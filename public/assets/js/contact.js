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
      applicant_type:   form.applicant_type.value,
      insurance_type:   form.insurance_type.value,
      property_address: form.property_address.value.trim(),
      notes:            form.notes.value.trim(),
    };

    if (!data.first_name || !data.last_name || !data.email || !data.phone) {
      showStatus('error', 'Please fill out name, email, and phone.');
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

      showStatus('success', 'Thanks — your request is in. We\'ll be in touch within one business day.');
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
