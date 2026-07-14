"""
Podsetnici: kada se šalju.

Regresija za bug (15.07.2026): vreme podsetnika iz Podešavanja je BEOGRADSKO zidno vreme,
ali se upisivalo kroz `::timestamptz` uz UTC sesiju — pa je 09:00 postajalo 11:00 po Beogradu
(podsetnici su kasnili 2h leti / 1h zimi).

Test radi sa FIKSNIM podacima koje sam obriše pre i posle sebe — ne ostavlja smeće u bazi
i može da se pokreće koliko god puta.
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error
import http.cookiejar

sys.stdout.reconfigure(encoding='utf-8')   # Windows konzola je podrazumevano cp1252

BASE = 'http://localhost:3000/api/v1'
VIN = 'REMINDERTEST00001'      # fiksno — test sam čisti za sobom
NAME = 'Test Podsetnik'
APPT_DATE = '2027-03-18'       # daleko u budućnosti, letnje računanje vremena
SEND_DATE = '2027-03-17'       # dan pre

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
      DELETE FROM appointment_reminder WHERE appointment_id IN
        (SELECT a.id FROM appointment a JOIN vehicle v ON v.id=a.vehicle_id WHERE v.vin='{VIN}');
      DELETE FROM appointment WHERE vehicle_id IN (SELECT id FROM vehicle WHERE vin='{VIN}');
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


cleanup()                                   # ako je prethodni pokušaj pukao na pola
call('GET', '/settings')                    # uzmi CSRF cookie
st, _ = call('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
if st != 200:
    raise SystemExit('Prijava nije uspela — je li API podignut i seed odrađen?')

send_time = call('GET', '/settings')[1]['reminderSendTime']   # npr. '09:00', beogradsko zidno vreme
print(f'=== Vreme podsetnika iz Podešavanja: {send_time} (beogradsko) ===\n')

try:
    st, c = call('POST', '/customers', {'type': 'individual', 'name': NAME, 'email': 'podsetnik@example.com'})
    assert st == 201, c
    st, v = call('POST', '/vehicles', {'vin': VIN, 'make': 'Test', 'model': 'Podsetnik', 'ownerId': c['id']})
    assert st == 201, v
    st, a = call('POST', '/appointments', {'date': APPT_DATE, 'time': '10:00', 'customerId': c['id'],
                                           'vehicleId': v['id'], 'remindersEnabled': True, 'confirmed': True})
    assert st == 201, a

    # Kada je podsetnik zakazan — vraćeno u beogradsko vreme
    row = db(f"""SELECT to_char(scheduled_send_at AT TIME ZONE 'Europe/Belgrade','YYYY-MM-DD HH24:MI')
                 FROM appointment_reminder WHERE appointment_id={a['id']}""")

    print('── Pravilo: DAN PRE termina, u vreme iz Podešavanja (po beogradskom vremenu) ──')
    check('podsetnik je zakazan', bool(row), row)
    check(f'šalje se DAN PRE termina ({APPT_DATE} → {SEND_DATE})', row.startswith(SEND_DATE), row)
    check(f'šalje se u {send_time} PO BEOGRADU (ne u UTC)', row.endswith(send_time),
          f'zakazano: {row}  ·  očekivano: {SEND_DATE} {send_time}')
finally:
    cleanup()

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
