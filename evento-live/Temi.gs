/**
 * Themes.
 *
 * The Temi tab is the single source of truth the voting screen reads. The model
 * is one way to fill it; a facilitator typing five rows by hand is another, and
 * the rest of the session cannot tell the difference. That is what keeps an LLM
 * failure from ending the event.
 */

function readThemes_() {
  const sh = sheet_('TEMI');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getValues()
    .filter(function (r) { return String(r[1]).trim() !== ''; })
    .map(function (r, i) {
      return {
        id: String(r[0]).trim() || ('t' + (i + 1)),
        label: String(r[1]).trim(),
        description: String(r[2]).trim()
      };
    });
}

function writeThemes_(themes) {
  const sh = sheet_('TEMI');
  withLock_(function () {
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    if (!themes.length) return;
    const rows = themes.map(function (t, i) {
      return ['t' + (i + 1), String(t.label || '').trim(), String(t.description || '').trim()];
    });
    sh.getRange(2, 1, rows.length, 3).setValues(rows);
  });
  dropStateCache_();
}
