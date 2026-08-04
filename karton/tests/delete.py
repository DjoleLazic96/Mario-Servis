"""
Brisanje majstora / vozila / radnih naloga (SAMO admin, samo „čisto").

Novo (18.07.2026): admin može da obriše greškom uneto. Kočnice:
- majstor: blokada ako je radio na nalozima (stavke rada);
- vozilo: blokada ako ima naloge/dokumente/termine;
- nalog: blokada ako ima dokument ili je osnov reklamacije.
Ne-admin nema pravo brisanja (403).

Test sam pravi i briše svoje podatke (fiksni markeri), pa se pokreće više puta.
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error
import http.cookiejar
import atexit

sys.stdout.reconfigure(encoding='utf-8')
BASE = 'http://localhost:3000/api/v1'
VIN_CLEAN = 'DELCLEAN000000001'
VIN_HIST = 'DELHIST0000000001'
NAME = 'Brisko Testić'
MECH_CLEAN = 'Brisko Čist Majstor'
MECH_HIST = 'Brisko Istorija Majstor'
USER_EMAIL = 'brisko.user@test.local'

ok = fail = 0


def mkclient():
    jar = http.cookiejar.CookieJar()
    return jar, urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


jar, op = mkclient()


def call(m, p, b=None, opener=None, j=None):
    opener = opener or op
    j = j if j is not None else jar
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    if d:
        r.add_header('Content-Type', 'application/json')
    if m not in ('GET', 'HEAD'):
        r.add_header('X-CSRF-Token', next((c.value for c in j if c.name == 'XSRF-TOKEN'), ''))
    try:
        with opener.open(r) as x:
            y = x.read()
            return x.status, (json.loads(y) if y else None)
    except urllib.error.HTTPError as e:
        y = e.read()
        try:
            return e.code, json.loads(y)
        except ValueError:
            return e.code, y


def db(sql):
    r = subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton', '-t', '-A', '-c', sql],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'psql greška: {r.stderr.strip()}')
    return r.stdout.strip()


def cleanup():
    db(f"""
      DELETE FROM labor_item WHERE work_order_id IN (SELECT wo.id FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id WHERE v.vin IN ('{VIN_CLEAN}','{VIN_HIST}'));
      DELETE FROM document_item WHERE document_id IN (SELECT id FROM document WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin IN ('{VIN_CLEAN}','{VIN_HIST}')));
      DELETE FROM document WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin IN ('{VIN_CLEAN}','{VIN_HIST}'));
      DELETE FROM work_order WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin IN ('{VIN_CLEAN}','{VIN_HIST}'));
      DELETE FROM registration_history WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin IN ('{VIN_CLEAN}','{VIN_HIST}'));
      DELETE FROM ownership_history WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin IN ('{VIN_CLEAN}','{VIN_HIST}'));
      DELETE FROM vehicle WHERE vin IN ('{VIN_CLEAN}','{VIN_HIST}');
      DELETE FROM customer_contact WHERE customer_id IN (SELECT id FROM customer WHERE name='{NAME}');
      DELETE FROM customer WHERE name='{NAME}';
      DELETE FROM mechanic WHERE full_name IN ('{MECH_CLEAN}','{MECH_HIST}');
      DELETE FROM app_user WHERE email='{USER_EMAIL}';
    """)


def check(label, cond, detail=''):
    global ok, fail
    print(f'  [{"OK  " if cond else "FAIL"}] {label}' + (f'  → {detail}' if detail else ''))
    ok += 1 if cond else 0
    fail += 0 if cond else 1


cleanup()
atexit.register(cleanup)
call('GET', '/settings')
st, _ = call('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
if st != 200:
    raise SystemExit('Prijava nije uspela — je li API podignut i seed odrađen?')

# Zajednički podaci
st, cust = call('POST', '/customers', {'type': 'individual', 'name': NAME, 'phone': '0655550000'}); assert st == 201, cust

print('=== MAJSTOR ===')
st, mc = call('POST', '/mechanics', {'fullName': MECH_CLEAN, 'specialty': 'mechanical', 'hourlyRate': 1000, 'hiredOn': '2026-01-01'}); assert st == 201, mc
st, _ = call('DELETE', f"/mechanics/{mc['id']}")
check('Admin briše majstora bez istorije', st == 204, f'HTTP {st}')
check('Obrisani majstor ga više nema', call('GET', '/mechanics')[1] is not None and not any(m['id'] == mc['id'] for m in call('GET', '/mechanics')[1]))

# Majstor sa radom → blokada
st, mh = call('POST', '/mechanics', {'fullName': MECH_HIST, 'specialty': 'mechanical', 'hourlyRate': 1000, 'hiredOn': '2026-01-01'}); assert st == 201, mh
st, vh = call('POST', '/vehicles', {'vin': VIN_HIST, 'make': 'Test', 'model': 'Hist', 'ownerId': cust['id']}); assert st == 201, vh
st, woh = call('POST', '/work-orders', {'vehicleId': vh['id'], 'requestedWork': 'test'}); assert st == 201, woh
st, li = call('POST', f"/work-orders/{woh['id']}/labor-items", {'mechanicId': mh['id'], 'name': 'rad', 'billingUnit': 'hour', 'quantity': 1, 'unitPrice': 1000, 'amount': 1000}); assert st in (200, 201), li
st, r = call('DELETE', f"/mechanics/{mh['id']}")
check('Majstor sa radom NE može da se obriše', st == 422 and r.get('code') == 'HAS_HISTORY', f"HTTP {st} {r.get('code')}")

print('\n=== VOZILO ===')
st, vc = call('POST', '/vehicles', {'vin': VIN_CLEAN, 'make': 'Test', 'model': 'Clean', 'ownerId': cust['id']}); assert st == 201, vc
st, _ = call('DELETE', f"/vehicles/{vc['id']}")
check('Admin briše vozilo bez istorije', st == 204, f'HTTP {st}')
# vozilo VIN_HIST ima nalog → blokada
st, r = call('DELETE', f"/vehicles/{vh['id']}")
check('Vozilo sa nalogom NE može da se obriše', st == 422 and r.get('code') == 'HAS_HISTORY', f"HTTP {st} {r.get('code')}")

print('\n=== RADNI NALOG ===')
# nalog bez dokumenta → briše se (napravimo nov nalog na istom vozilu)
st, wo2 = call('POST', '/work-orders', {'vehicleId': vh['id'], 'requestedWork': 'brišljiv'}); assert st == 201, wo2
st, _ = call('DELETE', f"/work-orders/{wo2['id']}")
check('Admin briše nalog bez dokumenta', st == 204, f'HTTP {st}')
# nalog sa predračunom → blokada (woh već ima stavku rada)
st, prof = call('POST', '/documents', {'type': 'proforma', 'workOrderId': woh['id']})
if st == 201:
    st, r = call('DELETE', f"/work-orders/{woh['id']}")
    check('Nalog sa dokumentom NE može da se obriše', st == 422 and r.get('code') == 'HAS_DOCUMENTS', f"HTTP {st} {r.get('code')}")
else:
    check('Nalog sa dokumentom NE može da se obriše', False, f'predračun nije napravljen: {prof}')

print('\n=== NE-ADMIN ===')
st, u = call('POST', '/users', {'name': 'Brisko User', 'email': USER_EMAIL, 'password': 'lozinka123', 'role': 'user'}); assert st == 201, u
ujar, uop = mkclient()
call('GET', '/settings', opener=uop, j=ujar)
st, _ = call('POST', '/auth/login', {'email': USER_EMAIL, 'password': 'lozinka123'}, opener=uop, j=ujar); assert st == 200
st, mc2 = call('POST', '/mechanics', {'fullName': 'Za brisanje 403', 'specialty': 'other', 'hourlyRate': 500, 'hiredOn': '2026-01-01'}); assert st == 201, mc2
st, r = call('DELETE', f"/mechanics/{mc2['id']}", opener=uop, j=ujar)
check('Korisnik (ne-admin) ne može da briše', st == 403, f'HTTP {st}')
call('DELETE', f"/mechanics/{mc2['id']}")   # admin počisti tog majstora

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
