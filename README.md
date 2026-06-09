# QR Standee Web App

A single-page web app that lets anyone generate WeTravel-branded QR code standees by typing in an organizer name + a URL. The PDF builds in the browser — no backend, no API, no server costs.

## What's inside

```
QR Standee Web App/
├── index.html          ← the page (form UI)
├── app.js              ← PDF generation logic (pdf-lib + qrcode.js)
├── assets/             ← payment + WeTravel logos (PNG, transparent)
├── fonts/              ← Poppins-Bold.ttf
├── Dockerfile          ← nginx:alpine static-serve image
├── nginx.conf          ← gzip + long-cache headers for assets
├── vercel.json         ← Vercel deployment config (static)
├── .gitignore
├── .dockerignore
└── README.md
```

## How it works

1. User picks A5 standee or business card from a dropdown
2. Types organizer name + QR URL
3. Clicks Generate → PDF is built client-side using `pdf-lib`
4. Browser downloads the file

QR codes use error-correction level M for A5 (large QRs) and Q for business cards (denser format, more occlusion-tolerant).

---

## Run locally

Any static HTTP server works — but you cannot just `open index.html` because the app needs to `fetch()` the local font and logo assets, which the `file://` protocol blocks.

```bash
# easiest options:
python3 -m http.server 8000
# or
npx serve .
```

Then visit `http://localhost:8000`.

---

## Run with Docker

```bash
docker build -t qr-standee .
docker run --rm -p 8080:80 qr-standee
```

Then visit `http://localhost:8080`. The image is `nginx:1.27-alpine` + the static files, ~25 MB.

Configurable bits live in `nginx.conf`:
- Gzip enabled for text/CSS/JS
- 1-year `Cache-Control: immutable` on fonts + logos
- `no-cache` on `index.html` so deploys take effect immediately

---

## Deploy to Vercel (alternative)

```bash
npm i -g vercel
vercel
```

Accept the defaults — Vercel auto-detects it as a static site. No build step needed.

```bash
vercel --prod   # for production
```

---

## Deploy elsewhere

Pure static site. Drop it on Netlify, GitHub Pages, Cloudflare Pages, S3+CloudFront, or any nginx/Caddy server. The Dockerfile above already gives you a portable container.

---

## Customising the design

All design constants live near the top of `app.js`:
- `TEAL` = `#19BED2`
- `DARK` = `#1A1F2E`
- Font sizes, padding, card dimensions are all in mm via the `MM` constant

The A5 and business card layouts are in `buildA5()` and `buildCard()`. Each function is self-contained.

---

## Notes for engineering

- **No secrets** — fully client-side, no env vars, no API keys
- **CDN deps** — `pdf-lib`, `@pdf-lib/fontkit`, `qrcode` (all from unpkg). If you want to vendor them for offline / CSP reasons, copy into `vendor/` and update the `<script>` tags in `index.html`
- **Bundle size** — fonts + logos ≈ 1 MB. Loaded lazily on first generate
- **No analytics / telemetry** baked in. Add what your org needs
- **Browser support** — modern evergreen browsers (ES2017+, `fetch`, `async/await`)
- **CORS** — none required; everything's same-origin
- **Healthcheck** — Dockerfile includes a built-in `wget` healthcheck on `/index.html`
