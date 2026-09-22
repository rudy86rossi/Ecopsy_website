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
    .addSeparator()
    .addItem('Azzera sessione', 'menuReset')
    .addToUi();
}

/**
 * The facilitator page proves it is the facilitator with this key. It lives in
 * Script Properties and in the address bar of whoever runs the room — never in
 * the JavaScript published on the site.
 */
function mostraChiave() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('FACILITATOR_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
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
    '\n\nPagina facilitatore: <sito>/evento-regia.html#k=' + key +
    '\n\nRidistribuendo, usa sempre "Gestisci distribuzioni → matita → Nuova versione":' +
    ' una nuova distribuzione cambia l’URL e le pagine pubblicate smettono di funzionare.'
  );
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
  if (!readThemes_().length) {
    SpreadsheetApp.getUi().alert('Nessun tema nel foglio Temi. Aggiungine almeno uno prima di aprire la votazione.');
    return;
  }
  setConfig('phase', 'voting');
  toast_('Votazione aperta');
}

function menuRisultati() {
  setConfig('phase', 'results');
  const cfg = getConfig();
  const rows = scoreBallots_(readBallots_(), readThemes_(), cfg);
  toast_('Votazione chiusa');
  SpreadsheetApp.getUi().alert(
    'Risultati\n\n' + rows.map(function (r, i) {
      return (i + 1) + '. ' + r.label + '  —  ' + r.points + ' punti (' + r.firsts + ' primi posti)';
    }).join('\n')
  );
}

function menuReset() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Azzerare la sessione?',
    'Cancella risposte, temi e voti. Il foglio conserva solo Config e Log.',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  withLock_(function () {
    ['RISPOSTE', 'TEMI', 'VOTI'].forEach(function (k) {
      const sh = sheet_(k);
      if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
  });
  setConfig('phase', 'collecting');
  log_('reset', 'menu', 'ok');
  toast_('Sessione azzerata');
}

function toast_(msg) {
  ss_().toast(msg, 'EcoPsy', 4);
}

/* ── rehearsal helpers, run from the editor ────────────────────────────── */

/** Fills the sheet with fake answers so the cloud and the analysis can be tried. */
function provaRiempi() {
  setup();
  const samples = [
    'Ansia da prestazione scolastica e paura del giudizio dei coetanei',
    'La pressione della scuola e dei voti, insieme ai social media',
    'Solitudine e isolamento, pochi spazi di socialità reale nei quartieri',
    'I social media e il confronto continuo con gli altri',
    'Famiglie fragili, genitori assenti, mancanza di ascolto',
    'Il clima e il futuro incerto pesano molto sui ragazzi',
    'Bullismo a scuola e online, nessuno interviene davvero',
    'Disuguaglianze economiche fra quartieri e accesso ai servizi'
  ];
  samples.forEach(function (t, i) {
    sheet_('RISPOSTE').appendRow([new Date(), 'prova-' + i, t]);
  });
  dropStateCache_();
  Logger.log('inserite ' + samples.length + ' risposte di prova');
}

/** Exercises the whole read path without deploying anything. */
function provaStato() {
  const s = state_();
  Logger.log('fase: %s · risposte: %s · nuvola: %s · temi: %s',
             s.phase, s.responses, s.cloud.slice(0, 10), s.themes.length);
  return s;
}

/** Exercises the model call and writes the Temi tab. */
function provaAnalisi() {
  Logger.log(JSON.stringify(runAnalyze_(), null, 2));
}
