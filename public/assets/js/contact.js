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
      showStatus('error', 'Sorry — something went wrong. Please email hello@prosperitynationalinsurance.com directly and we\'ll get right on it.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Request a Quote';
    }
  });
})();


// ---- Inline Calendly scheduler -------------------------------------------
// Renders the 30-min quote-call calendar right on the page. Slots are live.
// After a form submit we re-render it prefilled with the lead's name + email.
(function () {
  var CAL_URL = 'https://calendly.com/george-customerfirstinsurance/30min?hide_gdpr_banner=1';
  var el = document.getElementById('calendly-embed');
  if (!el) return;

  function doRender(prefill) {
    if (!(window.Calendly && Calendly.initInlineWidget)) return false;
    el.innerHTML = '';
    Calendly.initInlineWidget({
      url: CAL_URL,
      parentElement: el,
      prefill: prefill || {},
    });
    return true;
  }

  // Expose for the form-submit handler above.
  window.renderCalendly = function (prefill) {
    if (!doRender(prefill)) {
      // widget.js not loaded yet — retry briefly
      var tries = 0;
      var t = setInterval(function () {
        if (doRender(prefill) || ++tries > 40) clearInterval(t);
      }, 250);
    }
  };

  // Initial render (no prefill) once Calendly's async script is ready.
  window.renderCalendly();
})();
