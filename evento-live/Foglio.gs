/**
 * Tabs, bootstrap and configuration.
 *
 * The script is bound to one spreadsheet, which holds everything: the config a
 * facilitator can edit by hand, the answers, the themes, the ballots and the log.
 * Nothing else is persisted anywhere.
 */

const SHEETS = {
  CONFIG:   'Config',
  RISPOSTE: 'Risposte',
  TEMI:     'Temi',
  VOTI:     'Voti',
  LOG:      'Log'
};

// collecting -> analysing -> themes -> voting -> results
const PHASES = ['collecting', 'analysing', 'themes', 'voting', 'results'];

const DEFAULT_CONFIG = [
  ['phase',           'collecting',  'collecting | analysing | themes | voting | results'],
  ['title',           'Sessione EcoPsy', 'Shown at the top of every screen'],
  ['question',        'Quali fattori contano di più per la salute mentale degli adolescenti?', 'The question participants answer'],
  ['provider',        'anthropic',   'anthropic | gemini'],
  ['model',           'claude-opus-5', 'claude-opus-5 | gemini-2.5-flash (confirm the id before the event)'],
  ['max_themes',      '6',           'Hard cap. Above 7 the ranking UI collapses on a phone'],
  ['top_n',           '3',           'How many themes each participant ranks'],
  ['min_word_len',    '4',           'Shorter tokens never reach the cloud'],
  ['max_cloud_words', '60',          'Words returned to the projector'],
  ['blocklist',       '',            'Comma-separated words to drop from the cloud (the question’s own vocabulary)'],
  ['synonyms',        '',            'Comma-separated pairs "from=to", e.g. problema=problemi']
];

const HEADERS = {
  RISPOSTE: ['timestamp', 'voterId', 'text'],
  TEMI:     ['id', 'label', 'description'],
  VOTI:     ['timestamp', 'voterId', 'ranking'],
  LOG:      ['timestamp', 'action', 'detail', 'outcome']
};

function ss_() {
  return SpreadsheetApp.getActive();
}

/** Creates any missing tab and fills Config with its defaults. Safe to re-run. */
function setup() {
  const ss = ss_();

  let cfg = ss.getSheetByName(SHEETS.CONFIG);
  if (!cfg) {
    cfg = ss.insertSheet(SHEETS.CONFIG);
    cfg.getRange(1, 1, 1, 3).setValues([['chiave', 'valore', 'note']]).setFontWeight('bold');
    cfg.getRange(2, 1, DEFAULT_CONFIG.length, 3).setValues(DEFAULT_CONFIG);
    cfg.setColumnWidth(1, 160).setColumnWidth(2, 260).setColumnWidth(3, 420);
    cfg.setFrozenRows(1);
  } else {
    // Add keys introduced after the sheet was first created, leave existing values alone.
    const have = {};
    readConfigRows_(cfg).forEach(function (r) { have[r.key] = true; });
    const missing = DEFAULT_CONFIG.filter(function (d) { return !have[d[0]]; });
    if (missing.length) {
      cfg.getRange(cfg.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
    }
  }

  ['RISPOSTE', 'TEMI', 'VOTI', 'LOG'].forEach(function (k) {
    const name = SHEETS[k];
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, HEADERS[k].length).setValues([HEADERS[k]]).setFontWeight('bold');
      sh.setFrozenRows(1);
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

/** Whole config as a plain object. Read once per execution. */
function getConfig() {
  const rows = readConfigRows_(sheet_('CONFIG'));
  const out = {};
  rows.forEach(function (r) { out[r.key] = String(r.value).trim(); });
  out.max_themes      = Math.min(8, Number(out.max_themes) || 6);
  out.top_n           = Math.max(1, Number(out.top_n) || 3);
  out.min_word_len    = Number(out.min_word_len) || 4;
  out.max_cloud_words = Number(out.max_cloud_words) || 60;
  if (PHASES.indexOf(out.phase) === -1) out.phase = 'collecting';
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

function log_(action, detail, outcome) {
  try {
    sheet_('LOG').appendRow([new Date(), action, String(detail).slice(0, 500), outcome]);
  } catch (err) {
    // Logging must never be the thing that breaks a request mid-event.
    console.error('log failed: ' + err);
  }
}
