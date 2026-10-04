(function () {
  'use strict';

  /* operatore_<nome>.html says whose session it drives in <body data-persona>;
     evento-config.js maps the person to their web app URL. */
  var PERSONA = document.body.dataset.persona || '';
  var URL_EXEC = (window.EVENTO_PERSONE || {})[PERSONA];
  var KEY_SLOT = 'ecopsy-key-' + PERSONA;
  var app = document.getElementById('app');
  var titleEl = document.getElementById('title');

  /* The key arrives in the address bar (operatore_<nome>.html#k=...) and is kept
     for the session only. It is never written into this file: anything in the
     published JavaScript is public, and the phase controls have to be the one
     thing the room cannot press. The server checks it on every call. */
  var key = (function () {
    var m = /[#&]k=([^&]+)/.exec(location.hash);
    if (m) {
      var k = decodeURIComponent(m[1]);
      try { sessionStorage.setItem(KEY_SLOT, k); } catch (e) {}
      history.replaceState(null, '', location.pathname + location.search);
      return k;
    }
    try { return sessionStorage.getItem(KEY_SLOT) || ''; } catch (e) { return ''; }
  })();

  function getState() {
    return fetch(URL_EXEC + '?t=' + Date.now()).then(function (r) { return r.json(); });
  }
  function post(body) {
    body.key = key;
    return fetch(URL_EXEC, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  var PHASE_LABEL = {
    collecting: 'Raccolta aperta',
    analysing:  'Analisi in corso',
    themes:     'Temi pronti',
    voting:     'Votazione aperta',
    results:    'Risultati'
  };

  var STEPS = [
    { n: 1, to: 'collecting', label: 'Apri la raccolta',        sub: 'I partecipanti possono scrivere', from: ['results', 'themes', 'voting', 'analysing'] },
    { n: 2, act: 'analyze',   label: 'Chiudi e analizza',       sub: 'Estrae i temi dalle risposte',     from: ['collecting'] },
    { n: 3, to: 'voting',     label: 'Apri la votazione',       sub: 'I temi diventano votabili',        from: ['themes', 'results'] },
    { n: 4, to: 'results',    label: 'Chiudi e mostra i voti',  sub: 'La classifica compare sullo schermo', from: ['voting'] },
    { n: 5, act: 'next',      label: 'Domanda successiva',      sub: 'Nuovo giro: si riparte dalla raccolta', from: ['results'] }
  ];

  var busy = false, state = null, timer = null;

  /* Created once and re-attached on each render: rebuilding it would erase the
     confirmation of the action that just ran. */
  var status = el('div', 'status');
  status.setAttribute('role', 'status');

  function render(s) {
    state = s;
    titleEl.textContent = s.title || 'Sessione live';
    app.textContent = '';

    /* — current phase — */
    var head = el('div', 'card');
    head.appendChild(el('h2', null, 'Adesso'));
    var now = el('div', 'now');
    now.appendChild(el('span', 'pill', PHASE_LABEL[s.phase] || s.phase));
    var nums = el('div', 'nums');
    nums.appendChild(el('b', null, String(s.responses)));
    nums.appendChild(document.createTextNode(s.responses === 1 ? ' partecipante · ' : ' partecipanti · '));
    nums.appendChild(el('b', null, String(s.ballots)));
    nums.appendChild(document.createTextNode(s.ballots === 1 ? ' voto' : ' voti'));
    now.appendChild(nums);
    head.appendChild(now);
    var curq = el('div', 'curq');
    if (s.round) curq.appendChild(el('span', 'round', 'Domanda ' + s.round.n + ' di ' + s.round.of));
    curq.appendChild(document.createTextNode(s.question || ''));
    head.appendChild(curq);
    app.appendChild(head);

    /* — the four buttons, in order — */
    var ctrl = el('div', 'card');
    ctrl.appendChild(el('h2', null, 'Comandi'));
    var steps = el('div', 'steps');

    STEPS.forEach(function (st) {
      var b = el('button', 'step');
      b.type = 'button';
      b.appendChild(el('span', 'n', String(st.n)));
      var body = el('div');
      body.appendChild(document.createTextNode(st.label));
      body.appendChild(el('span', 'sub', st.sub));
      b.appendChild(body);

      var isLast = !s.round || s.round.n >= s.round.of;
      var available = st.from.indexOf(s.phase) !== -1 && !(st.act === 'next' && isLast);
      if (available) b.classList.add('next');
      b.disabled = busy || !available;

      b.addEventListener('click', function () {
        if (st.act === 'analyze' && !confirm('Chiudere la raccolta e analizzare le risposte di ' + s.responses + ' partecipanti?')) return;
        run(st, status, b);
      });
      steps.appendChild(b);
    });

    ctrl.appendChild(steps);
    ctrl.appendChild(status);

    var danger = el('div', 'danger');
    var rb = el('button', 'reset', 'Azzera la sessione');
    rb.type = 'button';
    rb.addEventListener('click', function () {
      if (!confirm('Cancella risposte, temi e voti di tutte le domande e torna alla prima. Procedere?')) return;
      busy = true;
      post({ action: 'reset', confirm: 'RESET' }).then(function (res) {
        busy = false;
        if (wrongKey(res)) return;
        say(status, res.ok ? 'Sessione azzerata.' : (res.error || 'Non riuscito.'), res.ok);
        tick();
      });
    });
    danger.appendChild(rb);
    ctrl.appendChild(danger);
    app.appendChild(ctrl);

    /* — the rounds, from the Domande tab; any of them can be put on screen — */
    if (s.questions && s.questions.length > 1) {
      var qc = el('div', 'card');
      qc.appendChild(el('h2', null, 'Domande'));
      var qol = el('ol', 'qs');
      s.questions.forEach(function (q) {
        var li = el('li', q.id === s.questionId ? 'cur' : null, q.text);
        if (q.id !== s.questionId) {
          var go = el('button', null, 'Vai');
          go.type = 'button';
          go.disabled = busy;
          go.addEventListener('click', function () {
            if (!confirm('Passare a questa domanda? La raccolta si riapre. Risposte, temi e voti di ogni domanda restano nel foglio.')) return;
            run({ act: 'question', to: q.id }, status, go);
          });
          li.appendChild(go);
        }
        qol.appendChild(li);
      });
      qc.appendChild(qol);
      qc.appendChild(el('p', 'links', 'Aggiungi o modifica le domande nel foglio Domande.'));
      app.appendChild(qc);
    }

    /* — themes, editable in the sheet — */
    if (s.themes.length) {
      var tc = el('div', 'card');
      tc.appendChild(el('h2', null, 'Temi (' + s.themes.length + ')'));
      var ol = el('ol', 'themes');
      s.themes.forEach(function (t) {
        var li = el('li');
        li.appendChild(el('span', 'label', t.label));
        if (t.description) li.appendChild(el('div', 'desc', t.description));
        ol.appendChild(li);
      });
      tc.appendChild(ol);
      tc.appendChild(el('p', 'links', 'Correggili nel foglio Temi: la pagina di voto legge quello, non il modello.'));
      app.appendChild(tc);
    }

    /* — results — */
    if (s.phase === 'results' && s.results) {
      var rc = el('div', 'card');
      rc.appendChild(el('h2', null, 'Classifica'));
      var ol2 = el('ol', 'themes');
      s.results.forEach(function (r) {
        var li = el('li');
        li.appendChild(el('span', 'label', r.label));
        li.appendChild(el('div', 'desc', r.points + ' punti · ' + r.firsts + ' primi posti'));
        ol2.appendChild(li);
      });
      rc.appendChild(ol2);
      app.appendChild(rc);
    }

    /* — the two links to open elsewhere — */
    var lc = el('div', 'card');
    lc.appendChild(el('h2', null, 'Schermi'));
    var links = el('div', 'links');
    var dir = location.origin + location.pathname.replace(/[^\/]*$/, '');
    links.appendChild(document.createTextNode('Proiettore: '));
    links.appendChild(el('code', null, dir + 'proiettore_' + PERSONA + '.html'));
    links.appendChild(el('br'));
    links.appendChild(document.createTextNode('Partecipanti: '));
    links.appendChild(el('code', null, dir + 'voto_studente_' + PERSONA + '.html'));
    lc.appendChild(links);
    app.appendChild(lc);
  }

  function run(st, status, btn) {
    busy = true;
    btn.disabled = true;
    say(status, st.act === 'analyze' ? 'Analisi in corso, può richiedere qualche secondo…' : 'Eseguo…');

    var call = st.act === 'analyze'  ? post({ action: 'analyze' })
             : st.act === 'next'     ? post({ action: 'question', to: 'next' })
             : st.act === 'question' ? post({ action: 'question', to: st.to })
             : post({ action: 'phase', to: st.to });

    call.then(function (res) {
      busy = false;
      if (res.ok) {
        say(status, st.act === 'analyze' ? (res.themes.length + ' temi estratti. Controllali qui sotto.') : 'Fatto.', true);
      } else {
        if (wrongKey(res)) return;
        say(status, (res.error || 'Non riuscito.') + (res.fallback ? ' — ' + res.fallback : ''), false);
      }
      tick();
    }).catch(function () {
      busy = false;
      say(status, 'Nessuna risposta dal server. Controlla la connessione e riprova.', false);
      tick();
    });
  }

  function say(node, msg, ok) {
    node.className = 'status' + (ok === true ? ' ok' : ok === false ? ' err' : '');
    node.textContent = msg;
  }

  /* A mistyped key would otherwise sit in the session and fail every command:
     forget it and ask again. */
  function wrongKey(res) {
    if (res.ok || !/chiave non valida/.test(res.error || '')) return false;
    key = '';
    try { sessionStorage.removeItem(KEY_SLOT); } catch (e) {}
    clearInterval(timer);
    app.textContent = '';
    askKey('Chiave non valida. Riprova.');
    return true;
  }

  function tick() {
    getState().then(function (s) { if (s.ok) render(s); }).catch(function () {});
  }

  function askKey(why) {
    var box = el('div', 'card locked');
    if (why) box.appendChild(el('p', 'status err', why));
    box.appendChild(el('p', null, 'Questa pagina richiede la chiave facilitatore, nella forma ' + PERSONA + '-123. La trovi nel foglio: menu EcoPsy → Mostra chiave e link.'));
    var input = el('input');
    input.type = 'password';
    input.setAttribute('aria-label', 'Chiave facilitatore');
    input.placeholder = PERSONA + '-123';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocomplete', 'off');
    var b = el('button', null, 'Entra');
    b.type = 'button';
    function go() {
      if (!input.value.trim()) return;
      key = input.value.trim();
      try { sessionStorage.setItem(KEY_SLOT, key); } catch (e) {}
      start();
    }
    b.addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    box.appendChild(input);
    box.appendChild(el('br'));
    box.appendChild(b);
    app.appendChild(box);
    input.focus();
  }

  function start() {
    app.textContent = '';
    tick();
    clearInterval(timer);
    timer = setInterval(function () { if (!busy) tick(); }, 5000);
  }

  if (!URL_EXEC || URL_EXEC.indexOf('INCOLLA') === 0) {
    app.appendChild(el('div', 'card', 'Configura evento-config.js con l’URL /exec del web app di “' + PERSONA + '”.'));
  } else if (!key) {
    askKey();
  } else {
    start();
  }
})();
