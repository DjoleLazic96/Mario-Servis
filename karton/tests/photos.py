"""Regresija za slike sa prijema: limit 10, iza prijave, zaključano posle završetka, folder po VIN/poseti."""
import atexit, json, os, subprocess, sys, urllib.request, urllib.error, http.cookiejar

sys.stdout.reconfigure(encoding='utf-8')   # Windows konzola je podrazumevano cp1252

BASE = 'http://localhost:3000/api/v1'
UPLOADS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'uploads')
jar = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
anon = urllib.request.build_opener()   # bez sesije
ok = fail = 0


def csrf(): return next((c.value for c in jar if c.name == 'XSRF-TOKEN'), '')


def db(sql):
    return subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton', '-t', '-A', '-c', sql],
                          capture_output=True, text=True).stdout.strip()


def cleanup(woid):
    """Test završi (zaključa) nalog, pa API ne da brisanje — čistimo direktno u bazi i na disku,
    inače bi svaki pokretaj ostavio po jedan nalog sa slikama u demou."""
    for rel in db(f"SELECT file_path FROM work_order_photo WHERE work_order_id={woid}").splitlines():
        rel = rel.strip()
        if not rel:
            continue
        try: os.remove(os.path.join(UPLOADS, *rel.split('/')))
        except FileNotFoundError: pass
        try: os.rmdir(os.path.dirname(os.path.join(UPLOADS, *rel.split('/'))))   # ukloni prazan folder posete
        except OSError: pass
    db(f"DELETE FROM work_order_photo WHERE work_order_id={woid};"
       f"DELETE FROM labor_item WHERE work_order_id={woid};"
       f"DELETE FROM part_item WHERE work_order_id={woid};"
       f"DELETE FROM external_service_item WHERE work_order_id={woid};"
       f"DELETE FROM work_order WHERE id={woid};")


def call(m, p, b=None, raw=False):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    if d: r.add_header('Content-Type', 'application/json')
    if m not in ('GET', 'HEAD'): r.add_header('X-CSRF-Token', csrf())
    try:
        with op.open(r) as x:
            y = x.read(); return x.status, (y if raw else (json.loads(y) if y else None))
    except urllib.error.HTTPError as e:
        y = e.read()
        try: return e.code, json.loads(y)
        except Exception: return e.code, y


def check(label, cond, detail=''):
    global ok, fail
    print(f'  [{"OK  " if cond else "FAIL"}] {label}' + (f'  → {detail}' if detail else ''))
    globals().__setitem__('ok', ok + 1) if cond else globals().__setitem__('fail', fail + 1)


def code(r): return r.get('code') if isinstance(r, dict) else str(r)


# mala validna JPEG slika (1x1), kao data URI
JPG_1X1 = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
           'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/E'
           'ABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==')

call('GET', '/settings')
assert call('POST', '/auth/login', {'email': 'admin', 'password': 'admin'})[0] == 200

# svež nalog za test (na postojećem demo vozilu)
st, vs = call('GET', '/vehicles?pageSize=1')
vid = vs['data'][0]['id']
st, wo = call('POST', '/work-orders', {'vehicleId': vid, 'requestedWork': 'Test slika sa prijema.'})
assert st == 201, wo
woid = wo['id']
atexit.register(cleanup, woid)   # obriši test-nalog i slike pri izlazu — bez obzira na ishod
print(f'=== test nalog {wo["number"]} (vozilo {vid}) ===\n')

print('── Upload i serviranje ──')
st, ph = call('POST', f'/work-orders/{woid}/photos', {'dataUrl': JPG_1X1})
check('upload slike', st == 201 and len(ph) == 1, f'{len(ph) if isinstance(ph, list) else ph} slika')
pid = ph[0]['id']

st, img = call('GET', f'/photos/{pid}', raw=True)
check('slika se servira (JPEG magic bytes)', st == 200 and isinstance(img, bytes) and img[:2] == b'\xff\xd8',
      f'{len(img)} B' if isinstance(img, bytes) else str(st))

# BEZ sesije → mora 401 (slike su lični podaci)
try:
    with anon.open(f'{BASE}/photos/{pid}') as x: anon_st = x.status
except urllib.error.HTTPError as e: anon_st = e.code
check('slika NIJE javna (bez prijave → 401)', anon_st == 401, f'HTTP {anon_st}')

print('\n── Folder na disku (VIN / datum_RN-broj) ──')
row = subprocess.run(['docker', 'exec', 'karton-db', 'psql', '-U', 'karton', '-d', 'karton', '-t', '-A',
                      '-c', f'SELECT file_path FROM work_order_photo WHERE id={pid}'],
                     capture_output=True, text=True).stdout.strip()
check('putanja je vozila/<VIN>/<datum>_<RN>/…', row.startswith('vozila/') and '_RN-' in row, row)
abs_path = os.path.join(UPLOADS, *row.split('/'))
check('fajl stvarno postoji na disku', os.path.isfile(abs_path), row)

print('\n── Limit 10 ──')
for i in range(9):   # +9 = ukupno 10
    call('POST', f'/work-orders/{woid}/photos', {'dataUrl': JPG_1X1})
st, lst = call('GET', f'/work-orders/{woid}/photos')
check('10 slika prošlo', len(lst) == 10, f'{len(lst)}')
st, r = call('POST', f'/work-orders/{woid}/photos', {'dataUrl': JPG_1X1})
check('11. slika ODBIJENA', st == 422 and code(r) == 'PHOTO_LIMIT_REACHED', code(r))

print('\n── Brisanje dok je nalog otvoren ──')
st, after = call('DELETE', f'/work-orders/{woid}/photos/{pid}')
check('brisanje slike prošlo', st == 200 and len(after) == 9, f'{len(after) if isinstance(after, list) else after}')
check('fajl obrisan sa diska', not os.path.isfile(abs_path))

print('\n── Zaključavanje posle završetka naloga ──')
st, w = call('GET', f'/work-orders/{woid}')
call('POST', f'/work-orders/{woid}/status', {'status': 'in_progress', 'version': w['version']})
st, w = call('GET', f'/work-orders/{woid}')
st, w2 = call('POST', f'/work-orders/{woid}/status', {'status': 'completed', 'version': w['version']})
check('nalog završen', st == 200 and w2['status'] == 'completed', str(st))

st, r = call('POST', f'/work-orders/{woid}/photos', {'dataUrl': JPG_1X1})
check('dodavanje slike na ZAVRŠEN nalog odbijeno', st == 422 and code(r) == 'ENTITY_LOCKED', code(r))
st, lst2 = call('GET', f'/work-orders/{woid}/photos')
st, r = call('DELETE', f'/work-orders/{woid}/photos/{lst2[0]["id"]}')
check('brisanje slike sa ZAVRŠENOG naloga odbijeno', st == 422 and code(r) == 'ENTITY_LOCKED', code(r))
check('slike i dalje tu (dokaz sačuvan)', len(lst2) == 9, f'{len(lst2)}')

print('\n── Galerija na kartonu vozila (grupisano po posetama) ──')
st, groups = call('GET', f'/vehicles/{vid}/photos')
mine = [g for g in groups if g['workOrderId'] == woid]
check('galerija grupiše po poseti (nalogu)', st == 200 and len(mine) == 1 and len(mine[0]['photos']) == 9,
      f"{len(groups)} poseta, moja ima {len(mine[0]['photos']) if mine else 0} slika")
check('grupa nosi broj naloga i datum', bool(mine and mine[0]['workOrderNumber'] and mine[0]['receivedOn']),
      f"{mine[0]['workOrderNumber']} · {mine[0]['receivedOn']}" if mine else '')

print(f'\n═══ {ok} prošlo, {fail} palo ═══')
sys.exit(1 if fail else 0)
