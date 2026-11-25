# veyrotrack.com website

A single static page (`index.html`), no build step. Contact buttons use `mailto:hello@veyrotrack.com`: **change this to a real inbox** before publishing
(search for `hello@veyrotrack.com`). The portal lives separately at https://track.veyrotrack.com.

Honest labelling: the page marks what is *Available* (fleet platform), *Early access* (aggregator, API) and *Coming soon* (alerts, WhatsApp, voice).
Update the tags as features ship. The API snippet is a preview, not a live endpoint.

## Hosting options (pick one)
1. **Free static hosts (simplest)**: Cloudflare Pages, Netlify or GitHub Pages. Upload this folder, then in GoDaddy DNS replace the parked `@` record with the
   host's A/ALIAS values and keep `www` as a CNAME to the host. Do not touch the `track` record.
2. **Same server, via the existing Caddy**: copy `index.html` to `~/Appscrapper/site/`, mount it in the Caddy container (`./site:/srv/site:ro`), and add a block
   to the Caddyfile:
   ```
   veyrotrack.com, www.veyrotrack.com {
       root * /srv/site
       file_server
       encode zstd gzip
   }
   ```
   Then point the `@` A record at the server's IP. (Same careful edit-validate-restart steps as for `track`.)
