// Worker entry for prosperitynationalinsurance.com
//
// Handles:
//   1. www → apex redirect (was previously in _redirects, but Workers Static
//      Assets requires relative URLs in that file, so we do it here).
//   2. POST /api/lead — accepts contact-form submissions, posts to Forge
//      JSON intake, optionally emails via Resend.
//   3. Everything else — delegates to env.ASSETS to serve the static site
//      from /public.
//
// Env vars (Workers → Settings → Variables):
//   FORGE_INTAKE_URL  Required. Full URL incl. slug.
//   NOTIFY_EMAIL      Default kirk@prosperityindustries.net.
//   RESEND_API_KEY    Optional, enables email notification.
//   ALLOWED_ORIGIN    Default https://prosperitynationalinsurance.com.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // www → apex 301 redirect
    if (url.hostname.startsWith('www.')) {
      const apexUrl = new URL(request.url);
      apexUrl.hostname = url.hostname.slice(4);
      return Response.redirect(apexUrl.toString(), 301);
    }

    // /api/lead handler
    if (url.pathname === '/api/lead') {
      if (request.method === 'OPTIONS') return handleOptions(env);
      if (request.method === 'POST')    return handleLead(request, env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Static asset fallback
    return env.ASSETS.fetch(request);
  },
};

function corsHeaders(env) {
  const allowed = env.ALLOWED_ORIGIN || 'https://prosperitynationalinsurance.com';
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function handleOptions(env) {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(env), 'Access-Control-Max-Age': '86400' },
  });
}

async function handleLead(request, env) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(env) };

  let payload;
  try { payload = await request.json(); }
  catch { return jsonErr(headers, 400, 'invalid json'); }

  const required = ['first_name', 'last_name', 'email', 'phone'];
  for (const k of required) {
    if (!payload[k] || typeof payload[k] !== 'string') {
      return jsonErr(headers, 400, `missing field: ${k}`);
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return jsonErr(headers, 400, 'invalid email');
  }

  const fullName = `${payload.first_name} ${payload.last_name}`.trim();

  let forgeOk = false;
  let forgeItemId = null;
  let forgeError = null;
  if (env.FORGE_INTAKE_URL) {
    try {
      const forgePayload = {
        source: 'prosperitynationalinsurance.com',
        notes:  payload.notes || '',
        fields: stripEmpty({
          name:  fullName,
          email: payload.email,
          phone: payload.phone,
          title:                  fullName,
          'applicant-type':       payload.applicant_type,
          'insurance-type':       payload.insurance_type,
          'servicing-status':     'New',
          'agent-name':           'Unassigned',
          'address-of-insurance': payload.property_address,
          notes: buildNotesBlock(payload),
        }),
      };
      const r = await fetch(env.FORGE_INTAKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forgePayload),
      });
      if (r.ok) {
        const j = await r.json();
        forgeOk = true;
        forgeItemId = j.item_id || null;
      } else {
        forgeError = `forge returned ${r.status}`;
      }
    } catch (err) {
      forgeError = String(err.message || err);
    }
  } else {
    forgeError = 'FORGE_INTAKE_URL not set';
  }

  if (env.RESEND_API_KEY) {
    const to = env.NOTIFY_EMAIL || 'kirk@prosperityindustries.net';
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'leads@prosperitynationalinsurance.com',
          to: [to],
          subject: `New PNI Lead — ${fullName}`,
          html: buildEmailBody(payload, fullName, forgeOk, forgeItemId, forgeError),
          reply_to: payload.email,
        }),
      });
    } catch (e) { /* silent */ }
  }

  if (!forgeOk && !env.RESEND_API_KEY) {
    return jsonErr(headers, 502, 'lead intake unavailable', { detail: forgeError });
  }
  return new Response(JSON.stringify({ ok: true, item_id: forgeItemId }), { status: 200, headers });
}

function jsonErr(headers, status, error, extra = {}) {
  return new Response(JSON.stringify({ error, ...extra }), { status, headers });
}
function stripEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null && v !== ''));
}
function buildNotesBlock(p) {
  const lines = [];
  if (p.applicant_type)   lines.push(`Applicant type: ${p.applicant_type}`);
  if (p.insurance_type)   lines.push(`Coverage requested: ${p.insurance_type}`);
  if (p.property_address) lines.push(`Property address: ${p.property_address}`);
  if (p.notes)            lines.push(`\n${p.notes}`);
  lines.push(`\n--- Submitted via prosperitynationalinsurance.com ---`);
  lines.push(`Submitted: ${new Date().toISOString()}`);
  return lines.join('\n');
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function buildEmailBody(p, fullName, forgeOk, itemId, forgeErr) {
  const status = forgeOk
    ? `<p style="color:#68d391;">✓ Created as Prospect in Forge${itemId ? ` (item ${itemId})` : ''}.</p>`
    : `<p style="color:#fc8181;">⚠ Forge intake failed: ${forgeErr || 'unknown'}. Add manually.</p>`;
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0e0e0e;color:#ece4dc;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#1c1c1c;border:1px solid rgba(193,149,117,0.2);border-radius:6px;padding:32px;">
<h2 style="font-family:'Cinzel',serif;color:#c19575;margin:0 0 8px;">New Insurance Lead</h2>
<div style="font-size:12px;letter-spacing:0.2em;color:#a07a60;text-transform:uppercase;margin-bottom:24px;">prosperitynationalinsurance.com</div>
${status}
<table style="width:100%;border-collapse:collapse;margin-top:16px;">
<tr><td style="padding:8px 0;color:#a07a60;width:140px;">Name</td><td>${esc(fullName)}</td></tr>
<tr><td style="padding:8px 0;color:#a07a60;">Email</td><td><a href="mailto:${esc(p.email)}" style="color:#d4ad8a;">${esc(p.email)}</a></td></tr>
<tr><td style="padding:8px 0;color:#a07a60;">Phone</td><td><a href="tel:${esc(p.phone)}" style="color:#d4ad8a;">${esc(p.phone)}</a></td></tr>
<tr><td style="padding:8px 0;color:#a07a60;">Applicant type</td><td>${esc(p.applicant_type || '—')}</td></tr>
<tr><td style="padding:8px 0;color:#a07a60;">Coverage</td><td>${esc(p.insurance_type || '—')}</td></tr>
<tr><td style="padding:8px 0;color:#a07a60;">Property</td><td>${esc(p.property_address || '—')}</td></tr>
</table>
${p.notes ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(193,149,117,0.18);"><div style="color:#a07a60;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:8px;">Notes</div><div style="white-space:pre-wrap;">${esc(p.notes)}</div></div>` : ''}
</div></body></html>`;
}
