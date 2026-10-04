/**
 * Keeping every result for later analysis.
 *
 * Nothing the room produced is deleted. Every row carries a timestamp and the
 * session it belongs to: the date and time the session started, renewed by
 * each reset.
 *
 * - Risposte, Temi, Voti: the rows the screens read. Voti keeps every ballot,
 *   a changed vote included; the latest one per device is the one that counts.
 * - Archivio risposte / temi / voti: rows moved out of those tabs, by a reset or
 *   by a new analysis replacing a question's themes, with when and why.
 * - Risultati: the ranking shown to the room, each time a vote is closed.
 * - Cronologia: every change of phase, from the page or from the menu.
 *
 * For analysis, read each tab together with its archive.
 */

function sessionId_() {
  return PropertiesService.getScriptProperties().getProperty('SESSION_ID') || startSession_();
}

function startSession_() {
  const id = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  PropertiesService.getScriptProperties().setProperty('SESSION_ID', id);
  return id;
}

/**
 * Copies rows of Risposte, Temi or Voti into their archive tab. Call it inside
 * withLock_, together with the write that removes them. Rows from before
 * sessions existed get the current one.
 */
function archiveRows_(key, rows, reason) {
  if (!rows.length) return;
  const width = HEADERS[key].length;
  const sessCol = HEADERS[key].indexOf('sessione');
  const session = sessionId_();
  const now = new Date();
  const out = rows.map(function (r) {
    const row = r.slice(0, width);
    while (row.length < width) row.push('');
    if (String(row[sessCol]).trim() === '') row[sessCol] = session;
    return row.concat([now, reason]);
  });
  const sh = sheet_('ARCHIVIO_' + key);
  sh.getRange(sh.getLastRow() + 1, 1, out.length, width + 2).setValues(out);
}

/** Called by setConfig on every phase change. */
function recordPhase_(phase, qid) {
  try {
    sheet_('CRONOLOGIA').appendRow([new Date(), sessionId_(), qid, phase]);
    if (phase === 'results') recordResults_();
  } catch (err) {
    // Like the log: keeping the record must never break the event.
    console.error('record failed: ' + err);
  }
}

/**
 * The ranking as the room sees it when the vote closes, one row per theme.
 * For a poll, one row per option: `label` is the option, `punti` how many
 * participants picked it, `schede` how many answered.
 */
function recordResults_() {
  const cfg = getConfig();
  const qid = cfg.question.id;
  if (cfg.question.options) return recordPollResults_(cfg);
  const ballots = readBallots_(qid);
  const rows = scoreBallots_(ballots, readThemes_(qid), cfg);
  if (!rows.length) return;
  const now = new Date();
  const session = sessionId_();
  const out = rows.map(function (r, i) {
    return [now, session, qid, safeCell_(cfg.question.text), i + 1, r.id, safeCell_(r.label), r.points, r.firsts, ballots.length];
  });
  const sh = sheet_('RISULTATI');
  sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
}

function recordPollResults_(cfg) {
  const q = cfg.question;
  const answers = readAnswers_(q.id);
  const voters = countParticipants_(answers);
  if (!voters) return;
  const now = new Date();
  const session = sessionId_();
  const out = countPoll_(q, answers).map(function (r, i) {
    return [now, session, q.id, safeCell_(q.text), i + 1, '', safeCell_(r.option), r.count, '', voters];
  });
  const sh = sheet_('RISULTATI');
  sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
}
