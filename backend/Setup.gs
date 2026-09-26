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
  seed_('DIRECTORY_LIMIT', '10', 'people fetched per company lookup — hunter charges per revealed address');

  // The token is deliberately NOT logged. Execution logs get copied whole into
  // chat, screenshots and bug reports, and this token is the only thing guarding
  // a public endpoint. Read it from Project Settings > Script Properties instead.
  console.log('sheet:  https://docs.google.com/spreadsheets/d/' + sheetId);
  console.log('token:  stored in Project Settings > Script Properties > PLUG_TOKEN');
  console.log('next:   Deploy > New deployment > Web app, execute as me, access anyone');
  return { sheetId: sheetId, tokenSet: true };
}

/**
 * Replace the shared token. Run this if it ever leaks — into a screenshot, a
 * chat, a log you pasted somewhere. The old one stops working immediately, so
 * re-paste the new one into the extension afterwards.
 */
function rotateToken() {
  PropertiesService.getScriptProperties().setProperty(
    'PLUG_TOKEN',
    Utilities.getUuid().replace(/-/g, '')
  );
  console.log('done. new token is in Project Settings > Script Properties > PLUG_TOKEN');
  console.log('the old token no longer works — update the extension.');
}

function seed_(key, value, notes) {
  if (getSetting_(key, '') === '') setSetting_(key, value, notes);
}

/** Confirms a token exists without printing it. */
function checkToken() {
  var t = getProp_('PLUG_TOKEN');
  console.log(t ? 'token is set (' + t.length + ' chars). copy it from Script Properties.' : 'not set — run setUp()');
}
