// Cloudflare Pages Function: POST /api/lead
//
// Receives form submissions from /contact.html and routes them to:
//   1. Forge JSON-intake endpoint (creates a Prospect in prosperity-insurance workspace)
//   2. Email notification to NOTIFY_EMAIL as a belt-and-suspenders fallback
//
// Env vars (set in Cloudflare Pages → Settings → Environment variables):
//   FORGE_INTAKE_URL  Required. Full URL incl. slug, e.g.
//                     https://prosperity-platform-production.up.railway.app/intake/json/abc123def456
//   NOTIFY_EMAIL      Optional. Address to email when a lead comes in. Defaults to kirk@prosperityindustries.net.
//   RESEND_API_KEY    Optional. If set, send the notification email via Resend. If not set, email step is skipped.
//   ALLOWED_ORIGIN    Optional. CORS allow-origin. Defaults to https://prosperitynationalinsurance.com.

export async function onRequestPost(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || 'https://prosperitynationalinsurance.com';

  // CORS preflight headers (also applied to the actual response)
  const baseHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: baseHeaders });
  }

  // Validate required fields
  const required = ['first_name', 'last_name', 'email', 'phone'];
  for (const k of required) {
    if (!payload[k] || typeof payload[k] !== 'string') {
      return new Response(JSON.stringify({ error: `missing field: ${k}` }), { status: 400, headers: baseHeaders });
    }
  }

  // Light email sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return new Response(JSON.stringify({ error: 'invalid email' }), { status: 400, headers: baseHeaders });
  }

  const fullName = `${payload.first_name} ${payload.last_name}`.trim();

  // ---------- Step 1: Post to Forge ----------
  let forgeOk = false;
  let forgeItemId = null;
  let forgeError = null;

  if (env.FORGE_INTAKE_URL) {
    try {
      // IMPORTANT: Forge's intake handler builds the Person record by reading
      // name/email/phone from INSIDE payload.fields (not top-level). Those keys
      // are not field external_ids on Prospects, so they're dropped when writing
      // the Prospect's data — but the contact extractor picks them up first and
      // creates (or matches) a Person, then auto-links the Person to the
      // Prospect's `primary-contact` relation field. This preserves Kirk's
      // People-as-root-of-all-contacts pattern.
      const forgePayload = {
        source: 'prosperitynationalinsurance.com',
        notes:  payload.notes || '',
        fields: {
          // Person-builder keys (consumed by Forge intake → People app)
          name:  fullName,
          email: payload.email,
          phone: payload.phone,
          // Prospect field external_ids
          title: fullName,
          'applicant-type':      payload.applicant_type || undefined,
          'insurance-type':      payload.insurance_type || undefined,
          'servicing-status':    'New',
          'agent-name':          'Unassigned',
          'address-of-insurance': payload.property_address || undefined,
          notes: buildNotesBlock(payload),
        },
      };

      // Strip undefined keys so Forge doesn't complain
      forgePayload.fields = Object.fromEntries(
        Object.entries(forgePayload.fields).filter(([_, v]) => v !== undefined && v !== '')
      );

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

  // ---------- Step 2: Email notification (best-effort) ----------
  if (env.RESEND_API_KEY) {
    const to = env.NOTIFY_EMAIL || 'kirk@prosperityindustries.net';
    const subj = `New PNI Lead — ${fullName}`;
    const body = buildEmailBody(payload, fullName, forgeOk, forgeItemId, forgeError);
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
          subject: subj,
          html: body,
          reply_to: payload.email,
        }),
      });
    } catch (e) {
      // Don't fail the whole request just because the email step blew up.
      console.error('[lead] email send failed', e);
    }
  }

  // We return success if Forge succeeded OR if at least the email went out.
  // If Forge fails silently and we have no email, we want to know.
  if (!forgeOk && !env.RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'lead intake unavailable', detail: forgeError }),
      { status: 502, headers: baseHeaders }
    );
  }

  return new Response(JSON.stringify({ ok: true, item_id: forgeItemId }), { status: 200, headers: baseHeaders });
}

export async function onRequestOptions(context) {
  const allowedOrigin = context.env.ALLOWED_ORIGIN || 'https://prosperitynationalinsurance.com';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
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

function buildEmailBody(p, fullName, forgeOk, itemId, forgeErr) {
  const status = forgeOk
    ? `<p style="color:#68d391;">✓ Created as Prospect in Forge${itemId ? ` (item ${itemId})` : ''}.</p>`
    : `<p style="color:#fc8181;">⚠ Forge intake failed: ${forgeErr || 'unknown'}. This email is the only record — please add manually.</p>`;
  return `
<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#0e0e0e; color:#ece4dc; padding:24px;">
  <div style="max-width:600px; margin:0 auto; background:#1c1c1c; border:1px solid rgba(193,149,117,0.2); border-radius:6px; padding:32px;">
    <h2 style="font-family:'Cinzel',serif; color:#c19575; margin:0 0 8px;">New Insurance Lead</h2>
    <div style="font-size:12px; letter-spacing:0.2em; color:#a07a60; text-transform:uppercase; margin-bottom:24px;">prosperitynationalinsurance.com</div>
    ${status}
    <table style="width:100%; border-collapse:collapse; margin-top:16px;">
      <tr><td style="padding:8px 0; color:#a07a60; width:140px;">Name</td><td>${esc(fullName)}</td></tr>
      <tr><td style="padding:8px 0; color:#a07a60;">Email</td><td><a href="mailto:${esc(p.email)}" style="color:#d4ad8a;">${esc(p.email)}</a></td></tr>
      <tr><td style="padding:8px 0; color:#a07a60;">Phone</td><td><a href="tel:${esc(p.phone)}" style="color:#d4ad8a;">${esc(p.phone)}</a></td></tr>
      <tr><td style="padding:8px 0; color:#a07a60;">Applicant type</td><td>${esc(p.applicant_type || '—')}</td></tr>
      <tr><td style="padding:8px 0; color:#a07a60;">Coverage</td><td>${esc(p.insurance_type || '—')}</td></tr>
      <tr><t