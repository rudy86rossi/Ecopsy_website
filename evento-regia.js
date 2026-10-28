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
  var NOW_TEXT_SUMMARY = {
    collecting: 'Il pubblico sta scrivendo',
    analysing:  'Scrittura della sintesi in corso',
    results:    'Sullo schermo: la sintesi'
  };

  function isLast(s) { return !s.round || s.round.n >= s.round.of; }
  function isSummary(s) { return s.type === 'sintesi'; }
  /* A `classifica`: the items most chosen in the poll before it, put in order by everyone. */
  function isRanking(s) { return s.type === 'classifica'; }
  function pageCount(s) { return s.summary ? s.summary.pages.length : 0; }

  function nowText(s) {
    if (isSummary(s)) {
      if (s.phase === 'collecting' && !s.question) return 'Scrivi la domanda';
      if (s.phase === 'results' && pageCount(s) > 1) return NOW_TEXT_SUMMARY.results + ', pagina ' + s.page + ' di ' + pageCount(s);
      return NOW_TEXT_SUMMARY[s.phase] || s.phase;
    }
    if (isRanking(s) && s.phase === 'voting') return 'Il pubblico sta mettendo in ordine le voci';
    return (s.poll && NOW_TEXT_POLL[s.phase]) || NOW_TEXT[s.phase] || s.phase;
  }

  /* A `sintesi` round: write the question, collect, then the summary goes on
     every screen at once and Avanti turns its pages. Null when the usual
     step applies (the next question, after the last page). */
  function summaryStep(s) {
    if (s.phase === 'collecting' && (!s.question || editing === s.questionId)) {
      return { label: s.question ? 'Mostra la domanda corretta' : 'Mostra la domanda',
               sub: 'Compare sullo schermo e sui telefoni', run: { act: 'text' } };
    }
    switch (s.phase) {
      case 'collecting':
        return s.responses
          ? { label: 'Chiudi e scrivi la sintesi', sub: 'La sintesi compare subito su tutti gli schermi', run: { act: 'analyze' } }
          : { label: 'Chiudi e scrivi la sintesi', sub: 'Aspetta le prime risposte' };
      case 'analysing':
        return { label: 'Sintesi in corso…', sub: 'Può richiedere fino a un minuto' };
      case 'results':
        if (s.page < pageCount(s)) {
          return { label: 'Pagina ' + (s.page + 1) + ' di ' + pageCount(s),
                   sub: 'Il seguito della sintesi', run: { act: 'page', to: s.page + 1 } };
        }
    }
    return null;
  }

  /* The next step of the round: { label, sub, run } — run is absent when
     Avanti cannot be pressed, and `sub` then says why. */
  function nextStep(s) {
    var own = isSummary(s) && summaryStep(s);
    if (own) return own;
    if (s.phase === 'results') {
      if (isLast(s)) return { label: 'Sessione conclusa', sub: 'Puoi aggiungere una domanda qui sopra' };
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
        if (isRanking(s)) {
          return s.ballots
            ? { label: 'Chiudi e mostra la classifica', sub: 'La classifica del gruppo compare sullo schermo', run: { to: 'results' } }
            : { label: 'Chiudi e mostra la classifica', sub: 'Aspetta le prime classifiche' };
        }
        return { label: 'Chiudi e mostra i voti', sub: 'La classifica compare sullo schermo', run: { to: 'results' } };
    }
    return null;
  }

  /* One step back. Analysing → collecting rescues an analysis that never came back. */
  function prevStep(s) {
    if (s.poll) return s.phase === 'results' ? { label: 'Riapri la raccolta', run: { to: 'collecting' } } : null;
    if (isRanking(s)) return s.phase === 'results' ? { label: 'Riapri la votazione', run: { to: 'voting' } } : null;
    if (isSummary(s)) {
      if (s.phase === 'results' && s.page > 1) return { label: 'Pagina precedente', run: { act: 'page', to: s.page - 1 } };
      if (s.phase === 'results' || s.phase === 'analysing') return { label: 'Riapri la raccolta', run: { to: 'collecting' } };
      return null;
    }
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

  /* A classifica opens on its vote: its items come from the poll before it. */
  var RANKING_STEPS = [
    { n: 1, to: 'voting',     label: 'Riapri la votazione',     sub: 'I partecipanti possono mettere in ordine le voci', from: ['results'] },
    { n: 2, to: 'results',    label: 'Chiudi e mostra la classifica', sub: 'La classifica compare sullo schermo', from: ['voting'] },
    { n: 3, act: 'next',      label: 'Domanda successiva',      sub: 'Nuovo giro: si riparte dalla raccolta', from: ['voting', 'results'] }
  ];

  /* A summary round: Rigenera writes a new summary from the same answers. The
     sheet's summary (typed by hand when the model fails) can be shown
     without one. Both need the question written. */
  var SUMMARY_STEPS = [
    { n: 1, to: 'collecting', label: 'Apri la raccolta',        sub: 'I partecipanti possono scrivere', from: ['results', 'analysing'] },
    { n: 2, act: 'analyze',   label: 'Chiudi e scrivi la sintesi', sub: 'La sintesi compare subito su tutti gli schermi', from: ['collecting'], needsText: true },
    { n: 3, act: 'analyze',   label: 'Rigenera la sintesi',     sub: 'Riscritta dalle stesse risposte; la precedente resta nel foglio Sintesi', from: ['results'], again: true },
    { n: 4, to: 'results',    label: 'Mostra la sintesi del foglio', sub: 'Quella scritta a mano nel foglio Sintesi', from: ['collecting'], needsText: true },
    { n: 5, act: 'next',      label: 'Domanda successiva',      sub: 'Nuovo giro: si riparte dalla raccolta', from: ['collecting', 'results'] }
  ];

  var SKIP_CONFIRM = 'Passare alla domanda successiva senza arrivare ai risultati? Le risposte di questa domanda restano nel foglio.';

  var busy = false, state = null, timer = null, moreOpen = false, pdfCard = null;

  /* The scaletta picked in "Nuova sessione", kept across the redraw. */
  var resetPick = null;

  /* The question being typed for a summary round, and the new question at the
     end of the session. Created once and re-attached on each render, so the
     redraw every few seconds keeps what is being typed. `editing` is the id of
     a written question being corrected (until its first answer). */
  var qbox = null, addBox = null, editing = null;
  var MAX_QUESTION = 300;

  /* Created once and re-attached on each render: rebuilding it would erase the
     confirmation of the action that just ran. */
  var status = el('div', 'status');
  status.setAttribute('role', 'status');

  function render(s) {
    state = s;
    if (editing && (editing !== s.questionId || s.responses || s.phase !== 'collecting')) { editing = null; qbox = null; }
    titleEl.textContent = s.title || 'Sessione live';
    app.textContent = '';

    /* — what is happening now — */
    var head = el('div', 'card nowcard');
    var curq = el('div', 'curq');
    if (s.round) curq.appendChild(el('span', 'round', 'Domanda ' + s.round.n + ' di ' + s.round.of));
    if (s.question) curq.appendChild(document.createTextNode(s.question));
    else curq.appendChild(el('span', 'unwritten', 'Domanda da scrivere qui sotto'));
    head.appendChild(curq);
    head.appendChild(el('div', 'nowtext', nowText(s)));
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
    /* A typo can be fixed until the first answer arrives. */
    if (isSummary(s) && s.phase === 'collecting' && s.question && !s.responses && editing !== s.questionId) {
      var fix = el('button', 'skip', 'Correggi la domanda');
      fix.type = 'button';
      fix.addEventListener('click', function () { editing = s.questionId; qbox = null; render(state); });
      head.appendChild(fix);
    }
    app.appendChild(head);

    if (atStart(s)) app.appendChild(setsCard(s));
    if (isSummary(s) && s.phase === 'collecting' && (!s.question || editing === s.questionId)) app.appendChild(questionBox(s));
    if (isLast(s) && s.phase === 'results') app.appendChild(addCard());

    /* — what the facilitator checks before pressing Avanti — */
    if (!s.poll && (s.phase === 'themes' || s.phase === 'voting') && s.themes.length) app.appendChild(themesCard(s));
    if (s.poll && s.poll.results) app.appendChild(pollCard(s));
    if (s.phase === 'results' && s.results) app.appendChild(rankingCard(s));
    if (isSummary(s) && s.phase === 'results') app.appendChild(summaryCard(s));

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
      if (nxt.run) go.addEventListener('click', function () {
        var st = withText(nxt.run);
        if (st) run(st, go);
      });
      row.appendChild(go);
    }

    inner.appendChild(row);
    bar.appendChild(inner);
    app.appendChild(bar);
  }

  /* Before the first answer of a session, the question set can still be
     swapped: nothing has to be archived. */
  function atStart(s) {
    return !!s.scalette && s.scalette.length > 1 && !!s.round && s.round.n === 1 &&
      s.phase === 'collecting' && !s.responses;
  }

  /* The scalette of the Domande tab: picking one starts the session on it. */
  function setsCard(s) {
    var card = el('div', 'card');
    card.appendChild(el('h2', null, 'Scaletta della sessione'));
    var list = el('div', 'steps');
    s.scalette.forEach(function (sc) {
      var cur = sc.name === s.scaletta;
      var b = el('button', 'step' + (cur ? ' next' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'n', String(sc.count)));
      var body = el('div');
      body.appendChild(document.createTextNode(sc.name));
      body.appendChild(el('span', 'sub', (sc.count === 1 ? '1 domanda' : sc.count + ' domande') +
        (cur ? ' · in uso' : ' · tocca per usarla')));
      b.appendChild(body);
      if (cur) b.setAttribute('aria-current', 'true');
      else b.addEventListener('click', function () { run({ act: 'reset', scaletta: sc.name }, b); });
      list.appendChild(b);
    });
    card.appendChild(list);
    card.appendChild(el('p', 'links', 'Si può cambiare finché non arriva la prima risposta.'));
    return card;
  }

  /* Avanti on "Mostra la domanda" sends what is in the question box. */
  function withText(st) {
    if (st.act !== 'text') return st;
    var t = qbox ? qbox.box.value() : '';
    if (!t) {
      say(status, 'Scrivi prima la domanda.', false);
      if (qbox) qbox.box.ta.focus();
      return null;
    }
    return { act: 'text', text: t };
  }

  /* A textarea with a character counter. value() is the text on one line. */
  function textBox(placeholder) {
    var wrap = el('div', 'qform');
    var ta = el('textarea');
    ta.maxLength = MAX_QUESTION;
    ta.rows = 3;
    ta.placeholder = placeholder;
    var count = el('div', 'count');
    function upd() { count.textContent = ta.value.length + ' / ' + MAX_QUESTION; }
    ta.addEventListener('input', upd);
    upd();
    wrap.appendChild(ta);
    wrap.appendChild(count);
    return {
      node: wrap, ta: ta,
      value: function () { return ta.value.replace(/\s+/g, ' ').trim(); },
      set: function (v) { ta.value = v; upd(); }
    };
  }

  /* A kept card was switched off with the rest of the page by the last command. */
  function revive(card) {
    Array.prototype.forEach.call(card.querySelectorAll('button'), function (b) {
      b.disabled = false;
      b.classList.remove('working');
    });
    return card;
  }

  function questionBox(s) {
    if (qbox && qbox.qid === s.questionId) return revive(qbox.card);
    var card = el('div', 'card qcard');
    card.appendChild(el('h2', null, s.question ? 'Correggi la domanda' : 'Scrivi la domanda'));
    var box = textBox('La domanda per il pubblico');
    if (s.question) box.set(s.question);
    card.appendChild(box.node);
    card.appendChild(el('p', 'links', 'Compare sullo schermo e sui telefoni quando premi Avanti. Si può correggere finché non arriva la prima risposta.'));
    if (s.question) {
      var cancel = el('button', 'skip', 'Annulla la correzione');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { editing = null; qbox = null; render(state); });
      card.appendChild(cancel);
    }
    qbox = { qid: s.questionId, card: card, box: box };
    return card;
  }

  /* At the end of the session: one more question, always with a summary.
     Closed, it is one large button; open, the question box. */
  function addCard() {
    if (addBox) return revive(addBox.card);
    var card = el('div', 'card addcard');
    var open = el('button', 'addopen');
    open.type = 'button';
    open.appendChild(el('span', 'v', '+ Nuova domanda'));
    open.appendChild(el('span', 's', 'Risposte libere e una sintesi su tutti gli schermi'));
    var form = el('div', 'addform');
    form.hidden = true;
    form.appendChild(el('h2', null, 'Nuova domanda'));
    var box = textBox('La domanda per il pubblico');
    form.appendChild(box.node);
    form.appendChild(el('p', 'links', 'Compare subito sullo schermo e sui telefoni, e la raccolta si apre.'));
    var row = el('div', 'addrow');
    var add = el('button', 'addgo');
    add.type = 'button';
    add.appendChild(el('span', 'v', 'Aggiungi e mostra'));
    var cancel = el('button', 'skip', 'Annulla');
    cancel.type = 'button';
    row.appendChild(add);
    row.appendChild(cancel);
    form.appendChild(row);
    card.appendChild(open);
    card.appendChild(form);

    open.addEventListener('click', function () { open.hidden = true; form.hidden = false; box.ta.focus(); });
    cancel.addEventListener('click', function () { form.hidden = true; open.hidden = false; });
    add.addEventListener('click', function () {
      var t = box.value();
      if (!t) { say(status, 'Scrivi prima la domanda.', false); box.ta.focus(); return; }
      run({ act: 'add', text: t }, add);
    });
    addBox = { card: card };
    return card;
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
    if (isSummary(s)) {
      return s.question && s.phase !== 'analysing' ? { n: s.responses, what: plural(s.responses, 'risposta', 'risposte') } : null;
    }
    if (s.phase === 'collecting') return { n: s.responses, what: plural(s.responses, 'risposta', 'risposte') };
    if (s.phase === 'themes') return { n: s.themes.length, what: plural(s.themes.length, 'tema', 'temi') };
    if (s.poll && s.phase === 'results') return { n: s.responses, what: plural(s.responses, 'risposta', 'risposte') };
    if (isRanking(s)) return { n: s.ballots, what: plural(s.ballots, 'classifica', 'classifiche') };
    if (s.phase === 'voting' || s.phase === 'results') return { n: s.ballots, what: plural(s.ballots, 'voto', 'voti') };
    return null;
  }

  function themesCard(s) {
    var tc = el('div', 'card');
    tc.appendChild(el('h2', null, (isRanking(s) ? 'Voci da mettere in ordine (' : 'Temi (') + s.themes.length + ')'));
    var ol = el('ol', 'themes');
    s.themes.forEach(function (t) {
      var li = el('li');
      li.appendChild(el('span', 'label', t.label));
      if (t.description) li.appendChild(el('div', 'desc', t.description));
      ol.appendChild(li);
    });
    tc.appendChild(ol);
    tc.appendChild(el('p', 'links', isRanking(s)
      ? 'Le più scelte nel sondaggio precedente. Sono nel foglio Temi.'
      : 'Correggili nel foglio Temi: la pagina di voto legge quello, non il modello.'));
    return tc;
  }

  /* With a fixed number of choices (`pick`): most chosen first, the first
     `pick` marked (a classifica after the poll ranks them), and a tie at the
     cut named, since the sheet order then decides. */
  function pollCard(s) {
    var pick = s.poll.pick;
    var rows = s.poll.results;
    if (pick) {
      rows = rows.map(function (r, i) { return { r: r, i: i }; })
        .sort(function (a, b) { return b.r.count - a.r.count || a.i - b.i; })
        .map(function (x) { return x.r; });
    }
    var pc = el('div', 'card');
    pc.appendChild(el('h2', null, 'Risultati'));
    var cut = pick && rows.length > pick ? rows[pick - 1].count : null;
    if (cut !== null && rows[pick].count === cut) {
      var tied = rows.filter(function (r) { return r.count === cut; }).map(function (r) { return r.option; });
      pc.appendChild(el('p', 'links', 'Pari merito al ' + pick + 'º posto (' + cut + (cut === 1 ? ' scelta' : ' scelte') + '): ' +
        tied.join(', ') + '. Passano quelle più in alto nel foglio Domande.'));
    }
    var ol = el('ol', 'themes');
    rows.forEach(function (r, i) {
      var li = el('li', pick && i >= pick ? 'out' : null);
      li.appendChild(el('span', 'label', r.option));
      li.appendChild(el('div', 'desc', r.count + ' · ' + Math.round(r.share * 100) + '%' +
        (pick && i < pick ? ' · va in classifica' : '')));
      ol.appendChild(li);
    });
    pc.appendChild(ol);
    return pc;
  }

  /* The summary as the room reads it, with the page on the projector marked. */
  function summaryCard(s) {
    var sc = el('div', 'card summary');
    sc.appendChild(el('h2', null, 'Sintesi'));
    if (!s.summary) {
      sc.appendChild(el('p', 'links', 'Nessuna sintesi per questa domanda: rigenerala da Altri comandi, o scrivila nel foglio Sintesi.'));
      return sc;
    }
    sc.appendChild(el('div', 'stitle', s.summary.title));
    var many = s.summary.pages.length > 1;
    s.summary.pages.forEach(function (idx, i) {
      var on = i + 1 === s.page;
      var pg = el('div', 'spage' + (many && on ? ' on' : ''));
      if (many) pg.appendChild(el('div', 'pn', 'Pagina ' + (i + 1) + (on ? ' · sullo schermo' : '')));
      idx.forEach(function (k) { pg.appendChild(el('p', null, s.summary.paragraphs[k])); });
      sc.appendChild(pg);
    });
    sc.appendChild(el('p', 'links', 'Il testo è nel foglio Sintesi. Per riscriverlo: Altri comandi → Rigenera la sintesi.'));
    return sc;
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
    (s.poll ? POLL_STEPS : isSummary(s) ? SUMMARY_STEPS : isRanking(s) ? RANKING_STEPS : STEPS).forEach(function (st) {
      var b = el('button', 'step');
      b.type = 'button';
      b.appendChild(el('span', 'n', String(st.n)));
      var body = el('div');
      body.appendChild(document.createTextNode(st.label));
      body.appendChild(el('span', 'sub', st.sub));
      b.appendChild(body);
      b.disabled = st.from.indexOf(s.phase) === -1 || (st.act === 'next' && isLast(s)) || (st.needsText && !s.question);
      b.addEventListener('click', function () {
        if (st.again && !confirm('Riscrivere la sintesi dalle stesse risposte? Quella attuale resta nel foglio Sintesi.')) return;
        if (st.act === 'analyze' && !st.again && !confirm('Chiudere la raccolta e analizzare le risposte di ' + s.responses + ' partecipanti?')) return;
        if (st.act === 'next' && s.phase !== 'results' && !confirm(SKIP_CONFIRM)) return;
        run(st, b);
      });
      steps.appendChild(b);
    });
    more.appendChild(steps);

    /* — the rounds, from the Domande tab; any of them can be put on screen — */
    if (s.questions && s.questions.length > 1) {
      more.appendChild(el('h2', null, s.scaletta ? 'Domande · ' + s.scaletta : 'Domande'));
      var qol = el('ol', 'qs');
      s.questions.forEach(function (q) {
        var li = el('li', q.id === s.questionId ? 'cur' : null, q.text || '(da scrivere in sala)');
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

    /* — a new session, on any scaletta — */
    var danger = el('div', 'danger');
    var many = s.scalette && s.scalette.length > 1;
    var pick = null;
    if (many) {
      if (!resetPick || !s.scalette.some(function (sc) { return sc.name === resetPick; })) resetPick = s.scaletta;
      pick = el('select', 'resetpick');
      pick.setAttribute('aria-label', 'Scaletta della nuova sessione');
      s.scalette.forEach(function (sc) {
        var o = el('option', null, sc.name + (sc.count === 1 ? ' (1 domanda)' : ' (' + sc.count + ' domande)'));
        o.value = sc.name;
        pick.appendChild(o);
      });
      pick.value = resetPick;
      pick.addEventListener('change', function () { resetPick = pick.value; });
      danger.appendChild(pick);
    }
    var rb = el('button', 'reset', 'Nuova sessione');
    rb.type = 'button';
    rb.addEventListener('click', function () {
      var name = pick ? pick.value : '';
      if (!confirm('Sposta risposte, temi e voti di tutte le domande nei fogli Archivio, apre una nuova sessione' +
        (name ? ' con la scaletta ' + name : '') + ' e torna alla prima domanda. Procedere?')) return;
      run({ act: 'reset', scaletta: name || undefined }, rb);
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
      var summary = state && isSummary(state);
      var show = function () {
        fillAvanti(btn, '', (summary ? 'Sintesi in corso… ' : 'Analisi in corso… ') + Math.round((Date.now() - started) / 1000) + ' s',
          summary ? 'Può richiedere fino a un minuto' : 'Può richiedere fino a mezzo minuto');
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
             : st.act === 'reset'    ? post({ action: 'reset', confirm: 'RESET', scaletta: st.scaletta })
             : st.act === 'text'     ? post({ action: 'question-text', id: state.questionId, text: st.text })
             : st.act === 'add'      ? post({ action: 'add-question', text: st.text })
             : st.act === 'page'     ? post({ action: 'page', to: st.to })
             : post({ action: 'phase', to: st.to });

    call.then(function (res) {
      busy = false;
      clearInterval(clock);
      if (res.ok) {
        if (st.act === 'text') { qbox = null; editing = null; }
        if (st.act === 'add') addBox = null;
        if (st.act === 'reset') resetPick = null;
        say(status, st.act === 'analyze' ? (res.summary ? 'Sintesi sullo schermo.' : res.themes.length + ' temi estratti. Controllali qui sopra.')
                  : st.act === 'reset'   ? (res.scaletta ? 'Nuova sessione: ' + res.scaletta + '.' : 'Nuova sessione.')
                  : st.act === 'text'    ? 'Domanda sullo schermo.'
                  : st.act === 'add'     ? 'Nuova domanda sullo schermo: la raccolta è aperta.' : 'Fatto.', true);
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

  /* A poll that set off before a command must not redraw over its spinner,
     nor over a question being typed or a list being picked from: rebuilding
     the page would close the phone's keyboard or the list. The next poll
     after it loses focus redraws. */
  function tick() {
    getState().then(function (s) {
      if (!s.ok || busy) return;
      if (typing()) state = s; else render(s);
    }).catch(function () {});
  }
  function typing() {
    var a = document.activeElement;
    return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && app.contains(a);
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
    /* Outside #app, so the redraw every few seconds leaves a running download alone. */
    if (window.EventoRisultati && !pdfCard) {
      pdfCard = window.EventoRisultati.card(post, PERSONA);
      app.parentNode.appendChild(pdfCard);
    }
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
