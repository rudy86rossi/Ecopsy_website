/**
 * Session names and the list of sessions on the facilitator page.
 *
 * A session's id is the time it started (see Archivio.gs) and stays on every
 * row. Its name lives only in the Sessioni tab, one row per session: renaming
 * one is editing its `nome` cell, or the pencil on the facilitator page.
 *
 * A new session needs a name (resetSession_ refuses one without). Sessions
 * from before names existed, and the very first session of a sheet (which
 * starts without a reset), get a name made of their date, scaletta and the
 * sheet's person, `2026-10-15 FSL-1 rodolfo`, with the start time added when
 * that name is taken: `2026-10-15 11:40 FSL-1 rodolfo`, then with seconds.
 * listSessions_ writes those rows when it finds a session that has none, so
 * the tab fills itself; setup() brings every name of that shape up to date
 * (renameDefaultSessions_).
 */

const MAX_SESSION_NAME = 60;

/** Names compare without regard to case or repeated spaces. */
function sessionNameKey_(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The Sessioni tab: [{row, id, name, scaletta}], in sheet order. */
function readSessions_() {
  const sh = sheet_('SESSIONI');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.SESSIONI.length).getValues()
    .map(function (r, i) {
      return { row: i + 2, id: sessionText_(r[0]), name: cellText_(r[1]).replace(/\s+/g, ' '), scaletta: String(r[2]).trim() };
    })
    .filter(function (s) { return s.id !== ''; });
}

/** The name of a session, or '' when it has none in the tab. */
function sessionNameOf_(id, sessions) {
  const s = (sessions || readSessions_()).filter(function (x) { return x.id === id; })[0];
  return s ? s.name : '';
}

/**
 * A name typed by the facilitator: one line, not empty, at most
 * MAX_SESSION_NAME characters, and used by no other session of this sheet.
 * Returns {name} or {error}.
 */
function checkSessionName_(raw, id, sessions) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'scrivi il nome della sessione' };
  if (name.length > MAX_SESSION_NAME) return { error: 'nome troppo lungo (massimo ' + MAX_SESSION_NAME + ' caratteri)' };
  const key = sessionNameKey_(name);
  const taken = (sessions || readSessions_()).some(function (s) {
    return s.id !== id && sessionNameKey_(s.name) === key;
  });
  if (taken) return { error: 'esiste già una sessione con questo nome' };
  return { name: name };
}

/** The person of this sheet (PERSONA, set by Mostra chiave e link); '' before it is set. */
function sheetPersona_() {
  return String(PropertiesService.getScriptProperties().getProperty('PERSONA') || '').trim();
}

/** The day, the day and HH:MM, the day and HH:MM:SS of a session id (`2026-10-15 11:40:07`). */
function sessionStamps_(id) {
  const day = id.slice(0, 10);
  return [day, day + ' ' + id.slice(11, 16), day + ' ' + id.slice(11, 19)];
}

/**
 * `2026-10-15 FSL-1 rodolfo`; when that is in `taken` (keys of sessionNameKey_),
 * `2026-10-15 11:40 FSL-1 rodolfo`, then `2026-10-15 11:40:07 FSL-1 rodolfo`,
 * then the last with ` (2)`, ` (3)`…
 */
function defaultSessionName_(id, scaletta, taken, persona) {
  const tail = (scaletta ? ' ' + scaletta : '') + (persona ? ' ' + persona : '');
  const stamps = sessionStamps_(id);
  for (let i = 0; i < stamps.length; i++) {
    if (!taken[sessionNameKey_(stamps[i] + tail)]) return stamps[i] + tail;
  }
  let n = 2;
  while (taken[sessionNameKey_(stamps[2] + tail + ' (' + n + ')')]) n++;
  return stamps[2] + tail + ' (' + n + ')';
}

/**
 * Whether `name` has the shape of a default name of session `id`: its date
 * (with or without the time), then optionally the scaletta, then optionally
 * the person. Such a name was given automatically, or typed as the example.
 */
function isDefaultSessionName_(name, id, scaletta, persona) {
  const key = sessionNameKey_(name);
  const n = key.match(/^(.*?) \((\d+)\)$/);
  const bare = n ? n[1] : key;
  return sessionStamps_(id).some(function (stamp) {
    return ['', ' ' + scaletta].some(function (set) {
      if (set === ' ') return false;
      return ['', ' ' + persona].some(function (who) {
        if (who === ' ') return false;
        return bare === sessionNameKey_(stamp + set + who);
      });
    });
  });
}

/**
 * New default names for the sessions in `sessions` ([{id, name, scaletta}])
 * whose name has the default shape: {id: name} for the ones that change.
 * Other names are kept and count as taken. Oldest first, so the oldest of
 * a day keeps the short name.
 */
function renamedDefaults_(sessions, persona) {
  const taken = {};
  const auto = [];
  sessions.forEach(function (s) {
    if (isDefaultSessionName_(s.name, s.id, s.scaletta, persona)) auto.push(s);
    else taken[sessionNameKey_(s.name)] = true;
  });
  auto.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  const out = {};
  auto.forEach(function (s) {
    const name = defaultSessionName_(s.id, s.scaletta, taken, persona);
    taken[sessionNameKey_(name)] = true;
    if (name !== s.name) out[s.id] = name;
  });
  return out;
}

/** Run by setup(): gives every session with a default-shaped name the current default name. */
function renameDefaultSessions_() {
  const persona = sheetPersona_();
  let changed = 0;
  withLock_(function () {
    const sessions = readSessions_();
    const names = renamedDefaults_(sessions, persona);
    const sh = sheet_('SESSIONI');
    sessions.forEach(function (s) {
      if (!names[s.id]) return;
      sh.getRange(s.row, 2).setNumberFormat('@').setValue(safeCell_(names[s.id]));
      changed++;
    });
  });
  if (changed) {
    dropStateCache_();
    log_('session-name', changed + ' nomi automatici aggiornati', 'ok');
  }
}

/** Writes one row of Sessioni. Call inside withLock_. */
function appendSession_(id, name, scaletta) {
  const sh = sheet_('SESSIONI');
  // Text, so Sheets keeps the id as written and never turns a name like 15/10 into a date.
  const at = sh.getLastRow() + 1;
  sh.getRange(at, 1, 1, 3).setNumberFormat('@').setValues([[id, safeCell_(name), scaletta || '']]);
}

/** The scaletta of every session in Cronologia: the last one recorded. */
function sessionSets_() {
  const sh = sheet_('CRONOLOGIA');
  const last = sh.getLastRow();
  const out = {};
  if (last < 2) return out;
  sh.getRange(2, 2, last - 1, 4).getValues().forEach(function (r) {
    const set = String(r[3]).trim();
    if (set) out[sessionText_(r[0])] = set;
  });
  return out;
}

/** Column `sessione` and, when asked, `voterId` of a tab, row by row. */
function sessionColumn_(key, withVoter) {
  const sh = sheet_(key);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const sc = HEADERS[key].indexOf('sessione');
  const vc = HEADERS[key].indexOf('voterId');
  const from = withVoter ? Math.min(sc, vc) : sc;
  const width = withVoter ? Math.abs(sc - vc) + 1 : 1;
  return sh.getRange(2, from + 1, last - 1, width).getValues().map(function (r) {
    return { id: sessionText_(r[sc - from]), voter: withVoter ? String(r[vc - from]) : '' };
  });
}

/**
 * Every session of the sheet, newest first:
 * [{id, name, scaletta, participants, current}]. `participants` counts the
 * devices that answered, leaving out the rehearsal ones (prova-…), so a
 * session filled only by provaRiempi counts as empty. A session found in the
 * data with no row in Sessioni gets one here, with the default name.
 */
function listSessions_() {
  const current = sessionId_();
  const people = {};
  const seen = {};
  seen[current] = true;
  ['RISPOSTE', 'ARCHIVIO_RISPOSTE'].forEach(function (k) {
    sessionColumn_(k, true).forEach(function (r) {
      if (!r.id) return;
      seen[r.id] = true;
      if (/^prova-/.test(r.voter)) return;
      (people[r.id] = people[r.id] || {})[r.voter] = true;
    });
  });
  ['VOTI', 'ARCHIVIO_VOTI', 'SINTESI', 'CRONOLOGIA'].forEach(function (k) {
    sessionColumn_(k, false).forEach(function (r) { if (r.id) seen[r.id] = true; });
  });
  const sets = sessionSets_();

  let sessions = readSessions_();
  const named = {};
  sessions.forEach(function (s) { named[s.id] = true; });
  const missing = Object.keys(seen).filter(function (id) { return !named[id]; }).sort();
  if (missing.length) {
    withLock_(function () {
      sessions = readSessions_();
      const taken = {};
      sessions.forEach(function (s) { named[s.id] = true; taken[sessionNameKey_(s.name)] = true; });
      // Sessions from before scalette existed ran the first one, as the server would today.
      const first = readDomande_('').scalette.map(function (s) { return s.name; })[0] || '';
      const persona = sheetPersona_();
      missing.forEach(function (id) {
        if (named[id]) return;
        const set = sets[id] || first;
        const name = defaultSessionName_(id, set, taken, persona);
        taken[sessionNameKey_(name)] = true;
        appendSession_(id, name, set);
      });
      sessions = readSessions_();
    });
  }

  return sessions
    .map(function (s) {
      return {
        id: s.id, name: s.name, scaletta: s.scaletta || sets[s.id] || '',
        participants: Object.keys(people[s.id] || {}).length,
        current: s.id === current
      };
    })
    .sort(function (a, b) { return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; });
}

/** Run by setup(): names every session already in the sheet, and updates the default names. */
function fillSessions_() {
  listSessions_();
  renameDefaultSessions_();
}

/* ── facilitator actions ───────────────────────────────────────────────── */

function actionSessions_(body) {
  requireKey_(body.key);
  return { ok: true, sessions: listSessions_() };
}

function actionSessionName_(body) {
  requireKey_(body.key);
  const id = String(body.sessione || '').trim();
  let out = null;
  withLock_(function () {
    const sessions = readSessions_();
    const row = sessions.filter(function (s) { return s.id === id; })[0];
    if (!row) { out = { ok: false, error: 'sessione sconosciuta' }; return; }
    const clean = checkSessionName_(body.nome, id, sessions);
    if (clean.error) { out = { ok: false, error: clean.error }; return; }
    sheet_('SESSIONI').getRange(row.row, 2).setNumberFormat('@').setValue(safeCell_(clean.name));
    out = { ok: true, sessione: id, name: clean.name };
  });
  if (out.ok) {
    dropStateCache_();
    log_('session-name', id + ' · ' + out.name, 'ok');
  }
  return out;
}
