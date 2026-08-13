/* ═══════════════════════════════════════════════════
   VOLUM — script.js  (v3)
═══════════════════════════════════════════════════ */

const IS_LAUNCHED    = false;
const PLAY_STORE_URL = '#';
const FETCH_TIMEOUT  = 5000;

// Cloudflare Worker relay for Meta Conversions API (server-side event
// backup to the browser Pixel). Empty until deployed -- see
// cloudflare/capi-relay/README.md. CAPI calls are skipped while unset.
const CAPI_ENDPOINT = 'https://volum-capi-relay.bouncingballentertainment.workers.dev';

/* ─── TRANSLATIONS ───────────────────────────────── */
/* Static page content (nav, hero, features, FAQ, etc.) lives in
   i18n/{lang}.json and is baked into index.html / es/index.html / pt/index.html
   at build time by scripts/generate.js -- see website/README.md. This dict
   only holds strings generated dynamically by JS after user interaction (so
   they can't be pre-baked into static HTML): form submit feedback and the
   language-picker label. */
const TRANSLATIONS = {
  en: {
    form_success_hero: 'You\'re on the list! We\'ll be in touch.',
    form_success_mid: 'You\'re on the list! We\'ll be in touch.',
    form_success_bottom: 'You\'re in. We\'ll message you on launch day.',
    form_error: 'Something went wrong. Try again.',
    sending: 'Sending…',
    platform_error: 'Please select Android or iPhone.',
    lang_label: 'EN',
  },
  es: {
    form_success_hero: '¡Estás en la lista! Estaremos en contacto.',
    form_success_mid: '¡Estás en la lista! Estaremos en contacto.',
    form_success_bottom: '¡Ya estás dentro! Te escribiremos el día del lanzamiento.',
    form_error: 'Algo salió mal. Inténtalo de nuevo.',
    sending: 'Enviando…',
    platform_error: 'Por favor selecciona Android o iPhone.',
    lang_label: 'ES',
  },
  pt: {
    form_success_hero: 'Você está na lista! Entraremos em contato.',
    form_success_mid: 'Você está na lista! Entraremos em contato.',
    form_success_bottom: 'Você está dentro! Vamos te avisar no dia do lançamento.',
    form_error: 'Algo deu errado. Tente novamente.',
    sending: 'Enviando…',
    platform_error: 'Por favor selecione Android ou iPhone.',
    lang_label: 'PT',
  },
};

let currentLang = 'en';
function t(key) {
  return (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key])
    || TRANSLATIONS.en[key] || key;
}

/* ─── HELPERS ────────────────────────────────────── */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plausibleEvent(name, props) {
  if (window.plausible) window.plausible(name, { props: props || {} });
}

/* ─── META PIXEL ─────────────────────────────────── */
// Pixel base code (init + PageView) lives inline in each page's <head>.
// These helpers fire additional events against the global fbq it defines,
// and mirror each one to the Conversions API relay (server-side backup for
// ad-blocker/ITP loss). Both sides share an event_id so Meta dedupes them
// into a single conversion instead of double-counting.

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function genEventId() {
  return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

// Anonymous only -- no email/name/phone. See cloudflare/capi-relay/README.md.
function sendCapiEvent(eventName, eventId, props) {
  if (!CAPI_ENDPOINT) return;
  const payload = {
    event_name: eventName,
    event_id: eventId,
    event_source_url: window.location.href,
    fbp: getCookie('_fbp'),
    fbc: getCookie('_fbc'),
    custom_data: props || {},
  };
  fetch(CAPI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

// Fire a Meta standard event (e.g. 'Lead'), mirroring plausibleEvent.
function pixelEvent(name, props) {
  const eventId = genEventId();
  if (window.fbq) window.fbq('track', name, props || {}, { eventID: eventId });
  sendCapiEvent(name, eventId, props);
}

// Fire a Meta CUSTOM event (e.g. waitlist button clicks / intent signals).
function pixelCustomEvent(name, props) {
  const eventId = genEventId();
  if (window.fbq) window.fbq('trackCustom', name, props || {}, { eventID: eventId });
  sendCapiEvent(name, eventId, props);
}

/* ─── ENGAGEMENT (signup-quality signals) ────────── */

// Scroll depth + time on page — these predict paid intent far better than
// raw signup volume. Each milestone fires once per page load.
function initEngagement() {
  // Scroll depth: 25 / 50 / 75 / 100 %
  const marks = [25, 50, 75, 100];
  let fired = 0;
  let ticking = false;

  const checkDepth = () => {
    ticking = false;
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return;
    const pct = ((window.scrollY || doc.scrollTop) / scrollable) * 100;
    while (fired < marks.length && pct >= marks[fired]) {
      const depth = marks[fired++];
      plausibleEvent('Scroll_Depth', { depth: depth + '%' });
      if (depth === 75) pixelEvent('ViewContent', { content_name: 'engaged_scroll' });
    }
  };

  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(checkDepth); }
  }, { passive: true });
  checkDepth(); // catch short pages already fully visible

  // Time on page: 15 / 30 / 60 / 120 s milestones, timers cleared on leave.
  const seconds = [15, 30, 60, 120];
  const timers = seconds.map(s =>
    setTimeout(() => plausibleEvent('Time_On_Page', { seconds: s + 's' }), s * 1000)
  );
  window.addEventListener('pagehide', () => timers.forEach(clearTimeout), { once: true });
}

function fetchWithTimeout(url, ms, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ─── LANGUAGE ───────────────────────────────────── */

// Each page's language is baked in at build time (correct <html lang>,
// content, meta tags already in the static HTML) -- no runtime detection or
// in-place content swap anymore. This just reads which page we're on so
// t() picks the right dynamic strings (form feedback, lang-picker label).
function currentLangFromPage() {
  const htmlLang = (document.documentElement.lang || 'en').toLowerCase();
  if (htmlLang.startsWith('es')) return 'es';
  if (htmlLang.startsWith('pt')) return 'pt';
  return 'en';
}

function initLanguage() {
  currentLang = currentLangFromPage();

  const labelEl = document.getElementById('lang-label');
  if (labelEl) labelEl.textContent = t('lang_label');

  document.querySelectorAll('#lang-dropdown [role="option"], .nav-mobile-lang button').forEach(el => {
    const active = el.dataset.lang === currentLang;
    el.setAttribute('aria-selected', active ? 'true' : 'false');
    el.classList.toggle('active', active);
  });
}

function initLangPicker() {
  const btn      = document.getElementById('lang-btn');
  const dropdown = document.getElementById('lang-dropdown');
  if (!btn || !dropdown) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = dropdown.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  });

  function selectLang(lang) {
    plausibleEvent('Language_Changed', { language: lang });
    try { localStorage.setItem('volum_lang', lang); } catch (e) {}
    dropdown.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');

    // Each locale is its own static page now (real navigation, not a
    // content swap) -- keeps the address bar, OG tags, and hreflang correct
    // for both users and crawlers.
    const paths = { en: '/', es: '/es/', pt: '/pt/' };
    if (paths[lang] && lang !== currentLang) {
      window.location.href = paths[lang];
    }
  }

  document.querySelectorAll('[data-lang]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      selectLang(el.dataset.lang);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectLang(el.dataset.lang);
      }
    });
  });
}

/* ─── NAVBAR SCROLL ──────────────────────────────── */

function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;
  const onScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ─── HAMBURGER MENU ─────────────────────────────── */

function initHamburger() {
  const btn      = document.getElementById('hamburger');
  const menu     = document.getElementById('nav-mobile');
  const langDrop = document.getElementById('lang-dropdown');
  if (!btn || !menu) return;

  function open() {
    menu.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', 'Close menu');
    if (langDrop) { langDrop.setAttribute('aria-hidden', 'true'); langDrop.setAttribute('tabindex', '-1'); }
  }
  function close() {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open menu');
    if (langDrop) { langDrop.removeAttribute('aria-hidden'); langDrop.removeAttribute('tabindex'); }
  }
  function toggle() { menu.classList.contains('open') ? close() : open(); }

  btn.addEventListener('click', toggle);

  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) close();
  });

  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', close));
}

/* ─── UTM CAPTURE ────────────────────────────────── */

function captureUTM(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  const params = new URLSearchParams(window.location.search);
  field.value = params.get('utm_source') || 'direct';
}

// Inject the remaining UTM parameters as hidden inputs so campaign reporting
// (medium/campaign/term/content) is captured, not just the source.
function injectUTMFields(form) {
  if (!form) return;
  const params = new URLSearchParams(window.location.search);
  ['utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(name => {
    if (form.querySelector('[name="' + name + '"]')) return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = params.get(name) || '';
    form.appendChild(input);
  });
}

/* ─── WAITLIST FORM ──────────────────────────────── */

function wireWaitlistForm(formId, msgId, submitBtnId, formLabel) {
  const form    = document.getElementById(formId);
  const msgEl   = document.getElementById(msgId);
  const submitBtn = document.getElementById(submitBtnId);
  if (!form || !msgEl || !submitBtn) return;

  injectUTMFields(form);

  const originalBtnText = submitBtn.textContent;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Platform choice (Android / iPhone) is mandatory.
    const platformInput = form.querySelector('.platform-hidden-input');
    if (platformInput && !platformInput.value) {
      msgEl.textContent = t('platform_error');
      msgEl.className   = 'form-message form-error-msg';
      const picker = document.querySelector('.platform-picker[data-form="' + formId + '"]');
      if (picker) {
        picker.classList.remove('shake');
        void picker.offsetWidth;          // restart the shake animation
        picker.classList.add('shake');
      }
      return;
    }

    plausibleEvent('Waitlist_Submit', { form: formLabel });

    submitBtn.disabled = true;
    submitBtn.textContent = t('sending');
    msgEl.textContent = '';
    msgEl.className = 'form-message';

    try {
      const res = await fetchWithTimeout(form.action, FETCH_TIMEOUT, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' },
      });

      if (res.ok) {
        form.style.display = 'none';
        msgEl.textContent  = t('form_success_' + formLabel);
        msgEl.className    = 'form-message form-success-msg';
        plausibleEvent('Waitlist_Success', { form: formLabel });
        pixelEvent('Lead', { content_name: 'waitlist', source: formLabel });

        if (formLabel === 'bottom') {
          const nudge = document.getElementById('share-nudge');
          if (nudge) nudge.style.display = 'block';
        }
      } else {
        throw new Error('non-ok');
      }
    } catch {
      submitBtn.disabled   = false;
      submitBtn.textContent = originalBtnText;
      msgEl.textContent    = t('form_error');
      msgEl.className      = 'form-message form-error-msg';
      plausibleEvent('Waitlist_Error', { form: formLabel });
    }
  });

  // Intent signal: user tapped the CTA (fires even if email/consent invalid).
  submitBtn.addEventListener('click', () => {
    plausibleEvent('Waitlist_Click', { form: formLabel });
    pixelCustomEvent('WaitlistButtonClick', { form: formLabel });
  });

  const emailInput = form.querySelector('input[type="email"]');
  if (emailInput) {
    let focusFired = false;
    emailInput.addEventListener('focus', () => {
      if (!focusFired) {
        plausibleEvent('Waitlist_Focus', { form: formLabel });
        focusFired = true;
      }
    });
  }
}

/* ─── SCROLL REVEAL ──────────────────────────────── */

function initScrollReveal() {
  if (reduceMotion) return;

  const staggerGroups = [
    '.features-grid .feature-card',
    '.steps-grid .step',
    '.stats-grid .stat-item',
    '.mockup-grid .phone-frame',
  ];

  const singles = [
    '.features .eyebrow',
    '.features h2',
    '.volume-statement .eyebrow',
    '.volume-statement h2',
    '.volume-body',
    '.how-it-works .eyebrow',
    '.how-it-works h2',
    '.real-numbers .eyebrow',
    '.real-numbers h2',
    '.real-numbers .section-sub',
    '.waitlist-section .eyebrow',
  ];

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  singles.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) { el.classList.add('reveal'); obs.observe(el); }
  });

  staggerGroups.forEach(sel => {
    document.querySelectorAll(sel).forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = (i * 90) + 'ms';
      obs.observe(el);
    });
  });
}

/* ─── VOLUME FORMULA REVEAL ──────────────────────── */

function initFormulaReveal() {
  const formula = document.querySelector('.volume-formula');
  if (!formula) return;

  const spans = formula.querySelectorAll('span');

  if (reduceMotion) {
    spans.forEach(s => { s.style.opacity = '1'; });
    return;
  }

  spans.forEach(s => {
    s.style.opacity = '0';
    s.style.display = 'inline-block';
  });

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        formula.classList.add('revealed');
        obs.unobserve(formula);
      }
    });
  }, { threshold: 0.6 });

  obs.observe(formula);
}

/* ─── COUNT-UP ANIMATION ─────────────────────────── */

function initCountUp() {
  const els = document.querySelectorAll('.stat-number[data-target]');
  if (!els.length) return;

  if (reduceMotion) {
    els.forEach(el => {
      el.textContent = parseInt(el.dataset.target, 10).toLocaleString();
    });
    return;
  }

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      obs.unobserve(entry.target);
      const el     = entry.target;
      const target = parseInt(el.dataset.target, 10);
      const dur    = 800;
      const start  = performance.now();

      function tick(now) {
        const progress = Math.min((now - start) / dur, 1);
        const ease     = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.floor(ease * target).toLocaleString();
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          el.textContent = target.toLocaleString();
          el.classList.add('stat-glow');
          setTimeout(() => el.classList.remove('stat-glow'), 900);
        }
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.5 });

  els.forEach(el => obs.observe(el));
}

/* ─── STEP LOOP CYCLE ────────────────────────────── */

function initStepLoop() {
  const steps = document.querySelectorAll('.steps-grid .step');
  const grid  = document.getElementById('steps-grid');
  if (!steps.length || reduceMotion) return;

  const isMobile = window.innerWidth < 768;

  let fill = null;
  if (!isMobile) {
    fill = document.createElement('div');
    fill.className = 'step-connector-fill';
    fill.setAttribute('aria-hidden', 'true');
    grid.appendChild(fill);
  }

  const fillScale = [0, 0.5, 1];
  let current = 0;
  let paused  = false;

  function activate(i) {
    steps.forEach((s, idx) => s.classList.toggle('loop-active', idx === i));
    if (!fill) return;
    if (i === 0) {
      fill.style.transition = 'none';
      fill.style.transform  = 'scaleX(0)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fill.style.transition = '';
      }));
    } else {
      fill.style.transform = `scaleX(${fillScale[i]})`;
    }
  }

  activate(0);

  setInterval(() => {
    if (!paused) {
      current = (current + 1) % steps.length;
      activate(current);
    }
  }, 2500);

  grid.addEventListener('mouseenter',  () => { paused = true; });
  grid.addEventListener('mouseleave',  () => { paused = false; });
  grid.addEventListener('touchstart',  () => { paused = true; },  { passive: true });
  grid.addEventListener('touchend',    () => { paused = false; }, { passive: true });

  steps.forEach((step, i) => {
    step.addEventListener('click', () => { current = i; activate(i); });
  });
}


/* ─── SHARE BUTTON ───────────────────────────────── */

function wireShareButton() {
  const btn    = document.getElementById('share-btn');
  const copied = document.getElementById('share-copied');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    plausibleEvent('Share_Click');
    const shareData = {
      title: 'Volum: Gym Tracker',
      text:  'You always know what to lift. Check out Volum.',
      url:   window.location.href,
    };

    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* dismissed */ }
    } else {
      try {
        const shareText = `Just joined the Volum waitlist — it plans your exact weight, sets, and reps every session. Check it out: ${window.location.origin}`;
        await navigator.clipboard.writeText(shareText);
        if (copied) {
          copied.style.display = 'block';
          setTimeout(() => { copied.style.display = 'none'; }, 2500);
        }
      } catch { /* clipboard blocked */ }
    }
  });
}

/* ─── LAUNCH STATE ───────────────────────────────── */

function initLaunchState() {
  if (!IS_LAUNCHED) return;

  document.querySelectorAll('.waitlist-form').forEach(form => {
    const btn = document.createElement('a');
    btn.href      = PLAY_STORE_URL;
    btn.className = 'btn btn-accent';
    btn.textContent = 'Download on Google Play';
    btn.target    = '_blank';
    btn.rel       = 'noopener';
    form.replaceWith(btn);
  });

  const playBadge = document.getElementById('play-badge');
  if (playBadge && PLAY_STORE_URL !== '#') {
    const link = document.createElement('a');
    link.href      = PLAY_STORE_URL;
    link.className = playBadge.className + ' active';
    link.id        = 'play-badge';
    link.setAttribute('aria-label', playBadge.getAttribute('aria-label') || '');
    link.innerHTML = playBadge.innerHTML;
    link.target    = '_blank';
    link.rel       = 'noopener';
    playBadge.replaceWith(link);
  }
}

/* ─── PLAUSIBLE NAV EVENTS ───────────────────────── */

function initNavEvents() {
  const navCta = document.querySelector('.nav-cta');
  if (navCta) navCta.addEventListener('click', () => {
    plausibleEvent('Nav_Waitlist_Click');
    pixelCustomEvent('WaitlistButtonClick', { form: 'nav' });
  });

}

/* ─── TESTIMONIAL CARDS ──────────────────────────── */

function initTestimonialCards() {
  document.querySelectorAll('.testimonial-card[data-href]').forEach(card => {
    card.addEventListener('click', e => {
      if (!e.target.closest('a')) {
        window.open(card.dataset.href, '_blank', 'noopener');
      }
    });
  });
}

/* ─── PLATFORM PICKER ────────────────────────────── */

function initPlatformPickers() {
  document.querySelectorAll('.platform-picker').forEach(picker => {
    const form = document.getElementById(picker.dataset.form);
    if (!form) return;
    const hidden = form.querySelector('.platform-hidden-input');
    picker.querySelectorAll('.platform-btn').forEach(btn => {
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        picker.querySelectorAll('.platform-btn').forEach(b => {
          b.classList.toggle('btn-accent', b === btn);
          b.classList.toggle('btn-ghost', b !== btn);
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        hidden.value = btn.dataset.platform;
        picker.classList.remove('shake');   // clear the error highlight
        const msgEl = document.getElementById(form.id.replace('waitlist-form-', '') + '-form-msg');
        if (msgEl && msgEl.classList.contains('form-error-msg')) {
          msgEl.textContent = '';
          msgEl.className   = 'form-message';
        }
      });
    });
  });
}

/* ─── PODIUM CAROUSEL (mobile) ───────────────────── */

function initPodiumCarousel() {
  if (window.innerWidth >= 768) return;
  const deck   = document.querySelector('.podium-deck');
  const center = document.querySelector('.podium-center');
  if (!deck || !center) return;

  const cards = deck.querySelectorAll('.podium-card');

  function updateActive() {
    const deckMid = deck.getBoundingClientRect().left + deck.clientWidth / 2;
    let closest = null, minDist = Infinity;
    cards.forEach(card => {
      const r = card.getBoundingClientRect();
      const dist = Math.abs(r.left + r.width / 2 - deckMid);
      if (dist < minDist) { minDist = dist; closest = card; }
    });
    cards.forEach(card => card.classList.toggle('active', card === closest));
  }

  requestAnimationFrame(() => {
    deck.scrollLeft = center.offsetLeft - (deck.clientWidth - center.clientWidth) / 2;
    updateActive();
  });

  deck.addEventListener('scroll', updateActive, { passive: true });
}

/* ─── HERO VOLUME COUNTER ───────────────────────── */

function initHeroCounter() {
  const el = document.querySelector('.hero-datacard-num[data-countup]');
  if (!el) return;
  const target = parseInt(el.dataset.countup, 10);
  if (reduceMotion) { el.textContent = target.toLocaleString(); return; }
  const dur = 1500, start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(ease * target).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = target.toLocaleString();
  }
  requestAnimationFrame(tick);
}

function initMidBars() {
  const sec = document.querySelector('.mid-cta');
  if (!sec || !sec.querySelector('.mcd-bars')) return;
  if (reduceMotion) { sec.classList.add('charged'); return; }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { sec.classList.add('charged'); obs.unobserve(sec); }
    });
  }, { threshold: 0.4 });
  obs.observe(sec);
}

/* ─── VOLUME CHART DRAW ──────────────────────────── */

function initVolumeChart() {
  const chart = document.getElementById('volume-chart');
  if (!chart) return;
  if (reduceMotion) { chart.classList.add('drawn'); return; }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { chart.classList.add('drawn'); obs.unobserve(chart); }
    });
  }, { threshold: 0.3 });
  obs.observe(chart);
}

/* ─── INIT ───────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initLanguage();
  initLangPicker();
  initNavbar();
  initHamburger();
  initLaunchState();
  initEngagement();

  captureUTM('utm-source-hero');
  captureUTM('utm-source-mid');
  captureUTM('utm-source-bottom');

  initPlatformPickers();

  wireWaitlistForm('waitlist-form-hero',   'hero-form-msg',   'hero-submit-btn',   'hero');
  wireWaitlistForm('waitlist-form-mid',    'mid-form-msg',    'mid-submit-btn',    'mid');
  wireWaitlistForm('waitlist-form-bottom', 'bottom-form-msg', 'bottom-submit-btn', 'bottom');

  wireShareButton();
  initNavEvents();

  initPodiumCarousel();
  initScrollReveal();
  initFormulaReveal();
  initCountUp();
  initHeroCounter();
  initVolumeChart();
  initMidBars();
  initStepLoop();
  initTestimonialCards();
});
