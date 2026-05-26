// public/assets/js/calendly-grid.js
// Branded slot-grid scheduler. Fetches /api/availability (Worker proxy → Calendly)
// and renders a copper/marble grid. Click a slot → opens Calendly's scheduling URL
// pre-selected to that time. Prefill (name/email) is layered on when the contact
// form is submitted, via window.setSchedulerPrefill().

(function () {
  var grid    = document.getElementById('slotGrid');
  var empty   = document.getElementById('slotEmpty');
  var countEl = document.getElementById('slotCount');
  if (!grid) return;

  var loaded = false;
  var prefill = { name: '', email: '' };

  function appendPrefill(url, p) {
    if (!p || (!p.name && !p.email)) return url;
    try {
      var u = new URL(url);
      if (p.name)  u.searchParams.set('name',  p.name);
      if (p.email) u.searchParams.set('email', p.email);
      return u.toString();
    } catch (_) { return url; }
  }

  // Form-submit handler will call this once the lead is in.
  window.setSchedulerPrefill = function (next) {
    prefill = Object.assign(prefill, next || {});
    grid.querySelectorAll('a.slot-btn[data-url]').forEach(function (a) {
      a.href = appendPrefill(a.dataset.url, prefill);
    });
    var cta = document.getElementById('scheduleCta');
    if (cta && cta.dataset.baseHref) {
      cta.href = appendPrefill(cta.dataset.baseHref, prefill);
    }
  };

  function fmtTime(d) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDay(d) {
    return d.toLocaleDateString([], {
      weekday: 'short', month: 'short', day: 'numeric',
    }).toUpperCase();
  }
  function dayKey(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function showSkeleton() {
    grid.classList.add('slot-grid-skeleton');
    grid.innerHTML = '';
    for (var i = 0; i < 18; i++) {
      var s = document.createElement('div');
      s.className = 'slot-skel';
      grid.appendChild(s);
    }
  }

  function showEmpty() {
    grid.classList.remove('slot-grid-skeleton');
    grid.innerHTML = '';
    grid.setAttribute('aria-busy', 'false');
    if (empty) empty.hidden = false;
    if (countEl) countEl.textContent = '';
  }

  function render(slots) {
    grid.classList.remove('slot-grid-skeleton');
    grid.innerHTML = '';
    grid.setAttribute('aria-busy', 'false');

    if (!slots.length) { showEmpty(); return; }

    var lastDay = '';
    slots.forEach(function (s) {
      var d = new Date(s.start_time);
      if (isNaN(d.getTime())) return;
      var key = dayKey(d);
      if (key !== lastDay) {
        lastDay = key;
        var lbl = document.createElement('div');
        lbl.className = 'slot-day-label';
        lbl.textContent = fmtDay(d);
        grid.appendChild(lbl);
      }
      var a = document.createElement('a');
      a.className   = 'slot-btn';
      a.dataset.url = s.scheduling_url;
      a.href        = appendPrefill(s.scheduling_url, prefill);
      a.target      = '_blank';
      a.rel         = 'noopener';
      a.setAttribute('role', 'listitem');
      a.textContent = fmtTime(d);
      grid.appendChild(a);
    });

    if (countEl) {
      countEl.textContent = slots.length + ' open times — click any time to confirm.';
    }
  }

  function fetchAndRender() {
    if (loaded) return;
    loaded = true;
    showSkeleton();
    fetch('/api/availability', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error((res.j && res.j.error) || 'fetch failed');
        var slots = (res.j && res.j.slots) || [];
        if (res.j && res.j.scheduling_base) {
          var cta = document.getElementById('scheduleCta');
          if (cta) cta.dataset.baseHref = res.j.scheduling_base;
        }
        render(slots);
      })
      .catch(function (err) {
        console.error('[scheduler]', err);
        showEmpty();
      });
  }

  // Lazy load: fetch when the grid scrolls near the viewport.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { fetchAndRender(); io.disconnect(); }
      });
    }, { rootMargin: '300px' });
    io.observe(grid);
  } else {
    fetchAndRender();
  }
})();
