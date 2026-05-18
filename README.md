# Prosperity National Insurance — Marketing Site

Credibility + lead-gen site for Prosperity National Insurance.

- **Stack:** Static HTML + Tailwind (CDN), Cloudflare Pages + Pages Functions
- **Lead routing:** Form submissions POST to Forge `/intake/json/<slug>` → lands as a Prospect in the `prosperity-insurance` workspace
- **Brand:** Prosperity REIS dark marble + copper aesthetic
- **Domain:** prosperitynationalinsurance.com (DNS via Cloudflare; nameservers updated at Squarespace)

## Local dev
Just open `index.html` in a browser. No build step.

## Deploy
Auto-deploys on push to `main` via Cloudflare Pages.

## Form handler
`functions/api/lead.js` — Cloudflare Pages Function. Validates, then POSTs to Forge JSON intake. Falls back to email-to-kirk if Forge is unreachable.

Required env vars on Cloudflare Pages:
- `FORGE_INTAKE_URL` — full URL including slug, e.g. `https://prosperity-platform-production.up.railway.app/intake/json/abc123def456`
- `NOTIFY_EMAIL` — kirk@prosperityindustries.net
- `RESEND_API_KEY` — for email notifications (optional)
