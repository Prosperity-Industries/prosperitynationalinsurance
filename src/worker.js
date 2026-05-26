// Worker entry for prosperitynationalinsurance.com
//
// Handles:
//   1. www → apex redirect.
//   2. POST /api/lead — accepts contact-form submissions, posts to Forge
//      JSON intake, optionally emails via Resend.
//   3. POST /api/inbound-email — SendGrid Inbound Parse webhook.
//   4. GET  /api/availability — proxy to Calendly's available-times API
//      (CALENDLY_TOKEN kept server-side, never reaches the browser).
//   5. Everything else — delegates to env.ASSETS.
//
// Env vars (Workers → Settings → Variables / Secrets):
//   FORGE_INTAKE_URL    Required for /api/lead. Full URL incl. slug.
//   NOTIFY_EMAIL        Default kirk@prosperityindustries.net.
//   RESEND_API_KEY      Optional, enables Resend email notification.
//   SENDGRID_API_KEY    Optional, enables SendGrid forwarding for inbound.
//   ALLOWED_ORIGIN      Default https://prosperitynationalinsurance.com.
//   CALENDLY_TOKEN      Required for /api/availability. Type: Secret.
//   CALENDLY_EVENT_URI  Optional override. Defaults to George's 30min.

const DEFAULT_CALENDLY_EVENT_URI =
  'https://api.calendly.com/event_types/2b9ffdf8-b290-4a53-b458-ad48b198b191';
const DEFAULT_SCHEDULING_BASE =
  'https://calendly.com/george-customerfirstinsurance/30min';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.hostname.startsWith('www.')) {
      const apexUrl = new URL(request.url);
      apexUrl.hostname = url.hostname.slice(4);
      return Response.redirect(apexUrl.toString(), 301);
    }

    if (url.pathname === '/api/lead') {
      if (request.method === 'OPTIONS') return handleOptions(env);
      if (request.method === 'POST')    return handleLead(request, env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/inbound-email') {
      if (request.method === 'POST') return handleInboundEmail(request, env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/availability') {
      if (request.method === 'OPTIONS') return handleOptions(env);
      if (request.method === 'GET')     return handleAvailability(request, env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    return env.ASSETS.fetch(request);
  },
};

function corsHeaders(env) {
  const allowed = env.ALLOWED_ORIGIN || 'https://prosperitynationalinsurance.com';
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function handleOptions(env) {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(env), 'Access-Control-Max-Age': '86400' },
  });
}

// --- /api/availability ----------------------------------------------------
async function handleAvailability(_request, env) {
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(env),
    'Cache-Control': 'public, max-age=60',
  };
  const token  = env.CALENDLY_TOKEN;
  const evtUri = env.CALENDLY_EVENT_URI || DEFAULT_CALENDLY_EVENT_URI;
  if (!token) {
    return new Response(JSON.stringify({ error: 'calendar not configured' }),
      { status: 503, headers });
  }

  // Calendly requires start_time strictly in the future; max 7-day window.
  const now   = new Date();
  const start = new Date(now.getTime() + 60_000).toISOString();
  const end   = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const apiUrl = 'https://api.calendly.com/event_type_available_times'
    + '?event_type='  + encodeURIComponent(evtUri)
    + '&start_time='  + encodeURIComponent(start)
    + '&end_time='    + encodeURIComponent(end);

  let r;
  try {
    r = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'calendar fetch failed', detail: String(e.message || e) }),
      { status: 502, headers });
  }
  if (!r.ok) {
    const body = await r.text();
    return new Response(JSON.stringify({ error: `calendly ${r.status}`, detail: body.slice(0, 400) }),
      { status: 502, headers });
  }
  const data = await r.json();
  const slots = (data.collection || [])
    .filter(s => s.status === 'available' && (s.invitees_remaining ?? 1) > 0)
    .map(s => ({ start_time: s.start_time, scheduling_url: s.scheduling_url }));

  return new Response(JSON.stringify({
    slots,
    count: slots.length,
    scheduling_base: DEFAULT_SCHEDULING_BASE,
  }), { status: 200, headers });
}

// --- /api/lead ------------------------------------------------------------
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
        source: (payload.attribution && payload.attribution.utm_source)
          ? `prosperitynationalinsurance.com / ${String(payload.attribution.utm_source).slice(0, 60)}`
          : 'prosperitynationalinsurance.com',
        notes:  payload.notes || '',
        fields: stripEmpty({
          name:  fullName,
          email: payload.email,
          phone: payload.phone,
          title:                  fullName,
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

// Domains that only ever RECEIVE mail for us. A From: address on one of
// these is forged.
const INBOUND_DOMAINS = new Set([
  'inbox.prosperitynationalinsurance.com',
]);

// --- /api/inbound-email ---------------------------------------------------
async function handleInboundEmail(request, env) {
  let form;
  try { form = await request.formData(); }
  catch { return new Response('bad form', { status: 400 }); }

  const get = (k) => { const v = form.get(k); return v == null ? '' : String(v); };

  const fromRaw   = get('from');
  const subject   = get('subject');
  const textBody  = get('text');
  const htmlBody  = get('html');
  const toField   = get('to');
  const spamScore = parseFloat(get('spam_score')) || 0;
  const threshold = parseFloat(env.SPAM_THRESHOLD || '5');
  const notifyTo  = env.NOTIFY_EMAIL || 'kirk@prosperityindustries.net';

  const m = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const senderEmail = (m ? m[2] : fromRaw).trim();
  const senderName  = (m ? m[1].trim() : '') || (senderEmail.split('@')[0] || 'Website Email');
  const senderDomain = (senderEmail.split('@')[1] || '').toLowerCase();

  // Anything ABOVE the threshold is quarantined: NOT written to Forge, and
  // forwarded to the human inbox ONLY if forwardInbound has a mail key.
  // 2026-08-12: neither SENDGRID_API_KEY nor RESEND_API_KEY is set on this
  // Worker, so quarantine currently means destroyed. The default is
  // therefore held at 5 - a borderline mail is better off as a visible
  // Prospect you can delete than as a customer enquiry nobody ever sees.
  // Tighten this once a mail key exists.
  // Self-spoofed mail (From: one of our own inbound-parse domains) is
  // always quarantined regardless of score - real customer mail never
  // originates there, so nothing legitimate is lost.
  const selfSpoofed = senderDomain !== '' && INBOUND_DOMAINS.has(senderDomain);
  const isSpam = spamScore > threshold || selfSpoofed;
  const bodyText = textBody || stripHtml(htmlBody);

  let forgeOk = false, forgeItemId = null, forgeError = null;
  if (!isSpam && env.FORGE_INTAKE_URL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    try {
      const notes = [
        `Inbound email to ${toField || 'hello@prosperitynationalinsurance.com'}`,
        `From: ${fromRaw}`,
        `Subject: ${subject || '(no subject)'}`,
        `Spam score: ${spamScore}`,
        ``,
        bodyText || '(no body)',
        ``,
        `--- Received via SendGrid Inbound Parse ---`,
        `Received: ${new Date().toISOString()}`,
      ].join('\n');
      const forgePayload = {
        source: 'inbound-email:prosperitynationalinsurance.com',
        fields: stripEmpty({
          name:               senderName,
          email:              senderEmail,
          title:              senderName,
          'servicing-status': 'New',
          'agent-name':       'Unassigned',
          notes,
        }),
      };
      const r = await fetch(env.FORGE_INTAKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forgePayload),
      });
      if (r.ok) { const j = await r.json().catch(() => ({})); forgeOk = true; forgeItemId = j.item_id || null; }
      else { forgeError = `forge ${r.status}`; }
    } catch (e) { forgeError = String(e.message || e); }
  }

  await forwardInbound(env, {
    notifyTo, fromRaw, senderEmail, senderName, subject, bodyText, htmlBody,
    spamScore, isSpam, selfSpoofed, forgeOk, forgeItemId, forgeError, toField,
  });

  return new Response(JSON.stringify({ ok: true, spam: isSpam, forge: forgeOk }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

async function forwardInbound(env, ctx) {
  const tag = ctx.isSpam ? '[SPAM?] ' : '';
  const subjectLine = `${tag}Fwd: ${ctx.subject || '(no subject)'} — via PNI website`;
  const statusLine = ctx.isSpam
    ? `<p style="color:#fc8181;">Quarantined${ctx.selfSpoofed ? ' — forged sender domain' : ` (spam score ${ctx.spamScore})`} — NOT added to Forge.</p>`
    : (ctx.forgeOk
        ? `<p style="color:#68d391;">Added to Forge Prospects${ctx.forgeItemId ? ` (item ${ctx.forgeItemId})` : ''}.</p>`
        : `<p style="color:#fc8181;">Forge intake failed: ${esc(ctx.forgeError || 'unknown')}. Add manually.</p>`);
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0e0e0e;color:#ece4dc;padding:24px;">
<div style="max-width:640px;margin:0 auto;background:#1c1c1c;border:1px solid rgba(193,149,117,0.2);border-radius:6px;padding:28px;">
<h2 style="font-family:'Cinzel',serif;color:#c19575;margin:0 0 4px;">Inbound Email — PNI</h2>
<div style="font-size:12px;letter-spacing:0.2em;color:#a07a60;text-transform:uppercase;margin-bottom:16px;">${esc(ctx.toField || 'hello@prosperitynationalinsurance.com')}</div>
${statusLine}
<table style="width:100%;border-collapse:collapse;margin-top:8px;">
<tr><td style="padding:6px 0;color:#a07a60;width:80px;">From</td><td>${esc(ctx.fromRaw)}</td></tr>
<tr><td style="padding:6px 0;color:#a07a60;">Subject</td><td>${esc(ctx.subject || '(no subject)')}</td></tr>
</table>
<div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(193,149,117,0.18);white-space:pre-wrap;">${esc(ctx.bodyText || '(no body)')}</div>
</div></body></html>`;

  if (env.SENDGRID_API_KEY) {
    try {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: ctx.notifyTo }] }],
          from: { email: env.FORWARD_FROM || 'leads@prosperitynationalinsurance.com', name: 'PNI Inbound' },
          reply_to: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.senderEmail) ? { email: ctx.senderEmail } : undefined,
          subject: subjectLine,
          content: [{ type: 'text/html', value: html }],
        }),
      });
      return;
    } catch (e) { /* fall through */ }
  }
  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.FORWARD_FROM || 'leads@prosperitynationalinsurance.com',
          to: [ctx.notifyTo],
          subject: subjectLine,
          html,
          reply_to: ctx.senderEmail,
        }),
      });
    } catch (e) { /* silent */ }
  }
}

function stripHtml(s) {
  return String(s || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function jsonErr(headers, status, error, extra = {}) {
  return new Response(JSON.stringify({ error, ...extra }), { status, headers });
}
function stripEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null && v !== ''));
}
function buildNotesBlock(p) {
  const lines = [];
  if (p.date_of_birth)    lines.push(`Date of birth: ${p.date_of_birth}`);
  if (p.insurance_type)   lines.push(`Coverage requested: ${p.insurance_type}`);
  if (p.property_address) lines.push(`Property address: ${p.property_address}`);
  if (p.notes)            lines.push(`\n${p.notes}`);
  const a = (p.attribution && typeof p.attribution === 'object') ? p.attribution : null;
  if (a) {
    const al = [];
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','msclkid']
      .forEach((k) => { if (a[k]) al.push(`${k}: ${a[k]}`); });
    if (a.landing_page) al.push(`Landing page: ${a.landing_page}`);
    if (a.referrer)     al.push(`Referrer: ${a.referrer}`);
    if (al.length) { lines.push(`\n--- Lead source ---`); lines.push(al.join('\n')); }
  }
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
<tr><td style="padding:8px 0;color:#a07a60;">Date of birth</td><td>${esc(p.date_of_birth || '—')}</td></tr>
<tr><td style="padding:8px 0;color:#a07a60;">Coverage</td><td>${esc(p.insurance_type || '—')}</td></tr>
<tr><td style="padding:8px 0;color:#a07a60;">Property</td><td>${esc(p.property_address || '—')}</td></tr>
</table>
${p.notes ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(193,149,117,0.18);"><div style="color:#a07a60;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:8px;">Notes</div><div style="white-space:pre-wrap;">${esc(p.notes)}</div></div>` : ''}
</div></body></html>`;
}
