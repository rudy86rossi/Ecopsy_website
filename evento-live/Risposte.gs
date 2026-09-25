/**
 * Answers and the word cloud.
 *
 * The phone asks for one short idea per box, and each box is one entry in the
 * cloud, kept whole: "social media" stays one entry and grows when several
 * people write it.
 *
 * Counting is done here rather than in the browser: the projector then receives
 * a few hundred bytes instead of every raw answer, the spreadsheet never has to
 * be world-readable, and there is no CSV to parse.
 */

const MAX_ITEM_LEN = 80;

/** Answers to one question: one row per idea, several rows per participant. */
function readAnswers_(qid) {
  const sh = sheet_('RISPOSTE');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .filter(function (r) { return String(r[2]).trim() !== '' && isForQuestion_(r[3], qid); })
    .map(function (r) {
      return { at: r[0], voterId: String(r[1]), text: String(r[2]).trim() };
    });
}

function countParticipants_(answers) {
  const seen = {};
  answers.forEach(function (a) { seen[a.voterId] = true; });
  return Object.keys(seen).length;
}

/**
 * Articles and prepositions, trimmed off the ends of an entry so "la scuola"
 * and "scuola" count together. Only these: trimming words that carry meaning
 * ("troppo", "poco") would merge ideas that differ.
 */
const STOPWORDS = ('il lo la i gli le l un uno una di a ad da in con su per tra fra ' +
  'del dello della dei degli delle dell al allo alla ai agli alle all dal dallo dalla dai dagli dalle dall ' +
  'nel nello nella nei negli nelle nell sul sullo sulla sui sugli sulle sull e ed o ' +
  'the an of to and or in on for').split(/\s+/);

const STOPSET = (function () {
  const s = {};
  STOPWORDS.forEach(function (w) { if (w) s[w] = true; });
  return s;
})();

function normalizeText_(s) {
  return String(s)
    .toLowerCase()
    .replace(/[''`’]/g, ' ')            // dell'ansia -> dell ansia
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // drop accents
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fold a plural into its singular, but only for the endings that actually pair
 * in Italian: o→i, a→e, e→i. Blindly stripping the final vowel would merge
 * "caso" with "casa"; this does not, because the plural of "casa" is "case".
 * Only one-word entries are folded; longer ones need a `synonyms` pair.
 */
const PLURAL_OF = { o: 'i', a: 'e', e: 'i' };

/** The grouping key: lower case, no accents or punctuation, no leading or trailing function words. */
function entryKey_(text) {
  const words = normalizeText_(text).split(' ').filter(Boolean);
  while (words.length && STOPSET[words[0]]) words.shift();
  while (words.length && STOPSET[words[words.length - 1]]) words.pop();
  return words.join(' ');
}

/** What the projector shows: the participant's own spelling, accents included, same ends trimmed as the key. */
function entryLabel_(text) {
  const words = String(text).toLowerCase()
    .replace(/[.,;:!?"«»()]/g, ' ')
    .split(/\s+/).filter(Boolean);
  const bare = function (w) { return normalizeText_(w); };
  while (words.length && STOPSET[bare(words[0])]) words.shift();
  while (words.length && STOPSET[bare(words[words.length - 1])]) words.pop();
  return words.join(' ');
}

function buildCloud_(answers, cfg) {
  // Blocking "scuola" has to block "scuole" too, or the plural survives into the
  // cloud on its own. The pairing is the same one used to fold plurals below.
  const extra = {};
  String(cfg.blocklist || '').split(',').forEach(function (w) {
    const k = entryKey_(w);
    if (!k) return;
    extra[k] = true;
    if (k.indexOf(' ') !== -1) return;
    const last = k.slice(-1), stem = k.slice(0, -1);
    if (PLURAL_OF[last]) extra[stem + PLURAL_OF[last]] = true;
    if (last === 'i') { extra[stem + 'o'] = true; extra[stem + 'e'] = true; }
    if (last === 'e') { extra[stem + 'a'] = true; extra[stem + 'i'] = true; }
  });

  const rename = {}, renamedLabel = {};
  String(cfg.synonyms || '').split(',').forEach(function (pair) {
    const bits = pair.split('=');
    if (bits.length === 2) {
      const from = entryKey_(bits[0]);
      const to = entryKey_(bits[1]);
      if (from && to) { rename[from] = to; renamedLabel[to] = entryLabel_(bits[1]); }
    }
  });

  const entries = [];
  answers.forEach(function (a) {
    const raw = entryKey_(a.text);
    const k = rename[raw] || raw;
    if (!k || extra[k] || /^\d+$/.test(k)) return;
    entries.push({ voterId: a.voterId, key: k, label: rename[raw] ? renamedLabel[k] : entryLabel_(a.text) });
  });

  // Fold one-word plurals into whichever form more people used. Counted before
  // folding only to choose the direction.
  const raw = {};
  entries.forEach(function (e) { raw[e.key] = (raw[e.key] || 0) + 1; });
  const fold = {};
  Object.keys(raw).forEach(function (w) {
    if (w.indexOf(' ') !== -1) return;
    const plural = PLURAL_OF[w.slice(-1)] ? w.slice(0, -1) + PLURAL_OF[w.slice(-1)] : null;
    if (plural && raw[plural] !== undefined && !fold[w] && !fold[plural]) {
      if (raw[w] >= raw[plural]) fold[plural] = w; else fold[w] = plural;
    }
  });

  const counts = {};   // key -> participants who wrote it
  const labels = {};   // key -> { label: times written }
  const seen = {};     // voterId|key, so one person writing the same idea twice counts once
  entries.forEach(function (e) {
    const k = fold[e.key] || e.key;
    labels[k] = labels[k] || {};
    labels[k][e.label] = (labels[k][e.label] || 0) + 1;
    if (seen[e.voterId + '|' + k]) return;
    seen[e.voterId + '|' + k] = true;
    counts[k] = (counts[k] || 0) + 1;
  });

  return Object.keys(counts)
    .map(function (k) {
      // The spelling most people used; on a tie, the shorter one.
      const forms = labels[k];
      const label = Object.keys(forms).sort(function (x, y) {
        return forms[y] - forms[x] || x.length - y.length;
      })[0];
      return [label, counts[k]];
    })
    .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); })
    .slice(0, cfg.max_cloud_words);
}
