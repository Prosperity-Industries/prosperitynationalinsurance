// Contact form — POST to /api/lead (Cloudflare Pages Function).
// Honeypot check happens client-side too (harmless), but the server enforces.

(function () {
  const form = document.getElementById('quoteForm');
  const status = document.getElementById('formStatus');
  if (!form || !status) return;

  function showStatus(type, message) {
    status.className = 'form-status ' + type;
    status.textContent = message;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Honeypot — if the hidden 'website' field was filled, silently "succeed"
    // so bots don't learn anything from the response.
    const honeypot = form.querySelector('input[name="website"]');
    if (honeypot && honeypot.value) {
      showStatus('success', 'Thanks — we\'ll be in touch.');
      form.reset();
      return;
    }

    const data = {
      first_name:       form.first_name.value.trim(),
      last_name:        form.last_name.value.trim(),
      email:            form.email.value.trim(),
      phone:            form.phone.value.trim(),
      date_of_birth:    form.date_of_birth.value,
      insurance_type:   form.insurance_type.value,
      property_address: form.property_address.value.trim(),
      notes:            form.notes.value.trim(),
    };

    if (!data.first_name || !data.last_name || !data.email || !data.phone) {
      showStatus('error', 'Please fill out name, email, and phone.');
      return;
    }
    if (!data.date_of_birth) {
      showStatus('error', 'Please enter your date of birth.');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Submission failed.');
      }

      showStatus('success', 'Thanks — your request is in. Now pick a time below and we\'ll call you then.');
      // Re-render the scheduler prefilled with this lead's details, then scroll to it.
      renderCalendly({
        name:  (data.first_name + ' ' + data.last_name).trim(),
        email: data.email,
      });
      const sched = document.getElementById('calendly-embed');
      if (sched) sched.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.reset();
    } catch (err) {
      console.error('[contact-form]', err);
      showStatus('error', 'Sorry — something went wrong. Please use the Email Us button on this page, or try again in a moment.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Request a Quote';
    }
  });
})();


// ---- Inline Calendly scheduler (lazy-loaded) -----------------------------
// widget.js is a heavy, render-blocking third-party script. We defer loading
// it until the scheduler section nears the viewport (or a form submit needs
// it prefilled). This keeps the contact page's initial render fast and
// non-blocking. The form -> calendar prefill behavior is preserved.
(function () {
  var CAL_URL   = 'https://calendly.com/george-customerfirstinsurance/30min?hide_gdpr_banner=1';
  var WIDGET_JS = 'https://assets.calendly.com/assets/external/widget.js';
  var el = document.getElementById('calendly-embed');
  if (!el) return;

  var scriptState = 'idle';  // idle | loading | ready
  var scriptCbs = [];

  function ensureScript(cb) {
    if (scriptState === 'ready') return cb();
    scriptCbs.push(cb);
    if (scriptState === 'loading') return;
    scriptState = 'loading';
    var s = document.createElement('script');
    s.src = WIDGET_JS;
    s.async = true;
    s.onload = function () {
      scriptState = 'ready';
      var cbs = scriptCbs.splice(0);
      cbs.forEach(function (fn) { fn(); });
    };
    s.onerror = function () { scriptState = 'idle'; scriptCbs.length = 0; };
    document.head.appendChild(s);
  }

  function doRender(prefill) {
    if (!(window.Calendly && Calendly.initInlineWidget)) return false;
    el.innerHTML = '';
    Calendly.initInlineWidget({ url: CAL_URL, parentElement: el, prefill: prefill || {} });
    return true;
  }

  var rendered = false;

  // Loads widget.js on demand, then renders (with optional prefill).
  window.renderCalendly = function (prefill) {
    ensureScript(function () {
      if (!doRender(prefill)) {
        var tries = 0;
        var t = setInterval(function () {
          if (doRender(prefill) || ++tries > 40) clearInterval(t);
        }, 250);
      }
      rendered = true;
    });
  };

  // Lazy trigger: only load + render when the scheduler nears the viewport.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !rendered) {
          window.renderCalendly();
          io.disconnect();
        }
      });
    }, { rootMargin: '300px' });
    io.observe(el);
  } else {
    window.renderCalendly();
  }
})();
