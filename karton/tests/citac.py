"""
Čitač saobraćajne — kojim sajtovima helper sme da odgovori.

Regresija (17.07.2026): prijavljeno „čitač čita sa drugim programom, a kroz aplikaciju ne".
Uzrok NIJE bio ni čitač ni kartica: helper odgovara samo sajtovima sa spiska, a na spisku su
bile SAMO lokalne razvojne adrese. Produkcijski domen se dodavao jedino ako se prosledi kao
argument — a `pokreni.bat` ga nije prosleđivao. Živi sajt je dobijao 403 na svakom računaru,
dok je aplikacija tvrdila „Čitač nije pokrenut".

Test NE traži čitač ni karticu — proverava samo sloj oko njih (domeni, CORS, PNA), tj. baš
ono što je bilo pokvareno. Sam pokreće helper na privremenom portu i gasi ga za sobom.
"""
import json
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

KOREN = Path(__file__).resolve().parents[2]
IZVOR = KOREN / 'citac-saobracajne' / 'src' / 'CitacServer.java'
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
    # NE pretvarati zaglavlja u dict: Java ih šalje kao „Access-control-allow-origin"
    # (normalizuje veličinu slova), a dict traži tačno poklapanje. HTTP zaglavlja su
    # neosetljiva na velika/mala slova i pretraživači ih tako i čitaju — `x.headers`
    # (email.message.Message) se ponaša isto, pa test meri ono što browser stvarno vidi.
    try:
        with urllib.request.urlopen(r, timeout=5) as x:
            return x.status, x.headers, x.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode('utf-8', 'replace')


# Spisak dozvoljenih se čita iz IZVORA — da test pokaže i kad neko obriše domen iz koda,
# a ne samo kad server pogrešno odgovori.
izvor = IZVOR.read_text(encoding='utf-8')
spisak = re.search(r'ALLOWED\s*=\s*new HashSet<>\(Arrays\.asList\((.*?)\)\)', izvor, re.S)
print('=== SPISAK DOZVOLJENIH SAJTOVA (iz koda) ===')
check('Produkcijski domen je UGRAĐEN u helper', spisak is not None and PROD in spisak.group(1),
      'ne oslanja se na to da se neko seti argumenta')

print('\n=== HELPER UŽIVO ===')
proc = subprocess.Popen(
    ['java', '-Dfile.encoding=UTF-8',
     '--add-opens', 'java.smartcardio/sun.security.smartcardio=ALL-UNNAMED',
     str(IZVOR)],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
try:
    for _ in range(60):                      # java single-file run se prvo kompajlira
        try:
            zovi('/status')
            break
        except Exception:
            time.sleep(0.5)
    else:
        raise SystemExit('Helper se nije podigao — je li port 8765 zauzet?')

    # 1. Živi sajt mora da prođe. Ovo je bio kvar.
    st, h, _ = zovi('/status', origin=PROD)
    check('Živi sajt je prihvaćen', h.get('Access-Control-Allow-Origin') == PROD,
          h.get('Access-Control-Allow-Origin') or 'nema Allow-Origin → sajt bi bio odbijen')
    check('Živi sajt ne dobija 403', st != 403, f'HTTP {st}')

    # 2. Chrome „Private Network Access": javni sajt → 127.0.0.1 traži ovo zaglavlje.
    st, h, _ = zovi('/status', origin=PROD, metod='OPTIONS')
    check('Preflight nosi Allow-Private-Network', h.get('Access-Control-Allow-Private-Network') == 'true',
          h.get('Access-Control-Allow-Private-Network') or 'fali → noviji Chrome blokira')
    check('Preflight dozvoljava GET', 'GET' in (h.get('Access-Control-Allow-Methods') or ''),
          h.get('Access-Control-Allow-Methods') or 'nema')

    # 3. Razvojna adresa i dalje radi (bez regresije).
    _, h, _ = zovi('/status', origin='http://localhost:5173')
    check('Razvojni localhost:5173 i dalje prolazi', h.get('Access-Control-Allow-Origin') == 'http://localhost:5173')

    # 4. Tuđi sajt NE sme da čita saobraćajne — zbog toga spisak i postoji.
    st, h, telo = zovi('/status', origin='https://zlonamerni-sajt.example')
    check('Nepoznat sajt je odbijen', st == 403, f'HTTP {st}')
    check('Nepoznat sajt ne dobija Allow-Origin', h.get('Access-Control-Allow-Origin') is None)
    check('Nepoznat sajt ne dobija Allow-Private-Network', h.get('Access-Control-Allow-Private-Network') is None)

    # 5. Bez Origin-a (kucanje adrese u pregledaču) — dijagnostika mora da radi.
    st, _, telo = zovi('/status')
    check('Direktno otvaranje /status daje odgovor', st == 200, telo.strip()[:60])
    check('Odgovor je ispravan JSON', telo.strip().startswith('{'))
    poruka = json.loads(telo)
    # Bez priključenog čitača ovo je očekivana greška — test ne traži čitač.
    print(f'         (stanje čitača na ovoj mašini: {poruka.get("error") or poruka})')
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
