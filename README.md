# Prosperity National Insurance — Marketing Site

Credibility + lead-gen site for Prosperity National Insurance.

- **Stack:** Static HTML + custom CSS, served by Cloudflare Workers Static Assets
- **Worker:** `src/worker.js` handles `POST /api/lead`, all other routes fall through to static
- **Lead routing:** Form submissions POST to Forge JSON intake → lands as a Prospect in the `prosperity-insurance` workspace; auto-creates a People record and links it as Primary Contact
- **Brand:** Prosperity REIS dark marble + copper aesthetic
- **Domain:** prosperitynationalinsurance.com (DNS via Cloudflare; nameservers already swapped from Squarespace)

## Local preview
Open `public/index.html` in a browser — no build step.

## Deploy
Auto-deploys on push to `main` via Cloudflare Workers (connected GitHub project).
Deploy command on Cloudflare: `npx wrangler deploy`

## Required env vars on Cloudflare

**⚠ USE SECRETS, NOT PLAIN-TEXT VARIABLES.** Plain-text variables in the Cloudflare dashboard are **wiped on every `wrangler deploy`** unless the deploy command uses `--keep-vars`. Secrets persist regardless. The values below are encrypted at rest in Cloudflare:

| Name | Type | Required | Value |
|---|---|---|---|
| `FORGE_INTAKE_URL` | Secret | Yes | `https://prosperity-platform-production.up.railway.app/intake/json/249b2d2765be5fc0` |
| `NOTIFY_EMAIL` | Secret | No (defaults to kirk@prosperityindustries.net) | `kirk@prosperityindustries.net` |
| `ALLOWED_ORIGIN` | Secret | No (defaults to https://prosperitynationalinsurance.com) | `https://prosperitynationalinsurance.com` |
| `RESEND_API_KEY` | Secret | No (skips email if absent) | (from Resend dashboard) |

To set them in the Cloudflare dashboard:
1. Workers & Pages → `prosperitynationalinsurance` → Settings → Variables and Secrets
2. Click **Add**
3. Choose **Type: Secret** (NOT Plain Text)
4. Enter name + value, click Deploy

Alternative: bake `--keep-vars` into the deploy command on the Build settings page. Same effect.

## Layout
```
public/              # served by env.ASSETS
├── index.html
├── about.html
├── contact.html
├── coverage/*.html
├── 404.html
├── assets/css/style.css
├── assets/js/contact.js
└── _headers         # Cloudflare security headers
src/worker.js        # Worker entry, /api/lead handler, www→apex redirect
wrangler.toml        # Cloudflare deploy config
```

## Forge intake schema reference
Posts to Forge JSON intake with this payload shape:
```json
{
  "source": "prosperitynationalinsurance.com",
  "notes": "...",
  "fields": {
    "name":  "Jane Doe",          // Person-builder key (auto-creates People record)
    "email": "jane@...",          // Person-builder key
    "phone": "555-...",           // Person-builder key
    "title": "Jane Doe",          // Prospect title
    "applicant-type": "Landlord", // Retail Buyer | Landlord | Fix & Flip | Renter | Commercial | Business
    "insurance-type": "Dwelling & Fire",
    "servicing-status": "New",
    "agent-name": "Unassigned",
    "address-of-insurance": "...",
    "notes": "..."
  }
}
```
