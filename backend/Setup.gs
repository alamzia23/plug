/**
 * plug — one-time setup.
 *
 * Run setUp() once from the Apps Script editor (Run > setUp), grant the scopes it
 * asks for, then read the log: it prints the token you paste into the extension.
 * Safe to run again — it never overwrites a spreadsheet or token that already exists.
 */

function setUp() {
  var props = PropertiesService.getScriptProperties();

  // 1. spreadsheet
  var sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) {
    var book = SpreadsheetApp.create('plug — database');
    sheetId = book.getId();
    props.setProperty('SHEET_ID', sheetId);

    // A new spreadsheet comes with a "Sheet1" we don't want, but it can only be
    // removed once a real tab exists.
    tab_('jobs');
    var stray = book.getSheetByName('Sheet1');
    if (stray) book.deleteSheet(stray);
  }

  // 2. every tab, so the Sheet is readable before any data lands
  Object.keys(SCHEMAS).forEach(tab_);

  // 3. shared token
  var token = props.getProperty('PLUG_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('PLUG_TOKEN', token);
  }

  // 4. defaults — DRY_RUN stays on until you deliberately turn it off
  seed_('DRY_RUN', 'true', 'when true every email goes to TEST_INBOX instead of the real contact');
  seed_('TEST_INBOX', Session.getEffectiveUser().getEmail(), 'where dry-run mail lands');
  seed_('DAILY_CAP', '25', 'max outreach emails per day');
  seed_('MAX_CONTACTS_PER_JOB', '3', '');
  seed_('MAX_FOLLOWUPS', '2', 'per contact, after the first email');

  console.log('sheet:  https://docs.google.com/spreadsheets/d/' + sheetId);
  console.log('token:  ' + token);
  console.log('next:   Deploy > New deployment > Web app, execute as me, access anyone');
  return { sheetId: sheetId, token: token };
}

function seed_(key, value, notes) {
  if (getSetting_(key, '') === '') setSetting_(key, value, notes);
}

/** Prints the token again if you lose it. */
function showToken() {
  console.log(getProp_('PLUG_TOKEN') || 'not set — run setUp()');
}
