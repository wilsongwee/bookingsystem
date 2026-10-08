/**
 * Room Booking — Google Sheets backend.
 *
 * Deploy as a web app bound to a Google Sheet (see SETUP.md). Opening the web
 * app URL serves the booking page (Index.html), which calls the api* functions
 * below through google.script.run. The same functions are also reachable as a
 * JSON API (?action=list / POST) for a page hosted elsewhere.
 *
 * Rules that protect the data (no double-booking) are checked here, under a
 * lock, so two people clicking the same slot at once cannot both get it.
 */

// Optional per-person cap in hours per day. null = no cap.
// Keep in step with maxHoursPerPersonPerDay in config.js.
var MAX_HOURS_PER_PERSON_PER_DAY = null;

var SHEET_NAME = 'Bookings';
var HEADERS = ['id', 'date', 'start', 'end', 'roomId', 'roomName', 'name', 'email', 'phone',
               'status', 'createdAt', 'cancelledAt'];

function doGet(e) {
  if (!e.parameter.action) {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Room Booking')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return handle_(function () {
    if (e.parameter.action !== 'list') throw new Error('Unknown action');
    return { ok: true, bookings: apiList(e.parameter.from) };
  });
}

function doPost(e) {
  return handle_(function () {
    var body = JSON.parse(e.postData.contents || '{}');
    if (body.action === 'book') return { ok: true, booking: apiBook(body.booking) };
    if (body.action === 'cancel') { apiCancel(body.id, body.email); return { ok: true }; }
    throw new Error('Unknown action');
  });
}

// ---- API (called by the page via google.script.run) -------------------------

function apiList(from) {
  from = from || '0000-00-00';
  return readAll_()
    .filter(function (b) { return b.status === 'active' && b.date >= from; })
    .map(publicView_);
}

function apiBook(booking) {
  return withLock_(function () { return publicView_(book_(booking || {})); });
}

function apiCancel(id, email) {
  withLock_(function () { cancel_(id, email); });
}

// Run once from the editor to create the sheet and header row.
function setup() {
  sheet_();
}

// ---- Actions ---------------------------------------------------------------

function book_(b) {
  var date = String(b.date || ''), start = Number(b.start), end = Number(b.end);
  var name = clean_(b.name, 80), email = clean_(b.email, 120).toLowerCase(), phone = clean_(b.phone, 30);
  var roomId = clean_(b.roomId, 40), roomName = clean_(b.roomName, 80);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date.');
  if (!(start >= 0 && end > start && end <= 24)) throw new Error('Invalid time block.');
  if (!roomId) throw new Error('Missing room.');
  if (!name || !email || !phone) throw new Error('Name, email and phone number are required.');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Invalid email.');

  var tz = Session.getScriptTimeZone();
  var endsAt = Utilities.parseDate(date + ' ' + pad_(end) + ':00', tz, 'yyyy-MM-dd HH:mm');
  if (endsAt.getTime() <= Date.now()) throw new Error('That slot has already passed.');

  var active = readAll_().filter(function (x) { return x.status === 'active' && x.date === date; });
  if (active.some(function (x) { return x.roomId === roomId && x.start === start; }))
    throw new Error('Sorry, that slot was just taken. Please pick another.');
  if (active.some(function (x) { return x.email === email && x.start === start; }))
    throw new Error('You already have a booking at that time.');
  if (MAX_HOURS_PER_PERSON_PER_DAY) {
    var used = active.filter(function (x) { return x.email === email; })
                     .reduce(function (s, x) { return s + (x.end - x.start); }, 0);
    if (used + (end - start) > MAX_HOURS_PER_PERSON_PER_DAY)
      throw new Error('Daily limit reached: ' + MAX_HOURS_PER_PERSON_PER_DAY + 'h per person per day.');
  }

  var row = {
    id: Utilities.getUuid(), date: date, start: start, end: end, roomId: roomId, roomName: roomName,
    name: name, email: email, phone: phone, status: 'active',
    createdAt: new Date().toISOString(), cancelledAt: '',
  };
  var sh = sheet_();
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, HEADERS.length)
    .setNumberFormat('@')
    .setValues([HEADERS.map(function (h) { return asText_(row[h]); })]);
  return row;
}

function cancel_(id, email) {
  var sh = sheet_();
  var values = sh.getDataRange().getDisplayValues();
  var col = indexOf_(HEADERS);
  for (var i = 1; i < values.length; i++) {
    if (values[i][col.id] !== id) continue;
    if (values[i][col.status] !== 'active') return;
    if (values[i][col.email] !== String(email || '').toLowerCase())
      throw new Error('Only the person who made a booking can cancel it.');
    sh.getRange(i + 1, col.status + 1).setValue('cancelled');
    sh.getRange(i + 1, col.cancelledAt + 1).setValue(new Date().toISOString());
    return;
  }
  throw new Error('Booking not found.');
}

// ---- Helpers ---------------------------------------------------------------

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  var values = sheet_().getDataRange().getDisplayValues();
  var col = indexOf_(values[0]);
  return values.slice(1).map(function (v) {
    return {
      id: v[col.id], date: v[col.date], start: Number(v[col.start]), end: Number(v[col.end]),
      roomId: v[col.roomId], roomName: v[col.roomName], name: v[col.name],
      email: v[col.email], phone: v[col.phone], status: v[col.status], createdAt: v[col.createdAt],
    };
  });
}

// Everything the booking page shows. Email is included so people can see and
// cancel their own bookings; the page only displays name and phone to others.
function publicView_(b) {
  return { id: b.id, date: b.date, start: b.start, end: b.end, roomId: b.roomId,
           name: b.name, email: b.email, phone: b.phone, createdAt: b.createdAt };
}

function indexOf_(headers) {
  var m = {};
  headers.forEach(function (h, i) { m[h] = i; });
  return m;
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\r\n\t]/g, ' ').trim().slice(0, max);
}

// Leading apostrophe stops Sheets reading "+65..." or "=..." as a formula; it
// is not part of the cell's displayed value.
function asText_(v) {
  var s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function pad_(n) { return (n < 10 ? '0' : '') + n; }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function handle_(fn) {
  var out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
