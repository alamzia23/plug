/**
 * plug — the Google Sheet is the database.
 *
 * One tab per table. The header row IS the schema: every read and write maps
 * column names to object keys, so adding a column later doesn't break old rows.
 */

var SCHEMAS = {
  jobs: [
    'id', 'company', 'role', 'location', 'url', 'source',
    'confidence', 'status', 'jd', 'captured_at', 'updated_at',
  ],
  contacts: [
    'id', 'job_id', 'name', 'title', 'linkedin_url',
    'email', 'email_status', 'score', 'created_at',
  ],
  outreach: [
    'id', 'job_id', 'contact_id', 'to_email', 'subject',
    'thread_id', 'status', 'sent_at', 'followups', 'last_action_at',
  ],
  settings: ['key', 'value', 'notes'],
};

function ss_() {
  var id = getProp_('SHEET_ID');
  if (!id) throw new Error('SHEET_ID script property is not set — run setUp() once');
  return SpreadsheetApp.openById(id);
}

/** Get a tab, creating it (with its header row) if it isn't there yet. */
function tab_(name) {
  var schema = SCHEMAS[name];
  if (!schema) throw new Error('unknown tab: ' + name);

  var book = ss_();
  var sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, schema.length).setValues([schema]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Later days add columns. Append any the sheet is missing rather than
  // rewriting the header, so a sheet with data in it keeps working.
  var have = headers_(sheet);
  var missing = schema.filter(function (col) {
    return have.indexOf(col) === -1;
  });
  if (missing.length) {
    sheet.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  return sheet;
}

function headers_(sheet) {
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (h) {
      return String(h).trim();
    });
}

/** All data rows of a tab as objects. Empty tab -> []. */
function readAll_(name) {
  var sheet = tab_(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var cols = headers_(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();

  return values.map(function (row, i) {
    var obj = { _row: i + 2 }; // sheet row number, so callers can update in place
    cols.forEach(function (col, c) {
      obj[col] = row[c];
    });
    return obj;
  });
}

/**
 * Build a row in the SHEET's column order, not the schema's. Once columns can
 * be appended by the migration above, the two orders can differ, and writing
 * in schema order would silently put values in the wrong columns.
 */
function rowFor_(sheet, obj) {
  return headers_(sheet).map(function (col) {
    var v = obj[col];
    return v === undefined || v === null ? '' : v;
  });
}

// ---------- jobs ----------

/** Upsert by url — recapturing the same posting refreshes it instead of duplicating. */
function saveJob_(job) {
  if (!job || !job.url) throw new Error('job.url is required');

  var sheet = tab_('jobs');
  var now = new Date().toISOString();
  var existing = readAll_('jobs').filter(function (r) {
    return String(r.url) === String(job.url);
  })[0];

  var record = {
    id: (existing && existing.id) || job.id || Utilities.getUuid(),
    company: job.company || '',
    role: job.role || '',
    location: job.location || '',
    url: job.url,
    source: job.source || '',
    confidence: job.confidence || '',
    status: job.status || (existing && existing.status) || 'draft',
    jd: String(job.jd || '').slice(0, 45000), // a cell tops out at 50k characters
    captured_at: (existing && existing.captured_at) || job.capturedAt || now,
    updated_at: now,
  };

  var row = rowFor_(sheet, record);
  if (existing) {
    sheet.getRange(existing._row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { id: record.id, url: record.url, created: !existing };
}

/** Newest first. */
function listJobs_(limit) {
  return readAll_('jobs')
    .sort(function (a, b) {
      return String(b.captured_at).localeCompare(String(a.captured_at));
    })
    .slice(0, limit)
    .map(function (r) {
      delete r._row;
      return r;
    });
}

// ---------- settings ----------

function getSetting_(key, fallback) {
  var hit = readAll_('settings').filter(function (r) {
    return String(r.key) === key;
  })[0];
  return hit && hit.value !== '' ? String(hit.value) : fallback;
}

function setSetting_(key, value, notes) {
  var sheet = tab_('settings');
  var hit = readAll_('settings').filter(function (r) {
    return String(r.key) === key;
  })[0];

  if (hit) {
    sheet.getRange(hit._row, 2).setValue(value);
  } else {
    sheet.appendRow(rowFor_(sheet, { key: key, value: value, notes: notes || '' }));
  }
}
