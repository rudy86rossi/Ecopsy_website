/**
 * The web app: one GET for state, one POST for everything that writes.
 *
 * CORS, the part that bites: Apps Script exposes only doGet and doPost, so it
 * cannot answer a preflight (there is no doOptions — a preflight gets a 405 and
 * the request never reaches this file). The client must therefore send a CORS
 * *simple* request: no custom headers, and Content-Type text/plain;charset=utf-8
 * even though the body is JSON. The 302 to script.googleusercontent.com is then
 * followed automatically and that response carries Access-Control-Allow-Origin: *,
 * so the caller can read the reply. Do not use mode:'no-cors' — it returns an
 * opaque response and the page cannot tell a recorded vote from a thrown error.
 *
 * Every reply is HTTP 200 with {ok:true|false}. An uncaught exception would
 * return Google's HTML error page, which the client cannot parse.
 */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.what === 'ping') return json_({ ok: true, pong: Date.now() });
    return json_(state_());
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'corpo non leggibile' });
  }

  try {
    switch (body.action) {
      case 'submit':  return json_(actionSubmit_(body));
      case 'ballot':  return json_(actionBallot_(body));
      case 'phase':   return json_(actionPhase_(body));
      case 'analyze': return json_(actionAnalyze_(body));
      case 'reset':   return json_(actionReset_(body));
      default:        return json_({ ok: false, error: 'azione sconosciuta' });
    }
  } catch (err) {
    console.error(err);
    log_(body.action || '?', String(err), 'error');
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── state ─────────────────────────────────────────────────────────────── */

/**
 * Everything both screens need, in one object.
 *
 * `results` is withheld until the facilitator closes the vote: a tally that
 * updates while people are still voting steers everyone who votes late.
 * `rev` changes only when something changed, so the projector can skip a redraw.
 */
function state_() {
  const cached = CacheService.getScriptCache().get('state');
  if (cached) return JSON.parse(cached);

  const cfg = getConfig();
  const answers = readAnswers_();
  const themes = readThemes_();
  const ballots = readBallots_();

  const out = {
    ok: true,
    phase: cfg.phase,
    title: cfg.title,
    question: cfg.question,
    topN: cfg.top_n,
    responses: answers.length,
    ballots: ballots.length,
    cloud: buildCloud_(answers.map(function (a) { return a.text; }), cfg),
    themes: themes,
    results: cfg.phase === 'results' ? scoreBallots_(ballots, themes, cfg) : null,
    rev: [cfg.phase, answers.length, themes.length, ballots.length].join('-'),
    serverTime: Date.now()
  };

  // Two seconds of cache flattens the burst when 20 phones poll at once; the
  // projector still feels live and every write drops the key.
  CacheService.getScriptCache().put('state', JSON.stringify(out), 2);
  return out;
}

function dropStateCache_() {
  CacheService.getScriptCache().remove('state');
}

/* ── participant actions ───────────────────────────────────────────────── */

function actionSubmit_(body) {
  const cfg = getConfig();
  if (cfg.phase !== 'collecting') return { ok: false, error: 'la raccolta è chiusa' };

  const text = String(body.text || '').trim();
  if (!text) return { ok: false, error: 'risposta vuota' };
  if (text.length > 1000) return { ok: false, error: 'risposta troppo lunga' };
  const voterId = cleanId_(body.voterId);

  withLock_(function () {
    sheet_('RISPOSTE').appendRow([new Date(), voterId, text]);
  });
  dropStateCache_();
  log_('submit', voterId, 'ok');
  return { ok: true };
}

function actionBallot_(body) {
  const cfg = getConfig();
  if (cfg.phase !== 'voting') return { ok: false, error: 'la votazione non è aperta' };

  const valid = {};
  readThemes_().forEach(function (t) { valid[t.id] = true; });

  const seen = {};
  const ranking = (body.ranking || [])
    .map(function (id) { return String(id); })
    .filter(function (id) {
      if (!valid[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    })
    .slice(0, cfg.top_n);

  if (!ranking.length) return { ok: false, error: 'nessun tema selezionato' };
  const voterId = cleanId_(body.voterId);

  // One ballot per device: a re-submission replaces, it does not add.
  withLock_(function () {
    const sh = sheet_('VOTI');
    const last = sh.getLastRow();
    const row = [new Date(), voterId, JSON.stringify(ranking)];
    if (last >= 2) {
      const ids = sh.getRange(2, 2, last - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === voterId) {
          sh.getRange(i + 2, 1, 1, 3).setValues([row]);
          return;
        }
      }
    }
    sh.appendRow(row);
  });
  dropStateCache_();
  log_('ballot', voterId + ' ' + ranking.join('>'), 'ok');
  return { ok: true, ranking: ranking };
}

/* ── facilitator actions ───────────────────────────────────────────────── */

function actionPhase_(body) {
  requireKey_(body.key);
  const to = String(body.to || '');
  if (PHASES.indexOf(to) === -1) return { ok: false, error: 'fase sconosciuta' };
  setConfig('phase', to);
  log_('phase', to, 'ok');
  return { ok: true, phase: to };
}

function actionAnalyze_(body) {
  requireKey_(body.key);
  return runAnalyze_();
}

/** Shared by the web app and the spreadsheet menu. */
function runAnalyze_() {
  const cfg = getConfig();
  const answers = readAnswers_();
  if (!answers.length) return { ok: false, error: 'nessuna risposta da analizzare' };

  setConfig('phase', 'analysing');
  const started = Date.now();
  try {
    const themes = extractThemes_(cfg, answers);
    writeThemes_(themes);
    setConfig('phase', 'themes');
    log_('analyze', themes.length + ' temi in ' + (Date.now() - started) + 'ms', 'ok');
    return { ok: true, themes: themes };
  } catch (err) {
    // Leave the previous themes intact and hand the room back to a human: the
    // Temi tab can be typed by hand and the voting screen will not know the
    // difference.
    setConfig('phase', 'themes');
    log_('analyze', String(err), 'error');
    return { ok: false, error: String(err), fallback: 'scrivi i temi a mano nel foglio Temi' };
  }
}

function actionReset_(body) {
  requireKey_(body.key);
  if (body.confirm !== 'RESET') return { ok: false, error: 'conferma mancante' };
  withLock_(function () {
    ['RISPOSTE', 'TEMI', 'VOTI'].forEach(function (k) {
      const sh = sheet_(k);
      if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
  });
  setConfig('phase', 'collecting');
  log_('reset', '', 'ok');
  return { ok: true };
}

/* ── helpers ───────────────────────────────────────────────────────────── */

function requireKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('FACILITATOR_KEY');
  if (!expected) throw new Error('FACILITATOR_KEY non impostata (menu EcoPsy → Mostra chiave)');
  if (String(key || '') !== expected) throw new Error('chiave non valida');
}

function cleanId_(v) {
  const s = String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return s || 'anon-' + Utilities.getUuid().slice(0, 8);
}

/**
 * Twenty people tapping at the same moment produce genuinely concurrent
 * executions; interleaved appendRow calls are how a vote disappears.
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('foglio occupato, riprova');
  try { return fn(); } finally { lock.releaseLock(); }
}
