"""
SMTP: šifrovanje lozinke + slanje kroz Podešavanja.

Zašto ovaj test postoji: pre 16.07.2026. worker je slao preko SMTP_* iz .env i potpuno
ignorisao ekran Podešavanja, a lozinku je čuvao u čistom tekstu (uz komentar u šemi koji
je tvrdio suprotno). Kvar se NIJE video — ništa ne pukne, podsetnik samo ne stigne.
Ovaj test čuva da se to ne vrati.

Radi nad lokalnim Mailpit-om i vraća podešavanja na zatečeno stanje kad završi.
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
MAILPIT = 'http://localhost:8025/api/v1'
TEST_PASSWORD = 'tajna-lozinka-za-test'
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
ok = fail = 0


def call(m, p, b=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    if d:
        r.add_header('Content-Type', 'application/json')
    if m != 'GET':
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
    return subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton',
                           '-t', '-A', '-c', sql], capture_output=True, text=True).stdout.strip()


def check(label, cond, detail=''):
    global ok, fail
    print(f'  [{"OK  " if cond else "FAIL"}] {label}' + (f'  → {detail}' if detail else ''))
    if cond:
        ok += 1
    else:
        fail += 1


call('GET', '/settings')
if call('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})[0] != 200:
    raise SystemExit('Prijava nije uspela — je li API podignut?')

ORIGINAL = call('GET', '/settings')[1]


def restore():
    """Vrati SMTP na zatečeno — test ne sme da ostavi svoja podešavanja u demou."""
    cur = call('GET', '/settings')[1]
    if not cur:
        return
    body = dict(cur)
    body.update({'smtpHost': ORIGINAL.get('smtpHost'), 'smtpPort': ORIGINAL.get('smtpPort'),
                 'smtpUsername': ORIGINAL.get('smtpUsername'), 'senderEmail': ORIGINAL.get('senderEmail'),
                 'smtpPassword': None})
    call('PATCH', '/settings', body)
    if not ORIGINAL.get('hasSmtpPassword'):
        db('UPDATE settings SET smtp_password=NULL WHERE id=1')


atexit.register(restore)
urllib.request.urlopen(urllib.request.Request(f'{MAILPIT}/messages', method='DELETE'))  # čist Mailpit

print('── Lozinka se ŠIFRUJE pri upisu (ne stoji u čistom tekstu) ──')
body = dict(ORIGINAL)
body.update({'smtpHost': 'localhost', 'smtpPort': 1025, 'smtpUsername': None,
             'senderEmail': 'servis@autoservis-s23.rs', 'smtpPassword': TEST_PASSWORD})
st, r = call('PATCH', '/settings', body)
check('podešavanja sačuvana', st == 200, '' if st == 200 else str(r))
stored = db('SELECT smtp_password FROM settings WHERE id=1')
check('lozinka NIJE u čistom tekstu', TEST_PASSWORD not in stored, f'u bazi: {stored[:24]}…')
check('zapisana kao AES-GCM (v1:iv:tag:šifrat)', stored.startswith('v1:') and len(stored.split(':')) == 4, stored[:24] + '…')
check('API nikad ne vraća lozinku', isinstance(r, dict) and r.get('hasSmtpPassword') is True and 'smtpPassword' not in r,
      f"hasSmtpPassword={r.get('hasSmtpPassword') if isinstance(r, dict) else '?'}")

print('\n── Slanje ide kroz PODEŠAVANJA, ne kroz .env ──')
st, t = call('POST', '/settings/test-email', {'to': 'mario@example.com'})
check('probni mejl poslat', st == 200, '' if st == 200 else str(t))
# Ovo usput dokazuje i da dešifrovanje radi: loadSmtp bi pukao na pogrešnom ključu.
check('izvor podešavanja = baza (ne .env)', isinstance(t, dict) and t.get('source') == 'settings',
      str(t.get('source') if isinstance(t, dict) else t))

print('\n── Mejl je stvarno stigao ──')
with urllib.request.urlopen(f'{MAILPIT}/messages') as x:
    msgs = json.loads(x.read())
m = (msgs.get('messages') or [None])[0]
check('mejl primljen u Mailpit', m is not None, f"{msgs.get('total', 0)} poruka")
if m:
    check('primalac tačan', m['To'][0]['Address'] == 'mario@example.com', m['To'][0]['Address'])
    check('pošiljalac iz Podešavanja', m['From']['Address'] == 'servis@autoservis-s23.rs', m['From']['Address'])
    check('ime servisa u naslovu', 'AUTO SERVIS S23' in m['Subject'], m['Subject'])

print('\n── Neispravan SMTP → jasna greška, ne tiho ćutanje ──')
bad = dict(call('GET', '/settings')[1])
bad.update({'smtpHost': 'localhost', 'smtpPort': 9999, 'smtpUsername': None, 'smtpPassword': None})
call('PATCH', '/settings', bad)
st, e = call('POST', '/settings/test-email', {'to': 'mario@example.com'})
check('odbijeno sa 422', st == 422, str(st))
check('kod je SMTP_FAILED', isinstance(e, dict) and e.get('code') == 'SMTP_FAILED',
      str(e.get('code') if isinstance(e, dict) else e))
check('poruka kaže šta ne valja', isinstance(e, dict) and 'ECONNREFUSED' in e.get('message', ''),
      (e.get('message', '') if isinstance(e, dict) else '')[:60])

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
