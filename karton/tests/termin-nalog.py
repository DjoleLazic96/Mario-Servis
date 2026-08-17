"""
Zakazivanje sa minimumom + „Napravi radni nalog" iz termina (18–19.08.2026).

Šta pokriva:
- Vozilo se pravi BEZ VIN-a (zakazivanje sa minimumom: ime klijenta + marka/model).
- VIN je jedinstven SAMO kad je popunjen (više vozila bez VIN-a je dozvoljeno; dva sa
  istim VIN-om nisu).
- „Napravi radni nalog" iz termina: nov nalog za vozilo/klijenta, napomena termina ide u
  „zahtevani rad", termin se realizuje i veže za nalog.
- Naknadni unos VIN-a i tablice se POVLAČI na nalog uživo (preko veze na vozilo), bez
  ikakve izmene samog naloga.
- VIN je nepromenljiv kada je već upisan (dopunjava se samo dok je prazan).

Test sam pravi i briše svoje podatke (fiksni marker MAKE), pa se pokreće više puta.
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error
import http.cookiejar
import atexit
from datetime import date, timedelta

sys.stdout.reconfigure(encoding='utf-8')
BASE = 'http://localhost:3000/api/v1'
CUST = 'Termin Testko NN'
MAKE = 'TerminTestVozilo'          # marker za čišćenje
VIN_HAS = 'TERMINTESTVIN0001'      # 17 znakova
VIN_FILL = 'TERMINTESTVIN9999'

ok = fail = 0
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


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
    r = subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton', '-t', '-A', '-c', sql],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'psql greška: {r.stderr.strip()}')
    return r.stdout.strip()


def cleanup():
    db(f"""
      DELETE FROM appointment_reminder WHERE appointment_id IN (SELECT id FROM appointment WHERE customer_text='Pera sa telefona' OR vehicle_text='Nissan Juke');
      DELETE FROM appointment WHERE customer_text='Pera sa telefona' OR vehicle_text='Nissan Juke';
      DELETE FROM appointment_reminder WHERE appointment_id IN (SELECT a.id FROM appointment a JOIN vehicle v ON v.id=a.vehicle_id WHERE v.make='{MAKE}');
      DELETE FROM appointment WHERE vehicle_id IN (SELECT id FROM vehicle WHERE make='{MAKE}');
      DELETE FROM labor_item WHERE work_order_id IN (SELECT wo.id FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id WHERE v.make='{MAKE}');
      DELETE FROM part_item WHERE work_order_id IN (SELECT wo.id FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id WHERE v.make='{MAKE}');
      DELETE FROM external_service_item WHERE work_order_id IN (SELECT wo.id FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id WHERE v.make='{MAKE}');
      DELETE FROM work_order WHERE vehicle_id IN (SELECT id FROM vehicle WHERE make='{MAKE}');
      DELETE FROM registration_history WHERE vehicle_id IN (SELECT id FROM vehicle WHERE make='{MAKE}');
      DELETE FROM ownership_history WHERE vehicle_id IN (SELECT id FROM vehicle WHERE make='{MAKE}');
      DELETE FROM vehicle WHERE make='{MAKE}';
      DELETE FROM customer_contact WHERE customer_id IN (SELECT id FROM customer WHERE name='{CUST}');
      DELETE FROM customer WHERE name='{CUST}';
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

st, cust = call('POST', '/customers', {'type': 'individual', 'name': CUST})
check('Klijent samo sa imenom (bez telefona/mejla)', st == 201, f'HTTP {st}')

print('=== VOZILO BEZ VIN-a (zakazivanje sa minimumom) ===')
st, v1 = call('POST', '/vehicles', {'make': MAKE, 'model': 'BezVina', 'ownerId': cust['id']})
check('Vozilo bez VIN-a se pravi (201)', st == 201, f'HTTP {st} {v1 if st != 201 else ""}')
check('VIN je null u odgovoru', st == 201 and v1.get('vin') is None, repr(v1.get('vin') if st == 201 else v1))
st, v2 = call('POST', '/vehicles', {'make': MAKE, 'model': 'BezVina2', 'ownerId': cust['id']})
check('Drugo vozilo bez VIN-a takođe prolazi (nema lažnog duplikata)', st == 201, f'HTTP {st}')

print('\n=== VIN JEDINSTVEN KADA POSTOJI ===')
st, vh = call('POST', '/vehicles', {'vin': VIN_HAS, 'make': MAKE, 'model': 'SaVinom', 'ownerId': cust['id']})
assert st == 201, vh
st, dup = call('POST', '/vehicles', {'vin': VIN_HAS, 'make': MAKE, 'model': 'Duplikat', 'ownerId': cust['id']})
check('Isti VIN → 409 DUPLICATE_VIN', st == 409 and dup.get('code') == 'DUPLICATE_VIN', f'HTTP {st} {dup.get("code")}')

print('\n=== TERMIN → „NAPRAVI RADNI NALOG" ===')
d = (date.today() + timedelta(days=2)).isoformat()
st, ap = call('POST', '/appointments', {'date': d, 'time': '10:00', 'durationMin': 60,
              'customerId': cust['id'], 'vehicleId': v1['id'], 'note': 'Servis kočnica',
              'remindersEnabled': False, 'confirmed': True})
check('Termin za vozilo bez VIN-a (201)', st == 201, f'HTTP {st} {ap if st != 201 else ""}')
st, wo = call('POST', '/work-orders', {'vehicleId': v1['id'], 'customerId': cust['id'], 'requestedWork': ap['note']})
check('Nalog iz termina napravljen (201)', st == 201, f'HTTP {st}')
st, _ = call('POST', f"/appointments/{ap['id']}/status", {'status': 'completed', 'workOrderId': wo['id'], 'version': ap['version']})
check('Termin realizovan i vezan za nalog', st == 200, f'HTTP {st}')
st, wo2 = call('GET', f"/work-orders/{wo['id']}")
check('Zahtevani rad prenet iz napomene termina', st == 200 and wo2.get('requestedWork') == 'Servis kočnica', repr(wo2.get('requestedWork') if st == 200 else wo2))
check('Nalog vidi vozilo bez VIN-a i bez tablice', st == 200 and wo2['vehicle'].get('vin') is None and wo2['vehicle'].get('plate') is None)
st, appts = call('GET', f"/appointments?from={d}&to={d}")
mine = next((a for a in (appts or []) if a['id'] == ap['id']), None)
check('Termin: status completed + workOrderId', bool(mine) and mine['status'] == 'completed' and mine['workOrderId'] == wo['id'],
      repr((mine['status'], mine['workOrderId']) if mine else None))

print('\n=== DOPUNA VIN/TABLICE → POVLAČI NA NALOG (uživo) ===')
st, _ = call('PATCH', f"/vehicles/{v1['id']}", {'vin': VIN_FILL, 'make': MAKE, 'model': 'BezVina'})
check('VIN se dopunjava kad je bio prazan (200)', st == 200, f'HTTP {st}')
st, _ = call('POST', f"/vehicles/{v1['id']}/registrations", {'plate': 'BG-TERMIN-01'})
check('Tablica se dodaje naknadno (201)', st == 201, f'HTTP {st}')
st, wo3 = call('GET', f"/work-orders/{wo['id']}")
check('Nalog POVLAČI dopunjeni VIN (uživo, bez diranja naloga)', st == 200 and wo3['vehicle'].get('vin') == VIN_FILL, repr(wo3['vehicle'].get('vin') if st == 200 else wo3))
check('Nalog POVLAČI dopunjenu tablicu (uživo)', st == 200 and wo3['vehicle'].get('plate') == 'BG-TERMIN-01', repr(wo3['vehicle'].get('plate') if st == 200 else None))

print('\n=== VIN NEPROMENLJIV KADA JE VEĆ UPISAN ===')
call('PATCH', f"/vehicles/{v1['id']}", {'vin': 'TERMINTESTVIN0002', 'make': MAKE, 'model': 'BezVina'})
st, vv = call('GET', f"/vehicles/{v1['id']}")
check('Izmena već upisanog VIN-a se ignoriše', st == 200 and vv.get('vin') == VIN_FILL, repr(vv.get('vin') if st == 200 else vv))

print('\n=== BRISANJE NALOGA VRAĆA TERMIN NA „ZAKAZANO" ===')
d3 = (date.today() + timedelta(days=4)).isoformat()
st, apx = call('POST', '/appointments', {'date': d3, 'time': '09:00', 'durationMin': 60,
              'customerId': cust['id'], 'vehicleId': v2['id'], 'note': 'Za brisanje',
              'remindersEnabled': False, 'confirmed': True})
assert st == 201, apx
st, wox = call('POST', '/work-orders', {'vehicleId': v2['id'], 'customerId': cust['id'], 'requestedWork': 'x'})
assert st == 201, wox
st, _ = call('POST', f"/appointments/{apx['id']}/status", {'status': 'completed', 'workOrderId': wox['id'], 'version': apx['version']})
check('Priprema: termin realizovan i vezan za nalog', st == 200, f'HTTP {st}')
st, _ = call('DELETE', f"/work-orders/{wox['id']}")
check('Prazan nalog se briše (204)', st == 204, f'HTTP {st}')
st, appts2 = call('GET', f"/appointments?from={d3}&to={d3}")
back = next((a for a in (appts2 or []) if a['id'] == apx['id']), None)
check('Posle brisanja naloga: termin vraćen na „zakazano"', bool(back) and back['status'] == 'scheduled', repr(back['status'] if back else None))
check('Posle brisanja naloga: veza na nalog skinuta', bool(back) and back['workOrderId'] is None, repr(back['workOrderId'] if back else None))

print('\n=== NEPOTPUN TERMIN (slobodan tekst) + SREĐIVANJE ===')
d2 = (date.today() + timedelta(days=3)).isoformat()
st, ld = call('POST', '/appointments', {'date': d2, 'time': '11:00', 'durationMin': 60,
              'customerText': 'Pera sa telefona', 'vehicleText': 'Nissan Juke',
              'remindersEnabled': True, 'confirmed': True})
check('Nepotpun termin (samo tekst) se pravi (201)', st == 201, f'HTTP {st} {ld if st != 201 else ""}')
check('Klijent je null, tekst stoji', st == 201 and ld.get('customer') is None and ld.get('customerText') == 'Pera sa telefona')
check('Vozilo je null, tekst stoji', st == 201 and ld.get('vehicle') is None and ld.get('vehicleText') == 'Nissan Juke')
# strana bez i id-a i teksta → 422
st, e1 = call('POST', '/appointments', {'date': d2, 'time': '12:00', 'vehicleText': 'X', 'confirmed': True})
check('Bez klijenta (ni id ni tekst) → 422', st == 422, f'HTTP {st}')
# podsetnik se NE zakazuje za nepotpun (nema koga da podseti)
rem = db(f"SELECT count(*) FROM appointment_reminder WHERE appointment_id={ld['id']}")
check('Nepotpun termin nema zakazan podsetnik', rem == '0', f'redova: {rem}')
# „sredi": poveži prave zapise → upisani tekst se briše
st, sr = call('PATCH', f"/appointments/{ld['id']}", {'date': d2, 'time': '11:00', 'durationMin': 60,
              'customerId': cust['id'], 'vehicleId': v2['id'], 'remindersEnabled': False, 'confirmed': True,
              'version': ld['version']})
check('Sređivanje (PATCH sa id-evima) prolazi (200)', st == 200, f'HTTP {st} {sr if st != 200 else ""}')
check('Po sređivanju: klijent vezan, tekst obrisan', st == 200 and sr.get('customer') and sr['customer']['id'] == cust['id'] and sr.get('customerText') is None)
check('Po sređivanju: vozilo vezano, tekst obrisan', st == 200 and sr.get('vehicle') and sr['vehicle']['id'] == v2['id'] and sr.get('vehicleText') is None)

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
