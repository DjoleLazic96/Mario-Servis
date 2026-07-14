"""
Acceptance test za V1 — prati tačno scenario iz primopredaje.
Kreira sopstvene entitete (svež klijent/vozilo), ne oslanja se na zatečeno stanje.
"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')   # Windows konzola je podrazumevano cp1252
import subprocess
import urllib.request
import urllib.error
import http.cookiejar
from urllib.parse import quote as urlq

BASE = 'http://localhost:3000/api/v1'
admin = http.cookiejar.CookieJar()
admin_op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(admin))
user = http.cookiejar.CookieJar()
user_op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(user))

ok = fail = 0


def csrf(jar):
    return next((c.value for c in jar if c.name == 'XSRF-TOKEN'), '')


def mk(opener, jar):
    def call(method, path, body=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        if data:
            req.add_header('Content-Type', 'application/json')
        if method not in ('GET', 'HEAD'):
            req.add_header('X-CSRF-Token', csrf(jar))
        try:
            with opener.open(req) as r:
                p = r.read()
                return r.status, (p if raw else (json.loads(p) if p else None))
        except urllib.error.HTTPError as e:
            p = e.read()
            try:
                return e.code, json.loads(p)
            except Exception:
                return e.code, p
    return call


A = mk(admin_op, admin)     # admin klijent
U = mk(user_op, user)       # obični korisnik


def check(label, cond, detail=''):
    global ok, fail
    mark = 'OK  ' if cond else 'FAIL'
    (globals().__setitem__('ok', ok + 1) if cond else globals().__setitem__('fail', fail + 1))
    print(f'  [{mark}] {label}' + (f'  → {detail}' if detail else ''))


def code(r):
    return r.get('code') if isinstance(r, dict) else str(r)


def db(sql):
    return subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton', '-t', '-A', '-c', sql],
                          capture_output=True, text=True).stdout.strip()


# ═══════════════════════ PRIPREMA ═══════════════════════
A('GET', '/settings')
st, _ = A('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
assert st == 200, 'admin prijava pala'

# napravi običnog korisnika (za test rola) i prijavi ga
n = len(A('GET', '/users')[1])
uemail = f'radnik{n}@karton.local'
A('POST', '/users', {'name': 'Radnik Test', 'email': uemail, 'password': 'radnik123', 'role': 'user'})
U('GET', '/settings')
st, _ = U('POST', '/auth/login', {'email': uemail, 'password': 'radnik123'})
assert st == 200, 'korisnik prijava pala'

# jedinstven VIN po pokretanju (izbegava DUPLICATE_VIN pri ponovnom pokretanju)
vcount = A('GET', '/vehicles?pageSize=1')[1]['meta']['total']
VIN = f'ACPT{vcount:013d}'

print('\n╔═══════════════════ OSNOVNI POSLOVNI TOK ═══════════════════╗')

# 1. klijent
st, cust = A('POST', '/customers', {'type': 'company', 'name': f'Primopredaja DOO {vcount}',
                                    'taxId': f'{100000000 + vcount}', 'address': 'Testna 1, Beograd',
                                    'email': 'test@primopredaja.rs', 'phone': '0601112223'})
check('1. Kreiranje klijenta', st == 201, cust.get('name') if isinstance(cust, dict) else str(st))

# 2. vozilo sa VIN-om  +  3. vlasništvo i tablica (u istom pozivu — BR-01/03)
st, veh = A('POST', '/vehicles', {'vin': VIN, 'make': 'Škoda', 'model': 'Octavia', 'year': 2018,
                                  'fuel': 'Dizel', 'plate': f'BG{vcount:04d}-AA', 'ownerId': cust['id']})
check('2. Vozilo sa VIN-om', st == 201 and veh['vin'] == VIN, VIN)
check('3. Vlasništvo i tablica', st == 201 and veh['currentOwner']['id'] == cust['id'] and veh['currentPlate'] is not None,
      f"{veh['currentPlate']} / {veh['currentOwner']['name']}" if st == 201 else str(st))

# 4. ponuda
st, quote = A('POST', '/documents', {'type': 'quote', 'customerId': cust['id'], 'vehicleId': veh['id'],
                                     'amountEur': 300, 'note': 'Procena za veliki servis.',
                                     'items': [{'itemType': 'labor', 'name': 'Veliki servis', 'amount': 12000},
                                               {'itemType': 'part', 'name': 'Filteri i ulje', 'amount': 9000}]})
check('4. Kreiranje ponude', st == 201, quote.get('number') if isinstance(quote, dict) else str(st))

# 5. prihvatanje ponude
st, acc = A('POST', f"/documents/{quote['id']}/accept", {'version': quote['version']})
check('5. Prihvatanje ponude', st == 200 and acc['status'] == 'accepted', code(acc) if st != 200 else 'accepted')

# 6. radni nalog iz ponude
st, wo = A('POST', '/work-orders', {'vehicleId': veh['id'], 'sourceQuoteId': quote['id'],
                                    'odometerKm': 95000, 'requestedWork': 'Uraditi veliki servis po ponudi.'})
check('6. Radni nalog iz ponude', st == 201 and wo['sourceQuoteId'] == quote['id'],
      wo.get('number') if isinstance(wo, dict) else code(wo))

# 7. Utvrđeno stanje (findings)
st, wo = A('PATCH', f"/work-orders/{wo['id']}", {'receivedOn': wo['receivedOn'],
                                                 'requestedWork': wo['requestedWork'],
                                                 'findings': 'Zamena razvodnog kaiša preporučena — pukotine na kaišu.',
                                                 'version': wo['version']})
check('7. Unos "Utvrđenog stanja"', st == 200 and 'razvodnog' in (wo.get('findings') or ''), str(st))

woid = wo['id']

# 8. stavka rada sa majstorom
st, mechs = A('GET', '/mechanics')
if not mechs:
    st, m = A('POST', '/mechanics', {'fullName': 'Acceptance Majstor', 'specialty': 'mechanical', 'hourlyRate': 2500})
    mechs = [m]
mid = mechs[0]['id']
st, wo = A('POST', f'/work-orders/{woid}/labor-items', {'mechanicId': mid, 'name': 'Veliki servis',
                                                        'billingUnit': 'hour', 'quantity': 4, 'unitPrice': 2500})
check('8. Stavka rada sa majstorom', st == 201, f"labor: {len(wo['laborItems'])}" if st == 201 else str(st))

# 9. deo
st, wo = A('POST', f'/work-orders/{woid}/part-items', {'name': 'Set filtera', 'quantity': 1, 'unitPrice': 6500})
check('9. Dodavanje dela', st == 201, f"parts: {len(wo['partItems'])}" if st == 201 else str(st))

# 10. eksterni servis
st, wo = A('POST', f'/work-orders/{woid}/external-items', {'vendorName': 'Auto Elektro Nikolić',
                                                          'description': 'Provera alternatora', 'price': 2000})
check('10. Eksterni servis', st == 201, f"external: {len(wo['externalItems'])}" if st == 201 else str(st))

# 11. interna stavka (ne naplaćuje se)
st, wo = A('POST', f'/work-orders/{woid}/part-items', {'name': 'WD-40 (interno)', 'quantity': 1,
                                                       'unitPrice': 800, 'internalNoCharge': True})
check('11. Interna stavka na nalogu', st == 201 and any(p['internalNoCharge'] for p in wo['partItems']),
      'internalNoCharge=true')

# 12. interna stavka NIJE u zbiru za klijenta
billable = sum(p['amount'] for p in wo['partItems'] if not p['internalNoCharge'])
check('12a. Interna stavka nije u zbiru delova', wo['totals']['parts'] == billable, f"{wo['totals']['parts']} RSD")

# 13. predračun
st, pf = A('POST', '/documents', {'type': 'proforma', 'workOrderId': woid})
check('13. Kreiranje predračuna', st == 201, pf.get('number') if isinstance(pf, dict) else code(pf))
pf_names = [i['name'] for i in pf['items']] if st == 201 else []
check('12b. Interna stavka NIJE na predračunu', 'WD-40 (interno)' not in pf_names, ', '.join(pf_names))

# 14. konverzija u račun
st, inv = A('POST', f"/documents/{pf['id']}/convert", {'dueOn': '2026-08-01', 'version': pf['version']})
check('14. Konverzija u račun', st == 201 and inv['type'] == 'invoice', inv.get('number') if isinstance(inv, dict) else code(inv))

# 15. plaćeno
st, inv = A('POST', f"/documents/{inv['id']}/mark-paid", {'paidOn': '2026-07-10', 'paymentMethod': 'prenos', 'version': inv['version']})
check('15. Račun plaćen', st == 200 and inv['status'] == 'paid', str(st))

# 16. izveštaj prihoda po datumu plaćanja
st, rev = A('GET', '/reports/revenue?from=2026-07-01&to=2026-07-31')
month = next((m for m in rev['byMonth'] if m['month'] == '2026-07'), None)
check('16. Prihod po datumu plaćanja', st == 200 and month is not None and month['total'] > 0,
      f"jul: {month['total']} RSD" if month else 'nema')

# 17. dokumentna traka (nalog i vozilo nose chain; klijent nosi istoriju naloga)
st, wod = A('GET', f'/work-orders/{woid}')
ch = wod['chain']
check('17a. Traka na nalogu (ponuda→RN→predračun→račun)',
      ch['quote'] and ch['workOrder'] and ch['proforma'] and ch['invoice'],
      f"{ch['quote']['number']} · {ch['workOrder']['number']} · {ch['proforma']['number']} · {ch['invoice']['number']}")
st, vdocs = A('GET', f"/documents?vehicleId={veh['id']}")
check('17b. Dokumenti dostupni po vozilu', st == 200 and len(vdocs['data']) >= 3, f"{len(vdocs['data'])} dok.")
st, cwos = A('GET', f"/work-orders?customerId={cust['id']}")
check('17c. Istorija naloga po klijentu', st == 200 and cwos['meta']['total'] >= 1, f"{cwos['meta']['total']} nalog(a)")

# 18. štampa / PDF (prijemni list je zasebna A4 ruta van app ljuske)
st, pl = A('GET', f'/work-orders/{woid}')  # podaci koje prijemni list koristi
# sama ruta štampe je na web sloju:
import urllib.request as _u
try:
    with _u.urlopen(f'http://localhost:5173/nalozi/{woid}/stampa') as r:
        print_status = r.status
except Exception as e:
    print_status = getattr(e, 'code', 0)
check('18. Ruta prijemnog lista (Save as PDF je browser akcija)', print_status == 200, f'HTTP {print_status}')


print('\n╔═══════════════════ NEGATIVNI TESTOVI ═══════════════════╗')

# 1. drugi aktivni predračun
st, r = A('POST', '/documents', {'type': 'proforma', 'workOrderId': woid})
check('1. Drugi aktivan predračun odbijen', st == 422 and code(r) in ('ACTIVE_PROFORMA_EXISTS', 'ACTIVE_INVOICE_EXISTS'), code(r))

# 2. drugi račun
st, r = A('POST', f"/documents/{pf['id']}/convert", {'dueOn': '2026-08-01', 'version': 999})
check('2. Drugi račun / konverzija odbijena', st in (409, 422), code(r))

# 3. kopiranje računa
st, r = A('POST', f"/documents/{inv['id']}/copy", {})
check('3. Kopiranje računa odbijeno', st == 422 and code(r) == 'COPY_NOT_ALLOWED', code(r))

# 4. izmena snapshot dokumenta (računa)
st, r = A('PATCH', f"/documents/{inv['id']}", {'note': 'hack', 'version': inv['version']})
check('4. Izmena snapshot dokumenta odbijena', st == 422 and code(r) == 'SNAPSHOT_IMMUTABLE', code(r))

# 5. korisnik radi admin-only akciju
st, r = U('GET', '/users')
check('5a. Korisnik ne vidi /users', st == 403, code(r))
st, r = U('POST', '/backup/run', {})
check('5b. Korisnik ne pokreće backup', st == 403, code(r))
st, s = A('GET', '/settings')
st, r = U('PATCH', '/settings', {**{k: v for k, v in s.items() if k not in ('logo', 'hasSmtpPassword')}})
check('5c. Korisnik ne menja podešavanja', st == 403, code(r))

# 6. termin na blokiran dan
A('POST', '/calendar-blocks', {'fromDate': '2026-12-25', 'toDate': '2026-12-25', 'reason': 'Praznik'})
st, r = A('POST', '/appointments', {'date': '2026-12-25', 'time': '10:00', 'customerId': cust['id'],
                                    'vehicleId': veh['id'], 'remindersEnabled': False})
check('6. Termin na blokiran dan odbijen', st == 422 and code(r) == 'CALENDAR_BLOCKED', code(r))

# 7. termin van radnog vremena (upozorenje, ne blokada)
st, r = A('POST', '/appointments', {'date': '2026-09-10', 'time': '05:00', 'customerId': cust['id'],
                                    'vehicleId': veh['id'], 'remindersEnabled': False})
warns = r.get('warnings', []) if isinstance(r, dict) else []
check('7. Termin van radnog vremena upozorava', st == 409 and 'OUTSIDE_WORK_HOURS' in warns, ','.join(warns))

# 8. preklapanje zauzetog majstora
A('POST', '/appointments', {'date': '2026-09-11', 'time': '10:00', 'durationMin': 60, 'customerId': cust['id'],
                            'vehicleId': veh['id'], 'mechanicId': mid, 'remindersEnabled': False, 'confirmed': True})
st, r = A('POST', '/appointments', {'date': '2026-09-11', 'time': '10:30', 'durationMin': 60, 'customerId': cust['id'],
                                    'vehicleId': veh['id'], 'mechanicId': mid, 'remindersEnabled': False})
warns = r.get('warnings', []) if isinstance(r, dict) else []
check('8. Preklapanje zauzetog majstora upozorava', st == 409 and 'MECHANIC_BUSY' in warns, ','.join(warns))

# 9. izmena zastarele verzije
st, r = A('PATCH', f'/work-orders/{woid}', {'receivedOn': wod['receivedOn'], 'version': 1})
check('9. Zastarela verzija odbijena', st == 409 and code(r) == 'VERSION_CONFLICT', code(r))

# 10. maliciozno sortiranje
st, r = A('GET', '/work-orders?sort=DROP;--:asc')
check('10a. sort=DROP;-- bezbedno odbačen', st == 200 and 'data' in r, f"{len(r.get('data', []))} redova")
st, r = A('GET', '/customers?q=' + urlq("' OR 1=1--"))
check('10b. injection u pretrazi bezbedan', st == 200 and 'data' in r, f"{len(r.get('data', []))} rezultata")


print('\n╔═══════════════════ BACKUP / RESTORE ═══════════════════╗')

# 1. kreiranje backupa
before_tables = int(db("SELECT count(*) FROM pg_tables WHERE schemaname='public'"))
st, run = A('POST', '/backup/run')
check('1. Kreiranje backupa', st == 201, str(st))

# 2. upis u evidenciju
st, runs = A('GET', '/backup/runs')
good = runs[0] if runs else None
check('2. Upis u evidenciju backupa', good is not None and good['status'] == 'success',
      f"{good['sizeBytes']} B" if good else 'nema')

# 3. namerno neuspešan restore (pokvaren dump)
path = good['destination']
orig = open(path, encoding='utf-8').read()
open(path, 'w', encoding='utf-8').write(orig + '\nINSERT INTO nepostojeca_tabela VALUES (1);\n')
st, r = A('POST', '/backup/restore', {'runId': good['id'], 'confirm': 'VRATI IZ BACKUPA', 'reason': 'Test pokvarenog dumpa.'})
check('3. Pokvaren dump → RESTORE_FAILED', st == 500 and code(r) == 'RESTORE_FAILED', code(r))

# 4. baza netaknuta
after_tables = int(db("SELECT count(*) FROM pg_tables WHERE schemaname='public'"))
check('4. Baza netaknuta posle neuspelog restore-a', after_tables == before_tables, f'{after_tables} tabela')
st, s = A('GET', '/settings')
check('   (aplikacija i dalje radi)', st == 200)

# vrati ispravan dump
open(path, 'w', encoding='utf-8').write(orig)

# 8+9. potvrda i razlog OBAVEZNI (pre uspešnog testa)
st, r = A('POST', '/backup/restore', {'runId': good['id'], 'confirm': 'da', 'reason': 'x'})
check('8. Pogrešna fraza odbijena', st == 400, code(r))
st, r = A('POST', '/backup/restore', {'runId': good['id'], 'confirm': 'VRATI IZ BACKUPA'})
check('9. Razlog obavezan', st == 400, code(r))

# 5. uspešan restore
st, r = A('POST', '/backup/restore', {'runId': good['id'], 'confirm': 'VRATI IZ BACKUPA', 'reason': 'Acceptance test vraćanja.'})
check('5. Uspešan restore validnog dumpa', st == 200 and r.get('restored') is True, str(st))

# 6. sve sesije odjavljene
st, _ = A('GET', '/settings')
check('6a. Admin sesija poništena posle restore-a', st == 401, str(st))
st, _ = U('GET', '/settings')
check('6b. Korisnička sesija poništena posle restore-a', st == 401, str(st))

# 7. audit zapis za restore (prijavi se ponovo da bismo proverili)
A('GET', '/settings')
A('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
restored_audit = db("SELECT count(*) FROM audit_log WHERE action='backup.restored'")
check('7. Audit zapis za restore', int(restored_audit) >= 1, f'{restored_audit} zapis(a)')


print(f'\n═══════════════════ UKUPNO: {ok} prošlo, {fail} palo ═══════════════════')
sys.exit(1 if fail else 0)
