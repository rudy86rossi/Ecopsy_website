/**
 * Summaries: the analysis of a `sintesi` question.
 *
 * One row per summary written, in the Sintesi tab, which is also its history:
 * a new analysis adds a row and the latest one for the question and session is
 * the one on screen. Like Temi, the tab is the source of truth: a summary
 * typed by hand into a row shows the same way.
 *
 * The projector cannot show 600 words at a size the back of the room can read,
 * so the paragraphs are grouped into pages here, once, for every screen.
 */

/** Characters on one projector page: one paragraph, or two short ones. */
const PAGE_CHARS = 700;

/**
 * The summary on screen for a question, or null: {title, paragraphs, pages},
 * where `pages` lists the paragraph indexes on each page. A row with no
 * questionId or no sessione was typed by hand and counts as the one on screen.
 */
function readSummary_(qid) {
  const sh = sheet_('SINTESI');
  const last = sh.getLastRow();
  if (last < 2) return null;
  const session = sessionId_();
  const rows = sh.getRange(2, 1, last - 1, 6).getValues().filter(function (r) {
    const own = sessionText_(r[1]);
    return (own === '' || own === session) && isForQuestion_(r[2], qid) && String(r[5]).trim() !== '';
  });
  if (!rows.length) return null;
  const r = rows[rows.length - 1];
  const paragraphs = cellText_(r[5]).split(/\s*\n\s*/).filter(Boolean);
  return { title: cellText_(r[4]), paragraphs: paragraphs, pages: pagesOf_(paragraphs) };
}

/** Paragraph indexes per page: as many whole paragraphs as fit in PAGE_CHARS, at least one. */
function pagesOf_(paragraphs) {
  const pages = [];
  let page = [], size = 0;
  paragraphs.forEach(function (p, i) {
    if (page.length && size + p.length > PAGE_CHARS) { pages.push(page); page = []; size = 0; }
    page.push(i);
    size += p.length;
  });
  if (page.length) pages.push(page);
  return pages;
}

function writeSummary_(cfg, summary, participants) {
  const sh = sheet_('SINTESI');
  const q = cfg.question;
  withLock_(function () {
    sh.appendRow([new Date(), sessionId_(), q.id, safeCell_(q.text), safeCell_(summary.title),
      safeCell_(summary.paragraphs.join('\n\n')), participants, cfg.model || cfg.provider || '']);
  });
  dropStateCache_();
}

/**
 * Rows typed by hand carry no sessione; give them the session that is ending,
 * so a placeholder question asked again next session starts with no summary.
 * Called by the reset, inside its lock.
 */
function stampSummarySession_() {
  const sh = sheet_('SINTESI');
  const last = sh.getLastRow();
  if (last < 2) return;
  const range = sh.getRange(2, 2, last - 1, 1);
  const vals = range.getValues();
  const session = sessionId_();
  let changed = false;
  vals.forEach(function (r) { if (String(r[0]).trim() === '') { r[0] = session; changed = true; } });
  if (changed) range.setValues(vals);
}
