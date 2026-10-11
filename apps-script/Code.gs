/**
 * Wedding RSVP backend. Paste into your Google Sheet: Extensions > Apps Script.
 * Setup steps: apps-script/SETUP.md
 *
 *  RSVPs    one row per phone number, always the guest's latest (final) answers
 *  History  every submission ever sent, append-only, so nothing is ever lost
 *  Summary  live headcounts
 *
 * Columns are matched by their header name, so the page can add or drop a question without
 * changing this script, and you can reorder or delete columns in the sheet safely.
 * The sheet stays private to you: guests can only send answers, never read them.
 */

const RSVPS = 'RSVPs';
const HISTORY = 'History';
const SUMMARY = 'Summary';
const SUMMARY_TITLE = 'Wedding RSVPs (live)';

// Starting layout for a fresh sheet; the page decides the real columns when it sends answers.
const QUESTIONS = ['Name', 'Coming', 'Adults', 'Kids', 'Dancing at Sangeet', 'Days',
  'Haldi 18th AM', 'Reception 18th PM', 'Wedding 19th AM', 'Accommodation', 'Note'];
const META = ['First sent', 'Last updated', 'Times sent'];

// {Header} is replaced with that column of the RSVPs tab.
const SUMMARY_ROWS = [
  ['Responses', '=COUNTA(RSVPs!A2:A)'],
  ['Total guests (adults + kids)', '=SUM({Adults})+SUM({Kids})'],
  ['Kids', '=SUM({Kids})'],
  ['', ''],
  ['Dancing at the Sangeet (responses)', '=COUNTIF({Dancing at Sangeet},"Yes")'],
  ['', ''],
  ['Coming both days (responses)', '=COUNTIF({Days},"Both days")'],
  ['Only some events (responses)', '=COUNTIF({Days},"Some events")'],
  ['Not sure yet (responses)', '=COUNTIF({Days},"Not sure yet")'],
  ['Haldi: confirmed guests', '=SUMPRODUCT(({Haldi 18th AM}="Yes")*({Adults}+{Kids}))'],
  ['Reception: confirmed guests', '=SUMPRODUCT(({Reception 18th PM}="Yes")*({Adults}+{Kids}))'],
  ['Wedding: confirmed guests', '=SUMPRODUCT(({Wedding 19th AM}="Yes")*({Adults}+{Kids}))'],
  ['', ''],
  ['Need a stay for 1 night (responses)', '=COUNTIF({Accommodation},"1 night")'],
  ['Need a stay for 2 nights (responses)', '=COUNTIF({Accommodation},"2 nights")'],
  ['Guests needing a stay', '=SUMPRODUCT((({Accommodation}="1 night")+({Accommodation}="2 nights"))*({Adults}+{Kids}))'],
  ['Guest-nights to book', '=SUMPRODUCT((({Accommodation}="1 night")+2*({Accommodation}="2 nights"))*({Adults}+{Kids}))'],
];

/**
 * Run once from the editor (▶ Run) to create the tabs and grant permissions.
 * Safe to run again: empty tabs are rebuilt with the current columns, tabs with answers are kept.
 */
function setup() {
  const ss = SpreadsheetApp.getActive();
  tabs_(ss, QUESTIONS);
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
    const phone = String(data.phone || '');
    if (!/^[6-9]\d{9}$/.test(phone)) throw new Error('Invalid phone number');
    const answers = clean_(data.answers);
    if (String(answers['Name'] || '').length < 2) throw new Error('Name missing');
    return reply_({ ok: true, status: save_(phone, answers) });
  } catch (err) {
    return reply_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function save_(phone, answers) {
  const ss = SpreadsheetApp.getActive();
  const keys = Object.keys(answers);
  const now = new Date();
  const { rsvps, history } = tabs_(ss, keys);

  const cols = headers_(rsvps, ['Phone'].concat(keys, META));
  const phoneCol = cols.indexOf('Phone') + 1;
  const last = rsvps.getLastRow();
  const phones = last > 1 ? rsvps.getRange(2, phoneCol, last - 1, 1).getDisplayValues().map(r => r[0]) : [];
  const at = phones.indexOf(phone);
  const row = at === -1 ? last + 1 : at + 2;
  const old = at === -1 ? [] : rsvps.getRange(row, 1, 1, cols.length).getValues()[0];
  const was = h => old[cols.indexOf(h)];
  const record = Object.assign({}, answers, {
    'Phone': phone,
    'First sent': (at !== -1 && was('First sent')) || now,
    'Last updated': now,
    'Times sent': at === -1 ? 1 : (Number(was('Times sent')) || 1) + 1,
  });
  rsvps.getRange(row, 1, 1, cols.length)
    .setValues([cols.map((h, i) => (h in record ? record[h] : old[i] !== undefined ? old[i] : ''))]);

  const status = at === -1 ? 'created' : 'updated';
  const hcols = headers_(history, ['Sent at', 'Phone'].concat(keys, ['Action']));
  const entry = Object.assign({}, answers, { 'Sent at': now, 'Phone': phone, 'Action': status });
  history.appendRow(hcols.map(h => (h in entry ? entry[h] : '')));
  return status;
}

// Only short header names and plain values get through.
function clean_(raw) {
  const out = {};
  Object.keys(raw || {}).slice(0, 40).forEach(k => {
    const key = String(k).trim().slice(0, 40);
    if (!key || /^[=+\-@]/.test(key)) return;
    const v = raw[k];
    out[key] = typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(50, Math.round(v))) : text_(v);
  });
  return out;
}

// Plain text only: trims, caps length, and stops "=..." being run as a sheet formula.
function text_(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Makes sure the RSVPs, History and Summary tabs exist and fit the questions being sent.
function tabs_(ss, keys) {
  const r = sheet_(ss, RSVPS, ['Phone'].concat(keys, META));
  const h = sheet_(ss, HISTORY, ['Sent at', 'Phone'].concat(keys, ['Action']));
  const sum = ss.getSheetByName(SUMMARY);
  if (r.fresh || h.fresh || !sum || sum.getRange('A1').getDisplayValue() !== SUMMARY_TITLE) summary_(ss);
  return { rsvps: r.sh, history: h.sh };
}

function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (sh) {
    const current = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
    if (current.join('|') === headers.join('|') || sh.getLastRow() > 1 || ss.getSheets().length < 2) {
      return { sh, fresh: false };
    }
    ss.deleteSheet(sh); // no answers in it yet, so start it again with the current columns
  }
  sh = ss.insertSheet(name);
  styleHeader_(sh.getRange(1, 1, 1, headers.length).setValues([headers]));
  sh.setFrozenRows(1);
  // Keep phone numbers as text so they match exactly
  sh.getRange(1, headers.indexOf('Phone') + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  return { sh, fresh: true };
}

// Returns the sheet's header names, adding any that are missing at the end.
function headers_(sh, wanted) {
  const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  while (have.length && !have[have.length - 1]) have.pop();
  const missing = wanted.filter(h => have.indexOf(h) === -1);
  if (missing.length) {
    const extra = have.length + missing.length - sh.getMaxColumns();
    if (extra > 0) sh.insertColumnsAfter(sh.getMaxColumns(), extra);
    styleHeader_(sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]));
  }
  return have.concat(missing);
}

function styleHeader_(range) {
  range.setFontWeight('bold').setBackground('#7A1426').setFontColor('#FFE7A8');
}

// Rebuilt from scratch every time; it only holds formulas.
function summary_(ss) {
  let sh = ss.getSheetByName(SUMMARY);
  if (sh) sh.clear();
  else sh = ss.insertSheet(SUMMARY, 0);
  const col = h => 'INDEX(' + RSVPS + '!A2:Z,0,MATCH("' + h + '",' + RSVPS + '!A1:Z1,0))';
  const rows = [[SUMMARY_TITLE, '']].concat(
    SUMMARY_ROWS.map(([label, f]) => [label, f.replace(/\{([^}]+)\}/g, (_, h) => col(h))]));
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange('A1').setFontWeight('bold').setFontSize(13).setFontColor('#7A1426');
  sh.getRange(2, 2, rows.length - 1, 1).setFontWeight('bold');
  sh.setColumnWidth(1, 300);
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
