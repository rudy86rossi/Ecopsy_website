(function () {
  'use strict';

  /* The sessions of the sheet, listed on request on the facilitator page, and
     the results of each as a PDF built in the facilitator's browser: the
     projector's screens for each question (the poll result, the themes put to
     the vote, the final ranking, each page of a summary), one per page, after
     a page with the session's name. The list comes from the `sessions` action,
     the data from `export`; both need the facilitator key. The same screens
     come out of evento-live/estrai-dati.py; a change to one belongs in the other. */

  /* Loaded on the first click only: together they weigh over half a megabyte. */
  var LIBS = [
    ['https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
     'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA=='],
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
     'sha512-qZvrmS2ekKPF2mSznTQsxqPgnpkI4DNTlrdUmTzrDgektczlKNRRhy5X5AAOnx5S09ydFYWWNSfcEqDTTHgtNA==']
  ];
  var MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
                'settembre', 'ottobre', 'novembre', 'dicembre'];

  function loadLibs() {
    return LIBS.reduce(function (p, lib) {
      return p.then(function () {
        return new Promise(function (ok, fail) {
          var s = document.createElement('script');
          s.src = lib[0];
          s.integrity = lib[1];
          s.crossOrigin = 'anonymous';
          s.onload = ok;
          s.onerror = function () { fail(new Error('libreria non caricata')); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve());
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* A tab of the export, as objects keyed by the header row. */
  function rows(tabs, name) {
    var t = tabs[name] || [];
    var head = t[0] || [];
    return t.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : String(r[i]); });
      return o;
    });
  }

  /* The screens of one session (its id, the start time), in order:
     [{divider}|{screen}], as evento.js draws them. */
  function buildPages(tabs, session) {
    function inSession(r) { return (r.sessione || '').trim() === session; }
    var cfg = {};
    rows(tabs, 'Config').forEach(function (r) { cfg[r.chiave] = r.valore; });
    var topN = Math.max(1, Number(cfg.top_n) || 3);

    var domande = rows(tabs, 'Domande').filter(function (r) { return r.id; });
    /* The rounds of a session: the planned rows of its scaletta, then those added in it. */
    var text = {}, place = {}, polls = {}, summaries = {}, rankings = {}, planned = [], added = {}, setNames = [];
    function names(v) {
      return (v || '').split('|').map(function (x) { return x.trim(); }).filter(Boolean);
    }
    domande.forEach(function (r, i) {
      names(r.scaletta).forEach(function (n) {
        if (!setNames.some(function (m) { return m.toLowerCase() === n.toLowerCase(); })) setNames.push(n);
      });
      text[r.id] = r.domanda;
      place[r.id] = i + 1;
      if ((r.opzioni || '').trim()) {
        var many = (r.multipla || '').trim();
        /* Its options in sheet order, and how many each participant picks (0 = any). */
        polls[r.id] = { options: names(r.opzioni), pick: /^\d+$/.test(many) && Number(many) > 1 ? Number(many) : 0 };
      }
      if (/^class/i.test((r.tipo || '').trim())) rankings[r.id] = true;
      if (/^sint/i.test((r.tipo || '').trim())) summaries[r.id] = true;
      if ((r.origine || '').trim() === 'aggiunta') {
        var k = (r.sessione || '').trim();
        (added[k] = added[k] || []).push(r.id);
      } else {
        planned.push({ id: r.id, sets: names(r.scaletta).map(function (n) { return n.toLowerCase(); }) });
      }
    });

    /* The scaletta each session ran, from Cronologia. Sessions from before
       scalette existed ran the first one, as the server would today. */
    var setOf = {};
    rows(tabs, 'Cronologia').forEach(function (r) {
      if ((r.scaletta || '').trim()) setOf[r.sessione] = r.scaletta.trim();
    });
    function plannedFor(sess) {
      var use = (setOf[sess] || setNames[0] || '').toLowerCase();
      return planned.filter(function (q) { return !use || !q.sets.length || q.sets.indexOf(use) !== -1; })
        .map(function (q) { return q.id; });
    }

    /* The summary on screen: the last one written per session and question,
       with the question as it was asked (a `sintesi` row is rewritten in each session). */
    var summaryOf = {};
    rows(tabs, 'Sintesi').forEach(function (r) {
      if (!inSession(r) || !(r.testo || '').trim()) return;
      summaryOf[r.sessione + '|' + r.questionId] = r;
      summaries[r.questionId] = true;
    });

    /* The ranking saved each time a vote closed: the last one per session and question. */
    var saved = {};
    rows(tabs, 'Risultati').forEach(function (r) {
      if (!inSession(r)) return;
      var k = r.sessione + '|' + r.questionId;
      if (r.posizione === '1' || !saved[k]) saved[k] = [];
      saved[k].push(r);
      text[r.questionId] = r.domanda;
    });

    function pick(names) {
      return names.reduce(function (all, n) { return all.concat(rows(tabs, n)); }, [])
        .filter(function (r) { return inSession(r); });
    }
    var answers = pick(['Archivio risposte', 'Risposte']);
    var themes = pick(['Archivio temi', 'Temi']);
    var votes = pick(['Archivio voti', 'Voti']);

    var sessions = [];
    answers.forEach(function (r) { if (sessions.indexOf(r.sessione) === -1) sessions.push(r.sessione); });
    sessions.sort();
    var nameOf = {};
    rows(tabs, 'Sessioni').forEach(function (r) { nameOf[(r.sessione || '').trim()] = (r.nome || '').trim(); });

    var pages = [];
    sessions.forEach(function (sess, si) {
      var sAnswers = answers.filter(function (r) { return r.sessione === sess; });
      var first = sAnswers.map(function (r) { return r.timestamp.slice(11, 16); }).filter(Boolean).sort()[0];
      pages.push({ divider: true, n: si + 1, name: nameOf[sess] || '', day: sess.slice(0, 10), from: first || '',
                   scaletta: setNames.length ? setOf[sess] || setNames[0] : '' });

      /* A classifica has ballots and no answers. */
      var qids = [];
      sAnswers.concat(votes.filter(function (r) { return r.sessione === sess; }))
        .forEach(function (r) { if (qids.indexOf(r.questionId) === -1) qids.push(r.questionId); });
      qids.sort(function (a, b) { return (place[a] || 99) - (place[b] || 99) || (a < b ? -1 : 1); });
      var order = plannedFor(sess).concat(added[sess] || []);

      qids.forEach(function (qid) {
        var qa = sAnswers.filter(function (r) { return r.questionId === qid; });
        var qt = themes.filter(function (r) { return r.sessione === sess && r.questionId === qid; });
        var res = saved[sess + '|' + qid];
        var srow = summaryOf[sess + '|' + qid];
        var at = order.indexOf(qid);
        var base = { question: (srow && srow.domanda) || text[qid] || qid,
                     n: at !== -1 ? at + 1 : place[qid] || Number(qid.slice(1)) || 1,
                     of: Math.max(order.length, 1) };
        var isPoll = polls[qid] || (!domande.length && res && !res[0].themeId);

        if (summaries[qid]) {
          if (!srow) return;  // no summary was written: nothing was on screen
          var paras = srow.testo.split(/\s*\n\s*/).filter(Boolean);
          var people = {};
          qa.forEach(function (r) { people[r.voterId] = true; });
          var nPeople = Object.keys(people).length;
          var spages = pagesOf(paras);
          spages.forEach(function (idx, i) {
            pages.push(Object.assign({ kind: 'summary', title: srow.titolo,
              paragraphs: idx.map(function (k) { return paras[k]; }),
              meta: (spages.length > 1 ? 'Pagina ' + (i + 1) + ' di ' + spages.length + ' · ' : '') +
                    nPeople + (nPeople === 1 ? ' risposta' : ' risposte') }, base));
          });
          return;
        }

        if (isPoll) {
          var counts = [], total;
          if (res) {
            res.forEach(function (r) { counts.push([r.label, Number(r.punti) || 0]); });
            total = Number(res[0].schede) || 0;
          } else {
            /* Not closed: each device's latest submission, the rows sharing its time. */
            var latest = {};
            qa.forEach(function (r) {
              var cur = latest[r.voterId];
              if (!cur || r.timestamp > cur.at) latest[r.voterId] = { at: r.timestamp, items: [r.text] };
              else if (r.timestamp === cur.at) cur.items.push(r.text);
            });
            var by = {};
            Object.keys(latest).forEach(function (v) {
              latest[v].items.forEach(function (t) { by[t] = (by[t] || 0) + 1; });
            });
            var opts = polls[qid] ? polls[qid].options : [];
            counts = (opts.length ? opts : Object.keys(by)).map(function (t) { return [t, by[t] || 0]; });
            total = Object.keys(latest).length;
          }
          var meta = total + (total === 1 ? ' risposta' : ' risposte');
          var many = polls[qid] && polls[qid].pick;
          if (many) {
            /* As the projector: the `many` most chosen, ties in sheet order. */
            counts = counts.map(function (c, i) { return { c: c, i: i }; })
              .sort(function (a, b) { return b.c[1] - a.c[1] || a.i - b.i; })
              .map(function (x) { return x.c; });
            var rest = counts.slice(many).map(function (c) { return c[1]; });
            counts = counts.slice(0, many);
            if (rest.length) {
              var lo = Math.min.apply(null, rest), hi = Math.max.apply(null, rest);
              meta = 'Altre ' + rest.length + ' voci: ' + (lo === hi ? lo : lo + '–' + hi) + (hi === 1 ? ' scelta' : ' scelte') +
                     ' ciascuna · ' + meta + ' · ' + many + ' voci a testa';
            }
          }
          pages.push(Object.assign({ kind: 'poll', meta: meta,
            rows: counts.map(function (c) {
              return [c[0], c[1], c[1] + ' · ' + Math.round(total ? 100 * c[1] / total : 0) + '%'];
            }) }, base));
          return;
        }
        if (!qt.length) return;  // the analysis never saved themes: nothing was on screen

        var ranked, ballots;
        var isRanking = !!rankings[qid];
        var places = isRanking ? qt.length : topN;
        if (res) {
          ranked = res.map(function (r) {
            return { label: r.label, points: Number(r.punti) || 0, firsts: Number(r['primi posti']) || 0 };
          });
          ballots = Number(res[0].schede) || 0;
        } else {
          /* Not closed: Borda on each device's latest ballot, as Voti.gs scores it. */
          var lastBallot = {};
          votes.forEach(function (r) {
            if (r.sessione !== sess || r.questionId !== qid) return;
            var list;
            try { list = JSON.parse(r.ranking); } catch (e) { return; }
            if (!list.length) return;
            var cur = lastBallot[r.voterId];
            if (!cur || r.timestamp >= cur.at) lastBallot[r.voterId] = { at: r.timestamp, list: list };
          });
          var pts = {}, firsts = {};
          qt.forEach(function (t) { pts[t.id] = 0; firsts[t.id] = 0; });
          Object.keys(lastBallot).forEach(function (v) {
            lastBallot[v].list.forEach(function (id, i) {
              if (pts[id] === undefined) return;
              pts[id] += Math.max(0, places - i);
              if (i === 0) firsts[id] += 1;
            });
          });
          ranked = qt.map(function (t) { return { label: t.label, points: pts[t.id], firsts: firsts[t.id] }; })
            .sort(function (a, b) { return b.points - a.points || b.firsts - a.firsts; });
          ballots = Object.keys(lastBallot).length;
        }
        var voters = {};
        qa.forEach(function (r) { voters[r.voterId] = true; });
        var nVoters = Object.keys(voters).length;

        pages.push(Object.assign({ kind: 'themes', ballots: ballots, themes: qt, full: isRanking }, base));
        pages.push(Object.assign({ kind: 'ranking',
          meta: isRanking ? ballots + (ballots === 1 ? ' classifica' : ' classifiche')
                          : ballots + (ballots === 1 ? ' voto' : ' voti') + ' · ' + nVoters + ' partecipanti',
          rows: ranked.map(function (r) {
            return [r.label, r.points, r.points + ' punti · ' + r.firsts + ' primi posti'];
          }) }, base));
      });
    });
    return { title: (cfg.title || '').trim() || 'Sessione EcoPsy', pages: pages };
  }

  /* How the server groups a summary's paragraphs into projector pages (Sintesi.gs pagesOf_). */
  var PAGE_CHARS = 700;
  function pagesOf(paragraphs) {
    var out = [], page = [], size = 0;
    paragraphs.forEach(function (p, i) {
      if (page.length && size + p.length > PAGE_CHARS) { out.push(page); page = []; size = 0; }
      page.push(i);
      size += p.length;
    });
    if (page.length) out.push(page);
    return out;
  }

  /* A summary page shrinks until it fits its frame, as evento.js summaryPage() does on the projector. */
  var SUMMARY_SIZES = [2, 1.85, 1.7, 1.55, 1.4, 1.3];
  function fitSummary(wrap) {
    var b = wrap.querySelector('.sbody');
    if (!b) return;
    SUMMARY_SIZES.some(function (s) {
      b.style.fontSize = s + 'rem';
      return wrap.scrollHeight <= wrap.clientHeight;
    });
  }

  /* The markup evento.js screenView() builds for the same phase. */
  function pageHtml(p, title) {
    var b = '';
    if (p.divider) {
      var when = Number(p.day.slice(8, 10)) + ' ' + MONTHS[Number(p.day.slice(5, 7)) - 1] + ' ' + p.day.slice(0, 4) +
                 (p.from ? ' · dalle ' + p.from : '') + (p.scaletta ? ' · ' + p.scaletta : '');
      var big = p.name || 'Sessione ' + p.n;
      b = '<div class="waiting"><div class="bignum"' + (big.length > 24 ? ' style="font-size:3.5rem"' : '') + '>' +
          esc(big) + '</div>' + esc(when) + '</div>';
    } else {
      if (p.of > 1) b += '<div class="round">Domanda ' + p.n + ' di ' + p.of + '</div>';
      b += '<div class="qline">' + esc(p.question) + '</div>';
      if (p.kind === 'summary') {
        b += '<div class="spage"><div class="stitle">' + esc(p.title) + '</div><div class="sbody">' +
             p.paragraphs.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div></div>' +
             '<div class="meta">' + esc(p.meta) + '</div>';
      } else if (p.kind === 'themes') {
        /* The items of a classifica go in two columns, as on the projector. */
        b += p.full ? '<div class="cols">' : '<div>';
        p.themes.forEach(function (t) {
          b += '<div class="theme"><span class="badge">•</span><div><div class="label">' + esc(t.label) +
               '</div><div class="desc">' + esc(t.description) + '</div></div></div>';
        });
        b += '</div><div class="meta">' + p.ballots + (p.full ? (p.ballots === 1 ? ' classifica inviata' : ' classifiche inviate')
             : (p.ballots === 1 ? ' voto espresso' : ' voti espressi')) + '</div>';
      } else {
        b += p.rows.length > 6 ? '<div class="many">' : '<div>';
        var top = Math.max.apply(null, p.rows.map(function (r) { return r[1]; }).concat([1]));
        p.rows.forEach(function (r) {
          b += '<div class="res"><div class="top"><div class="label">' + esc(r[0]) + '</div><div class="pts">' +
               esc(r[2]) + '</div></div><div class="bar"><i style="width:' + Math.round(100 * r[1] / top) +
               '%"></i></div></div>';
        });
        b += '</div><div class="meta">' + esc(p.meta) + '</div>';
      }
    }
    return '<div class="wrap"><div class="eyebrow">EcoPsy</div><h1>' + esc(title) + '</h1><div class="stage">' + b + '</div></div>';
  }

  var FONTS = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap';

  /* html2canvas lays the text out in the frame but draws it on a canvas of this
     page, which only has the fonts this page loaded: without them the words
     come out in a fallback font, unevenly spaced. */
  function pageFonts() {
    if (!document.querySelector('link[href="' + FONTS + '"]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = FONTS;
      document.head.appendChild(l);
    }
    if (!document.fonts) return Promise.resolve();
    var wait = new Promise(function (ok) { setTimeout(ok, 50); });
    return wait.then(function () {
      return Promise.all(['400 16px Inter', '500 16px Inter', '600 16px Inter',
        '700 16px "Plus Jakarta Sans"', '800 16px "Plus Jakarta Sans"'].map(function (f) {
        return document.fonts.load(f, 'Aàèéìòù·…');
      }));
    }).catch(function () {});
  }

  /* A 1920x1080 frame with the projector's stylesheets, out of sight. */
  var FRAME_DOC = '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">' +
    '<link href="' + FONTS + '" rel="stylesheet">' +
    '<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="evento.css">' +
    '<style>html,body{margin:0}body.screen .wrap{width:1920px;height:1080px;min-height:0;max-width:none;' +
    'box-sizing:border-box;padding:40px 258px;overflow:hidden}</style></head><body class="screen"></body></html>';

  function openFrame() {
    return new Promise(function (ok) {
      var f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1920px;height:1080px;border:0;visibility:hidden';
      f.onload = function () { ok(f); };
      f.srcdoc = FRAME_DOC;
      document.body.appendChild(f);
    });
  }

  function makePdf(built, progress) {
    return Promise.all([openFrame(), pageFonts()]).then(function (got) {
      var frame = got[0];
      var doc = frame.contentDocument;
      var pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: [1440, 810] });
      var chain = doc.fonts ? doc.fonts.ready : Promise.resolve();
      built.pages.forEach(function (p, i) {
        chain = chain.then(function () {
          progress(i + 1, built.pages.length);
          doc.body.innerHTML = pageHtml(p, built.title);
          return doc.fonts ? doc.fonts.ready : null;
        }).then(function () {
          fitSummary(doc.body.firstChild);
          return window.html2canvas(doc.body.firstChild, {
            scale: 1, width: 1920, height: 1080, windowWidth: 1920, windowHeight: 1080,
            backgroundColor: '#1a4a2e', logging: false
          });
        }).then(function (canvas) {
          if (i > 0) pdf.addPage([1440, 810], 'landscape');
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 1440, 810);
        });
      });
      return chain.then(function () { frame.remove(); return pdf; },
                        function (err) { frame.remove(); throw err; });
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* "15 ottobre 2026 · 10:32" from a session id. */
  function when(id) {
    var d = String(id);
    if (!/^\d{4}-\d\d-\d\d/.test(d)) return d;
    return Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4) +
      (d.length >= 16 ? ' · ' + d.slice(11, 16) : '');
  }

  /* A name as a file name: the signs Windows refuses in one become -. */
  function fileName(t) {
    return String(t).replace(/[\\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '') || 'sessione';
  }

  var MAX_SESSION_NAME = 60;

  /* The card on the facilitator page, folded: the list loads the first time
     it is opened, never with the page. `post` sends a command with the key. */
  function card(post, persona) {
    var box = el('details', 'card sesscard');
    box.appendChild(el('summary', null, 'Sessioni e risultati'));
    box.appendChild(el('p', 'links', 'Ogni sessione del foglio, dalla più recente. PDF: le schermate di sondaggi, temi, classifiche e sintesi, una per pagina.'));
    var list = el('div', 'sesslist');
    box.appendChild(list);
    var tools = el('div', 'sesstools');
    var again = el('button', 'sessbtn', 'Aggiorna l’elenco');
    again.type = 'button';
    var showAll = el('input');
    showAll.type = 'checkbox';
    var allLabel = el('label', 'sessall');
    allLabel.appendChild(showAll);
    allLabel.appendChild(document.createTextNode(' Mostra anche le sessioni vuote'));
    tools.appendChild(again);
    tools.appendChild(allLabel);
    box.appendChild(tools);
    var status = el('p', 'status');
    status.setAttribute('role', 'status');
    box.appendChild(status);

    var sessions = null, loading = false, working = false, renaming = null;

    function say(msg, ok) {
      status.className = 'status' + (ok === true ? ' ok' : ok === false ? ' err' : '');
      status.textContent = msg;
    }

    function load() {
      if (loading) return;
      loading = true;
      again.disabled = true;
      if (!sessions) list.textContent = '';
      say('Carico l’elenco delle sessioni…');
      post({ action: 'sessions' }).then(function (res) {
        if (!res.ok) throw new Error(res.error || 'elenco non disponibile');
        sessions = res.sessions;
        say('');
        draw();
      }).catch(function (err) {
        say(String(err && err.message || err).replace(/^Error: /, ''), false);
      }).then(function () {
        loading = false;
        again.disabled = false;
      });
    }

    function draw() {
      list.textContent = '';
      if (!sessions) return;
      var shown = sessions.filter(function (x) { return showAll.checked || x.current || x.participants > 0; });
      var hidden = sessions.length - shown.length;
      if (!shown.length) list.appendChild(el('p', 'links', 'Nessuna sessione con risposte.'));
      shown.forEach(function (x) { list.appendChild(row(x)); });
      if (hidden && !showAll.checked) {
        list.appendChild(el('p', 'links', hidden === 1 ? '1 sessione vuota nascosta.' : hidden + ' sessioni vuote nascoste.'));
      }
    }

    function row(x) {
      var r = el('div', 'sessrow' + (x.current ? ' cur' : ''));
      var info = el('div', 'sessinfo');
      if (renaming === x.id) {
        var input = el('input');
        input.type = 'text';
        input.maxLength = MAX_SESSION_NAME;
        input.value = x.name;
        input.setAttribute('aria-label', 'Nuovo nome della sessione');
        info.appendChild(input);
        var actions = el('div', 'sessbtns');
        var save = el('button', 'sessbtn main', 'Salva');
        save.type = 'button';
        var cancel = el('button', 'sessbtn', 'Annulla');
        cancel.type = 'button';
        var send = function () { rename(x, input.value, save); };
        save.addEventListener('click', send);
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') send();
          if (e.key === 'Escape') { renaming = null; draw(); }
        });
        cancel.addEventListener('click', function () { renaming = null; draw(); });
        actions.appendChild(save);
        actions.appendChild(cancel);
        r.appendChild(info);
        r.appendChild(actions);
        setTimeout(function () { input.focus(); input.select(); }, 0);
        return r;
      }
      var name = el('div', 'sessname');
      name.appendChild(document.createTextNode(x.name));
      if (x.current) name.appendChild(el('span', 'badge', 'in corso'));
      info.appendChild(name);
      info.appendChild(el('div', 'sub', [when(x.id), x.scaletta,
        x.participants === 1 ? '1 partecipante' : x.participants + ' partecipanti'].filter(Boolean).join(' · ')));
      r.appendChild(info);
      var btns = el('div', 'sessbtns');
      var pdf = el('button', 'sessbtn main', 'PDF');
      pdf.type = 'button';
      pdf.disabled = working;
      pdf.addEventListener('click', function () { download(x, pdf); });
      var pen = el('button', 'sessbtn', 'Rinomina');
      pen.type = 'button';
      pen.disabled = working;
      pen.addEventListener('click', function () { renaming = x.id; draw(); });
      btns.appendChild(pdf);
      btns.appendChild(pen);
      r.appendChild(btns);
      return r;
    }

    function rename(x, value, btn) {
      var name = String(value || '').replace(/\s+/g, ' ').trim();
      if (!name) { say('Scrivi il nome della sessione.', false); return; }
      if (name === x.name) { renaming = null; draw(); return; }
      btn.disabled = true;
      btn.classList.add('working');
      post({ action: 'session-name', sessione: x.id, nome: name }).then(function (res) {
        if (!res.ok) throw new Error(res.error || 'nome non salvato');
        x.name = res.name;
        renaming = null;
        say('Nome salvato.', true);
        draw();
      }).catch(function (err) {
        btn.disabled = false;
        btn.classList.remove('working');
        say(String(err && err.message || err).replace(/^Error: /, ''), false);
      });
    }

    function download(x, btn) {
      working = true;
      Array.prototype.forEach.call(list.querySelectorAll('button'), function (b) { b.disabled = true; });
      btn.classList.add('working');
      say('Scarico i dati dal foglio…');
      var libs = window.jspdf && window.html2canvas ? Promise.resolve() : loadLibs();
      Promise.all([post({ action: 'export' }), libs]).then(function (out) {
        var res = out[0];
        if (!res.ok) throw new Error(res.error || 'esportazione non riuscita');
        var built = buildPages(res.tabs, x.id);
        if (!built.pages.length) throw new Error('nessuna schermata da mettere nel PDF: la sessione “' + x.name + '” non ha risposte');
        return makePdf(built, function (i, n) { say('Preparo la pagina ' + i + ' di ' + n + '…'); });
      }).then(function (pdf) {
        pdf.save('Risultati-' + persona + ' - ' + fileName(x.name) + '.pdf');
        say('PDF di “' + x.name + '” scaricato.', true);
      }).catch(function (err) {
        say(String(err && err.message || err).replace(/^Error: /, ''), false);
      }).then(function () {
        working = false;
        draw();
      });
    }

    box.addEventListener('toggle', function () { if (box.open && !sessions) load(); });
    again.addEventListener('click', load);
    showAll.addEventListener('change', draw);
    return box;
  }

  window.EventoRisultati = { card: card, buildPages: buildPages, makePdf: makePdf, loadLibs: loadLibs };
})();
