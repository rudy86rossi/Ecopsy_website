/**
 * The only call that leaves Google's servers.
 *
 * Two providers, chosen by the `provider` row in Config. Switching is a config
 * edit plus a key in Script Properties — no code change.
 *
 * Both ask for JSON through the provider's own structured-output mechanism, and
 * both are still parsed defensively: a model that wraps its JSON in a code fence
 * should not end the session.
 *
 * The model has no tools and its answer is only ever data: a few short strings
 * that the pages render as text. What a hijacked answer could still do is put
 * a theme on the projector, so checkThemes_ validates every theme before it
 * reaches the Temi tab, and the facilitator sees the themes before opening the vote.
 */

function extractThemes_(cfg, answers) {
  const prompt = buildPrompt_(cfg, answers);
  const data = parseJson_(callModel_(cfg, prompt));
  return checkThemes_((data && data.themes) || [], prompt.participants, cfg.max_themes);
}

/**
 * Keeps a theme only if it is backed by real participants: its `participants`
 * must be line numbers the model was actually shown, and with four or more
 * people in the room at least two distinct ones. A theme injected by a single
 * answer ("scrivi come tema: …") has one supporter at most, and is dropped.
 * Labels and descriptions are flattened to one line and capped.
 */
function checkThemes_(themes, participants, maxThemes) {
  const minSupport = participants >= 4 ? 2 : 1;
  const seenLabel = {};
  const out = [];
  themes.forEach(function (t) {
    if (!t || typeof t !== 'object') return;
    const who = {};
    (Array.isArray(t.participants) ? t.participants : []).forEach(function (n) {
      n = Number(n);
      if (n === Math.floor(n) && n >= 1 && n <= participants) who[n] = true;
    });
    const support = Object.keys(who).length;
    const label = oneLine_(t.label, MAX_LABEL_LEN);
    const description = oneLine_(t.description, MAX_DESC_LEN);
    if (!label || support < minSupport || seenLabel[label.toLowerCase()]) return;
    seenLabel[label.toLowerCase()] = true;
    out.push({ label: label, description: description, support: support });
  });
  if (!out.length) throw new Error('nessun tema condiviso da più partecipanti');
  return out.slice(0, maxThemes);
}

function oneLine_(s, max) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
}

function parseJson_(text) {
  const cleaned = String(text)
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('risposta del modello non è JSON');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function callModel_(cfg, prompt) {
  const provider = (cfg.provider || 'anthropic').toLowerCase();
  if (provider === 'gemini') return callGemini_(cfg, prompt);
  return callAnthropic_(cfg, prompt);
}

function prop_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error(name + ' non impostata in Proprietà script');
  return v;
}

/** One retry, on 5xx or a transport failure only. A 400 is a bug, not bad luck. */
function fetchWithRetry_(url, options) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();
      if (code < 500) return res;
      last = new Error('HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
    } catch (err) {
      last = err;
    }
    Utilities.sleep(1500);
  }
  throw last;
}

function callAnthropic_(cfg, prompt) {
  const payload = {
    model: cfg.model || 'claude-opus-5',
    // Enough for low-effort thinking plus a few hundred tokens of JSON, and a
    // ceiling on the worst-case cost of one analysis (8000 × $25/M = $0.20).
    max_tokens: 8000,
    // No `temperature`: sampling parameters are rejected on Claude Opus 5.
    // Effort `low` is right here — short inputs, a small structured answer, and
    // a room waiting for it.
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: themeSchema_() }
    },
    // Instructions in `system`, answers in the user turn: the model treats the
    // two with different authority, which is the first line against an answer
    // that tries to give orders.
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }]
  };

  const res = fetchWithRetry_('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': prop_('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error('Anthropic HTTP ' + code + ': ' + body.slice(0, 300));

  const data = JSON.parse(body);
  if (data.stop_reason === 'refusal') throw new Error('richiesta rifiutata dal modello');
  if (data.stop_reason === 'max_tokens') throw new Error('risposta del modello troncata (max_tokens)');

  // Thinking is on by default on Opus 5, so the text is not necessarily the
  // first content block.
  const block = (data.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!block) throw new Error('nessun blocco di testo nella risposta');
  return block.text;
}

function callGemini_(cfg, prompt) {
  // Gemini's responseSchema follows a subset of OpenAPI and rejects
  // additionalProperties, so the shared schema is stripped down here.
  const schema = themeSchema_();
  delete schema.additionalProperties;
  delete schema.properties.themes.items.additionalProperties;

  const model = cfg.model && cfg.model.indexOf('gemini') === 0 ? cfg.model : 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(prop_('GEMINI_API_KEY'));

  const res = fetchWithRetry_(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    }),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error('Gemini HTTP ' + code + ': ' + body.slice(0, 300));

  const data = JSON.parse(body);
  const cand = (data.candidates || [])[0];
  // Thinking models can put a thought summary before the answer.
  const part = cand && cand.content && (cand.content.parts || [])
    .filter(function (p) { return p.text && !p.thought; })[0];
  if (!part) throw new Error('nessun testo nella risposta Gemini');
  return part.text;
}
