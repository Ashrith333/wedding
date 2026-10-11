/* Wedding RSVP: plain JS, no build step. Answers go to a private Google Sheet (see apps-script/). */
(() => {
  'use strict';

  const SCRIPT_URL = (window.RSVP_CONFIG || {}).scriptUrl || '';
  const DRAFT_KEY = 'rsvp:draft';
  const SENT_KEY = 'rsvp:sent';
  const PHONE_RE = /^[6-9]\d{9}$/;
  const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOTION = STILL ? 'auto' : 'smooth';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const form = $('#rsvp');
  const sendBtn = $('#send');
  const statusEl = $('#status');
  const thanks = $('#thanks');
  const lede = $('.lede');

  // Named conditions used by data-show="…"
  const RULES = {
    family: s => s.party === 'With family',
    dancing: s => s.dance === 'Yes',
    someEvents: s => s.days === 'Some events',
    daysUnsure: s => s.days === 'Not sure yet',
    stayAsked: s => nights(s).length > 0,
    twoNights: s => nights(s).length > 1,
  };

  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
  };

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

  const attending = (s, ev) => s.days === 'Both days' || (s.days === 'Some events' && s.events.includes(ev));

  // November nights between the guest's first and last celebration (the 17th counts only for dancers).
  function nights(s) {
    const days = [];
    if (s.dance === 'Yes') days.push(17);
    if (attending(s, 'Haldi') || attending(s, 'Reception')) days.push(18);
    if (attending(s, 'Wedding')) days.push(19);
    const out = [];
    for (let d = Math.min(...days); d < Math.max(...days); d++) out.push(d);
    return out;
  }

  // What gets stored: keys are the Sheet's column headers, in column order.
  function payload() {
    const s = read();
    const family = s.party === 'With family';
    const yesNo = ev => (s.days === 'Not sure yet' ? 'Maybe' : s.days ? (attending(s, ev) ? 'Yes' : 'No') : '');
    return {
      phone: normalisePhone(s.phone),
      website: s.website || '',
      answers: {
        'Name': s.name || '',
        'Coming': s.party || '',
        'Adults': family ? int(s.adults, 1, 20) : partySize(s),
        'Kids': family ? int(s.kids, 0, 20) : 0,
        'Dancing at Sangeet': s.dance === 'Yes' ? 'Yes' : 'No',
        'Days': s.days || '',
        'Haldi 18th AM': yesNo('Haldi'),
        'Reception 18th PM': yesNo('Reception'),
        'Wedding 19th AM': yesNo('Wedding'),
        'Accommodation': RULES.stayAsked(s) ? s.stay || '' : '',
        'Note': s.note || '',
      },
    };
  }

  /* ---------- rendering ---------- */

  function apply() {
    let s = read();
    $$('[data-show]', form).forEach(el => { el.hidden = !RULES[el.dataset.show](s); });
    // A choice that just got hidden must not stay picked (e.g. "2 nights" after un-picking dance)
    $$('label[data-show][hidden] input:checked', form).forEach(i => { i.checked = false; });
    s = read();
    const n = nights(s);
    $('#stay-sub').textContent = n.length > 1
      ? `For the nights of ${n.join(' and ')} Nov`
      : n.length ? `For the night of ${n[0]} Nov` : '';
    store.set(DRAFT_KEY, s);
  }

  function summaryRows(p) {
    const a = p.answers;
    const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
    const who = a['Coming'] === 'With family'
      ? `Family · ${plural(a['Adults'], 'adult')}${a['Kids'] ? `, ${plural(a['Kids'], 'kid')}` : ''}`
      : a['Coming'];
    const events = [['Haldi', 'Haldi 18th AM'], ['Reception', 'Reception 18th PM'], ['Wedding', 'Wedding 19th AM']]
      .filter(([, col]) => a[col] === 'Yes').map(([ev]) => ev);
    const days = { 'Both days': 'Both days ❤️', 'Some events': events.join(', '), 'Not sure yet': 'Not sure yet' }[a['Days']];
    const stay = { '1 night': 'Yes, 1 night', '2 nights': 'Yes, 2 nights', No: 'No, thank you' }[a['Accommodation']];
    return [
      ['Name', a['Name']],
      ['Mobile', p.phone && `+91 ${p.phone.slice(0, 5)} ${p.phone.slice(5)}`],
      ['Coming', who],
      ['Sangeet', a['Dancing at Sangeet'] === 'Yes' ? 'Dancing 💃 · 17 Nov' : 'Cheering you on 👏'],
      ['Wedding', days],
      ['Stay', stay],
      ['Note', a['Note']],
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

  function validate() {
    const all = $$('[data-required]', form);
    const bad = all.filter(q => !q.closest('[hidden]') && !check(q));
    all.forEach(clearError);
    void form.offsetWidth; // restart the shake animation
    bad.forEach(q => {
      const err = document.createElement('p');
      err.className = 'err';
      err.textContent = q.dataset.error;
      q.classList.add('invalid');
      q.append(err);
    });
    if (bad.length) {
      bad[0].closest('.card')?.classList.add('in');
      bad[0].scrollIntoView({ behavior: MOTION, block: 'center' });
    }
    return !bad.length;
  }

  /* ---------- submit ---------- */

  async function send() {
    const p = payload();
    if (!SCRIPT_URL) {
      console.warn('RSVP: set scriptUrl in config.js, see apps-script/SETUP.md');
      setStatus("We're just getting things ready. Please try again in a little while 🙏", true);
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    setStatus('');
    try {
      // A text/plain body keeps this a "simple" request, so Apps Script needs no CORS preflight
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(p) });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || 'Not saved');
      store.set(SENT_KEY, read());
      store.del(DRAFT_KEY);
      thank(p, out.status === 'updated');
    } catch (err) {
      console.error('RSVP send failed', err);
      setStatus("Sorry, that didn't go through. Please check your internet and tap Send again. Your answers are safe on this phone.", true);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send RSVP 🪔';
    }
  }

  function thank(p, updated) {
    form.hidden = true;
    lede.hidden = true;
    thanks.hidden = false;
    $('#thanks-title').textContent = `Thank you, ${p.answers['Name'].split(/\s+/)[0]}!`;
    $('#thanks-msg').textContent = [
      updated ? "We've updated your RSVP." : "We've received your RSVP.",
      p.answers['Dancing at Sangeet'] === 'Yes' ? "We can't wait to see you dance at the Sangeet 💃" : '',
      'We look forward to celebrating with you 🙏 If your plans change, just come back here anytime.',
    ].filter(Boolean).join(' ');
    renderSummary($('#thanks-summary'), p);
    thanks.scrollIntoView({ behavior: MOTION, block: 'start' });
    $('#thanks-title').focus({ preventScroll: true });
    petals(26);
  }

  function petals(count) {
    if (STILL) return;
    const flowers = ['🌼', '🌸', '🏵️', '🌺'];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'petal';
      el.textContent = flowers[i % flowers.length];
      el.style.left = `${Math.random() * 96}vw`;
      el.style.fontSize = `${12 + Math.random() * 14}px`;
      el.style.animationDuration = `${4 + Math.random() * 4}s`;
      el.style.animationDelay = `${Math.random() * 2}s`;
      el.addEventListener('animationend', () => el.remove());
      document.body.append(el);
    }
  }

  function welcomeBack(sent) {
    const el = $('#welcome');
    if (!sent || !sent.name) return;
    el.textContent = `Welcome back, ${sent.name.split(/\s+/)[0]}! 🙏 We have your RSVP. Feel free to update anything and send it again.`;
    el.hidden = false;
  }

  // Cards fade up as they scroll into view
  function revealOnScroll() {
    const cards = $$('.card');
    if (STILL || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('anim');
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    cards.forEach(c => io.observe(c));
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
  }

  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);

  form.addEventListener('click', e => {
    const btn = e.target.closest('.ctr');
    if (!btn) return;
    const input = form.elements[btn.dataset.for];
    input.value = int(Number(input.value) + Number(btn.dataset.delta), Number(input.min), Number(input.max));
    apply();
  });

  // Enter in a text box just closes the keyboard instead of sending the whole form
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      e.target.blur();
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!sendBtn.disabled && validate()) send();
  });

  $('#edit').addEventListener('click', () => {
    thanks.hidden = true;
    form.hidden = false;
    lede.hidden = false;
    welcomeBack(store.get(SENT_KEY));
    $$('.card').forEach(c => c.classList.add('in'));
    form.scrollIntoView({ behavior: MOTION, block: 'start' });
  });

  /* ---------- boot ---------- */

  const sent = store.get(SENT_KEY);
  write(store.get(DRAFT_KEY) || sent);
  welcomeBack(sent);
  apply();
  form.elements.phone.closest('.field').classList.toggle('is-valid', PHONE_RE.test(form.elements.phone.value));
  revealOnScroll();
  petals(10);
})();
