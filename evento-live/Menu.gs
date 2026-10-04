/**
 * The spreadsheet menu: the fallback path for everything the facilitator page
 * does, for the moment the facilitator page will not load.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EcoPsy')
    .addItem('Inizializza fogli', 'setup')
    .addItem('Mostra chiave e link', 'mostraChiave')
    .addSeparator()
    .addItem('1 · Apri raccolta', 'menuApriRaccolta')
    .addItem('2 · Chiudi raccolta e analizza', 'menuAnalizza')
    .addItem('3 · Apri votazione', 'menuApriVotazione')
    .addItem('4 · Chiudi votazione e mostra risultati', 'menuRisultati')
    .addItem('5 · Passa alla domanda successiva', 'menuDomandaSuccessiva')
    .addSeparator()
    .addItem('Nuova chiave facilitatore', 'nuovaChiave')
    .addItem('Azzera sessione', 'menuReset')
    .addToUi();
}

/**
 * The facilitator page proves it is the facilitator with this key. It lives in
 * Script Properties and in the address bar of whoever runs the room — never in
 * the JavaScript published on the site. The page itself is public: without the
 * key it shows a lock screen and every command it sends is refused here.
 *
 * The key is the person's name and three digits (rodolfo-482), short enough to
 * type in the room. A thousand combinations are guessable, so requireKey_ stops
 * accepting keys for a while after a run of wrong ones.
 */
function newKey_(persona, old) {
  let key;
  do {
    key = persona + '-' + ('00' + Math.floor(Math.random() * 1000)).slice(-3);
  } while (key === old);
  return key;
}

/** The name in this person's page addresses (operatore_<nome>.html). Asked for once and remembered. */
function persona_(ui, props) {
  let persona = props.getProperty('PERSONA');
  if (persona) return persona;
  const res = ui.prompt('Nome della persona',
    'Il nome usato negli indirizzi delle sue pagine, ad esempio rodolfo per operatore_rodolfo.html.',
    ui.ButtonSet.OK_CANCEL);
  persona = (res.getResponseText() || '').trim().toLowerCase();
  if (res.getSelectedButton() !== ui.Button.OK || !/^[a-z]+$/.test(persona)) {
    ui.alert('Serve un nome di sole lettere minuscole, uguale a quello negli indirizzi delle pagine.');
    return '';
  }
  props.setProperty('PERSONA', persona);
  return persona;
}

function mostraChiave() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const persona = persona_(ui, props);
  if (!persona) return;
  let key = props.getProperty('FACILITATOR_KEY');
  // Long keys from earlier versions, or a key for another name: replace them on sight.
  if (!key || !new RegExp('^' + persona + '-\\d{3}$').test(key)) {
    key = newKey_(persona, key);
    props.setProperty('FACILITATOR_KEY', key);
  }

  // Asked for once and remembered. ScriptApp.getService().getUrl() returns the
  // editor's head deployment, a different id from the versioned deployment that
  // anonymous visitors reach — pasting it into evento-config.js kills the event.
  let url = props.getProperty('EXEC_URL');
  if (!url) {
    const res = ui.prompt('URL del web app',
      'Incolla l’URL che finisce in /exec (Distribuisci → Gestisci distribuzioni).',
      ui.ButtonSet.OK_CANCEL);
    url = (res.getResponseText() || '').trim();
    if (res.getSelectedButton() !== ui.Button.OK || !/\/exec$/.test(url)) {
      ui.alert('Serve l’URL che finisce in /exec. Chiave generata comunque:\n\n' + key);
      return;
    }
    props.setProperty('EXEC_URL', url);
  }

  ui.alert(
    'Chiave facilitatore\n\n' + key +
    '\n\nURL del web app\n\n' + url +
    '\n\nPagina facilitatore: <sito>/operatore_' + persona + '.html#k=' + key +
    '\n(oppure apri operatore_' + persona + '.html e scrivi la chiave)' +
    '\n\nRidistribuendo, usa sempre "Gestisci distribuzioni → matita → Nuova versione":' +
    ' una nuova distribuzione cambia l’URL e le pagine pubblicate smettono di funzionare.'
  );
}

/** For when the link has been seen by someone it should not have been: the old one stops working at once. */
function nuovaChiave() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Generare una nuova chiave?',
    'Il link del facilitatore attuale smette di funzionare subito. Dovrai riaprire la pagina con il nuovo link.',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  const props = PropertiesService.getScriptProperties();
  const persona = persona_(ui, props);
  if (!persona) return;
  props.setProperty('FACILITATOR_KEY', newKey_(persona, props.getProperty('FACILITATOR_KEY')));
  log_('key', 'rotated', 'ok');
  mostraChiave();
}

function menuApriRaccolta() {
  setConfig('phase', 'collecting');
  toast_('Raccolta aperta');
}

function menuAnalizza() {
  const ui = SpreadsheetApp.getUi();
  const res = runAnalyze_();
  if (res.ok) {
    ui.alert('Temi estratti: ' + res.themes.length + '.\n\nControllali nel foglio Temi, poi apri la votazione.');
  } else {
    ui.alert('Analisi non riuscita\n\n' + res.error +
             '\n\nScrivi i temi a mano nel foglio Temi (id, etichetta, descrizione) e prosegui: ' +
             'la pagina di votazione legge quel foglio, non il modello.');
  }
}

function menuApriVotazione() {
  if (!readThemes_(getConfig().question.id).length) {
    SpreadsheetApp.getUi().alert('Nessun tema nel foglio Temi. Aggiungine almeno uno prima di aprire la votazione.');
    return;
  }
  setConfig('phase', 'voting');
  toast_('Votazione aperta');
}

function menuRisultati() {
  setConfig('phase', 'results');
  const cfg = getConfig();
  const qid = cfg.question.id;
  const rows = scoreBallots_(readBallots_(qid), readThemes_(qid), cfg);
  toast_('Votazione chiusa');
  SpreadsheetApp.getUi().alert(
    'Risultati\n\n' + rows.map(function (r, i) {
      return (i + 1) + '. ' + r.label + '  —  ' + r.points + ' punti (' + r.firsts + ' primi posti)';
    }).join('\n')
  );
}

function menuDomandaSuccessiva() {
  const ui = SpreadsheetApp.getUi();
  const cfg = getConfig();
  const nxt = cfg.questions[cfg.questionIndex + 1];
  if (!nxt) {
    ui.alert('Questa è l’ultima domanda del foglio Domande. Aggiungi una riga per proseguire.');
    return;
  }
  goToQuestion_(nxt.id);
  toast_('Domanda ' + (cfg.questionIndex + 2) + ' di ' + cfg.questions.length + ': raccolta aperta');
}

function menuReset() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Azzerare la sessione?',
    'Sposta risposte, temi e voti di tutte le domande nei fogli Archivio, apre una nuova sessione e torna alla prima domanda.',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  resetSession_('menu');
  toast_('Sessione azzerata');
}

function toast_(msg) {
  ss_().toast(msg, 'EcoPsy', 4);
}

/* ── rehearsal helpers, run from the editor ────────────────────────────── */

/** Fills the question on screen with fake answers so the cloud and the analysis can be tried. */
function provaRiempi() {
  setup();
  const qid = getConfig().question.id;
  const people = [
    ['Ansia da prestazione', 'Giudizio dei coetanei', 'Voti'],
    ['Pressione scolastica', 'I social media', 'voti'],
    ['Solitudine', 'Pochi spazi di socialità', 'Quartieri'],
    ['Social media', 'Confronto continuo'],
    ['Famiglie fragili', 'Genitori assenti', 'Mancanza di ascolto'],
    ['Futuro incerto', 'Clima'],
    ['Bullismo', 'Social media', 'Solitudine'],
    ['Disuguaglianze economiche', 'Accesso ai servizi', 'la solitudine']
  ];
  const now = new Date();
  const session = sessionId_();
  const rows = [];
  people.forEach(function (items, i) {
    items.forEach(function (t) { rows.push([now, 'prova-' + i, t, qid, session]); });
  });
  const sh = sheet_('RISPOSTE');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  dropStateCache_();
  Logger.log('inserite ' + rows.length + ' idee di ' + people.length + ' partecipanti di prova (' + qid + ')');
}

/** Exercises the whole read path without deploying anything. */
function provaStato() {
  const s = state_();
  Logger.log('domanda: %s (%s di %s) · fase: %s · partecipanti: %s · idee: %s · nuvola: %s · temi: %s',
             s.questionId, s.round.n, s.round.of, s.phase, s.responses, s.entries,
             JSON.stringify(s.cloud.slice(0, 10)), s.themes.length);
  return s;
}

/** Lists the Gemini model ids this key can actually call, newest names last. */
function provaModelli() {
  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' +
    encodeURIComponent(prop_('GEMINI_API_KEY')),
    { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  const usable = (data.models || [])
    .filter(function (m) {
      return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
    })
    .map(function (m) { return m.name.replace('models/', ''); });
  Logger.log('Metti uno di questi nella riga "model" del foglio Config:\n\n' + usable.join('\n'));
  return usable;
}

/** Exercises the model call and writes the Temi tab. */
function provaAnalisi() {
  Logger.log(JSON.stringify(runAnalyze_(), null, 2));
}
