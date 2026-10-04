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
      case 'phase':   return json_(withState_(actionPhase_(body)));
      case 'question': return json_(withState_(actionQuestion_(body)));
      case 'analyze': return json_(withState_(actionAnalyze_(body)));
      case 'reset':   return json_(withState_(actionReset_(body)));
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
 * `results` and `poll.results` are withheld until the facilitator closes the
 * round: a tally that updates while people are still answering steers everyone
 * who answers late.
 * `rev` changes only when something changed, so the projector can skip a redraw.
 *
 * Every request pays about 2.5 s of Apps Script start-up, and building the
 * state reads five tabs on top of that. So the state is kept in the cache until
 * something writes (every write calls dropStateCache_, a hand edit too: see
 * onEdit), and most polls cost only the start-up.
 */
const STATE_TTL = 30;

function state_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('state');
  if (cached) return JSON.parse(cached);
  const gen = cache.get('state-gen');

  const cfg = getConfig();
  const q = cfg.question;
  const qid = q.id;
  const isPoll = !!q.options;
  const answers = readAnswers_(qid);
  const themes = isPoll ? [] : readThemes_(qid);
  const ballots = isPoll ? [] : readBallots_(qid);

  const out = {
    ok: true,
    phase: cfg.phase,
    title: cfg.title,
    question: cfg.question.text,
    questionId: qid,
    round: { n: cfg.questionIndex + 1, of: cfg.questions.length },
    questions: cfg.questions,
    answerFields: cfg.answer_fields,
    topN: cfg.top_n,
    poll: isPoll ? {
      options: q.options,
      multiple: q.multiple,
      exclusive: q.exclusive,
      results: cfg.phase === 'results' ? countPoll_(q, answers) : null
    } : null,
    responses: countParticipants_(answers),
    entries: answers.length,
    ballots: ballots.length,
    cloud: isPoll ? [] : buildCloud_(answers, cfg),
    themes: themes,
    results: !isPoll && cfg.phase === 'results' ? scoreBallots_(ballots, themes, cfg) : null,
    rev: [qid, cfg.phase, answers.length, themes.length, ballots.length].join('-')
  };

  // A write that landed while this state was being read has already dropped
  // the cache; storing this (older) state would bring it back.
  if (cache.get('state-gen') === gen) cache.put('state', JSON.stringify(out), STATE_TTL);
  return out;
}

function dropStateCache_() {
  const cache = CacheService.getScriptCache();
  cache.put('state-gen', Utilities.getUuid(), 21600);
  cache.remove('state');
}

/**
 * A facilitator action answers with the new state: the facilitator page shows
 * it without asking again, and the cache is warm when the projector polls.
 */
function withState_(res) {
  if (res && res.ok) res.state = state_();
  return res;
}

/* ── participant actions ───────────────────────────────────────────────── */

function actionSubmit_(body) {
  const cfg = getConfig();
  if (cfg.phase !== 'collecting') return { ok: false, error: 'la raccolta è chiusa' };
  if (cfg.question.options) return submitPoll_(cfg, body);

  // One idea per box. Each becomes its own row, and its own entry in the cloud.
  const items = (Array.isArray(body.items) ? body.items : [body.text])
    .map(function (t) { return String(t || '').replace(/\s+/g, ' ').trim(); })
    .filter(function (t) { return t !== ''; })
    .slice(0, cfg.answer_fields);
  if (!items.length) return { ok: false, error: 'risposta vuota' };
  if (items.some(function (t) { return t.length > MAX_ITEM_LEN; })) {
    return { ok: false, error: 'risposta troppo lunga (massimo ' + MAX_ITEM_LEN + ' caratteri per idea)' };
  }
  const voterId = cleanId_(body.voterId);
  const qid = cfg.question.id;
  const now = new Date();

  withLock_(function () {
    const sh = sheet_('RISPOSTE');
    const session = sessionId_();
    const rows = items.map(function (t) { return [now, voterId, safeCell_(t), qid, session]; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  });
  dropStateCache_();
  log_('submit', voterId + ' ' + qid + ' ×' + items.length, 'ok');
  return { ok: true };
}

function submitPoll_(cfg, body) {
  const choice = checkPollChoice_(cfg.question, body.items);
  if (choice.error) return { ok: false, error: choice.error };
  const voterId = cleanId_(body.voterId);
  const qid = cfg.question.id;
  const now = new Date();

  withLock_(function () {
    const sh = sheet_('RISPOSTE');
    const session = sessionId_();
    const rows = choice.items.map(function (t) { return [now, voterId, safeCell_(t), qid, session]; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  });
  dropStateCache_();
  log_('submit', voterId + ' ' + qid + ' sondaggio ×' + choice.items.length, 'ok');
  return { ok: true };
}

function actionBallot_(body) {
  const cfg = getConfig();
  if (cfg.phase !== 'voting') return { ok: false, error: 'la votazione non è aperta' };
  if (cfg.question.options) return { ok: false, error: 'questa domanda non ha una votazione' };

  const qid = cfg.question.id;
  const valid = {};
  readThemes_(qid).forEach(function (t) { valid[t.id] = true; });

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

  // Every ballot is kept, a changed vote included: readBallots_ counts only the
  // latest one per device and question.
  withLock_(function () {
    sheet_('VOTI').appendRow([new Date(), voterId, JSON.stringify(ranking), qid, sessionId_()]);
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
  if (getConfig().question.options && to !== 'collecting' && to !== 'results') {
    return { ok: false, error: 'un sondaggio ha solo raccolta e risultati' };
  }
  setConfig('phase', to);
  log_('phase', to, 'ok');
  return { ok: true, phase: to };
}

/** Moves the room to another question: `to` is its id, or "next". */
function actionQuestion_(body) {
  requireKey_(body.key);
  const cfg = getConfig();
  let to = String(body.to || '');
  if (to === 'next') {
    const nxt = cfg.questions[cfg.questionIndex + 1];
    if (!nxt) return { ok: false, error: 'questa è l’ultima domanda' };
    to = nxt.id;
  }
  return goToQuestion_(to, cfg);
}

function actionAnalyze_(body) {
  requireKey_(body.key);
  return runAnalyze_();
}

/** Shared by the web app and the spreadsheet menu. */
function runAnalyze_() {
  const cfg = getConfig();
  const qid = cfg.question.id;
  if (cfg.question.options) return { ok: false, error: 'un sondaggio non si analizza: chiudi e mostra i risultati' };
  const answers = readAnswers_(qid);
  if (!answers.length) return { ok: false, error: 'nessuna risposta da analizzare' };

  setConfig('phase', 'analysing');
  const started = Date.now();
  try {
    const themes = extractThemes_(cfg, answers);
    writeThemes_(qid, themes);
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
  resetSession_('web');
  return { ok: true };
}

/**
 * Moves every round into the archive tabs, starts a new session and goes back
 * to the first question. Domande is kept.
 */
function resetSession_(from) {
  withLock_(function () {
    ['RISPOSTE', 'TEMI', 'VOTI'].forEach(function (k) {
      const sh = sheet_(k);
      const last = sh.getLastRow();
      if (last < 2) return;
      archiveRows_(k, sh.getRange(2, 1, last - 1, HEADERS[k].length).getValues(), 'azzeramento');
      sh.deleteRows(2, last - 1);
    });
    startSession_();
  });
  const first = readQuestions_()[0];
  setConfigs_(first ? { current_question: first.id, phase: 'collecting' } : { phase: 'collecting' });
  log_('reset', from, 'ok');
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/*
 * Keys are short (rodolfo-482), so wrong guesses are counted: after
 * KEY_MAX_FAILS of them, every key is refused until KEY_LOCK_SECONDS pass with
 * no new wrong one. That puts a thousand combinations hours away. The lock
 * blocks the right key too, otherwise it would not slow a guesser down; the
 * EcoPsy menu in the sheet keeps working meanwhile.
 */
const KEY_MAX_FAILS = 10;
const KEY_LOCK_SECONDS = 600;

function requireKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('FACILITATOR_KEY');
  if (!expected) throw new Error('FACILITATOR_KEY non impostata (menu EcoPsy → Mostra chiave)');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('key-fails')) || 0;
  if (fails >= KEY_MAX_FAILS) {
    throw new Error('troppi tentativi con una chiave sbagliata: riprova fra 10 minuti, o usa il menu EcoPsy nel foglio');
  }
  if (String(key || '').trim().toLowerCase() !== expected.toLowerCase()) {
    cache.put('key-fails', String(fails + 1), KEY_LOCK_SECONDS);
    throw new Error('chiave non valida');
  }
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
