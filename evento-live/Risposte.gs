/**
 * Answers and the word cloud.
 *
 * Counting is done here rather than in the browser: the projector then receives
 * a few hundred bytes instead of every raw answer, the spreadsheet never has to
 * be world-readable, and there is no CSV to parse.
 */

function readAnswers_() {
  const sh = sheet_('RISPOSTE');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getValues()
    .filter(function (r) { return String(r[2]).trim() !== ''; })
    .map(function (r) {
      return { at: r[0], voterId: String(r[1]), text: String(r[2]).trim() };
    });
}

/** Italian and English function words. Without this the cloud reads "di, che, non, più". */
const STOPWORDS = ('a ad affinché agli ai al alcuna alcuni alcuno all alla alle allo altri altro anche ancora ' +
  'avere avendo avete avevo avuto basta bene c che chi ci cioè circa co coi col come con cosa cosi così cui ' +
  'da dagli dai dal dall dalla dalle dallo degli dei del dell della delle dello dentro deve devo di dopo dove ' +
  'dovrebbe due e ecco ed egli ella eppure era erano essa esse essendo essere essi fa fare fatto fino fra ' +
  'gli grande ha hai hanno ho i il in inoltre insieme invece io la le lei li lo loro lui ma me medesimo mentre ' +
  'mi mia mie miei mio modo molta molti molto ne nei nel nell nella nelle nello nessuno niente no noi non ' +
  'nostra nostro nulla o od oggi ogni ognuno oltre oppure ora ossia ovvero per perché perchè però pero più piu ' +
  'poco poi potere può puo qua quale quali qualche qualcosa quando quanto quasi quella quelle quelli quello ' +
  'questa queste questi questo qui quindi sarebbe sarà sara se sé sei sembra sempre senza si sia siamo siete ' +
  'solo sono sopra sotto sta stanno stare stato stesso su sua sue sugli sui sul sull sulla sulle sullo suo ' +
  'tanto te tra tre troppo tu tua tue tuo tutta tutte tutti tutto un una uno va vale vi via voi vostra vostro ' +
  'the a an and or but of to in on for with without from by as at is are was were be been being this that ' +
  'these those it its they them their we our you your i my me not no yes very more most much many some any ' +
  'can could should would will just also about into than then there here what which who whom how when where ' +
  'has have had do does did so such only own same too if because while during').split(/\s+/);

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
 */
const PLURAL_OF = { o: 'i', a: 'e', e: 'i' };

function buildCloud_(texts, cfg) {
  const minLen = cfg.min_word_len;
  // Blocking "scuola" has to block "scuole" too, or the plural survives into the
  // cloud on its own. The pairing is the same one used to fold plurals below.
  const extra = {};
  String(cfg.blocklist || '').split(',').forEach(function (w) {
    const k = normalizeText_(w);
    if (!k) return;
    extra[k] = true;
    const last = k.slice(-1), stem = k.slice(0, -1);
    if (PLURAL_OF[last]) extra[stem + PLURAL_OF[last]] = true;
    if (last === 'i') { extra[stem + 'o'] = true; extra[stem + 'e'] = true; }
    if (last === 'e') { extra[stem + 'a'] = true; extra[stem + 'i'] = true; }
  });

  const rename = {};
  String(cfg.synonyms || '').split(',').forEach(function (pair) {
    const bits = pair.split('=');
    if (bits.length === 2) {
      const from = normalizeText_(bits[0]);
      const to = normalizeText_(bits[1]);
      if (from && to) rename[from] = to;
    }
  });

  const counts = {};
  texts.forEach(function (t) {
    const seen = {};
    normalizeText_(t).split(' ').forEach(function (w) {
      if (rename[w]) w = rename[w];
      if (w.length < minLen) return;
      if (STOPSET[w] || extra[w]) return;
      if (/^\d+$/.test(w)) return;
      // Count a word once per answer, so one long answer cannot own the cloud.
      if (seen[w]) return;
      seen[w] = true;
      counts[w] = (counts[w] || 0) + 1;
    });
  });

  Object.keys(counts).forEach(function (w) {
    if (counts[w] === undefined) return;  // already folded into its singular
    const plural = PLURAL_OF[w.slice(-1)] ? w.slice(0, -1) + PLURAL_OF[w.slice(-1)] : null;
    if (plural && counts[plural] !== undefined) {
      const keep = counts[w] >= counts[plural] ? w : plural;
      const drop = keep === w ? plural : w;
      counts[keep] += counts[drop];
      delete counts[drop];
    }
  });

  return Object.keys(counts)
    .map(function (w) { return [w, counts[w]]; })
    .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); })
    .slice(0, cfg.max_cloud_words);
}
