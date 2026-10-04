/**
 * Themes.
 *
 * The Temi tab is the single source of truth the voting screen reads. The model
 * is one way to fill it; a facilitator typing five rows by hand is another, and
 * the rest of the session cannot tell the difference. That is what keeps an LLM
 * failure from ending the event.
 */

function readThemes_(qid) {
  const sh = sheet_('TEMI');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .filter(function (r) { return String(r[1]).trim() !== '' && isForQuestion_(r[3], qid); })
    .map(function (r, i) {
      return {
        id: String(r[0]).trim() || ('t' + (i + 1)),
        label: cellText_(r[1]),
        description: cellText_(r[2])
      };
    });
}

/**
 * Replaces one question's themes and leaves the other rounds' rows alone. The
 * themes it replaces go to the archive: ballots already cast name them by id.
 */
function writeThemes_(qid, themes) {
  const sh = sheet_('TEMI');
  const width = HEADERS.TEMI.length;
  withLock_(function () {
    const last = sh.getLastRow();
    const all = last < 2 ? [] : sh.getRange(2, 1, last - 1, width).getValues();
    const others = all.filter(function (r) { return !isForQuestion_(r[3], qid); });
    archiveRows_('TEMI', all.filter(function (r) { return isForQuestion_(r[3], qid) && String(r[1]).trim() !== ''; }), 'nuova analisi');
    const now = new Date();
    const session = sessionId_();
    const mine = themes.map(function (t, i) {
      return ['t' + (i + 1), safeCell_(String(t.label || '').trim()), safeCell_(String(t.description || '').trim()), qid, session, now];
    });
    const rows = others.concat(mine);
    if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  });
  dropStateCache_();
}
