/**
 * Tabs, bootstrap and configuration.
 *
 * The script is bound to one spreadsheet, which holds everything: the config a
 * facilitator can edit by hand, the questions, the answers, the themes, the
 * ballots, their archives, the results, the timeline and the log. Nothing else
 * is persisted anywhere (see Archivio.gs for what is kept and where).
 *
 * A session is a sequence of rounds, one per row of the Domande tab in the
 * session's scaletta (question set). Answers, themes and ballots carry the id
 * of the question they belong to, so earlier rounds stay in the sheet when the
 * room moves on.
 */

const SHEETS = {
  CONFIG:   'Config',
  DOMANDE:  'Domande',
  RISPOSTE: 'Risposte',
  TEMI:     'Temi',
  VOTI:     'Voti',
  ARCHIVIO_RISPOSTE: 'Archivio risposte',
  ARCHIVIO_TEMI:     'Archivio temi',
  ARCHIVIO_VOTI:     'Archivio voti',
  RISULTATI:  'Risultati',
  SINTESI:    'Sintesi',
  CRONOLOGIA: 'Cronologia',
  LOG:      'Log'
};

// collecting -> analysing -> themes -> voting -> results, once per question
const PHASES = ['collecting', 'analysing', 'themes', 'voting', 'results'];

const DEFAULT_QUESTION = 'Quali fattori contano di più per la salute mentale degli adolescenti?';

const DEFAULT_CONFIG = [
  ['phase',            'collecting',  'collecting | analysing | themes | voting | results'],
  ['current_question', 'q1',          'Id of the question on screen (tab Domande). Change it from the menu or the facilitator page'],
  ['scaletta',         '',            'Question set of the session (column scaletta in Domande). Chosen when a session starts; empty means the first'],
  ['title',            'Sessione EcoPsy', 'Shown at the top of every screen'],
  ['provider',         'anthropic',   'anthropic | gemini'],
  ['model',            'claude-opus-5', 'claude-opus-5 | a gemini id from provaModelli()'],
  ['max_themes',       '5',           'At most 5 themes; higher values are treated as 5'],
  ['top_n',            '3',           'How many themes each participant ranks'],
  ['answer_fields',    '3',           'How many short boxes the phone shows: one idea per box'],
  ['pagina',           '1',           'Page of the summary on the projector (sintesi questions); back to 1 on each results'],
  ['max_cloud_words',  '60',          'Entries returned to the projector'],
  ['blocklist',        '',            'Comma-separated entries to drop from the cloud (the question’s own vocabulary)'],
  ['synonyms',         '',            'Comma-separated pairs "from=to", e.g. problema=problemi, social=social media']
];

// Keys earlier versions wrote into Config. setup() removes them so nobody edits
// a row that no longer does anything.
const OBSOLETE_CONFIG = ['question', 'min_word_len'];

const HEADERS = {
  DOMANDE:  ['id', 'domanda', 'opzioni', 'multipla', 'esclusiva', 'tipo', 'sessione', 'origine', 'scaletta'],
  RISPOSTE: ['timestamp', 'voterId', 'text', 'questionId', 'sessione'],
  TEMI:     ['id', 'label', 'description', 'questionId', 'sessione', 'timestamp'],
  VOTI:     ['timestamp', 'voterId', 'ranking', 'questionId', 'sessione'],
  RISULTATI:  ['timestamp', 'sessione', 'questionId', 'domanda', 'posizione', 'themeId', 'label', 'punti', 'primi posti', 'schede'],
  SINTESI:    ['timestamp', 'sessione', 'questionId', 'domanda', 'titolo', 'testo', 'partecipanti', 'modello'],
  CRONOLOGIA: ['timestamp', 'sessione', 'questionId', 'fase', 'scaletta'],
  LOG:      ['timestamp', 'action', 'detail', 'outcome']
};
['RISPOSTE', 'TEMI', 'VOTI'].forEach(function (k) {
  HEADERS['ARCHIVIO_' + k] = HEADERS[k].concat(['archiviato', 'motivo']);
});

// Looked up once per execution: every Apps Script call to the spreadsheet
// costs a round trip, and a request touches the same tabs several times.
let SS_ = null;
const TABS_ = {};

function ss_() {
  return SS_ || (SS_ = SpreadsheetApp.getActive());
}

/** Creates any missing tab and fills Config with its defaults. Safe to re-run. */
function setup() {
  const ss = ss_();
  let oldQuestion = '';

  let cfg = ss.getSheetByName(SHEETS.CONFIG);
  if (!cfg) {
    cfg = ss.insertSheet(SHEETS.CONFIG);
    cfg.getRange(1, 1, 1, 3).setValues([['chiave', 'valore', 'note']]).setFontWeight('bold');
    cfg.getRange(2, 1, DEFAULT_CONFIG.length, 3).setValues(DEFAULT_CONFIG);
    cfg.setColumnWidth(1, 160).setColumnWidth(2, 260).setColumnWidth(3, 420);
    cfg.setFrozenRows(1);
  } else {
    // Add keys introduced after the sheet was first created, leave existing values alone.
    const rows = readConfigRows_(cfg);
    const have = {};
    rows.forEach(function (r) { have[r.key] = true; });
    rows.forEach(function (r) { if (r.key === 'question') oldQuestion = String(r.value).trim(); });
    const missing = DEFAULT_CONFIG.filter(function (d) { return !have[d[0]]; });
    if (missing.length) {
      cfg.getRange(cfg.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
    }
    // Bottom-up, so deleting a row does not shift the ones still to delete.
    rows.filter(function (r) { return OBSOLETE_CONFIG.indexOf(r.key) !== -1; })
      .map(function (r) { return r.row; })
      .sort(function (a, b) { return b - a; })
      .forEach(function (row) { cfg.deleteRow(row); });
  }

  ['DOMANDE', 'RISPOSTE', 'TEMI', 'VOTI', 'ARCHIVIO_RISPOSTE', 'ARCHIVIO_TEMI', 'ARCHIVIO_VOTI',
   'RISULTATI', 'SINTESI', 'CRONOLOGIA', 'LOG'].forEach(function (k) {
    const name = SHEETS[k];
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, HEADERS[k].length).setValues([HEADERS[k]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      if (k === 'DOMANDE') {
        // The single question of the first version moves here as round one.
        sh.getRange(2, 1, 1, 2).setValues([['q1', oldQuestion || DEFAULT_QUESTION]]);
        sh.setColumnWidth(1, 80).setColumnWidth(2, 640);
      }
    } else if (sh.getLastColumn() < HEADERS[k].length) {
      // A tab from an earlier version: add the new columns. An empty questionId
      // counts as the question on screen (see stampQuestion_), an empty sessione
      // as the current session (see archiveRows_).
      sh.getRange(1, 1, 1, HEADERS[k].length).setValues([HEADERS[k]]).setFontWeight('bold');
    }
  });

  return 'ok';
}

function sheet_(key) {
  if (TABS_[key]) return TABS_[key];
  let sh = ss_().getSheetByName(SHEETS[key]);
  if (!sh) { setup(); sh = ss_().getSheetByName(SHEETS[key]); }
  return (TABS_[key] = sh);
}

/** A hand edit in the sheet (a theme typed in Temi, a Config value) shows on the screens at once. */
function onEdit() {
  try { dropStateCache_(); } catch (err) { /* the cache expires on its own */ }
}

function readConfigRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 2).getValues()
    .map(function (r, i) { return { row: i + 2, key: String(r[0]).trim(), value: r[1] }; })
    .filter(function (r) { return r.key !== ''; });
}

/**
 * The rounds of one scaletta, in sheet order, and the list of scalette.
 *
 * `scaletta` names the question sets a row belongs to, separated by |; an
 * empty cell puts the row in every one. `name` is matched without regard to
 * case; an empty or unknown name means the first scaletta in the tab. A tab
 * with no names at all is one list, as before scalette existed.
 * Returns {questions, scaletta, scalette:[{name, count}], clash}: `scaletta`
 * is the name in use ('' with no names), `clash` an id of this list that two
 * rows of the tab share ('' if none). Ids must be unique across the tab, since
 * answers, themes and the export find a question by id alone.
 *
 * A row with `opzioni` (choices separated by |) is a poll: participants pick
 * from the choices, and the round goes from collecting straight to results.
 * `multipla` = sì lets them pick several; `esclusiva` names the choices that
 * clear all the others when picked (e.g. "No"). Without `opzioni` the row is
 * an open question: `tipo` = testo asks for one longer free answer per person
 * (no word cloud), `tipo` = sintesi the same, summarised in one text instead
 * of themes and a vote; anything else asks for short ideas that feed the cloud.
 * `type` is 'sondaggio', 'testo', 'sintesi' or 'parole'. An empty id falls
 * back to the row's position in the tab.
 *
 * A `sintesi` row may have no text: the facilitator writes it in the room, and
 * the text is stamped with the session (`sessione`). In a later session that
 * text counts as empty, so the question is asked afresh. A row with `origine`
 * = aggiunta was added from the facilitator page and belongs to its session
 * only.
 */
function readDomande_(name) {
  const sh = sheet_('DOMANDE');
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, HEADERS.DOMANDE.length).getValues();
  const split = function (v) {
    return String(v).split('|').map(function (o) { return o.trim(); }).filter(Boolean);
  };
  const session = sessionId_();

  const names = [];
  const seen = {};
  rows.forEach(function (r) {
    split(r[8]).forEach(function (n) { if (!findScaletta_(names, n)) names.push(n); });
    const id = String(r[0]).trim();
    if (id) seen[id] = (seen[id] || 0) + 1;
  });
  const use = findScaletta_(names, name) || names[0] || '';

  const kept = [];
  const counts = {};
  rows.forEach(function (r, i) {
    const tipo = String(r[5]).trim();
    const own = sessionText_(r[6]);
    const isSummary = /^sint/i.test(tipo);
    if (own && own !== session && String(r[7]).trim() === ORIGIN_ADDED) return;
    let text = String(r[1]).trim();
    if (isSummary && own && own !== session) text = '';
    if (!text && !isSummary) return;
    const sets = split(r[8]);
    names.forEach(function (n) {
      if (!sets.length || findScaletta_(sets, n)) counts[n] = (counts[n] || 0) + 1;
    });
    if (sets.length && !findScaletta_(sets, use)) return;
    const q = { id: String(r[0]).trim() || ('q' + (i + 1)), text: text };
    const options = split(r[2]);
    if (options.length) {
      q.type = 'sondaggio';
      q.options = options;
      q.multiple = /^(s[iì]|yes|true|x|1)$/i.test(String(r[3]).trim());
      q.exclusive = split(r[4]).filter(function (o) { return options.indexOf(o) !== -1; });
    } else {
      q.type = isSummary ? 'sintesi' : /^test/i.test(tipo) ? 'testo' : 'parole';
    }
    kept.push(q);
  });

  const clash = kept.filter(function (q) { return seen[q.id] > 1; })[0];
  return {
    questions: kept,
    scaletta: use,
    scalette: names.map(function (n) { return { name: n, count: counts[n] || 0 }; }),
    clash: clash ? clash.id : ''
  };
}

/** The name in `list` that matches `name` without regard to case, or ''. */
function findScaletta_(list, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return '';
  for (let i = 0; i < list.length; i++) {
    if (list[i].toLowerCase() === want) return list[i];
  }
  return '';
}

/** `origine` of a row added from the facilitator page. */
const ORIGIN_ADDED = 'aggiunta';

/** Longest question the facilitator page can write. */
const MAX_QUESTION_LEN = 300;

/** A question typed on the facilitator page: one line, not empty, capped. Returns {text} or {error}. */
function cleanQuestion_(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return { error: 'scrivi la domanda' };
  if (text.length > MAX_QUESTION_LEN) return { error: 'domanda troppo lunga (massimo ' + MAX_QUESTION_LEN + ' caratteri)' };
  return { text: text };
}

/** Sheet row of a question id, or 0. Ids that fall back to their position are not found. */
function questionRow_(id) {
  const sh = sheet_('DOMANDE');
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return i + 2;
  }
  return 0;
}

/**
 * An id no row has ever used: q + one more than the highest number in the tab,
 * counting rows hidden from this session, so an id never names two texts.
 */
function nextQuestionId_() {
  const sh = sheet_('DOMANDE');
  const last = sh.getLastRow();
  let top = last - 1;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      const m = /^q(\d+)$/i.exec(String(r[0]).trim());
      if (m) top = Math.max(top, Number(m[1]));
    });
  }
  return 'q' + (top + 1);
}

/**
 * Whole config as a plain object. Read once per execution.
 * `questions` is the list of rounds of the session's scaletta, `question` the
 * one on screen, `scalette` every question set in Domande.
 */
function getConfig() {
  const rows = readConfigRows_(sheet_('CONFIG'));
  const out = {};
  rows.forEach(function (r) { out[r.key] = String(r.value).trim(); });
  out.max_themes      = Math.min(5, Number(out.max_themes) || 5);
  out.top_n           = Math.max(1, Number(out.top_n) || 3);
  out.answer_fields   = Math.min(6, Math.max(1, Number(out.answer_fields) || 3));
  out.max_cloud_words = Number(out.max_cloud_words) || 60;
  out.pagina          = Math.max(1, Math.floor(Number(out.pagina)) || 1);
  if (PHASES.indexOf(out.phase) === -1) out.phase = 'collecting';

  const d = readDomande_(out.scaletta);
  out.questions = d.questions;
  out.scaletta = d.scaletta;
  out.scalette = d.scalette;
  let at = 0;
  for (let i = 0; i < out.questions.length; i++) {
    if (out.questions[i].id === out.current_question) { at = i; break; }
  }
  out.questionIndex = at;
  out.question = out.questions[at] || { id: 'q1', text: '', type: 'parole' };
  return out;
}

function setConfig(key, value) {
  const pair = {};
  pair[key] = value;
  setConfigs_(pair);
}

/**
 * Several Config values with one read of the tab. A phase change goes into
 * Cronologia. Entering the results always starts a summary from its first page.
 */
function setConfigs_(values) {
  if (values.phase === 'results' && !('pagina' in values)) values.pagina = 1;
  const sh = sheet_('CONFIG');
  const rows = readConfigRows_(sh);
  Object.keys(values).forEach(function (key) {
    const row = rows.filter(function (r) { return r.key === key; })[0];
    if (row) {
      sh.getRange(row.row, 2).setValue(values[key]);
    } else {
      const at = sh.getLastRow() + 1;
      sh.getRange(at, 1, 1, 2).setValues([[key, values[key]]]);
      rows.push({ row: at, key: key, value: values[key] });
    }
  });
  dropStateCache_();
  if ('phase' in values) {
    recordPhase_(values.phase,
      'current_question' in values ? values.current_question : configValueIn_(rows, 'current_question'),
      'scaletta' in values ? values.scaletta : configValueIn_(rows, 'scaletta'));
  }
}

function configValueIn_(rows, key) {
  const r = rows.filter(function (r) { return r.key === key; })[0];
  return r ? String(r.value).trim() : '';
}

/**
 * Puts another question on screen and reopens collection.
 *
 * Rows typed by hand (a theme written into Temi after a failed analysis) have
 * no questionId; they count as the question on screen. Before moving on they
 * are stamped with the outgoing id, so they stay with the round they belong to.
 */
function goToQuestion_(toId, cfg) {
  cfg = cfg || getConfig();
  const target = cfg.questions.filter(function (q) { return q.id === toId; })[0];
  if (!target) return { ok: false, error: 'domanda sconosciuta' };
  if (target.id !== cfg.question.id) stampQuestion_(cfg.question.id);
  setConfigs_({ current_question: target.id, phase: 'collecting' });
  log_('question', target.id, 'ok');
  return { ok: true, questionId: target.id };
}

function stampQuestion_(qid) {
  withLock_(function () {
    ['RISPOSTE', 'TEMI', 'VOTI', 'SINTESI'].forEach(function (k) {
      const sh = sheet_(k);
      const last = sh.getLastRow();
      if (last < 2) return;
      const col = HEADERS[k].indexOf('questionId') + 1;
      const range = sh.getRange(2, col, last - 1, 1);
      const vals = range.getValues();
      let changed = false;
      vals.forEach(function (r) { if (String(r[0]).trim() === '') { r[0] = qid; changed = true; } });
      if (changed) range.setValues(vals);
    });
  });
}

/**
 * Participant and model text going into a cell. A value starting with = + - @
 * would be parsed as a formula, and a formula like =IMPORTXML can send the
 * sheet's contents to any server. The leading apostrophe makes Sheets store it
 * as plain text; cellText_ undoes it on the way out.
 */
function safeCell_(s) {
  s = String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function cellText_(v) {
  return String(v).replace(/^'(?=[=+\-@])/, '').trim();
}

/** Does a row belong to the question on screen? Empty counts as yes. */
function isForQuestion_(cell, qid) {
  const v = String(cell).trim();
  return v === '' || v === qid;
}

function log_(action, detail, outcome) {
  try {
    sheet_('LOG').appendRow([new Date(), action, String(detail).slice(0, 500), outcome]);
  } catch (err) {
    // Logging must never be the thing that breaks a request mid-event.
    console.error('log failed: ' + err);
  }
}
