/**
 * Polls: questions with fixed choices (the `opzioni` column of Domande).
 *
 * A poll answer is stored like an open one, one Risposte row per chosen
 * option, so sessions, archives and the export need nothing new. A device can
 * change its answer while the poll is open: all the rows of one submission
 * carry the same timestamp, and only the device's latest submission counts.
 */

/** The cleaned choice, or an error message for the phone. */
function checkPollChoice_(q, picked) {
  const seen = {};
  const items = (Array.isArray(picked) ? picked : [])
    .map(function (t) { return String(t || '').trim(); })
    .filter(function (t) {
      if (!t || seen[t]) return false;
      seen[t] = true;
      return true;
    });
  if (!items.length) return { error: 'nessuna opzione scelta' };
  if (items.some(function (t) { return q.options.indexOf(t) === -1; })) return { error: 'opzione sconosciuta' };
  if (!q.multiple && items.length > 1) return { error: 'si può scegliere una sola opzione' };
  if (q.pick && items.length !== q.pick) return { error: 'scegline esattamente ' + q.pick };
  if (items.length > 1 && items.some(function (t) { return q.exclusive.indexOf(t) !== -1; })) {
    return { error: '“' + items.filter(function (t) { return q.exclusive.indexOf(t) !== -1; })[0] + '” non si combina con altre opzioni' };
  }
  return { items: items };
}

/** Each device's latest submission, as a list of chosen options. */
function latestPollAnswers_(answers) {
  const byVoter = {};
  answers.forEach(function (a) {
    const at = a.at instanceof Date ? a.at.getTime() : 0;
    const cur = byVoter[a.voterId];
    if (!cur || at > cur.at) byVoter[a.voterId] = { at: at, items: [a.text] };
    else if (at === cur.at) cur.items.push(a.text);
  });
  return Object.keys(byVoter).map(function (k) { return byVoter[k].items; });
}

/**
 * One row per option, in the order of the sheet. `share` is the fraction of
 * participants who picked it: with several choices allowed the shares add up
 * to more than 1.
 */
function countPoll_(q, answers) {
  const latest = latestPollAnswers_(answers);
  const counts = {};
  q.options.forEach(function (o) { counts[o] = 0; });
  latest.forEach(function (items) {
    items.forEach(function (t) { if (counts[t] !== undefined) counts[t] += 1; });
  });
  return q.options.map(function (o) {
    return { option: o, count: counts[o], share: latest.length ? counts[o] / latest.length : 0 };
  });
}

/** The `n` options chosen most often, ties broken by sheet order. */
function topPollOptions_(q, answers, n) {
  return countPoll_(q, answers)
    .map(function (r, i) { return { r: r, i: i }; })
    .sort(function (a, b) { return b.r.count - a.r.count || a.i - b.i; })
    .slice(0, n)
    .map(function (x) { return x.r; });
}
