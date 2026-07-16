"""
Kočnica na prijavi: 5 promašaja sa iste adrese → ta adresa čeka 30 min.

Zaključava se ADRESA KOJA POGAĐA, ne nalog — namerno. Da zaključavamo nalog, svako
ko zna korisničko ime mogao bi da drži vlasnika trajno napolju.

Test čisti za sobom (briše svoje zapise iz login_throttle).
"""
import atexit
import json
import subprocess
import sys
import urllib.request
import urllib.error
import http.cookiejar

sys.stdout.reconfigure(encoding='utf-8')

BASE = 'http://localhost:3000/api/v1'
ok = fail = 0


def opener():
    """Svež kolačić-jar = novi „pregledač"; adresa ostaje ista (localhost)."""
    j = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(j)), j


def call(op, jar, m, p, b=None, spoof_ip=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    if d:
        r.add_header('Content-Type', 'application/json')
    if m != 'GET':
        r.add_header('X-CSRF-Token', next((c.value for c in jar if c.name == 'XSRF-TOKEN'), ''))
    if spoof_ip:
        r.add_header('X-Forwarded-For', spoof_ip)
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
    return subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton',
                           '-t', '-A', '-c', sql], capture_output=True, text=True).stdout.strip()


def cleanup():
    db('DELETE FROM login_throttle')


def check(label, cond, detail=''):
    global ok, fail
    print(f'  [{"OK  " if cond else "FAIL"}] {label}' + (f'  → {detail}' if detail else ''))
    if cond:
        ok += 1
    else:
        fail += 1


def code(r):
    return r.get('code') if isinstance(r, dict) else str(r)


atexit.register(cleanup)
cleanup()

print('── 4 promašaja još ne zaključavaju (omaška pri kucanju je normalna) ──')
op, jar = opener()
call(op, jar, 'GET', '/settings')
for i in range(4):
    st, r = call(op, jar, 'POST', '/auth/login', {'email': 'admin', 'password': 'pogresna'})
    if i == 3:
        check('4. promašaj → i dalje 401, ne zaključava', st == 401 and code(r) == 'UNAUTHENTICATED', f'{st} {code(r)}')

print('\n── Ispravna lozinka posle 4 promašaja PROLAZI i briše brojač ──')
st, r = call(op, jar, 'POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
check('prijava prošla', st == 200, f'{st} {code(r) if st != 200 else ""}')
check('brojač obrisan posle uspeha', db("SELECT count(*) FROM login_throttle") == '0',
      f"zapisa: {db('SELECT count(*) FROM login_throttle')}")

print('\n── 5. promašaj zaključava adresu ──')
op, jar = opener()
call(op, jar, 'GET', '/settings')
last = None
for i in range(5):
    st, last = call(op, jar, 'POST', '/auth/login', {'email': 'admin', 'password': 'pogresna'})
check('5. promašaj → 429', st == 429, f'{st} {code(last)}')
check('kod je TOO_MANY_ATTEMPTS', code(last) == 'TOO_MANY_ATTEMPTS', code(last))
check('poruka kaže koliko da čeka', isinstance(last, dict) and 'min' in last.get('message', ''),
      (last.get('message', '') if isinstance(last, dict) else '')[:52])

print('\n── Zaključana adresa ne može ni sa ISPRAVNOM lozinkom ──')
st, r = call(op, jar, 'POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
check('ispravna lozinka odbijena dok traje pauza', st == 429 and code(r) == 'TOO_MANY_ATTEMPTS', f'{st} {code(r)}')

print('\n── Pauza je ~30 min, ne zauvek ──')
mins = db("SELECT ceil(extract(epoch FROM (locked_until - now()))/60)::int FROM login_throttle LIMIT 1")
check('zaključano ~30 min', mins.isdigit() and 29 <= int(mins) <= 30, f'{mins} min')

print('\n── Admin pušta ranije ──')
adm, ajar = opener()
db('DELETE FROM login_throttle')                      # admin mora nekako da uđe
call(adm, ajar, 'GET', '/settings')
st, _ = call(adm, ajar, 'POST', '/auth/login', {'email': 'admin', 'password': 'admin'})
db("INSERT INTO login_throttle (ip, locked_until) VALUES ('203.0.113.7', now() + interval '30 min')")
st, locks = call(adm, ajar, 'GET', '/login-locks')
check('admin vidi zaključane adrese', st == 200 and any(l['ip'] == '203.0.113.7' for l in locks),
      f'{len(locks) if isinstance(locks, list) else "?"} zaključanih')
st, _ = call(adm, ajar, 'DELETE', '/login-locks/203.0.113.7')
check('admin pustio adresu (204)', st == 204, str(st))
check('adresa više nije zaključana', db("SELECT count(*) FROM login_throttle WHERE ip='203.0.113.7'") == '0')

print('\n── Napadač NE MOŽE da izbegne kočnicu lažiranjem adrese ──')
# Bez TRUST_PROXY (lokalno) X-Forwarded-For se MORA ignorisati — inače bi napadač
# slao lažnu adresu uz svaki pokušaj i pogađao neograničeno.
db('DELETE FROM login_throttle')
sp, sjar = opener()
call(sp, sjar, 'GET', '/settings')
last2 = None
for i in range(6):
    st, last2 = call(sp, sjar, 'POST', '/auth/login',
                     {'email': 'admin', 'password': 'pogresna'}, spoof_ip=f'9.9.9.{i}')
check('lažni X-Forwarded-For ne pomaže — i dalje zaključan', st == 429 and code(last2) == 'TOO_MANY_ATTEMPTS',
      f'{st} {code(last2)}')
ips = db("SELECT string_agg(ip, ',') FROM login_throttle")
check('brojano po PRAVOJ adresi, ne po lažnoj', '9.9.9.' not in ips, f'u bazi: {ips}')
db('DELETE FROM login_throttle')

print('\n── Običan korisnik ne sme da otključava ──')
# (nema drugog naloga u demou — proveravamo bar da ruta traži admina preko odjavljene sesije)
anon, ajar2 = opener()
st, r = call(anon, ajar2, 'GET', '/login-locks')
check('bez prijave → 401', st == 401, f'{st} {code(r)}')

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
