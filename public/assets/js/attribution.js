// First-touch attribution — captures ad/referrer context on the first page
// view of a visit and stores it in sessionStorage, so the contact form can
// attach it to the lead even if the visitor landed on a different page first.
// Runs site-wide. Self-contained, fail-safe, non-blocking.
(function () {
  try {
    var KEY = 'pni_attribution';
    if (sessionStorage.getItem(KEY)) return; // first-touch only — don't overwrite
    var qs = new URLSearchParams(location.search);
    var keys = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','msclkid'];
    var data = {};
    keys.forEach(function (k) { var v = qs.get(k); if (v) data[k] = String(v).slice(0, 200); });
    data.landing_page = (location.pathname + location.search).slice(0, 300);
    data.referrer = (document.referrer || '').slice(0, 300);
    data.first_seen = new Date().toISOString();
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) { /* no-op */ }
})();
