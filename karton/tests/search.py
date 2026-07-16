"""
Opseg pretrage po spiskovima.

Regresija za bug (16.07.2026): na strani Dokumenti pretraga „987" nije nalazila ništa,
iako vozilo ima tablicu BG987-ZZ. Uzrok NIJE bio „traži samo od početka" (LIKE je oduvek
bio '%…%'), nego opseg: Dokumenti su gledali samo broj i ime klijenta, a Klijenti samo
ime i PIB — tablicu nijedan.

Test radi sa FIKSNIM podacima koje sam obriše pre i posle sebe.
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error
import urllib.parse
import http.cookiejar
import atexit

sys.stdout.reconfigure(encoding='utf-8')   # Windows konzola je podrazumevano cp1252

BASE = 'http://localhost:3000/api/v1'
VIN = 'SEARCHTEST0000001'
NAME = 'Pretraga Testić'
PLATE = 'TS987-QQ'
MAKE = 'Testomobil'
MODEL = 'Pretragoslav'
PHONE = '0655551234'

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
ok = fail = 0


def call(m, p, b=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    if d:
        r.add_header('Content-Type', 'application/json')
    if m not in ('GET', 'HEAD'):
        r.add_header('X-CSRF-Token', next((c.value for c in jar if c.name == 'XSRF-TOKEN'), ''))
    try:
        with op.open(r) as x:
            y = x.read()
            return x.status, (json.loads(y) if y else None)
    except urllib.error.HTTPError as e:
        y = e.read()
        try:
            return e.code, json.loads(y)
        except ValueError:
            return e.code, y


def db(sql):
    r = subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton',
                        '-t', '-A', '-c', sql], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'psql greška: {r.stderr.strip()}')
    return r.stdout.strip()


def cleanup():
    """Briše sve što ovaj test pravi — redosledom koji poštuje strane ključeve."""
    db(f"""
      DELETE FROM document_item WHERE document_id IN
        (SELECT d.id FROM document d JOIN vehicle v ON v.id=d.vehicle_id WHERE v.vin='{VIN}');
      DELETE FROM document WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin='{VIN}');
      DELETE FROM registration_history WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin='{VIN}');
      DELETE FROM ownership_history WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin='{VIN}');
      DELETE FROM vehicle WHERE vin='{VIN}';
      DELETE FROM customer_contact WHERE customer_id IN (SELECT id FROM customer WHERE name='{NAME}');
      DELETE FROM customer WHERE name='{NAME}';
    """)


def check(label, cond, detail=''):
    global ok, fail
    print(f'  [{"OK  " if cond else "FAIL"}] {label}' + (f'  → {detail}' if detail else ''))
    if cond:
        ok += 1
    else:
        fail += 1


def found(path, q, needle_id):
    """Da li pretraga `q` na `path` vraća naš zapis?"""
    st, r = call('GET', f'{path}?q={urllib.parse.quote(q)}&pageSize=50')
    assert st == 200, r
    return any(x['id'] == needle_id for x in r['data'])


cleanup()
atexit.register(cleanup)

call('GET', '/settings')
st, _ = call('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
if st != 200:
    raise SystemExit('Prijava nije uspela — je li API podignut i seed odrađen?')

st, cust = call('POST', '/customers', {'type': 'individual', 'name': NAME, 'phone': PHONE})
assert st == 201, cust
st, veh = call('POST', '/vehicles', {'vin': VIN, 'make': MAKE, 'model': MODEL,
                                     'ownerId': cust['id'], 'plate': PLATE})
assert st == 201, veh
st, doc = call('POST', '/documents', {'type': 'quote', 'customerId': cust['id'], 'vehicleId': veh['id'],
                                      'items': [{'itemType': 'labor', 'name': 'Proba', 'quantity': 1,
                                                 'unitPrice': 1000, 'amount': 1000, 'billingUnit': 'hour'}]})
assert st == 201, doc

print('=== DOKUMENTI (bug je bio ovde) ===')
check('Tablica „987" nalazi dokument', found('/documents', '987', doc['id']), PLATE)
check('Cela tablica nalazi dokument', found('/documents', PLATE, doc['id']))
check('Marka „estomob" (sredina reči) nalazi dokument', found('/documents', 'estomob', doc['id']), MAKE)
check('Broj dokumenta i dalje nalazi (bez regresije)', found('/documents', doc['number'], doc['id']))
check('Ime klijenta i dalje nalazi (bez regresije)', found('/documents', 'Testić', doc['id']))
check('Besmislen pojam ne nalazi ništa', not found('/documents', 'zzzznemanicega', doc['id']))

print('\n=== KLIJENTI (bug je bio ovde) ===')
check('Tablica „987" nalazi klijenta', found('/customers', '987', cust['id']), PLATE)
check('Marka vozila nalazi klijenta', found('/customers', 'estomob', cust['id']))
check('Telefon „5551" (sredina broja) nalazi klijenta', found('/customers', '5551', cust['id']), PHONE)
check('Ime i dalje nalazi (bez regresije)', found('/customers', 'Testić', cust['id']))
check('Ime sa razmakom („pretraga test")', found('/customers', 'pretraga test', cust['id']))

print('\n=== VOZILA I NALOZI (nisu bili pokvareni — čuvamo od regresije) ===')
check('Vozila: „987" nalazi vozilo', found('/vehicles', '987', veh['id']))
check('Vozila: sredina VIN-a nalazi vozilo', found('/vehicles', 'CHTEST', veh['id']))

st, wo = call('POST', '/work-orders', {'vehicleId': veh['id'], 'receivedOn': '2026-07-17',
                                       'complaint': 'Proba pretrage'})
if st == 201:
    check('Nalozi: „987" nalazi nalog', found('/work-orders', '987', wo['id']))
    db(f"DELETE FROM work_order WHERE id={wo['id']}")
else:
    check('Nalozi: „987" nalazi nalog', False, f'nalog nije napravljen: {wo}')

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
