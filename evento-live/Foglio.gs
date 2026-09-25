/**
 * Tabs, bootstrap and configuration.
 *
 * The script is bound to one spreadsheet, which holds everything: the config a
 * facilitator can edit by hand, the questions, the answers, the themes, the
 * ballots and the log. Nothing else is persisted anywhere.
 *
 * A session is a sequence of rounds, one per row of the Domande tab. Answers,
 * themes and ballots carry the id of the question they belong to, so earlier
 * rounds stay in the sheet when the room moves on.
 */

const SHEETS = {
  CONFIG:   'Config',
  DOMANDE:  'Domande',
  RISPOSTE: 'Risposte',
  TEMI:     'Temi',
  VOTI:     'Voti',
  LOG:      'Log'
};

// collecting -> analysing -> themes -> voting -> results, once per question
const PHASES = ['collecting', 'analysing', 'themes', 'voting', 'results'];

const DEFAULT_QUESTION = 'Quali fattori contano di più per la salute mentale degli adolescenti?';

const DEFAULT_CONFIG = [
  ['phase',            'collecting',  'collecting | analysing | themes | voting | results'],
  ['current_question', 'q1',          'Id of the question on screen (tab Domande). Change it from the menu or the facilitator page'],
  ['title',            'Sessione EcoPsy', 'Shown at the top of every screen'],
  ['provider',         'anthropic',   'anthropic | gemini'],
  ['model',            'claude-opus-5', 'claude-opus-5 | a gemini id from provaModelli()'],
  ['max_themes',       '6',           'Hard cap. Above 7 the ranking UI collapses on a phone'],
  ['top_n',            '3',           'How many themes each participant ranks'],
  ['answer_fields',    '3',           'How many short boxes the phone shows: one idea per box'],
  ['max_cloud_words',  '60',          'Entries returned to the projector'],
  ['blocklist',        '',            'Comma-separated entries to drop from the cloud (the question’s own vocabulary)'],
  ['synonyms',         '',            'Comma-separated pairs "from=to", e.g. problema=problemi, social=social media']
];

// Keys earlier versions wrote into Config. setup() removes them so nobody edits
// a row that no longer does anything.
const OBSOLETE_CONFIG = ['question', 'min_word_len'];

const HEADERS = {
  DOMANDE:  ['id', 'domanda'],
  RISPOSTE: ['timestamp', 'voterId', 'text', 'questionId'],
  TEMI:     ['id', 'label', 'description', 'questionId'],
  VOTI:     ['timestamp', 'voterId', 'ranking', 'questionId'],
  LOG:      ['timestamp', 'action', 'detail', 'outcome']
};

function ss_() {
  return SpreadsheetApp.getActive();
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

  ['DOMANDE', 'RISPOSTE', 'TEMI', 'VOTI', 'LOG'].forEach(function (k) {
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
      // A tab from the first version: add the questionId column. Its empty cells
      // count as the question on screen (see stampQuestion_).
      sh.getRange(1, 1, 1, HEADERS[k].length).setValues([HEADERS[k]]).setFontWeight('bold');
    }
  });

  return 'ok';
}

function sheet_(key) {
  const sh = ss_().getSheetByName(SHEETS[key]);
  if (!sh) { setup(); return ss_().getSheetByName(SHEETS[key]); }
  return sh;
}

function readConfigRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 2).getValues()
    .map(function (r, i) { return { row: i + 2, key: String(r[0]).trim(), value: r[1] }; })
    .filter(function (r) { return r.key !== ''; });
}

/** The rounds, in sheet order. An empty id falls back to its position. */
function readQuestions_() {
  const sh = sheet_('DOMANDE');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 2).getValues()
    .filter(function (r) { return String(r[1]).trim() !== ''; })
    .map(function (r, i) {
      return { id: String(r[0]).trim() || ('q' + (i + 1)), text: String(r[1]).trim() };
    });
}

/**
 * Whole config as a plain object. Read once per execution.
 * `questions` is the list of rounds, `question` the one on screen.
 */
function getConfig() {
  const rows = readConfigRows_(sheet_('CONFIG'));
  const out = {};
  rows.forEach(function (r) { out[r.key] = String(r.value).trim(); });
  out.max_themes      = Math.min(8, Number(out.max_themes) || 6);
  out.top_n           = Math.max(1, Number(out.top_n) || 3);
  out.answer_fields   = Math.min(6, Math.max(1, Number(out.answer_fields) || 3));
  out.max_cloud_words = Number(out.max_cloud_words) || 60;
  if (PHASES.indexOf(out.phase) === -1) out.phase = 'collecting';

  out.questions = readQuestions_();
  let at = 0;
  for (let i = 0; i < out.questions.length; i++) {
    if (out.questions[i].id === out.current_question) { at = i; break; }
  }
  out.questionIndex = at;
  out.question = out.questions[at] || { id: 'q1', text: '' };
  return out;
}

function setConfig(key, value) {
  const sh = sheet_('CONFIG');
  const rows = readConfigRows_(sh);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].key === key) {
      sh.getRange(rows[i].row, 2).setValue(value);
      dropStateCache_();
      return;
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[key, value]]);
  dropStateCache_();
}

/**
 * Puts another question on screen and reopens collection.
 *
 * Rows typed by hand (a theme written into Temi after a failed analysis) have
 * no questionId; they count as the question on screen. Before moving on they
 * are stamped with the outgoing id, so they stay with the round they belong to.
 */
function goToQuestion_(toId) {
  const cfg = getConfig();
  const target = cfg.questions.filter(function (q) { return q.id === toId; })[0];
  if (!target) return { ok: false, error: 'domanda sconosciuta' };
  if (target.id !== cfg.question.id) stampQuestion_(cfg.question.id);
  setConfig('current_question', target.id);
  setConfig('phase', 'collecting');
  log_('question', target.id, 'ok');
  return { ok: true, questionId: target.id };
}

function stampQuestion_(qid) {
  withLock_(function () {
    ['RISPOSTE', 'TEMI', 'VOTI'].forEach(function (k) {
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
