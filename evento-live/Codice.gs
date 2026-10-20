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
      case 'question-text': return json_(withState_(actionQuestionText_(body)));
      case 'add-question':  return json_(withState_(actionAddQuestion_(body)));
      case 'page':    return json_(withState_(actionPage_(body)));
      case 'analyze': return json_(withState_(actionAnalyze_(body)));
      case 'reset':   return json_(withState_(actionReset_(body)));
      case 'export':  return json_(actionExport_(body));
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
  const isSummary = q.type === 'sintesi';
  const isText = q.type === 'testo' || isSummary;
  const answers = readAnswers_(qid);
  const themes = isPoll || isSummary ? [] : readThemes_(qid);
  const ballots = isPoll || isSummary ? [] : readBallots_(qid);
  const summary = isSummary && cfg.phase === 'results' ? readSummary_(qid) : null;
  const page = summary ? Math.min(cfg.pagina, summary.pages.length) : 1;

  const out = {
    ok: true,
    phase: cfg.phase,
    title: cfg.title,
    question: cfg.question.text,
    questionId: qid,
    type: q.type,
    session: sessionId_(),
    maxLength: isText ? MAX_TEXT_LEN : MAX_ITEM_LEN,
    round: { n: cfg.questionIndex + 1, of: cfg.questions.length },
    questions: cfg.questions,
    scaletta: cfg.scaletta,
    scalette: cfg.scalette,
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
    cloud: isPoll || isText ? [] : buildCloud_(answers, cfg),
    themes: themes,
    results: !isPoll && !isSummary && cfg.phase === 'results' ? scoreBallots_(ballots, themes, cfg) : null,
    summary: summary,
    page: page,
    rev: [cfg.scaletta, qid, cfg.phase, answers.length, themes.length, ballots.length,
          textHash_(q.text), summary ? textHash_(summary.paragraphs.join('')) : '', page].join('-')
  };

  // A write that landed while this state was being read has already dropped
  // the cache; storing this (older) state would bring it back.
  if (cache.get('state-gen') === gen) cache.put('state', JSON.stringify(out), STATE_TTL);
  return out;
}

/** A short fingerprint, so `rev` changes when a text does. */
function textHash_(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
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

/**
 * What a participant's write needs to know: the phase, the question on screen,
 * and for a ballot the themes. Taken from the cached state when there is one,
 * since reading Config and Domande adds over a second to a request the phone
 * is waiting on. Every write drops that cache, so it is never behind the sheet.
 * `themeIds` is null when the state was not cached: the ballot reads Temi.
 */
function participantView_() {
  const cached = CacheService.getScriptCache().get('state');
  if (cached) {
    const s = JSON.parse(cached);
    return {
      phase: s.phase, qid: s.questionId, type: s.type, text: s.question, poll: s.poll,
      answerFields: s.answerFields, topN: s.topN,
      themeIds: s.themes.map(function (t) { return t.id; })
    };
  }
  const cfg = getConfig();
  const q = cfg.question;
  return {
    phase: cfg.phase, qid: q.id, type: q.type, text: q.text,
    poll: q.options ? { options: q.options, multiple: q.multiple, exclusive: q.exclusive } : null,
    answerFields: cfg.answer_fields, topN: cfg.top_n,
    themeIds: null
  };
}

/**
 * The phone retries a send whose reply never arrived, and the first attempt
 * may have been written all the same. Each send carries an id; a write with an
 * id already seen is skipped and answered as done. Call inside withLock_.
 */
function sentBefore_(sendId) {
  return !!sendId && CacheService.getScriptCache().get('sent-' + sendId) !== null;
}
function sendIdOf_(body) {
  return body.sendId ? cleanId_(body.sendId) : '';
}
function markSent_(sendId) {
  if (sendId) CacheService.getScriptCache().put('sent-' + sendId, '1', 600);
}

/**
 * Rows into Risposte, once per send. One appended block, so a reader never
 * sees half a submission. With `oncePerVoter`, a device that already answered
 * this question writes nothing; returns false then.
 */
function writeAnswers_(qid, voterId, items, sendId, oncePerVoter) {
  const now = new Date();
  let written = true;
  withLock_(function () {
    if (sentBefore_(sendId)) return;
    const sh = sheet_('RISPOSTE');
    if (oncePerVoter && hasAnswered_(sh, qid, voterId)) { written = false; return; }
    const session = sessionId_();
    const rows = items.map(function (t) { return [now, voterId, safeCell_(t), qid, session]; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    markSent_(sendId);
  });
  if (written) dropStateCache_();
  return written;
}

/** Whether this device has a row for this question in Risposte (columns voterId, text, questionId). */
function hasAnswered_(sh, qid, voterId) {
  const last = sh.getLastRow();
  if (last < 2) return false;
  return sh.getRange(2, 2, last - 1, 3).getValues().some(function (r) {
    return String(r[0]) === voterId && isForQuestion_(r[2], qid);
  });
}

/* Participant writes leave no Log row: the Risposte or Voti row already says
   who, when and what, and the phone is waiting on this request. */

function actionSubmit_(body) {
  const v = participantView_();
  if (v.phase !== 'collecting') return { ok: false, error: 'la raccolta è chiusa' };
  if (v.poll) return submitPoll_(v, body);
  if (!v.text) return { ok: false, error: 'la domanda non è ancora stata scritta' };
  if (v.type === 'testo' || v.type === 'sintesi') return submitText_(v, body);

  // One idea per box. Each becomes its own row, and its own entry in the cloud.
  const items = (Array.isArray(body.items) ? body.items : [body.text])
    .map(function (t) { return String(t || '').replace(/\s+/g, ' ').trim(); })
    .filter(function (t) { return t !== ''; })
    .slice(0, v.answerFields);
  if (!items.length) return { ok: false, error: 'risposta vuota' };
  if (items.some(function (t) { return t.length > MAX_ITEM_LEN; })) {
    return { ok: false, error: 'risposta troppo lunga (massimo ' + MAX_ITEM_LEN + ' caratteri per idea)' };
  }
  writeAnswers_(v.qid, cleanId_(body.voterId), items, sendIdOf_(body));
  return { ok: true };
}

/**
 * A `testo` or `sintesi` question: one free answer per device, sent once. A second send
 * from the same device (another tab, a reload) is answered `already` and
 * changes nothing: the first answer stands.
 */
function submitText_(v, body) {
  const raw = Array.isArray(body.items) ? body.items[0] : body.text;
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, error: 'risposta vuota' };
  if (text.length > MAX_TEXT_LEN) {
    return { ok: false, error: 'risposta troppo lunga (massimo ' + MAX_TEXT_LEN + ' caratteri)' };
  }
  const written = writeAnswers_(v.qid, cleanId_(body.voterId), [text], sendIdOf_(body), true);
  return written ? { ok: true } : { ok: true, already: true };
}

function submitPoll_(v, body) {
  const choice = checkPollChoice_(v.poll, body.items);
  if (choice.error) return { ok: false, error: choice.error };
  writeAnswers_(v.qid, cleanId_(body.voterId), choice.items, sendIdOf_(body));
  return { ok: true };
}

function actionBallot_(body) {
  const v = participantView_();
  if (v.phase !== 'voting') return { ok: false, error: 'la votazione non è aperta' };
  if (v.poll) return { ok: false, error: 'questa domanda non ha una votazione' };

  const qid = v.qid;
  const valid = {};
  (v.themeIds || readThemes_(qid).map(function (t) { return t.id; }))
    .forEach(function (id) { valid[id] = true; });

  const seen = {};
  const ranking = (body.ranking || [])
    .map(function (id) { return String(id); })
    .filter(function (id) {
      if (!valid[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    })
    .slice(0, v.topN);

  if (!ranking.length) return { ok: false, error: 'nessun tema selezionato' };
  const voterId = cleanId_(body.voterId);
  const sendId = sendIdOf_(body);

  // Every ballot is kept, a changed vote included: readBallots_ counts only the
  // latest one per device and question.
  withLock_(function () {
    if (sentBefore_(sendId)) return;
    sheet_('VOTI').appendRow([new Date(), voterId, JSON.stringify(ranking), qid, sessionId_()]);
    markSent_(sendId);
  });
  dropStateCache_();
  return { ok: true, ranking: ranking };
}

/* ── facilitator actions ───────────────────────────────────────────────── */

function actionPhase_(body) {
  requireKey_(body.key);
  const to = String(body.to || '');
  if (PHASES.indexOf(to) === -1) return { ok: false, error: 'fase sconosciuta' };
  const q = getConfig().question;
  if (q.options && to !== 'collecting' && to !== 'results') {
    return { ok: false, error: 'un sondaggio ha solo raccolta e risultati' };
  }
  if (q.type === 'sintesi' && to !== 'collecting' && to !== 'results') {
    return { ok: false, error: 'una domanda con sintesi ha solo raccolta e sintesi' };
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

/**
 * Writes the text of a `sintesi` question in the room. Only the question on
 * screen, and only until the first answer: after that, a changed text would
 * no longer match what people answered.
 */
function actionQuestionText_(body) {
  requireKey_(body.key);
  const cfg = getConfig();
  const q = cfg.question;
  if (String(body.id || '') !== q.id) return { ok: false, error: 'non è la domanda sullo schermo' };
  if (q.type !== 'sintesi') return { ok: false, error: 'solo le domande con sintesi si scrivono dalla pagina' };
  const clean = cleanQuestion_(body.text);
  if (clean.error) return { ok: false, error: clean.error };
  const row = questionRow_(q.id);
  if (!row) return { ok: false, error: 'la domanda non ha un id nel foglio Domande' };
  let refused = false;
  withLock_(function () {
    if (readAnswers_(q.id).length) { refused = true; return; }
    const sh = sheet_('DOMANDE');
    sh.getRange(row, 2).setValue(safeCell_(clean.text));
    sh.getRange(row, HEADERS.DOMANDE.indexOf('sessione') + 1).setValue(sessionId_());
  });
  if (refused) return { ok: false, error: 'sono già arrivate risposte: la domanda non si può più cambiare' };
  dropStateCache_();
  log_('question-text', q.id, 'ok');
  return { ok: true, questionId: q.id };
}

/**
 * Adds a `sintesi` question after the last one and puts it on screen. Only
 * once the session is finished: the last question, on its results. The row
 * belongs to this session and its scaletta (see readDomande_).
 */
function actionAddQuestion_(body) {
  requireKey_(body.key);
  const cfg = getConfig();
  if (cfg.questionIndex < cfg.questions.length - 1 || cfg.phase !== 'results') {
    return { ok: false, error: 'si aggiunge una domanda solo alla fine della sessione' };
  }
  const clean = cleanQuestion_(body.text);
  if (clean.error) return { ok: false, error: clean.error };
  let id = '';
  withLock_(function () {
    id = nextQuestionId_();
    const row = [id, safeCell_(clean.text), '', '', '', 'sintesi', sessionId_(), ORIGIN_ADDED, cfg.scaletta];
    const sh = sheet_('DOMANDE');
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  });
  log_('add-question', id, 'ok');
  return goToQuestion_(id);
}

/** Turns the page of the summary on the projector. `to` is 1-based. */
function actionPage_(body) {
  requireKey_(body.key);
  const cfg = getConfig();
  if (cfg.question.type !== 'sintesi' || cfg.phase !== 'results') return { ok: false, error: 'nessuna sintesi sullo schermo' };
  const summary = readSummary_(cfg.question.id);
  const to = Math.floor(Number(body.to));
  if (!summary || !(to >= 1 && to <= summary.pages.length)) return { ok: false, error: 'pagina inesistente' };
  setConfig('pagina', to);
  return { ok: true, page: to };
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
  if (cfg.question.type === 'sintesi') return runSummary_(cfg, answers);

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

/**
 * A `sintesi` question goes from the analysis straight to the room: the round
 * has already waited on the facilitator typing the question. On failure the
 * collection reopens and the facilitator runs it again.
 */
function runSummary_(cfg, answers) {
  setConfig('phase', 'analysing');
  const started = Date.now();
  try {
    const summary = extractSummary_(cfg, answers);
    writeSummary_(cfg, summary, summary.participants);
    setConfig('phase', 'results');
    log_('analyze', 'sintesi ' + summary.paragraphs.length + ' paragrafi in ' + (Date.now() - started) + 'ms', 'ok');
    return { ok: true, summary: { title: summary.title, paragraphs: summary.paragraphs } };
  } catch (err) {
    setConfig('phase', 'collecting');
    log_('analyze', String(err), 'error');
    return { ok: false, error: String(err), fallback: 'riprova, o scrivi la sintesi a mano nel foglio Sintesi' };
  }
}

/** `scaletta`, optional, is the question set of the new session; without it the current one stays. */
function actionReset_(body) {
  requireKey_(body.key);
  if (body.confirm !== 'RESET') return { ok: false, error: 'conferma mancante' };
  return resetSession_('web', body.scaletta);
}

/**
 * Moves every round into the archive tabs, starts a new session on the
 * scaletta `name` (the current one when empty) and goes to its first question.
 * Domande is kept. A list with an id two rows share is refused before anything
 * moves: its answers could not be told apart.
 */
function resetSession_(from, name) {
  const cfg = getConfig();
  let use = cfg.scaletta;
  if (name) {
    use = findScaletta_(cfg.scalette.map(function (s) { return s.name; }), name);
    if (!use) return { ok: false, error: 'scaletta sconosciuta: ' + String(name).slice(0, 40) };
  }
  const clash = readDomande_(use).clash;
  if (clash) return { ok: false, error: 'l’id ' + clash + ' è usato da due righe nel foglio Domande: correggilo prima di iniziare' };

  withLock_(function () {
    ['RISPOSTE', 'TEMI', 'VOTI'].forEach(function (k) {
      const sh = sheet_(k);
      const last = sh.getLastRow();
      if (last < 2) return;
      archiveRows_(k, sh.getRange(2, 1, last - 1, HEADERS[k].length).getValues(), 'azzeramento');
      sh.deleteRows(2, last - 1);
    });
    stampSummarySession_();
    startSession_();
  });
  // The new session changes which rows Domande shows (see readDomande_).
  const first = readDomande_(use).questions[0];
  const values = { scaletta: use, phase: 'collecting' };
  if (first) values.current_question = first.id;
  setConfigs_(values);
  log_('reset', from + (use ? ' · ' + use : ''), 'ok');
  return { ok: true, scaletta: use };
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
