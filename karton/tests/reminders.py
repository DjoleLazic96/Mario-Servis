"""
Podsetnici: kada se šalju.

Regresija za bug (15.07.2026): vreme podsetnika iz Podešavanja je BEOGRADSKO zidno vreme,
ali se upisivalo kroz `::timestamptz` uz UTC sesiju — pa je 09:00 postajalo 11:00 po Beogradu
(podsetnici su kasnili 2h leti / 1h zimi).
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error
import http.cookiejar

sys.stdout.reconfigure(encoding='utf-8')   # Windows konzola je podrazumevano cp1252

BASE = 'http://localhost:3000/api/v1'
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
ok = fail = 0


def csrf():
    return next((c.value for c in jar if c.name == 'XSRF-TOKEN'), '')


def call(m, p, b=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    if d:
        r.add_header('Content-Type', 'application/json')
    if m not in ('GET', 'HEAD'):
        r.add_header('X-CSRF-Token', csrf())
    try:
        with op.open(r) as x:
            y = x.read()
            return x.status, (json.loads(y) if y else None)
    except urllib.error.HTTPError as e:
        y = e.read()
        try:
            return e.code, json.loads(y)
        except Exception:
            return e.code, y


def db(sql):
    return subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton', '-t', '-A', '-c', sql],
                          capture_output=True, text=True).stdout.strip()


def check(label, cond, detail=''):
    global ok, fail
    print(f'  [{"OK  " if cond else "FAIL"}] {label}' + (f'  → {detail}' if detail else ''))
    globals().__setitem__('ok', ok + 1) if cond else globals().__setitem__('fail', fail + 1)


call('GET', '/settings')
assert call('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})[0] == 200

st, s = call('GET', '/settings')
send_time = s['reminderSendTime']          # npr. '09:00' — BEOGRADSKO zidno vreme
print(f'=== Vreme podsetnika iz Podešavanja: {send_time} (beogradsko) ===\n')

# klijent sa emailom + vozilo + termin u budućnosti
n = db('SELECT count(*) FROM customer')
st, c = call('POST', '/customers', {'type': 'individual', 'name': f'Podsetnik Test {n}',
                                    'email': f'podsetnik{n}@example.com'})
st, v = call('POST', '/vehicles', {'vin': f'REMI{int(n):013d}', 'make': 'Test', 'model': 'Podsetnik',
                                   'ownerId': c['id']})
APPT_DATE = '2027-03-18'                   # daleko u budućnosti, letnje računanje vremena
st, a = call('POST', '/appointments', {'date': APPT_DATE, 'time': '10:00', 'customerId': c['id'],
                                       'vehicleId': v['id'], 'remindersEnabled': True, 'confirmed': True})
assert st == 201, a

# Kada je podsetnik ZAKAZAN — pretvoreno nazad u beogradsko vreme
row = db(f"""SELECT to_char(scheduled_send_at AT TIME ZONE 'Europe/Belgrade','YYYY-MM-DD HH24:MI')
             FROM appointment_reminder WHERE appointment_id={a['id']}""")

print('── Pravilo: DAN PRE termina, u vreme iz Podešavanja (po beogradskom vremenu) ──')
check('podsetnik je zakazan', bool(row), row)
check(f'šalje se DAN PRE termina ({APPT_DATE} → 2027-03-17)', row.startswith('2027-03-17'), row)
check(f'šalje se u {send_time} PO BEOGRADU (ne u UTC!)', row.endswith(send_time),
      f'zakazano: {row}  ·  očekivano: 2027-03-17 {send_time}')

# čišćenje
call('DELETE', f"/appointments/{a['id']}")

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
