"""
Čitač saobraćajne (Go verzija) — kojim sajtovima helper sme da odgovori.

Regresija (17.07.2026): prijavljeno „čitač čita sa drugim programom, a kroz aplikaciju ne".
Uzrok NIJE bio ni čitač ni kartica: helper odgovara samo sajtovima sa spiska, a produkcijski
domen nije bio na njemu (dodavao se samo ako se prosledi kao argument). Živi sajt je dobijao 403.

Test NE traži čitač ni karticu — proverava samo sloj oko njih (dozvoljeni sajtovi, CORS, PNA),
tj. baš ono što je bilo pokvareno. Pokreće prevedeni .exe; ako ga nema a Go je na PATH-u, prevede ga.
"""
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

KOREN = Path(__file__).resolve().parents[2]
GO_DIR = KOREN / 'citac-saobracajne' / 'go'
SRC = GO_DIR / 'main.go'
EXE = GO_DIR / 'AUTO SERVIS S23 citac.exe'
BASE = 'http://127.0.0.1:8765'
PROD = 'https://autoserviss23.rs'

ok = fail = 0


def check(label, cond, detail=''):
    global ok, fail
    print(f'  [{"OK  " if cond else "FAIL"}] {label}' + (f'  → {detail}' if detail else ''))
    if cond:
        ok += 1
    else:
        fail += 1


def zovi(put, origin=None, metod='GET'):
    r = urllib.request.Request(BASE + put, method=metod)
    if origin:
        r.add_header('Origin', origin)
    if metod == 'OPTIONS':
        r.add_header('Access-Control-Request-Method', 'GET')
        r.add_header('Access-Control-Request-Private-Network', 'true')
    try:
        with urllib.request.urlopen(r, timeout=5) as x:
            return x.status, x.headers, x.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode('utf-8', 'replace')


# 1) Spisak dozvoljenih se čita iz IZVORA — da test pukne i kad neko obriše domen iz koda.
izvor = SRC.read_text(encoding='utf-8')
spisak = re.search(r'var allowed = map\[string\]bool\{(.*?)\}', izvor, re.S)
print('=== SPISAK DOZVOLJENIH SAJTOVA (iz koda) ===')
check('Produkcijski domen je UGRAĐEN u čitač', spisak is not None and PROD in spisak.group(1),
      'ne oslanja se na to da se neko seti argumenta')

# Prevedi ako .exe ne postoji a Go je dostupan.
if not EXE.exists() and shutil.which('go'):
    print('  (prevodim .exe…)')
    subprocess.run(['go', 'build', '-o', EXE.name, '.'], cwd=GO_DIR, check=False)

if not EXE.exists():
    print('  (preskočen živi deo — nema .exe ni Go na PATH-u; pokrenuti go/napravi.bat)')
    print(f'\n═══ {ok} prošlo, {fail} palo ═══')
    sys.exit(1 if fail else 0)

print('\n=== ČITAČ UŽIVO ===')
proc = subprocess.Popen([str(EXE)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
try:
    for _ in range(40):
        try:
            zovi('/status')
            break
        except Exception:
            time.sleep(0.25)
    else:
        raise SystemExit('Čitač se nije podigao — je li port 8765 zauzet?')

    # Živi sajt mora da prođe. Ovo je bio kvar.
    st, h, _ = zovi('/status', origin=PROD)
    check('Živi sajt je prihvaćen', h.get('Access-Control-Allow-Origin') == PROD,
          h.get('Access-Control-Allow-Origin') or 'nema Allow-Origin → sajt bi bio odbijen')
    check('Živi sajt ne dobija 403', st != 403, f'HTTP {st}')

    # Chrome „Private Network Access".
    st, h, _ = zovi('/status', origin=PROD, metod='OPTIONS')
    check('Preflight nosi Allow-Private-Network', h.get('Access-Control-Allow-Private-Network') == 'true',
          h.get('Access-Control-Allow-Private-Network') or 'fali → noviji Chrome blokira')
    check('Preflight dozvoljava GET', 'GET' in (h.get('Access-Control-Allow-Methods') or ''),
          h.get('Access-Control-Allow-Methods') or 'nema')

    # Razvojna adresa i dalje radi.
    _, h, _ = zovi('/status', origin='http://localhost:5173')
    check('Razvojni localhost:5173 i dalje prolazi', h.get('Access-Control-Allow-Origin') == 'http://localhost:5173')

    # Tuđi sajt NE sme da čita saobraćajne.
    st, h, _ = zovi('/status', origin='https://zlonamerni-sajt.example')
    check('Nepoznat sajt je odbijen', st == 403, f'HTTP {st}')
    check('Nepoznat sajt ne dobija Allow-Origin', h.get('Access-Control-Allow-Origin') is None)

    # Direktno otvaranje (bez Origin-a) — dijagnostika mora da radi.
    st, _, telo = zovi('/status')
    check('Direktno otvaranje /status daje odgovor', st == 200, telo.strip()[:70])
    poruka = json.loads(telo)
    check('Odgovor je ispravan JSON', isinstance(poruka, dict))
    # Sa čitačem: {reader, cardPresent}. Bez: {error}. Test ne zahteva čitač.
    print(f'         (stanje na ovoj mašini: {poruka})')
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
