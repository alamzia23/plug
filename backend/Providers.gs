/**
 * plug — LLM providers.
 *
 * Nothing above this file knows which model is answering. Llm.gs builds a
 * prompt and calls llmComplete_(); this file owns every provider-specific
 * detail — url, auth header, body shape, where the text lives in the response.
 *
 * Adding a provider means adding one entry to PROVIDERS. Switching providers
 * means changing two Script Properties. No prompt or caller changes either way.
 *
 * Script Properties:
 *   LLM_PROVIDER  gemini | anthropic | openai   (default: gemini)
 *   LLM_API_KEY   the key for that provider
 *   LLM_MODEL     optional override; each provider has a sane default
 */

var PROVIDERS = {
  gemini: {
    defaultModel: 'gemini-2.5-flash',
    url: function (model, key) {
      return (
        'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) +
        ':generateContent?key=' +
        encodeURIComponent(key)
      );
    },
    headers: function () {
      return {}; // gemini authenticates with the key in the query string
    },
    body: function (o) {
      var cfg = {
        maxOutputTokens: o.maxTokens,
        temperature: o.temperature,
      };
      if (o.json) cfg.responseMimeType = 'application/json';
      return {
        systemInstruction: { parts: [{ text: o.system }] },
        contents: [{ role: 'user', parts: [{ text: o.user }] }],
        generationConfig: cfg,
      };
    },
    text: function (data) {
      var c = data.candidates && data.candidates[0];
      if (!c) {
        var blocked = data.promptFeedback && data.promptFeedback.blockReason;
        throw new Error(blocked ? 'gemini blocked the prompt: ' + blocked : 'gemini returned no candidates');
      }
      if (c.finishReason === 'MAX_TOKENS') throw new Error('gemini hit the token cap — the reply was cut off');
      return (c.content && c.content.parts ? c.content.parts : [])
        .map(function (p) { return p.text || ''; })
        .join('');
    },
  },

  anthropic: {
    defaultModel: 'claude-opus-5',
    url: function () {
      return 'https://api.anthropic.com/v1/messages';
    },
    headers: function (key) {
      return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    },
    body: function (o, model) {
      // No assistant prefill on current models — the prompt has to ask for
      // bare JSON and the parser has to tolerate a stray code fence.
      return {
        model: model,
        max_tokens: o.maxTokens,
        system: o.system,
        messages: [{ role: 'user', content: o.user }],
      };
    },
    text: function (data) {
      if (data.stop_reason === 'refusal') {
        throw new Error('the model declined this request');
      }
      return (data.content || [])
        .filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join('');
    },
  },

  openai: {
    defaultModel: 'gpt-4o-mini',
    url: function () {
      return 'https://api.openai.com/v1/chat/completions';
    },
    headers: function (key) {
      return { Authorization: 'Bearer ' + key };
    },
    body: function (o, model) {
      var b = {
        model: model,
        max_tokens: o.maxTokens,
        temperature: o.temperature,
        messages: [
          { role: 'system', content: o.system },
          { role: 'user', content: o.user },
        ],
      };
      if (o.json) b.response_format = { type: 'json_object' };
      return b;
    },
    text: function (data) {
      var c = data.choices && data.choices[0];
      if (!c) throw new Error('openai returned no choices');
      return (c.message && c.message.content) || '';
    },
  },
};

function providerName_() {
  return getProp_('LLM_PROVIDER') || 'gemini';
}

/**
 * One call to whichever provider is configured.
 * opts: { system, user, maxTokens, temperature, json }
 */
function llmComplete_(opts) {
  var name = providerName_();
  var provider = PROVIDERS[name];
  if (!provider) {
    throw new Error('unknown LLM_PROVIDER "' + name + '" — expected one of: ' + Object.keys(PROVIDERS).join(', '));
  }

  var key = getProp_('LLM_API_KEY');
  if (!key) throw new Error('LLM_API_KEY script property is not set');

  var model = getProp_('LLM_MODEL') || provider.defaultModel;
  var o = {
    system: opts.system,
    user: opts.user,
    maxTokens: opts.maxTokens || 2048,
    temperature: opts.temperature === undefined ? 0.7 : opts.temperature,
    json: Boolean(opts.json),
  };

  var startedAt = Date.now();
  var res = UrlFetchApp.fetch(provider.url(model, key), {
    method: 'post',
    contentType: 'application/json',
    headers: provider.headers(key),
    payload: JSON.stringify(provider.body(o, model)),
    muteHttpExceptions: true, // read the provider's own error text instead of a generic throw
  });

  var code = res.getResponseCode();
  var raw = res.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(name + ' http ' + code + ': ' + errorMessage_(raw).slice(0, 300));
  }

  var data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(name + ' returned non-json: ' + raw.slice(0, 200));
  }

  var text = provider.text(data);
  if (!text) throw new Error(name + ' returned an empty completion');
  // Time the provider call alone, so slow drafting can be blamed on the right
  // thing — Apps Script cold start and its redirect cost a second or two too.
  return { text: text, provider: name, model: model, ms: Date.now() - startedAt };
}

/** Providers disagree about where the message lives; try the common shapes. */
function errorMessage_(raw) {
  try {
    var d = JSON.parse(raw);
    return (
      (d.error && (d.error.message || d.error.type)) ||
      (d.message) ||
      raw
    );
  } catch (err) {
    return raw;
  }
}
