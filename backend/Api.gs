/**
 * plug — web app entry point.
 *
 * The extension has no Google identity, so the deployment is "anyone, anonymous"
 * and a shared token in Script Properties is what actually guards it. Keep the
 * deployment URL and the token together: either one alone is useless.
 *
 * Apps Script web apps always answer 200, so every response carries an `ok` flag
 * and the caller checks that rather than a status code.
 */

var ROUTES = {
  ping: function () {
    return { pong: true, dryRun: getSetting_('DRY_RUN', 'true') === 'true' };
  },
  saveJob: function (payload) {
    return saveJob_(payload.job || payload);
  },
  saveJobs: function (payload) {
    return (payload.jobs || []).map(saveJob_);
  },
  listJobs: function (payload) {
    return listJobs_(Number(payload.limit) || 50);
  },
  draftEmail: function (payload) {
    return draftReferral_(payload);
  },
  llmInfo: function () {
    var name = providerName_();
    var p = PROVIDERS[name];
    return {
      provider: name,
      model: getProp_('LLM_MODEL') || (p && p.defaultModel) || null,
      keySet: Boolean(getProp_('LLM_API_KEY')),
      known: Boolean(p),
    };
  },
};

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'empty request' });
    }

    var req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return json_({ ok: false, error: 'body is not json' });
    }

    if (!tokenOk_(req.token)) {
      return json_({ ok: false, error: 'bad token' });
    }

    var handler = ROUTES[req.action];
    if (!handler) {
      return json_({ ok: false, error: 'unknown action: ' + req.action });
    }

    return json_({ ok: true, data: handler(req.payload || {}) });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Health check you can open in a browser. Deliberately says nothing useful. */
function doGet() {
  return ContentService.createTextOutput('plug backend is up').setMimeType(
    ContentService.MimeType.TEXT
  );
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** Compare every character so a wrong token can't be guessed from response timing. */
function tokenOk_(given) {
  var expected = getProp_('PLUG_TOKEN');
  if (!expected || typeof given !== 'string' || given.length !== expected.length) {
    return false;
  }
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}
