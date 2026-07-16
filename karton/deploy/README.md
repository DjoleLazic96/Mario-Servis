# Deploy

Konfiguracija produkcije (`autoserviss23.rs`, Hetzner CX22). Ovde stoji zato što je do sada
živela samo na serveru — da server otkaže, podešavanja bi otišla s njim.

## Caddyfile

Kopira se na server i pušta ovako:

```bash
scp deploy/Caddyfile root@SERVER:/etc/caddy/Caddyfile
ssh root@SERVER 'caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
```

`caddy validate` pre `reload` nije formalnost: pogrešan Caddyfile obori sajt, a `reload`
sam po sebi neće da ga zaustavi.

### Zašto su pravila za keš takva kakva jesu

Bez `Cache-Control`, browser sam odlučuje koliko da čuva `index.html`. Stari `index.html`
pokazuje na stare `/assets/*` fajlove, pa se nova verzija ne preuzme — korisnik posle
deploya gleda staru aplikaciju i misli da izmene nisu ni urađene. Zato:

- `/assets/*` — ime sadrži heš i menja se pri svakoj izmeni → `immutable`, keš zauvek.
- sve ostalo (uključujući SPA rute tipa `/dokumenti/17`, koje takođe vraćaju `index.html`)
  → `no-cache`, tj. uvek se proveri kod servera (ETag → 304, jeftino).

## Provera posle deploya

```bash
curl -sI https://autoserviss23.rs/            | grep -i cache-control   # no-cache
curl -sI https://autoserviss23.rs/assets/...  | grep -i cache-control   # immutable
```
