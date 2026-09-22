/**
 * Ballots and scoring.
 *
 * A ballot is one row: an ordered list of theme ids. Storing it that way (rather
 * than one row per theme per voter) keeps lock contention near zero and makes
 * "the latest ballot from a device wins" a single comparison.
 *
 * Scoring is Borda: with top_n = 3 the first choice is worth 3, the second 2,
 * the third 1. First-place counts are reported alongside the totals because the
 * two sometimes disagree, and that disagreement is worth showing the room.
 */

function readBallots_() {
  const sh = sheet_('VOTI');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, 3).getValues();
  const byVoter = {};
  rows.forEach(function (r) {
    let ranking = [];
    try { ranking = JSON.parse(r[2]); } catch (err) { return; }
    if (!ranking.length) return;
    const voterId = String(r[1]);
    const at = r[0] instanceof Date ? r[0].getTime() : 0;
    if (!byVoter[voterId] || byVoter[voterId].at <= at) {
      byVoter[voterId] = { voterId: voterId, at: at, ranking: ranking };
    }
  });
  return Object.keys(byVoter).map(function (k) { return byVoter[k]; });
}

function scoreBallots_(ballots, themes, cfg) {
  const points = {}, firsts = {};
  themes.forEach(function (t) { points[t.id] = 0; firsts[t.id] = 0; });

  ballots.forEach(function (b) {
    b.ranking.forEach(function (id, i) {
      if (points[id] === undefined) return;      // a theme deleted after voting opened
      points[id] += Math.max(0, cfg.top_n - i);  // partial ballots simply score less
      if (i === 0) firsts[id] += 1;
    });
  });

  return themes
    .map(function (t) {
      return { id: t.id, label: t.label, description: t.description,
               points: points[t.id], firsts: firsts[t.id] };
    })
    .sort(function (a, b) { return b.points - a.points || b.firsts - a.firsts; });
}
