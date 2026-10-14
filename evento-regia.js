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

  /* The facilitator is talking to a room, not reading this page. The round
     almost always runs the same way, so the page works out the next step and
     offers it as one large Avanti button; Indietro undoes the last step.
     Everything else waits under "Altri comandi". */

  /* What the room is doing, in words the facilitator can say aloud. */
  var NOW_TEXT = {
    collecting: 'Il pubblico sta scrivendo',
    analysing:  'Analisi delle risposte in corso',
    themes:     'Sullo schermo: i temi',
    voting:     'Votazione aperta',
    results:    'Sullo schermo: la classifica'
  };
  var NOW_TEXT_POLL = {
    collecting: 'Il pubblico sta scegliendo',
    results:    'Sullo schermo: i risultati'
  };

  function isLast(s) { return !s.round || s.round.n >= s.round.of; }

  /* The next step of the round: { label, sub, run } — run is absent when
     Avanti cannot be pressed, and `sub` then says why. */
  function nextStep(s) {
    if (s.phase === 'results') {
      if (isLast(s)) return { label: 'Sessione conclusa', sub: 'Era l’ultima domanda' };
      var nq = s.questions && s.questions[s.round.n];
      return { label: 'Domanda ' + (s.round.n + 1), sub: nq ? nq.text : '', run: { act: 'next' } };
    }
    if (s.poll) {
      if (s.phase === 'collecting') {
        return s.responses
          ? { label: 'Chiudi e mostra i risultati', sub: 'Le barre compaiono sullo schermo', run: { to: 'results' } }
          : { label: 'Chiudi e mostra i risultati', sub: 'Aspetta le prime risposte' };
      }
      return null;
    }
    switch (s.phase) {
      case 'collecting':
        return s.responses
          ? { label: 'Chiudi e analizza', sub: 'Le risposte vengono raggruppate in temi', run: { act: 'analyze' } }
          : { label: 'Chiudi e analizza', sub: 'Aspetta le prime risposte' };
      case 'analysing':
        return { label: 'Analisi in corso…', sub: 'Può richiedere fino a mezzo minuto' };
      case 'themes':
        return s.themes.length
          ? { label: 'Apri la votazione', sub: 'I temi diventano votabili sui telefoni', run: { to: 'voting' } }
          : { label: 'Apri la votazione', sub: 'Nessun tema: scrivili nel foglio Temi' };
      case 'voting':
        return { label: 'Chiudi e mostra i voti', sub: 'La classifica compare sullo schermo', run: { to: 'results' } };
    }
    return null;
  }

  /* One step back. Analysing → collecting rescues an analysis that never came back. */
  function prevStep(s) {
    if (s.poll) return s.phase === 'results' ? { label: 'Riapri la raccolta', run: { to: 'collecting' } } : null;
    switch (s.phase) {
      case 'analysing':
      case 'themes':  return { label: 'Riapri la raccolta', run: { to: 'collecting' } };
      case 'voting':  return { label: 'Torna ai temi', run: { to: 'themes' } };
      case 'results': return { label: 'Riapri la votazione', run: { to: 'voting' } };
    }
    return null;
  }

  /* The full list, kept under "Altri comandi" for leaving the usual path. */
  var STEPS = [
    { n: 1, to: 'collecting', label: 'Apri la raccolta',        sub: 'I partecipanti possono scrivere', from: ['results', 'themes', 'voting', 'analysing'] },
    { n: 2, act: 'analyze',   label: 'Chiudi e analizza',       sub: 'Estrae i temi dalle risposte',     from: ['collecting'] },
    { n: 3, to: 'voting',     label: 'Apri la votazione',       sub: 'I temi diventano votabili',        from: ['themes', 'results'] },
    { n: 4, to: 'results',    label: 'Chiudi e mostra i voti',  sub: 'La classifica compare sullo schermo', from: ['voting'] },
    { n: 5, act: 'next',      label: 'Domanda successiva',      sub: 'Nuovo giro: si riparte dalla raccolta', from: ['collecting', 'themes', 'voting', 'results'] }
  ];

  /* A poll has no analysis and no vote: collect, show the bars, move on. */
  var POLL_STEPS = [
    { n: 1, to: 'collecting', label: 'Apri la raccolta',        sub: 'I partecipanti possono scegliere', from: ['results'] },
    { n: 2, to: 'results',    label: 'Chiudi e mostra i risultati', sub: 'Le barre compaiono sullo schermo', from: ['collecting'] },
    { n: 3, act: 'next',      label: 'Domanda successiva',      sub: 'Nuovo giro: si riparte dalla raccolta', from: ['collecting', 'results'] }
  ];

  var SKIP_CONFIRM = 'Passare alla domanda successiva senza arrivare ai risultati? Le risposte di questa domanda restano nel foglio.';

  var busy = false, state = null, timer = null, moreOpen = false;

  /* Created once and re-attached on each render: rebuilding it would erase the
     confirmation of the action that just ran. */
  var status = el('div', 'status');
  status.setAttribute('role', 'status');

  function render(s) {
    state = s;
    titleEl.textContent = s.title || 'Sessione live';
    app.textContent = '';

    /* — what is happening now — */
    var head = el('div', 'card nowcard');
    var curq = el('div', 'curq');
    if (s.round) curq.appendChild(el('span', 'round', 'Domanda ' + s.round.n + ' di ' + s.round.of));
    curq.appendChild(document.createTextNode(s.question || ''));
    head.appendChild(curq);
    head.appendChild(el('div', 'nowtext', (s.poll && NOW_TEXT_POLL[s.phase]) || NOW_TEXT[s.phase] || s.phase));
    var count = countOf(s);
    if (count) {
      var big = el('div', 'bignum');
      big.appendChild(el('b', null, String(count.n)));
      big.appendChild(document.createTextNode(' ' + count.what));
      head.appendChild(big);
    }
    /* Stopping a round early is a real choice when time runs short. */
    if (s.phase !== 'results' && s.phase !== 'analysing' && !isLast(s)) {
      var skip = el('button', 'skip', 'Salta alla domanda successiva');
      skip.type = 'button';
      skip.addEventListener('click', function () {
        if (!confirm(SKIP_CONFIRM)) return;
        run({ act: 'next' }, skip);
      });
      head.appendChild(skip);
    }
    app.appendChild(head);

    /* — what the facilitator checks before pressing Avanti — */
    if (!s.poll && (s.phase === 'themes' || s.phase === 'voting') && s.themes.length) app.appendChild(themesCard(s));
    if (s.poll && s.poll.results) app.appendChild(pollCard(s));
    if (s.phase === 'results' && s.results) app.appendChild(rankingCard(s));

    app.appendChild(moreCard(s));

    /* — the bar at the bottom: status, Indietro, Avanti — */
    var bar = el('div', 'bar');
    var inner = el('div', 'bar-in');
    inner.appendChild(status);
    var row = el('div', 'bar-row');

    var prev = prevStep(s);
    if (prev) {
      var back = el('button', 'back');
      back.type = 'button';
      back.appendChild(el('span', 'k', 'Indietro'));
      back.appendChild(el('span', 'v', prev.label));
      back.addEventListener('click', function () { run(prev.run, back); });
      row.appendChild(back);
    }

    var nxt = nextStep(s);
    if (nxt) {
      var go = el('button', 'avanti');
      go.type = 'button';
      fillAvanti(go, nxt.run ? 'Avanti' : '', nxt.label, nxt.sub);
      go.disabled = !nxt.run;
      if (nxt.run) go.addEventListener('click', function () { run(nxt.run, go); });
      row.appendChild(go);
    }

    inner.appendChild(row);
    bar.appendChild(inner);
    app.appendChild(bar);
  }

  function fillAvanti(btn, kicker, label, sub) {
    btn.textContent = '';
    if (kicker) btn.appendChild(el('span', 'k', kicker));
    btn.appendChild(el('span', 'v', label));
    if (sub) btn.appendChild(el('span', 's', sub));
  }

  /* The number worth glancing at in each phase. */
  function countOf(s) {
    var plural = function (n, one, many) { return n === 1 ? one : many; };
    if (s.phase === 'collecting') return { n: s.responses, what: plural(s.responses, 'risposta', 'risposte') };
    if (s.phase === 'themes') return { n: s.themes.length, what: plural(s.themes.length, 'tema', 'temi') };
    if (s.poll && s.phase === 'results') return { n: s.responses, what: plural(s.responses, 'risposta', 'risposte') };
    if (s.phase === 'voting' || s.phase === 'results') return { n: s.ballots, what: plural(s.ballots, 'voto', 'voti') };
    return null;
  }

  function themesCard(s) {
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
    return tc;
  }

  function pollCard(s) {
    var pc = el('div', 'card');
    pc.appendChild(el('h2', null, 'Risultati'));
    var ol = el('ol', 'themes');
    s.poll.results.forEach(function (r) {
      var li = el('li');
      li.appendChild(el('span', 'label', r.option));
      li.appendChild(el('div', 'desc', r.count + ' · ' + Math.round(r.share * 100) + '%'));
      ol.appendChild(li);
    });
    pc.appendChild(ol);
    return pc;
  }

  function rankingCard(s) {
    var rc = el('div', 'card');
    rc.appendChild(el('h2', null, 'Classifica'));
    if (!s.results.length) rc.appendChild(el('p', 'links', 'Nessun voto registrato.'));
    var ol = el('ol', 'themes');
    s.results.forEach(function (r) {
      var li = el('li');
      li.appendChild(el('span', 'label', r.label));
      li.appendChild(el('div', 'desc', r.points + ' punti · ' + r.firsts + ' primi posti'));
      ol.appendChild(li);
    });
    rc.appendChild(ol);
    return rc;
  }

  /* Folded away: every step, the question list, the screen links, the reset.
     Its open state survives the redraw every few seconds. */
  function moreCard(s) {
    var more = el('details', 'card more');
    more.open = moreOpen;
    more.addEventListener('toggle', function () { moreOpen = more.open; });
    more.appendChild(el('summary', null, 'Altri comandi'));

    var steps = el('div', 'steps');
    (s.poll ? POLL_STEPS : STEPS).forEach(function (st) {
      var b = el('button', 'step');
      b.type = 'button';
      b.appendChild(el('span', 'n', String(st.n)));
      var body = el('div');
      body.appendChild(document.createTextNode(st.label));
      body.appendChild(el('span', 'sub', st.sub));
      b.appendChild(body);
      b.disabled = st.from.indexOf(s.phase) === -1 || (st.act === 'next' && isLast(s));
      b.addEventListener('click', function () {
        if (st.act === 'analyze' && !confirm('Chiudere la raccolta e analizzare le risposte di ' + s.responses + ' partecipanti?')) return;
        if (st.act === 'next' && s.phase !== 'results' && !confirm(SKIP_CONFIRM)) return;
        run(st, b);
      });
      steps.appendChild(b);
    });
    more.appendChild(steps);

    /* — the rounds, from the Domande tab; any of them can be put on screen — */
    if (s.questions && s.questions.length > 1) {
      more.appendChild(el('h2', null, 'Domande'));
      var qol = el('ol', 'qs');
      s.questions.forEach(function (q) {
        var li = el('li', q.id === s.questionId ? 'cur' : null, q.text);
        if (q.id !== s.questionId) {
          var go = el('button', null, 'Vai');
          go.type = 'button';
          go.addEventListener('click', function () {
            if (!confirm('Passare a questa domanda? La raccolta si riapre. Risposte, temi e voti di ogni domanda restano nel foglio.')) return;
            run({ act: 'question', to: q.id }, go);
          });
          li.appendChild(go);
        }
        qol.appendChild(li);
      });
      more.appendChild(qol);
      more.appendChild(el('p', 'links', 'Aggiungi o modifica le domande nel foglio Domande.'));
    }

    more.appendChild(el('h2', null, 'Schermi'));
    var links = el('div', 'links');
    var dir = location.origin + location.pathname.replace(/[^\/]*$/, '');
    links.appendChild(document.createTextNode('Proiettore: '));
    links.appendChild(el('code', null, dir + 'proiettore_' + PERSONA + '.html'));
    links.appendChild(el('br'));
    links.appendChild(document.createTextNode('Partecipanti: '));
    links.appendChild(el('code', null, dir + 'voto_studente_' + PERSONA + '.html'));
    more.appendChild(links);

    var danger = el('div', 'danger');
    var rb = el('button', 'reset', 'Azzera la sessione');
    rb.type = 'button';
    rb.addEventListener('click', function () {
      if (!confirm('Sposta risposte, temi e voti di tutte le domande nei fogli Archivio, apre una nuova sessione e torna alla prima domanda. Procedere?')) return;
      run({ act: 'reset' }, rb);
    });
    danger.appendChild(rb);
    more.appendChild(danger);
    return more;
  }

  /* While a command runs every button is off, so a second tap cannot send a
     second command; the pressed one shows it is working. */
  function run(st, btn) {
    busy = true;
    Array.prototype.forEach.call(app.querySelectorAll('button'), function (b) { b.disabled = true; });
    btn.classList.add('working');
    var started = Date.now(), clock = null;
    if (st.act === 'analyze' && btn.classList.contains('avanti')) {
      var show = function () {
        fillAvanti(btn, '', 'Analisi in corso… ' + Math.round((Date.now() - started) / 1000) + ' s', 'Può richiedere fino a mezzo minuto');
      };
      show();
      clock = setInterval(show, 1000);
      say(status, '');
    } else {
      say(status, st.act === 'analyze' ? 'Analisi in corso, può richiedere qualche secondo…' : 'Eseguo…');
    }

    var call = st.act === 'analyze'  ? post({ action: 'analyze' })
             : st.act === 'next'     ? post({ action: 'question', to: 'next' })
             : st.act === 'question' ? post({ action: 'question', to: st.to })
             : st.act === 'reset'    ? post({ action: 'reset', confirm: 'RESET' })
             : post({ action: 'phase', to: st.to });

    call.then(function (res) {
      busy = false;
      clearInterval(clock);
      if (res.ok) {
        say(status, st.act === 'analyze' ? (res.themes.length + ' temi estratti. Controllali qui sopra.')
                  : st.act === 'reset'   ? 'Sessione azzerata.' : 'Fatto.', true);
      } else {
        if (wrongKey(res)) return;
        say(status, (res.error || 'Non riuscito.') + (res.fallback ? ' — ' + res.fallback : ''), false);
      }
      /* A successful command answers with the new state: no second request. */
      if (res.state) render(res.state); else tick();
    }).catch(function () {
      busy = false;
      clearInterval(clock);
      say(status, 'Nessuna risposta dal server. Controlla la connessione e riprova.', false);
      if (state) render(state);
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

  /* A poll that set off before a command must not redraw over its spinner. */
  function tick() {
    getState().then(function (s) { if (s.ok && !busy) render(s); }).catch(function () {});
  }

  /* Keeps the phone awake between steps: a locked screen in a pocket would
     mean unlocking and finding the page again in front of the room. The lock
     drops whenever the tab is hidden, so it is asked for again on return. */
  function keepAwake() {
    if (!navigator.wakeLock || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').catch(function () {});
  }
  document.addEventListener('visibilitychange', keepAwake);

  function askKey(why) {
    var box = el('div', 'card locked');
    if (why) box.appendChild(el('p', 'status err', why));
    box.appendChild(el('p', null, 'Questa pagina richiede la chiave facilitatore. La trovi nel foglio: menu EcoPsy → Mostra chiave e link.'));
    var input = el('input');
    input.type = 'password';
    input.setAttribute('aria-label', 'Chiave facilitatore');
    input.placeholder = 'chiave';
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
    app.appendChild(el('div', 'card loading', 'Collegamento…'));
    keepAwake();
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
