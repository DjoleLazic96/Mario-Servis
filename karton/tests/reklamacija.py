"""
Reklamacije + rok za delove.

Novo (17.07.2026):
- Reklamacija je NOV nalog vezan za stari: vozilo/klijent se preuzimaju, veza se vidi na oba,
  otvara se BEZ stavki (garancija).
- „Čeka delove" nosi očekivani datum i napomenu (dve odvojene kolone); brišu se izlaskom iz statusa.

Test sam pravi i briše svoje podatke (fiksni VIN), pa se pokreće više puta.
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
VIN = 'REKLAMTEST0000001'
NAME = 'Reklamacija Testić'

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
    db(f"""
      DELETE FROM part_item WHERE work_order_id IN
        (SELECT wo.id FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id WHERE v.vin='{VIN}');
      DELETE FROM labor_item WHERE work_order_id IN
        (SELECT wo.id FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id WHERE v.vin='{VIN}');
      DELETE FROM work_order WHERE source_work_order_id IN
        (SELECT wo.id FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id WHERE v.vin='{VIN}');
      DELETE FROM work_order WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin='{VIN}');
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


cleanup()
atexit.register(cleanup)

call('GET', '/settings')
st, _ = call('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
if st != 200:
    raise SystemExit('Prijava nije uspela — je li API podignut i seed odrađen?')

st, cust = call('POST', '/customers', {'type': 'individual', 'name': NAME, 'phone': '0651112223'})
assert st == 201, cust
st, veh = call('POST', '/vehicles', {'vin': VIN, 'make': 'Test', 'model': 'Reklamko', 'ownerId': cust['id'], 'plate': 'RT111-AA'})
assert st == 201, veh
st, orig = call('POST', '/work-orders', {'vehicleId': veh['id'], 'requestedWork': 'menjač zvoni'})
assert st == 201, orig

print('=== REKLAMACIJA ===')
st, rek = call('POST', f"/work-orders/{orig['id']}/reklamacija", {})
check('Reklamacija se pravi (201)', st == 201, f'HTTP {st}')
check('Reklamacija je NOV nalog (drugi id)', rek and rek['id'] != orig['id'])
check('Vozilo preuzeto sa originala', rek and rek['vehicle']['id'] == veh['id'])
check('Klijent preuzet sa originala', rek and rek['customer']['id'] == cust['id'])
check('Veza na original (sourceWorkOrderId)', rek and rek['sourceWorkOrderId'] == orig['id'])
check('Veza nosi broj originala', rek and rek['sourceWorkOrderNumber'] == orig['number'], rek and rek.get('sourceWorkOrderNumber'))
check('Reklamacija otvara se BEZ stavki', rek and len(rek['laborItems']) == 0 and len(rek['partItems']) == 0)

# Original mora da zna da je reklamiran
st, orig2 = call('GET', f"/work-orders/{orig['id']}")
check('Original vidi svoju reklamaciju', any(r['id'] == rek['id'] for r in orig2['reklamacije']),
      f"reklamacije: {[r['number'] for r in orig2['reklamacije']]}")

print('\n=== ROK ZA DELOVE ===')
# Prebaci reklamaciju na „Čeka delove" sa datumom + napomenom
st, wp = call('POST', f"/work-orders/{rek['id']}/status",
              {'status': 'waiting_parts', 'version': rek['version'],
               'partsExpectedOn': '2027-01-15', 'partsNote': 'naručeno kod Bosch-a'})
check('Prelaz na „Čeka delove" (200)', st == 200, f'HTTP {st}')
check('Datum delova upisan', wp and wp['partsExpectedOn'] == '2027-01-15', wp and wp.get('partsExpectedOn'))
check('Napomena o delovima upisana', wp and wp['partsNote'] == 'naručeno kod Bosch-a', wp and wp.get('partsNote'))

# Izlazak iz „Čeka delove" briše rok
st, back = call('POST', f"/work-orders/{rek['id']}/status", {'status': 'in_progress', 'version': wp['version']})
check('Izlazak iz „Čeka delove" briše datum', back and back['partsExpectedOn'] is None)
check('Izlazak iz „Čeka delove" briše napomenu', back and back['partsNote'] is None)

print('\n=== FILTER NEZAVRŠENIH ===')
st, active = call('GET', '/work-orders?active=true&pageSize=200')
check('active=true vraća samo nezavršene', st == 200 and all(
    o['status'] in ('open', 'in_progress', 'waiting_parts') for o in active['data']),
    f"statusi: {sorted(set(o['status'] for o in active['data']))}")
check('Naša reklamacija je među nezavršenima', any(o['id'] == rek['id'] for o in active['data']))

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
