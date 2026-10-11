/* Wedding RSVP — plain JS, no build step. Answers go to a private Google Sheet (see apps-script/). */
(() => {
  'use strict';

  const SCRIPT_URL = (window.RSVP_CONFIG || {}).scriptUrl || '';
  const DRAFT_KEY = 'rsvp:draft';
  const SENT_KEY = 'rsvp:sent';
  const PHONE_RE = /^[6-9]\d{9}$/;
  const MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const form = $('#rsvp');
  const steps = $$('.step', form);
  const progress = $('#progress');
  const backBtn = $('#back');
  const nextBtn = $('#next');
  const statusEl = $('#status');
  const thanks = $('#thanks');

  // Named conditions: data-show="…" toggles a block/option, data-when="…" puts a whole step in the flow.
  const RULES = {
    family: s => s.party === 'With family',
    dancing: s => s.dance === 'Yes',
    groupDancing: s => s.dance === 'Yes' && partySize(s) > 1,
    someEvents: s => s.days === 'Some events',
    daysUnsure: s => s.days === 'Not sure yet',
    // Stay is asked of anyone with us across both days: everything, or an 18th event plus the wedding on the 19th
    twoDays: s => s.days === 'Both days' || (s.days === 'Some events' && s.events.includes('Wedding')
      && (s.events.includes('Haldi') || s.events.includes('Reception'))),
    needStay: s => s.stay === 'Yes',
    stayUnsure: s => s.stay === 'Not sure yet',
  };

  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
  };

  let current = 0; // index into steps (DOM order)

  /* ---------- state ---------- */

  const int = (v, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || min));

  function read() {
    const s = { events: [] };
    for (const [key, val] of new FormData(form)) {
      if (key === 'events') s.events.push(val);
      else s[key] = String(val).trim();
    }
    return s;
  }

  function write(s) {
    for (const [key, val] of Object.entries(s || {})) {
      const el = form.elements[key];
      if (!el || key === 'website') continue;
      if (el instanceof RadioNodeList || el.type === 'radio' || el.type === 'checkbox') {
        const vals = [].concat(val);
        (el instanceof RadioNodeList ? [...el] : [el]).forEach(i => { i.checked = vals.includes(i.value); });
      } else {
        el.value = val;
      }
    }
  }

  function partySize(s) {
    if (s.party === 'With spouse') return 2;
    if (s.party === 'With family') return int(s.adults, 1, 20) + int(s.kids, 0, 20);
    return 1;
  }

  // Accepts "98765 43210", "+91 98765-43210", "098765…" and keeps the 10-digit number.
  function normalisePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d.slice(0, 10);
  }

  // Exactly what gets stored: only answers to questions this guest was actually shown.
  function payload() {
    const s = read();
    const size = partySize(s);
    const dancing = s.dance === 'Yes';
    const both = s.days === 'Both days';
    const picked = new Set(s.events);
    const attend = ev => (both ? 'Yes' : s.days === 'Some events' ? (picked.has(ev) ? 'Yes' : 'No') : s.days ? 'Maybe' : '');
    const twoDays = RULES.twoDays(s);
    const staying = twoDays && s.stay === 'Yes';
    const family = s.party === 'With family';
    return {
      phone: normalisePhone(s.phone),
      name: s.name || '',
      party: s.party || '',
      adults: family ? int(s.adults, 1, 20) : size,
      kids: family ? int(s.kids, 0, 20) : 0,
      dance: dancing ? 'Yes' : 'No',
      dancers: dancing ? int(s.dancers, 1, size) : 0,
      song: dancing ? s.song || '' : '',
      days: s.days || '',
      haldi: attend('Haldi'),
      reception: attend('Reception'),
      wedding: attend('Wedding'),
      stay: twoDays ? s.stay || '' : '',
      city: staying ? s.city || '' : '',
      arrival: staying ? s.arrival || '' : '',
      departure: staying ? s.departure || '' : '',
      pickup: staying ? s.pickup || '' : '',
      note: s.note || '',
      website: s.website || '',
    };
  }

  /* ---------- rendering ---------- */

  const flow = (s = read()) => steps.filter(st => !st.dataset.when || RULES[st.dataset.when](s));
  const isLast = () => { const f = flow(); return f[f.length - 1] === steps[current]; };

  function apply() {
    let s = read();
    $$('[data-show]', form).forEach(el => { el.hidden = !RULES[el.dataset.show](s); });
    // A choice that just got hidden must not stay picked (e.g. "17 Nov" arrival after un-picking dance)
    $$('label[data-show][hidden] input:checked', form).forEach(i => { i.checked = false; });
    const dancers = form.elements.dancers;
    dancers.max = partySize(s);
    dancers.value = int(dancers.value, 1, partySize(s));
    s = read();
    renderProgress(s);
    store.set(DRAFT_KEY, s);
  }

  function renderProgress(s) {
    const f = flow(s);
    const pos = f.indexOf(steps[current]);
    progress.innerHTML = f
      .map((st, i) => `<li class="${i < pos ? 'done' : i === pos ? 'current' : ''}"${i === pos ? ' aria-current="step"' : ''}>${st.dataset.label}</li>`)
      .join('');
    backBtn.hidden = pos <= 0;
    nextBtn.textContent = pos === f.length - 1 ? 'Send RSVP 🪔' : 'Continue →';
  }

  function show(step, scroll = true) {
    steps.forEach(st => st.classList.toggle('is-active', st === step));
    current = steps.indexOf(step);
    setStatus('');
    renderProgress();
    if (isLast()) renderSummary($('#summary'), payload());
    if (scroll) {
      progress.scrollIntoView({ behavior: MOTION, block: 'start' });
      $('h2', step).focus({ preventScroll: true });
    }
  }

  function summaryRows(p) {
    const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
    const who = p.party === 'With family'
      ? `Family · ${plural(p.adults, 'adult')}${p.kids ? `, ${plural(p.kids, 'kid')}` : ''}`
      : p.party;
    const events = ['Haldi', 'Reception', 'Wedding'].filter(e => p[e.toLowerCase()] === 'Yes');
    const days = { 'Both days': 'Both days ❤️', 'Some events': events.join(', '), 'Not sure yet': 'Not sure yet' }[p.days];
    const stay = p.stay === 'Yes'
      ? ['Yes', p.arrival && `arriving ${p.arrival}`, p.departure && `leaving ${p.departure}`,
        p.pickup && p.pickup !== 'No' && `pickup from ${p.pickup.toLowerCase()}`].filter(Boolean).join(' · ')
      : { No: 'No, thank you', 'Not sure yet': 'Not sure yet' }[p.stay];
    return [
      ['Name', p.name],
      ['Mobile', p.phone && `+91 ${p.phone.slice(0, 5)} ${p.phone.slice(5)}`],
      ['Coming', who],
      ['Sangeet', p.dance === 'Yes' ? `Dancing 💃${p.dancers > 1 ? ` (${p.dancers} of you)` : ''} · 17 Nov` : 'Cheering you on 👏'],
      ['Wedding', days],
      ['Stay', stay],
      ['From', p.city],
      ['Note', p.note],
    ].filter(([, v]) => v);
  }

  function renderSummary(dl, p) {
    dl.replaceChildren(...summaryRows(p).flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }));
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
  }

  /* ---------- validation ---------- */

  function check(q) {
    if (q.dataset.validate === 'phone') return PHONE_RE.test(form.elements.phone.value);
    const inputs = $$('input, textarea', q).filter(i => !i.closest('[hidden]'));
    const choices = inputs.filter(i => i.type === 'radio' || i.type === 'checkbox');
    if (choices.length) return choices.some(i => i.checked);
    return inputs.every(i => i.value.trim().length >= 2);
  }

  function clearError(q) {
    q.classList.remove('invalid');
    q.querySelector(':scope > .err')?.remove();
  }

  function validate(step) {
    const bad = $$('[data-required]', step).filter(q => !q.closest('[hidden]') && !check(q));
    $$('[data-required]', step).forEach(clearError);
    void step.offsetWidth; // restart the shake animation
    bad.forEach(q => {
      const err = document.createElement('p');
      err.className = 'err';
      err.textContent = q.dataset.error;
      q.classList.add('invalid');
      q.append(err);
    });
    if (bad.length) bad[0].scrollIntoView({ behavior: MOTION, block: 'center' });
    return !bad.length;
  }

  /* ---------- submit ---------- */

  async function send() {
    const p = payload();
    if (!SCRIPT_URL) {
      console.warn('RSVP: set scriptUrl in config.js — see apps-script/SETUP.md');
      setStatus("We're just getting things ready — please try again in a little while 🙏", true);
      return;
    }
    nextBtn.disabled = true;
    nextBtn.textContent = 'Sending…';
    setStatus('');
    try {
      // text/plain body keeps this a "simple" request, so Apps Script needs no CORS preflight
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(p) });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || 'Not saved');
      store.set(SENT_KEY, p);
      store.del(DRAFT_KEY);
      thank(p, out.status === 'updated');
    } catch (err) {
      console.error('RSVP send failed', err);
      setStatus("Sorry, that didn't go through. Please check your internet and tap Send again — your answers are safe on this phone.", true);
    } finally {
      nextBtn.disabled = false;
      renderProgress();
    }
  }

  function thank(p, updated) {
    form.hidden = true;
    progress.hidden = true;
    thanks.hidden = false;
    $('#thanks-title').textContent = `Thank you, ${p.name.split(/\s+/)[0]}!`;
    $('#thanks-msg').textContent = [
      updated ? "We've updated your RSVP." : "We've received your RSVP.",
      p.dance === 'Yes' ? "We can't wait to see you dance at the Sangeet 💃" : '',
      'We look forward to celebrating with you 🙏 If your plans change, just come back here anytime.',
    ].filter(Boolean).join(' ');
    renderSummary($('#thanks-summary'), p);
    thanks.scrollIntoView({ behavior: MOTION, block: 'start' });
    $('#thanks-title').focus({ preventScroll: true });
    celebrate();
  }

  function celebrate() {
    if (MOTION === 'auto') return;
    const flowers = ['🌼', '🌸', '🏵️', '🌺'];
    for (let i = 0; i < 24; i++) {
      const el = document.createElement('span');
      el.className = 'petal';
      el.textContent = flowers[i % flowers.length];
      el.style.left = `${Math.random() * 96}vw`;
      el.style.fontSize = `${14 + Math.random() * 16}px`;
      el.style.animationDuration = `${3 + Math.random() * 3}s`;
      el.style.animationDelay = `${Math.random() * 1.5}s`;
      el.addEventListener('animationend', () => el.remove());
      document.body.append(el);
    }
  }

  function welcomeBack(sent) {
    const el = $('#welcome');
    if (!sent || !sent.name) return;
    el.textContent = `Welcome back, ${sent.name.split(/\s+/)[0]}! 🙏 We have your RSVP — feel free to update anything and send it again.`;
    el.hidden = false;
  }

  /* ---------- events ---------- */

  function onChange(e) {
    const t = e.target;
    if (t.name === 'phone') {
      const v = normalisePhone(t.value);
      if (v !== t.value) t.value = v;
      t.closest('.field').classList.toggle('is-valid', PHONE_RE.test(v));
    }
    apply();
    const q = t.closest('.q.invalid');
    if (q && check(q)) clearError(q);
    if (isLast()) renderSummary($('#summary'), payload());
  }

  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);

  form.addEventListener('click', e => {
    const btn = e.target.closest('.ctr');
    if (!btn) return;
    const input = form.elements[btn.dataset.for];
    input.value = int(Number(input.value) + Number(btn.dataset.delta), Number(input.min), Number(input.max));
    apply();
    if (isLast()) renderSummary($('#summary'), payload());
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const step = steps[current];
    if (nextBtn.disabled || !validate(step)) return;
    const f = flow();
    const i = f.indexOf(step);
    if (i === f.length - 1) send();
    else show(f[i + 1]);
  });

  backBtn.addEventListener('click', () => {
    const f = flow();
    const i = f.indexOf(steps[current]);
    if (i > 0) show(f[i - 1]);
  });

  $('#edit').addEventListener('click', () => {
    thanks.hidden = true;
    form.hidden = false;
    progress.hidden = false;
    welcomeBack(store.get(SENT_KEY));
    show(steps[0]);
  });

  /* ---------- boot ---------- */

  const sent = store.get(SENT_KEY);
  write(store.get(DRAFT_KEY) || sent);
  welcomeBack(sent);
  apply();
  form.elements.phone.closest('.field').classList.toggle('is-valid', PHONE_RE.test(form.elements.phone.value));
  show(steps[0], false);
})();
