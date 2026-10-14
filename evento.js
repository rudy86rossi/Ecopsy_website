(function () {
  'use strict';

  /* Each person has three pages (proiettore_<nome>, voto_studente_<nome>,
     operatore_<nome>) and their own sheet. The page says whose it is and what
     it shows in <body data-persona data-ruolo>; evento-config.js maps the
     person to their web app URL. */
  var PERSONA = document.body.dataset.persona || '';
  var URL_EXEC = (window.EVENTO_PERSONE || {})[PERSONA];
  var IS_SCREEN = document.body.dataset.ruolo === 'proiettore';
  /* Polls are answered from the server's cache, so the projector can ask often. */
  var POLL_MS = IS_SCREEN ? 2000 : 5000;

  var stage = document.getElementById('stage');
  var titleEl = document.getElementById('title');
  if (IS_SCREEN) document.body.classList.add('screen');

  /* ── transport ──────────────────────────────────────────────────────
     GET is a plain fetch with no custom headers, and POST declares
     text/plain even though the body is JSON. Both are CORS "simple"
     requests. Anything else triggers a preflight, and Apps Script has no
     doOptions to answer it — the request would get a 405 and never reach
     the script. Never mode:'no-cors': the response would be opaque and we
     could not tell a recorded vote from a thrown error. */
  function getState() {
    return fetch(URL_EXEC + '?t=' + Date.now()).then(function (r) { return r.json(); });
  }
  function post(body) {
    return fetch(URL_EXEC, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  /* Identifies this device so a re-submission replaces rather than doubles.
     Not an identity check, and does not need to be. */
  function voterId() {
    try {
      var v = localStorage.getItem('ecopsy-voter-' + PERSONA);
      if (!v) {
        v = 'v' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('ecopsy-voter-' + PERSONA, v);
      }
      return v;
    } catch (err) {
      if (!window._vid) window._vid = 'v' + Math.random().toString(36).slice(2, 10);
      return window._vid;
    }
  }
  /* Per session and question: moving to the next round, or a reset, must show
     the answer boxes again. A `testo` answer can be sent only once, so its
     marker survives a reload (localStorage); the others last for the tab. */
  function submittedKey(phase) {
    return 'ecopsy-' + PERSONA + '-' + (state ? state.session + '-' + state.questionId : '') + '-' + phase + '-done';
  }
  function store() { return state && state.type === 'testo' ? localStorage : sessionStorage; }
  function markDone(phase) { try { store().setItem(submittedKey(phase), '1'); } catch (e) {} }
  function isDone(phase) { try { return store().getItem(submittedKey(phase)) === '1'; } catch (e) { return false; } }
  function clearDone(phase) { try { store().removeItem(submittedKey(phase)); } catch (e) {} }

  /* Where participants join: the same person's phone page, next to this one. */
  var JOIN_URL = location.origin + location.pathname.replace(/[^\/]*$/, '') + 'voto_studente_' + PERSONA + '.html';

  function qrNode(cls) {
    var box = el('div', cls);
    if (!window.qrcode) return box;
    var qr = window.qrcode(0, 'M');
    qr.addData(JOIN_URL);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    return box;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ── views ─────────────────────────────────────────────────────────── */

  var state = null, lastRev = null, picked = [];

  function render(s) {
    titleEl.textContent = s.title || 'Sessione live';
    if (IS_SCREEN && updateCloud(s)) return;
    live = null;
    stage.textContent = '';
    var view = IS_SCREEN ? screenView : phoneView;
    view(s);
  }

  /* — phone — */
  function phoneView(s) {
    if (s.poll) {
      if (s.phase === 'results') return resultsCard(s);
      return isDone('answer') ? waitCard(s, 'Risposta inviata', 'Puoi cambiarla finché la raccolta è aperta.', 'answer') : pollCard(s);
    }
    if (s.phase === 'collecting' && s.type === 'testo') {
      if (!isDone('answer')) return textCard(s);
      var first = alreadyAnswered;
      alreadyAnswered = false;
      return waitCard(s, first ? 'Avevi già risposto' : 'Risposta inviata',
        first ? 'Vale la prima risposta che hai inviato a questa domanda.' : 'Grazie! Le risposte vengono raccolte e poi raggruppate in temi.');
    }
    if (s.phase === 'collecting') return isDone('answer') ? waitCard(s, 'Risposta inviata', 'Guarda lo schermo: le parole compaiono man mano.') : answerCard(s);
    if (s.phase === 'analysing')  return waitCard(s, 'Analisi in corso', 'Stiamo raggruppando le risposte in temi.');
    if (s.phase === 'themes')     return themesPreview(s);
    if (s.phase === 'voting')     return isDone('vote') ? waitCard(s, 'Voto registrato', 'Puoi cambiarlo finché la votazione è aperta.', 'vote') : voteCard(s);
    if (s.phase === 'results')    return resultsCard(s);
  }

  function roundLabel(s) {
    return s.round && s.round.of > 1 ? 'Domanda ' + s.round.n + ' di ' + s.round.of : '';
  }

  /* One short idea per box: each box is one entry in the word cloud, kept
     whole, so "social media" stays together. */
  function answerCard(s) {
    var card = el('div', 'card');
    if (roundLabel(s)) card.appendChild(el('div', 'round', roundLabel(s)));
    card.appendChild(el('div', 'question', s.question));
    var n = s.answerFields || 1;
    if (n > 1) card.appendChild(el('p', 'hint', 'Un’idea per casella, in poche parole. Puoi riempirne anche solo una.'));

    var inputs = [];
    for (var i = 0; i < n; i++) {
      var inp = el('input', 'idea');
      inp.type = 'text';
      inp.setAttribute('maxlength', '80');
      inp.setAttribute('enterkeyhint', i < n - 1 ? 'next' : 'send');
      inp.setAttribute('aria-label', n > 1 ? 'Idea ' + (i + 1) : 'La tua risposta');
      inp.placeholder = n > 1 ? 'Idea ' + (i + 1) + (i ? ' (facoltativa)' : '') : 'Scrivi qui…';
      card.appendChild(inp);
      inputs.push(inp);
    }
    inputs.forEach(function (inp, i) {
      inp.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i < inputs.length - 1) inputs[i + 1].focus(); else btn.click();
      });
    });

    var btn = el('button', 'act', 'Invia');
    var status = el('div', 'status');
    status.setAttribute('role', 'status');
    card.appendChild(btn);
    card.appendChild(status);

    btn.addEventListener('click', function () {
      var items = inputs.map(function (x) { return x.value.trim(); }).filter(Boolean);
      if (!items.length) { status.className = 'status err'; status.textContent = 'Scrivi qualcosa prima di inviare.'; return; }
      send({ action: 'submit', items: items }, 'answer', btn, inputs, status);
    });

    stage.appendChild(card);
    inputs[0].focus();
  }

  /* A `testo` question: one free answer, a few sentences, sent once. */
  function textCard(s) {
    var max = s.maxLength || 500;
    var card = el('div', 'card');
    if (roundLabel(s)) card.appendChild(el('div', 'round', roundLabel(s)));
    card.appendChild(el('div', 'question', s.question));
    card.appendChild(el('p', 'hint', 'Scrivi liberamente, anche più frasi. Puoi inviare una sola risposta.'));

    var ta = el('textarea', 'idea long');
    ta.setAttribute('maxlength', String(max));
    ta.setAttribute('rows', '5');
    ta.setAttribute('aria-label', 'La tua risposta');
    ta.placeholder = 'Scrivi qui…';
    var count = el('div', 'count', '0 / ' + max);
    /* Grows with the text, so a long answer can be read back before sending. */
    ta.addEventListener('input', function () {
      count.textContent = ta.value.length + ' / ' + max;
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 2 + 'px';
    });
    card.appendChild(ta);
    card.appendChild(count);

    var btn = el('button', 'act', 'Invia');
    var status = el('div', 'status');
    status.setAttribute('role', 'status');
    card.appendChild(btn);
    card.appendChild(status);
    btn.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { status.className = 'status err'; status.textContent = 'Scrivi qualcosa prima di inviare.'; return; }
      send({ action: 'submit', items: [text] }, 'answer', btn, [ta], status);
    });

    stage.appendChild(card);
    ta.focus();
  }

  /**
   * Sends an answer or a vote, and shows at every moment that something is
   * happening: a request takes 3–6 s, and a grey button with nothing else
   * looks like a dead tap. The button turns into a spinner and the form locks;
   * then either the ✓ screen, or a red message with the form unlocked and the
   * text still in it.
   *
   * A send whose reply never arrived is tried once more by itself. It carries
   * the same sendId, so if the first attempt was written after all the server
   * skips the second.
   */
  var justSent = false, alreadyAnswered = false;

  function send(body, what, btn, fields, status) {
    body.voterId = voterId();
    body.sendId = 's' + Math.random().toString(36).slice(2, 12);
    var label = btn.textContent;
    var slow = null;

    function lock(on) {
      btn.disabled = on;
      btn.classList.toggle('working', on);
      btn.textContent = on ? 'Invio in corso…' : label;
      fields.forEach(function (f) { f.disabled = on; });
    }
    function say(msg, cls) { status.className = 'status' + (cls ? ' ' + cls : ''); status.textContent = msg; }
    function fail(msg) { clearTimeout(slow); lock(false); say(msg, 'err'); }

    lock(true);
    say('');
    slow = setTimeout(function () { say('Connessione lenta, ancora un momento…'); }, 8000);

    function attempt(retry) {
      post(body).then(function (res) {
        clearTimeout(slow);
        if (!res.ok) return fail('Non inviata: ' + (res.error || 'errore del server') + '.');
        markDone(what);
        justSent = true;
        alreadyAnswered = !!res.already;
        if (navigator.vibrate) { try { navigator.vibrate(40); } catch (e) {} }
        render(state);
      }).catch(function () {
        if (retry) {
          say('Connessione lenta, riprovo…');
          setTimeout(function () { attempt(false); }, 1500);
        } else {
          fail('La risposta non è arrivata. Controlla la connessione e tocca di nuovo Invia.');
        }
      });
    }
    attempt(true);
  }

  /* `change` names what can still be changed: 'vote', or 'answer' for a poll. */
  function waitCard(s, head, sub, change) {
    var card = el('div', 'card done' + (justSent ? ' pop' : ''));
    justSent = false;
    card.appendChild(el('div', 'tick', '✓'));
    card.appendChild(el('h2', null, head));
    card.appendChild(el('p', null, sub));
    if (change) {
      var b = el('button', 'act', change === 'vote' ? 'Cambia il mio voto' : 'Cambia la mia risposta');
      b.addEventListener('click', function () {
        clearDone(change);
        render(state);
      });
      card.appendChild(b);
    }
    stage.appendChild(card);
  }

  function themesPreview(s) {
    var card = el('div', 'card');
    card.appendChild(el('div', 'question', 'Temi emersi'));
    card.appendChild(el('p', 'hint', 'La votazione si apre fra un momento.'));
    s.themes.forEach(function (t) {
      var row = el('div', 'theme');
      row.appendChild(el('span', 'badge', '•'));
      var body = el('div');
      body.appendChild(el('div', 'label', t.label));
      if (t.description) body.appendChild(el('div', 'desc', t.description));
      row.appendChild(body);
      card.appendChild(row);
    });
    stage.appendChild(card);
  }

  function voteCard(s) {
    picked = [];
    var card = el('div', 'card');
    card.appendChild(el('div', 'question', 'Quali temi vale la pena approfondire?'));
    card.appendChild(el('p', 'hint', 'Tocca i temi in ordine di preferenza, fino a ' + s.topN +
      '. Tocca di nuovo per togliere. Puoi sceglierne anche meno.'));

    var btn = el('button', 'act', 'Invia');
    var status = el('div', 'status');
    status.setAttribute('role', 'status');

    var buttons = s.themes.map(function (t) {
      var row = el('button', 'theme');
      row.type = 'button';
      row.setAttribute('aria-pressed', 'false');
      var badge = el('span', 'badge', '–');
      var body = el('div');
      body.appendChild(el('div', 'label', t.label));
      if (t.description) body.appendChild(el('div', 'desc', t.description));
      row.appendChild(badge);
      row.appendChild(body);

      row.addEventListener('click', function () {
        var at = picked.indexOf(t.id);
        if (at !== -1) picked.splice(at, 1);
        else if (picked.length < s.topN) picked.push(t.id);
        else { status.className = 'status'; status.textContent = 'Hai già scelto ' + s.topN + ' temi. Togline uno per cambiarli.'; return; }
        status.textContent = '';
        paint();
      });
      card.appendChild(row);
      return { id: t.id, row: row, badge: badge };
    });

    function paint() {
      buttons.forEach(function (b) {
        var at = picked.indexOf(b.id);
        b.row.setAttribute('aria-pressed', at !== -1 ? 'true' : 'false');
        b.badge.textContent = at !== -1 ? String(at + 1) : '–';
      });
      btn.disabled = picked.length === 0;
    }

    btn.disabled = true;
    card.appendChild(btn);
    card.appendChild(status);

    btn.addEventListener('click', function () {
      send({ action: 'ballot', ranking: picked }, 'vote', btn,
        buttons.map(function (b) { return b.row; }), status);
    });

    stage.appendChild(card);
  }

  /* A poll: tap to choose, tap again to clear. With several choices allowed,
     an exclusive option ("No") clears the others and any other clears it. */
  function pollCard(s) {
    var p = s.poll;
    picked = [];
    var card = el('div', 'card');
    if (roundLabel(s)) card.appendChild(el('div', 'round', roundLabel(s)));
    card.appendChild(el('div', 'question', s.question));
    card.appendChild(el('p', 'hint', p.multiple ? 'Puoi sceglierne più di una.' : 'Scegline una.'));

    var btn = el('button', 'act', 'Invia');
    var status = el('div', 'status');
    status.setAttribute('role', 'status');

    var buttons = p.options.map(function (o) {
      var row = el('button', 'theme opt');
      row.type = 'button';
      var badge = el('span', 'badge');
      row.appendChild(badge);
      row.appendChild(el('div', 'label', o));
      row.addEventListener('click', function () {
        var at = picked.indexOf(o);
        if (at !== -1) picked.splice(at, 1);
        else if (!p.multiple) picked = [o];
        else if (p.exclusive.indexOf(o) !== -1) picked = [o];
        else {
          picked = picked.filter(function (x) { return p.exclusive.indexOf(x) === -1; });
          picked.push(o);
        }
        paint();
      });
      card.appendChild(row);
      return { option: o, row: row, badge: badge };
    });

    function paint() {
      buttons.forEach(function (b) {
        var on = picked.indexOf(b.option) !== -1;
        b.row.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.badge.textContent = on ? '✓' : '';
      });
      btn.disabled = picked.length === 0;
    }
    paint();

    card.appendChild(btn);
    card.appendChild(status);
    btn.addEventListener('click', function () {
      send({ action: 'submit', items: picked }, 'answer', btn,
        buttons.map(function (b) { return b.row; }), status);
    });

    stage.appendChild(card);
  }

  function resultsCard(s) {
    var card = el('div', 'card');
    card.appendChild(el('div', 'question', s.poll ? s.question : 'Risultati'));
    card.appendChild(s.poll ? pollResults(s) : resultsList(s));
    stage.appendChild(card);
  }

  /* — projector — */
  /* Created once: the corner QR stays put while the stage redraws. */
  var corner = null;
  function showCorner(on) {
    if (on && !corner) {
      corner = qrNode('qrcorner qr');
      corner.appendChild(el('div', 'cap', 'Partecipa'));
      document.body.appendChild(corner);
    }
    if (corner) corner.style.display = on ? '' : 'none';
    document.body.classList.toggle('hasqr', on);
  }

  function screenView(s) {
    /* The opening screen of each round: the question, and a QR large enough
       to scan from the back of the room. */
    var opening = s.phase === 'collecting' && !s.responses;
    showCorner(!opening && s.phase !== 'results');

    if (roundLabel(s)) stage.appendChild(el('div', 'round', roundLabel(s)));
    if (opening) {
      var join = el('div', 'join');
      join.appendChild(qrNode('qr'));
      var side = el('div', 'waiting');
      side.appendChild(document.createTextNode(s.question));
      var url = el('div', 'meta');
      url.appendChild(document.createTextNode('Inquadra il codice o apri '));
      url.appendChild(el('span', 'joinurl', JOIN_URL.replace(/^https?:\/\//, '')));
      side.appendChild(url);
      join.appendChild(side);
      stage.appendChild(join);
      return;
    }
    stage.appendChild(el('div', 'qline', s.question));
    if (s.poll) {
      /* While the poll is open the room sees the choices and how many have
         answered, never a running tally: on a personal question that would
         steer and expose the people still answering. */
      if (s.phase === 'results') {
        stage.appendChild(pollResults(s));
        return;
      }
      var opts = el('div');
      s.poll.options.forEach(function (o) {
        var row = el('div', 'theme opt');
        row.appendChild(el('span', 'badge', '•'));
        row.appendChild(el('div', 'label', o));
        opts.appendChild(row);
      });
      stage.appendChild(opts);
      stage.appendChild(el('div', 'meta', s.responses + (s.responses === 1 ? ' risposta' : ' risposte')));
      return;
    }
    /* Long answers never go on screen while they come in: nobody has read
       them yet, and anyone with the QR can type anything. The room sees them
       arrive as a count and one dot per person. */
    if (s.phase === 'collecting' && s.type === 'testo') {
      live = { kind: 'dots', qid: s.questionId, num: el('div', 'bignum'), box: el('div', 'dots'), n: 0 };
      stage.appendChild(live.num);
      stage.appendChild(live.box);
      drawDots(s.responses);
      return;
    }
    if (s.phase === 'collecting') {
      if (!s.cloud.length) {
        stage.appendChild(el('div', 'waiting', 'Le risposte stanno arrivando…'));
        stage.appendChild(el('div', 'meta', participants(s)));
        return;
      }
      live = { kind: 'cloud', qid: s.questionId, box: el('div', 'cloud'), meta: el('div', 'meta'), words: {} };
      stage.appendChild(live.box);
      stage.appendChild(live.meta);
      updateCloud(s);
      return;
    }
    if (s.phase === 'analysing') { stage.appendChild(el('div', 'waiting', 'Analisi in corso…')); return; }
    if (s.phase === 'themes' || s.phase === 'voting') {
      var wrap = el('div');
      s.themes.forEach(function (t) {
        var row = el('div', 'theme');
        row.appendChild(el('span', 'badge', '•'));
        var body = el('div');
        body.appendChild(el('div', 'label', t.label));
        if (t.description) body.appendChild(el('div', 'desc', t.description));
        row.appendChild(body);
        wrap.appendChild(row);
      });
      stage.appendChild(wrap);
      /* During voting the count is shown, never the tally: a bar chart that
         moves while people vote steers everyone who votes late. */
      stage.appendChild(el('div', 'meta', s.phase === 'voting'
        ? s.ballots + (s.ballots === 1 ? ' voto espresso' : ' voti espressi')
        : 'Votazione in apertura…'));
      return;
    }
    if (s.phase === 'results') {
      stage.appendChild(resultsList(s));
      stage.appendChild(el('div', 'meta', s.ballots + (s.ballots === 1 ? ' voto' : ' voti') + ' · ' + s.responses + ' partecipanti'));
    }
  }

  function resultsList(s) {
    var wrap = el('div');
    var rows = s.results || [];
    if (!rows.length) { wrap.appendChild(el('p', 'hint', 'Nessun voto registrato.')); return wrap; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.points; })) || 1;
    rows.forEach(function (r) {
      var box = el('div', 'res');
      var top = el('div', 'top');
      top.appendChild(el('div', 'label', r.label));
      top.appendChild(el('div', 'pts', r.points + ' punti · ' + r.firsts + ' primi posti'));
      box.appendChild(top);
      var bar = el('div', 'bar');
      var fill = el('i');
      fill.style.width = Math.round((r.points / max) * 100) + '%';
      bar.appendChild(fill);
      box.appendChild(bar);
      wrap.appendChild(box);
    });
    return wrap;
  }

  /* Shares are of the people who answered: with several choices allowed they add up to more than 100%. */
  function pollResults(s) {
    var wrap = el('div');
    var rows = s.poll.results || [];
    if (!s.responses) { wrap.appendChild(el('p', 'hint', 'Nessuna risposta registrata.')); return wrap; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; })) || 1;
    rows.forEach(function (r) {
      var box = el('div', 'res');
      var top = el('div', 'top');
      top.appendChild(el('div', 'label', r.option));
      top.appendChild(el('div', 'pts', r.count + ' · ' + Math.round(r.share * 100) + '%'));
      box.appendChild(top);
      var bar = el('div', 'bar');
      var fill = el('i');
      fill.style.width = Math.round((r.count / max) * 100) + '%';
      bar.appendChild(fill);
      box.appendChild(bar);
      wrap.appendChild(box);
    });
    wrap.appendChild(el('div', IS_SCREEN ? 'meta' : 'hint', s.responses + (s.responses === 1 ? ' risposta' : ' risposte') +
      (s.poll.multiple ? ' · una persona può indicarne più di una' : '')));
    return wrap;
  }

  function participants(s) {
    return s.responses + (s.responses === 1 ? ' partecipante' : ' partecipanti');
  }

  /**
   * Words flow rather than scatter: a spiral layout overlaps or overflows at
   * unpredictable counts, and on a projector that is the one thing that must
   * not happen. Size and colour carry the frequency.
   *
   * The cloud stays on screen between polls and is updated in place, so the
   * room sees it change: a new word pops in, a word written again swells and
   * glows, and the words around it glide to their new places instead of
   * jumping. Each word also drifts slowly on its own. A word keeps its place
   * once it is in; new ones land at a random spot.
   *
   * With twenty short answers every count is often 1. Rather than pretend
   * otherwise, the cloud then renders at one size and reads as a word list.
   */
  var live = null;   // { qid, box, meta, words: { entry: { node, inner, n } } }
  var CALM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* True when the cloud (or the dots) on screen was updated in place and nothing else needs drawing. */
  function updateCloud(s) {
    if (!live || live.qid !== s.questionId || s.phase !== 'collecting') return false;
    if (live.kind === 'dots') { drawDots(s.responses); return true; }
    if (!s.cloud.length) return false;
    live.meta.textContent = participants(s);
    drawWords(s.cloud);
    return true;
  }

  var MAX_DOTS = 300;
  function drawDots(n) {
    live.num.textContent = n + (n === 1 ? ' risposta' : ' risposte');
    if (n < live.n) { live.box.textContent = ''; live.n = 0; }
    for (var i = live.n; i < Math.min(n, MAX_DOTS); i++) {
      var d = el('span', 'dot');
      d.style.animationDelay = Math.min(i - live.n, 20) * 60 + 'ms';
      live.box.appendChild(d);
    }
    live.n = Math.max(live.n, Math.min(n, MAX_DOTS));
  }

  function drawWords(pairs) {
    var max = pairs[0][1], min = pairs[pairs.length - 1][1];
    var flat = max === min;

    /* Where every word is now, to animate from it once the layout has changed. */
    var before = {};
    Object.keys(live.words).forEach(function (k) { before[k] = live.words[k].node.getBoundingClientRect(); });

    var keep = {}, fresh = [], grown = [];
    pairs.forEach(function (p) {
      var word = p[0], n = p[1];
      keep[word] = true;
      var w = live.words[word];
      if (!w) {
        w = { node: el('span', 'w'), inner: el('span', 'f', word), n: 0 };
        w.inner.style.animationDuration = (5 + Math.random() * 4).toFixed(1) + 's';
        w.inner.style.animationDelay = (-Math.random() * 9).toFixed(1) + 's';
        w.node.appendChild(w.inner);
        var kids = live.box.children;
        live.box.insertBefore(w.node, kids[Math.floor(Math.random() * (kids.length + 1))] || null);
        live.words[word] = w;
        fresh.push(w);
      } else if (n > w.n) {
        grown.push(w);
      }
      w.n = n;
      var t = flat ? 0.45 : (n - min) / (max - min);
      w.node.style.fontSize = (1.5 + Math.pow(t, 0.7) * 4.4).toFixed(2) + 'rem';
      w.node.style.color = t > 0.66 ? '#ffffff' : t > 0.33 ? '#6fe0a0' : '#bff0d3';
      w.node.style.opacity = (0.6 + t * 0.4).toFixed(2);
      w.node.title = n + (n === 1 ? ' persona' : ' persone');
    });

    /* Entries that left the list: blocklist edited, or pushed past max_cloud_words. */
    Object.keys(live.words).forEach(function (k) {
      if (keep[k]) return;
      live.words[k].node.remove();
      delete live.words[k];
      delete before[k];
    });

    if (CALM || !live.box.animate) return;

    /* Glide: start each word where it was, at its old size, and let it settle. */
    Object.keys(before).forEach(function (k) {
      var w = live.words[k], a = before[k], b = w.node.getBoundingClientRect();
      var dx = a.left - b.left, dy = a.top - b.top, sc = b.height ? a.height / b.height : 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.01) return;
      w.node.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')' },
        { transform: 'none' }
      ], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });

    fresh.forEach(function (w, i) {
      w.inner.animate([
        { transform: 'scale(.2)', opacity: 0, textShadow: '0 0 30px rgba(111,224,160,.95)' },
        { transform: 'scale(1.18)', opacity: 1, offset: 0.55 },
        { transform: 'scale(1)', textShadow: '0 0 0 rgba(111,224,160,0)' }
      ], { duration: 900, delay: Math.min(i, 12) * 70, easing: 'ease-out', fill: 'backwards' });
    });

    grown.forEach(function (w) {
      w.inner.animate([
        { textShadow: '0 0 0 rgba(255,255,255,0)' },
        { textShadow: '0 0 28px rgba(255,255,255,.9)', offset: 0.3 },
        { textShadow: '0 0 0 rgba(255,255,255,0)' }
      ], { duration: 1600, easing: 'ease-out' });
    });
  }

  /* ── loop ──────────────────────────────────────────────────────────── */

  /* Shown the moment the page opens, until the first state arrives (2–5 s). */
  var loading = null, misses = 0;
  function showLoading() {
    loading = el('div', 'card loading');
    loading.appendChild(el('div', 'spinner'));
    loading.appendChild(el('p', null, 'Collegamento…'));
    stage.appendChild(loading);
  }

  function tick(force) {
    getState()
      .then(function (s) {
        if (!s.ok) return;
        loading = null;
        /* The projector redraws whenever anything changed. A phone must not:
           someone else submitting an answer moves `rev`, and a redraw would
           wipe a half-typed answer or a half-built ranking. It follows the
           phase (and the theme list) instead. */
        var stamp = IS_SCREEN ? s.rev : s.questionId + '|' + s.phase + '|' + s.themes.length;
        if (!force && stamp === lastRev) return;
        lastRev = stamp;
        state = s;
        render(s);
      })
      .catch(function () {
        /* A dropped poll on venue wifi is not worth a banner, unless nothing
           has loaded yet and the page would otherwise spin in silence. */
        if (loading && ++misses >= 2) loading.lastChild.textContent = 'Il collegamento è lento, riprovo…';
      });
  }

  if (!URL_EXEC || URL_EXEC.indexOf('INCOLLA') === 0) {
    stage.appendChild(el('div', 'card', 'Configura evento-config.js con l’URL /exec del web app di “' + PERSONA + '”.'));
  } else {
    showLoading();
    tick(true);
    setInterval(tick, POLL_MS);
  }
})();
