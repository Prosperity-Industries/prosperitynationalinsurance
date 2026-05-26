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

    // Attach first-touch attribution (UTMs / referrer / landing page) so the
    // lead carries its ad source into Forge. Captured by attribution.js.
    try {
      var attr = JSON.parse(sessionStorage.getItem('pni_attribution') || '{}');
      if (attr && Object.keys(attr).length) data.attribution = attr;
    } catch (e) { /* no-op */ }

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
      // Layer prefill onto every slot button + the CTA, then scroll to the grid.
      if (typeof window.setSchedulerPrefill === 'function') {
        window.setSchedulerPrefill({
          name:  (data.first_name + ' ' + data.last_name).trim(),
          email: data.email,
        });
      }
      const sched = document.getElementById('slotGrid');
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


