/* ═══════════════════════════════════════════════════
   VOLUM — script.js  (v3)
═══════════════════════════════════════════════════ */

const FETCH_TIMEOUT  = 5000;
const EMAIL_PATTERN  = /^[^\s@.]+(?:\.[^\s@.]+)*@(?:[^\s@.]+\.)+[^\s@.]+$/u;

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
    email_error: 'Please enter a valid email address.',
    sending: 'Sending…',
    lang_label: 'EN',
  },
  es: {
    form_success_hero: '¡Estás en la lista de iOS! Te escribiremos cuando Volum llegue al iPhone.',
    form_success_mid: '¡Estás en la lista de iOS! Te escribiremos cuando Volum llegue al iPhone.',
    form_success_bottom: '¡Ya estás dentro! Te escribiremos el día que Volum llegue a iOS.',
    form_error: 'Algo salió mal. Inténtalo de nuevo.',
    email_error: 'Introduce una dirección de correo válida.',
    sending: 'Enviando…',
    lang_label: 'ES',
  },
  pt: {
    form_success_hero: 'Você está na lista do iOS! Avisaremos quando o Volum chegar ao iPhone.',
    form_success_mid: 'Você está na lista do iOS! Avisaremos quando o Volum chegar ao iPhone.',
    form_success_bottom: 'Você está dentro! Vamos te avisar no dia em que o Volum chegar ao iOS.',
    form_error: 'Algo deu errado. Tente novamente.',
    email_error: 'Insira um endereço de e-mail válido.',
    sending: 'Enviando…',
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

/* ─── COOKIE CONSENT ─────────────────────────────── */
// Gates the Meta Pixel (script load + all events) and the CAPI relay behind
// an explicit visitor choice. Nothing pixel-related runs until this reads
// 'accepted'. Plausible is cookieless/unconditional -- not gated here.
const CONSENT_KEY = 'volum_tracking_consent';

function getConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
}

function setConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch (e) {}
}

function initConsentBanner() {
  const banner  = document.getElementById('consent-banner');
  const accept  = document.getElementById('consent-accept');
  const decline = document.getElementById('consent-decline');
  if (!banner || !accept || !decline) return;

  const existing = getConsent();
  if (existing === 'accepted') loadMetaPixel();
  else if (!existing) banner.hidden = false;

  accept.addEventListener('click', () => {
    setConsent('accepted');
    banner.hidden = true;
    loadMetaPixel();
  });

  decline.addEventListener('click', () => {
    const wasLoaded = metaPixelLoaded;
    setConsent('declined');
    banner.hidden = true;
    // The pixel is already running in this page; reload so it stops.
    if (wasLoaded) window.location.reload();
  });

  // Footer "Cookie settings" link: lets visitors change their choice later.
  const reopen = document.getElementById('cookie-settings');
  if (reopen) reopen.addEventListener('click', (e) => {
    e.preventDefault();
    banner.hidden = false;
  });
}

/* ─── META PIXEL ─────────────────────────────────── */
// The pixel script itself is only fetched, initialized, and fires PageView
// after consent is granted (see initConsentBanner above). These helpers
// fire additional events against the global fbq it defines, and mirror
// each one to the Conversions API relay (server-side backup for
// ad-blocker/ITP loss). Both sides share an event_id so Meta dedupes them
// into a single conversion instead of double-counting.
const META_PIXEL_ID = '2011076452832345';
let metaPixelLoaded = false;

function loadMetaPixel() {
  if (metaPixelLoaded || getConsent() !== 'accepted') return;
  metaPixelLoaded = true;
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', META_PIXEL_ID);
  window.fbq('track', 'PageView');
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function genEventId() {
  return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

// Anonymous only -- no email/name/phone. See cloudflare/capi-relay/README.md.
function sendCapiEvent(eventName, eventId, props) {
  if (!CAPI_ENDPOINT || getConsent() !== 'accepted') return;
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
  if (getConsent() !== 'accepted') return;
  const eventId = genEventId();
  if (window.fbq) window.fbq('track', name, props || {}, { eventID: eventId });
  sendCapiEvent(name, eventId, props);
}

// Fire a Meta CUSTOM event (e.g. waitlist button clicks / intent signals).
function pixelCustomEvent(name, props) {
  if (getConsent() !== 'accepted') return;
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
  const emailInput = form.querySelector('input[type="email"]');
  const updateEmailValidity = () => {
    if (!emailInput) return true;
    const value = emailInput.value.trim();
    const hasFormatError = value !== '' && !EMAIL_PATTERN.test(value);
    emailInput.setCustomValidity(hasFormatError ? t('email_error') : '');
    emailInput.setAttribute('aria-invalid', hasFormatError ? 'true' : 'false');
    if (!hasFormatError && msgEl.textContent === t('email_error')) {
      msgEl.textContent = '';
      msgEl.className = 'form-message';
    }
    return !hasFormatError;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (emailInput) {
      emailInput.value = emailInput.value.trim();
      updateEmailValidity();
      if (!emailInput.checkValidity()) {
        emailInput.reportValidity();
        msgEl.textContent = t('email_error');
        msgEl.className = 'form-message form-error-msg';
        return;
      }
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

  if (emailInput) {
    emailInput.addEventListener('input', updateEmailValidity);
    emailInput.addEventListener('blur', () => {
      emailInput.value = emailInput.value.trim();
      updateEmailValidity();
    });
    emailInput.addEventListener('invalid', () => {
      updateEmailValidity();
      if (!emailInput.validity.valueMissing) {
        msgEl.textContent = t('email_error');
        msgEl.className = 'form-message form-error-msg';
      }
    });
  }

  // Intent signal: user tapped the CTA (fires even if email/consent invalid).
  submitBtn.addEventListener('click', () => {
    plausibleEvent('Waitlist_Click', { form: formLabel });
    pixelCustomEvent('WaitlistButtonClick', { form: formLabel });
  });

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

/* ─── PLAUSIBLE NAV EVENTS ───────────────────────── */

function initPlayLinks() {
  document.querySelectorAll('a[href*="play.google.com"]').forEach(link => {
    link.addEventListener('click', () => {
      const slot = link.dataset.slot || 'unknown';
      plausibleEvent('Play_Click', { slot: slot });
      pixelCustomEvent('PlayStoreClick', { slot: slot });
    });
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
  initEngagement();
  initConsentBanner();

  captureUTM('utm-source-hero');
  captureUTM('utm-source-mid');
  captureUTM('utm-source-bottom');

  wireWaitlistForm('waitlist-form-hero',   'hero-form-msg',   'hero-submit-btn',   'hero');
  wireWaitlistForm('waitlist-form-mid',    'mid-form-msg',    'mid-submit-btn',    'mid');
  wireWaitlistForm('waitlist-form-bottom', 'bottom-form-msg', 'bottom-submit-btn', 'bottom');

  wireShareButton();
  initPlayLinks();

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
