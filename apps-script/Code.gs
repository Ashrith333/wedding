/**
 * Wedding RSVP backend — paste into your Google Sheet → Extensions → Apps Script.
 * Setup steps: apps-script/SETUP.md
 *
 *  RSVPs    one row per phone number, always the guest's latest (final) answers
 *  History  every submission ever sent, append-only, so nothing is ever lost
 *  Summary  live headcounts
 *
 * The sheet stays private to you: guests can only send answers, never read them.
 */

const RSVPS = 'RSVPs';
const HISTORY = 'History';
const SUMMARY = 'Summary';

// [key sent by the page, column header]
const FIELDS = [
  ['phone', 'Phone'],
  ['name', 'Name'],
  ['party', 'Coming'],
  ['adults', 'Adults'],
  ['kids', 'Kids'],
  ['dance', 'Dancing at Sangeet'],
  ['dancers', 'How many dancing'],
  ['song', 'Song idea'],
  ['days', 'Both days?'],
  ['haldi', 'Haldi 18th AM'],
  ['reception', 'Reception 18th PM'],
  ['wedding', 'Wedding 19th AM'],
  ['stay', 'Needs stay'],
  ['city', 'Travelling from'],
  ['arrival', 'Arriving'],
  ['departure', 'Leaving'],
  ['pickup', 'Pickup'],
  ['note', 'Note'],
];
const NUMBERS = ['adults', 'kids', 'dancers'];
const META = ['First sent', 'Last updated', 'Times sent'];
const RSVP_HEADERS = FIELDS.map(f => f[1]).concat(META);
const HISTORY_HEADERS = ['Sent at'].concat(FIELDS.map(f => f[1]), ['Action']);

/** Run once from the editor (▶ Run) to create the tabs and grant permissions. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  sheet_(ss, RSVPS, RSVP_HEADERS);
  sheet_(ss, HISTORY, HISTORY_HEADERS);
  summary_(ss);
}

/** Open the web-app URL in a browser to check the deployment is live. */
function doGet() {
  return reply_({ ok: true, service: 'wedding-rsvp' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const data = JSON.parse(e.postData.contents);
    if (data.website) return reply_({ ok: true, status: 'created' }); // honeypot: quietly drop bots
    return reply_({ ok: true, status: upsert_(clean_(data)) });
  } catch (err) {
    return reply_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function upsert_(r) {
  const ss = SpreadsheetApp.getActive();
  const sheet = sheet_(ss, RSVPS, RSVP_HEADERS);
  const history = sheet_(ss, HISTORY, HISTORY_HEADERS);
  summary_(ss);

  const values = FIELDS.map(f => r[f[0]]);
  const now = new Date();
  const last = sheet.getLastRow();
  const phones = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getDisplayValues().map(row => row[0]) : [];
  const at = phones.indexOf(r.phone);
  let status;

  if (at === -1) {
    sheet.getRange(last + 1, 1, 1, RSVP_HEADERS.length).setValues([values.concat([now, now, 1])]);
    status = 'created';
  } else {
    const row = at + 2;
    const meta = sheet.getRange(row, FIELDS.length + 1, 1, META.length).getValues()[0];
    sheet.getRange(row, 1, 1, RSVP_HEADERS.length)
      .setValues([values.concat([meta[0] || now, now, (Number(meta[2]) || 1) + 1])]);
    status = 'updated';
  }

  history.appendRow([now].concat(values, [status]));
  return status;
}

function clean_(d) {
  const r = {};
  FIELDS.forEach(([key]) => {
    r[key] = NUMBERS.indexOf(key) >= 0
      ? Math.max(0, Math.min(20, parseInt(d[key], 10) || 0))
      : text_(d[key]);
  });
  if (!/^[6-9]\d{9}$/.test(r.phone)) throw new Error('Invalid phone number');
  if (r.name.length < 2) throw new Error('Name missing');
  return r;
}

// Plain text only: trims, caps length, and stops "=…" being run as a sheet formula.
function text_(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#7A1426').setFontColor('#FFE7A8');
  sh.setFrozenRows(1);
  // Keep phone numbers as text so they match exactly
  sh.getRange(1, headers.indexOf('Phone') + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  return sh;
}

function summary_(ss) {
  if (ss.getSheetByName(SUMMARY)) return;
  const sh = ss.insertSheet(SUMMARY, 0);
  const c = key => RSVPS + '!' + col_(key) + '2:' + col_(key);
  const people = '(' + c('adults') + '+' + c('kids') + ')';
  const count = (key, val) => '=COUNTIF(' + c(key) + ',"' + val + '")';
  const heads = (key, val) => '=SUMPRODUCT((' + c(key) + '="' + val + '")*' + people + ')';
  const rows = [
    ['Wedding RSVPs — live', ''],
    ['Responses', '=COUNTA(' + c('phone') + ')'],
    ['Total guests (adults + kids)', '=SUM(' + c('adults') + ')+SUM(' + c('kids') + ')'],
    ['Kids', '=SUM(' + c('kids') + ')'],
    ['', ''],
    ['Sangeet 17th — responses dancing', count('dance', 'Yes')],
    ['Sangeet 17th — people dancing', '=SUM(' + c('dancers') + ')'],
    ['', ''],
    ['Coming both days (responses)', count('days', 'Both days')],
    ['Only some events (responses)', count('days', 'Some events')],
    ['Still deciding (responses)', count('days', 'Not sure yet')],
    ['Haldi — confirmed people', heads('haldi', 'Yes')],
    ['Reception — confirmed people', heads('reception', 'Yes')],
    ['Wedding — confirmed people', heads('wedding', 'Yes')],
    ['', ''],
    ['Need accommodation (responses)', count('stay', 'Yes')],
    ['Need accommodation (people)', heads('stay', 'Yes')],
    ['Accommodation undecided (responses)', count('stay', 'Not sure yet')],
    ['Pickups needed', '=COUNTIFS(' + c('pickup') + ',"<>",' + c('pickup') + ',"<>No")'],
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange('A1').setFontWeight('bold').setFontSize(13).setFontColor('#7A1426');
  sh.getRange(2, 2, rows.length - 1, 1).setFontWeight('bold');
  sh.setColumnWidth(1, 300);
}

function col_(key) {
  let n = FIELDS.findIndex(f => f[0] === key) + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
