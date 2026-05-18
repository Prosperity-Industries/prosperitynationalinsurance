# Prosperity National Insurance — Marketing Site

Credibility + lead-gen site for Prosperity National Insurance.

- **Stack:** Static HTML + custom CSS, served by Cloudflare Workers Static Assets
- **Worker:** `src/worker.js` handles `POST /api/lead`, all other routes fall through to static
- **Lead routing:** Form submissions POST to Forge JSON intake → lands as a Prospect in the `prosperity-insurance` workspace; auto-creates a People record and links it as Primary Contact
- **Brand:** Prosperity REIS dark marble + copper aesthetic
- **Domain:** prosperitynationalinsurance.com (DNS via Cloudflare; nameservers updated at Squarespace)

## Local preview
Open `public/index.html` in a browser — no build step.

## Deploy
Auto-deploys on push to `main` via Cloudflare Workers (connected GitHub project).
Deploy command on Cloudflare: `npx wrangler deploy`

## Required env vars on Cloudflare (Settings → Variables)
- `FORGE_INTAKE_URL` — full URL incl. slug, e.g. `https://prosperity-platform-production.up.railway.app/intake/json/<slug>`
- `NOTIFY_EMAIL` — default `kirk@prosperityindustries.net`
- `ALLOWED_ORIGIN` — default `https://prosperitynationalinsurance.com`
- `RESEND_API_KEY` — optional, enables email notification on top of Forge intake

## Layout
```
public/              # served by env.ASSETS
├── index.html
├── about.html
├── contact.html
├── coverage/*.html
├── assets/css/style.css
├── assets/js/contact.js
├── _headers         # Cloudflare security headers
└── _redirects       # apex/www redirect rules
src/worker.js        # Worker entry, /api/lead handler
wrangler.toml        # Cloudflare deploy config
```
