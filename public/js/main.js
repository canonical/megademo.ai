/**
 * MegaDemo.ai — client-side JS
 */

/* -- CSRF helper ------------------------------------------- */
function getCsrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.content || '';
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* -- Star voting ------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const voteWidget = document.querySelector('.star-voting');
  if (!voteWidget) return;

  const projectId = voteWidget.dataset.projectId;
  if (!projectId) return;
  const buttons = voteWidget.querySelectorAll('.star-btn');

  // Hover preview
  buttons.forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      const n = parseInt(btn.dataset.stars, 10);
      buttons.forEach((b) => b.classList.toggle('hover-preview', parseInt(b.dataset.stars, 10) <= n));
    });
    btn.addEventListener('mouseleave', () => {
      buttons.forEach((b) => b.classList.remove('hover-preview'));
    });
  });

  // Click to vote
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stars = parseInt(btn.dataset.stars, 10);
      try {
        const data = await apiPost(`/projects/${projectId}/vote`, { stars });
        buttons.forEach((b) => b.classList.toggle('active', parseInt(b.dataset.stars, 10) <= stars));
        const avgEl = document.getElementById('vote-avg');
        const countEl = document.getElementById('vote-count');
        if (avgEl && typeof data.avgRating === 'number') avgEl.textContent = data.avgRating.toFixed(1);
        if (countEl && typeof data.voteCount === 'number') countEl.textContent = ` (${data.voteCount} ${data.voteCount === 1 ? 'vote' : 'votes'})`;
        const yourVote = document.querySelector('.your-vote');
        if (yourVote) yourVote.textContent = `Your vote: ${stars} ★`;
      } catch (err) {
        if (err.status === 401) {
          if (confirm('You need to sign in to vote. Sign in now?')) location.href = '/auth/github';
        } else {
          alert('Vote failed. Please try again.');
        }
      }
    });
  });
});

/* -- Tech-tag-check .checked fallback (for :has() in older browsers) -- */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tech-tag-check input[type="checkbox"]').forEach((cb) => {
    const label = cb.closest('.tech-tag-check');
    if (!label) return;
    if (cb.checked) label.classList.add('checked');
    cb.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
  });
});


/* -- Dirty form guard (warn before leaving page with unsaved changes) -- */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-dirty-guard]').forEach((form) => {
    let dirty = false;
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('change', () => { dirty = true; });
    form.addEventListener('submit', () => { dirty = false; });
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  });
});

/* -- Countdown timer --------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const widget = document.getElementById('countdown-widget');
  if (!widget) return;

  const section = widget.closest('.countdown-section');

  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const deadline = parseDate(widget.dataset.deadline);
  const megademo  = parseDate(widget.dataset.megademo);
  const label  = document.getElementById('countdown-label');
  const cdDays = document.getElementById('cd-days');
  const cdHrs  = document.getElementById('cd-hours');
  const cdMins = document.getElementById('cd-mins');
  const cdSecs = document.getElementById('cd-secs');
  if (!label || !cdDays || !cdHrs || !cdMins || !cdSecs) return;

  function pad(n) { return String(n).padStart(2, '0'); }

  function tick() {
    const now = Date.now();
    let target = null;
    let text   = '';

    if (deadline && now < deadline.getTime()) {
      // Submission window still open
      target = deadline;
      text = 'Submissions close in';
    } else if (megademo && now < megademo.getTime()) {
      // Submissions closed; countdown to the event
      target = megademo;
      text = 'MegaDemo starts in';
    } else if (megademo && now >= megademo.getTime()) {
      // Event is live
      label.textContent = 'MEGADEMO IS NOW!';
      cdDays.textContent = cdHrs.textContent = cdMins.textContent = cdSecs.textContent = '00';
      return;
    } else if (deadline && now >= deadline.getTime()) {
      // Submissions closed, no megademo date configured
      label.textContent = 'Submissions Closed';
      cdDays.textContent = cdHrs.textContent = cdMins.textContent = cdSecs.textContent = '00';
      return;
    }

    if (!target) {
      // Nothing relevant to show — hide the whole strip
      if (section) section.style.display = 'none';
      else widget.style.display = 'none';
      return;
    }

    const diff = target.getTime() - now;
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000)  / 60000);
    const secs  = Math.floor((diff % 60000)    / 1000);

    label.textContent = text;
    cdDays.textContent = pad(days);
    cdHrs.textContent  = pad(hours);
    cdMins.textContent = pad(mins);
    cdSecs.textContent = pad(secs);
  }

  tick();
  setInterval(tick, 1000);
});

/* -- Bootstrap: explicit Collapse + Dropdown init for mobile --- */
document.addEventListener('DOMContentLoaded', () => {
  // Use window.bootstrap to be explicit; fallback to globalThis for non-browser envs.
  // Ensures hamburger/collapse + username dropdown work on iOS/Android WebKit
  // even if Bootstrap's auto-init hasn't fired.
  const bs = window.bootstrap || globalThis.bootstrap;
  if (!bs) return;

  document.querySelectorAll('.navbar-collapse').forEach((el) => {
    bs.Collapse.getInstance(el) || new bs.Collapse(el, { toggle: false });
  });
  document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((el) => {
    bs.Dropdown.getInstance(el) || new bs.Dropdown(el);
  });
});

/* -- Custom cross-browser select dropdown ------------------- */
// Replaces <select class="md-select"> with a fully themed Bootstrap dropdown,
// bypassing Firefox's inability to style native <select> popups.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('select.md-select').forEach((select) => {
    // Transfer spacing/width utility classes to the wrapper
    const spacingRe = /^(m|p)(t|b|s|e|x|y)?-\d|^w-/;
    const transferClasses = Array.from(select.classList).filter((c) => spacingRe.test(c));

    const wrapper = document.createElement('div');
    wrapper.className = 'md-custom-select dropdown';
    transferClasses.forEach((c) => { wrapper.classList.add(c); select.classList.remove(c); });

    // Build button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-custom-select-btn dropdown-toggle';
    btn.setAttribute('data-bs-toggle', 'dropdown');
    btn.setAttribute('aria-expanded', 'false');

    // Build menu
    const menu = document.createElement('ul');
    menu.className = 'dropdown-menu md-custom-select-menu';

    function syncBtn() {
      const opt = select.options[select.selectedIndex];
      btn.textContent = opt ? opt.text : '';
    }

    function buildMenu() {
      menu.innerHTML = '';
      Array.from(select.options).forEach((opt) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item' + (opt.selected ? ' active' : '');
        a.href = '#';
        a.dataset.value = opt.value;
        a.textContent = opt.text;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          menu.querySelectorAll('.active').forEach((el) => el.classList.remove('active'));
          a.classList.add('active');
          syncBtn();
        });
        li.appendChild(a);
        menu.appendChild(li);
      });
    }

    buildMenu();
    syncBtn();

    // Insert wrapper, move select inside (hidden but present for form submission + validation)
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(btn);
    wrapper.appendChild(menu);
    wrapper.appendChild(select);
    select.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;top:0;left:0;';

    // Re-sync button if select value changes externally (e.g. form reset)
    select.addEventListener('change', syncBtn);

    // Initialize Bootstrap Dropdown (elements created after Bootstrap's own init pass)
    if (window.bootstrap) new window.bootstrap.Dropdown(btn);
  });
});


document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.join-leave-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const original = btn ? btn.textContent : null;
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      try {
        await apiPost(form.action, {});
        window.location.reload();
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = original; }
        if (err.status === 401) {
          window.location.href = '/auth/github';
        } else {
          alert('Something went wrong. Please try again.');
        }
      }
    });
  });
});
