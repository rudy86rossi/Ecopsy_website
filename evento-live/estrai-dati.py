#!/usr/bin/env python3
"""
Extracts one day of the live event from a sheet's CSV export.

Reads the tabs exported as CSV (File -> Download -> .csv, one per tab) from a
folder: Archivio risposte / temi / voti, and Risposte / Temi / Voti / Risultati /
Domande / Sintesi / Cronologia when present.
Writes, for every session started on the given day:

  risposte.csv  every answer; for a poll, each device's latest choice
  temi.csv      the themes of each question with their score as shown to the room
                (the Risultati tab; recomputed from the ballots when it is missing)
  voti.csv      each device's latest ballot
  sintesi.csv   the summary of each `sintesi` question, the last one written
  riepilogo.md  the same, readable
  schermate/    the projector's screens, rebuilt from the data: for each question
                the themes as put to the vote and the final ranking, or each page
                of the summary, as HTML and, when a headless Chromium is found,
                as 1920x1080 PNG
  Risultati-sessione-<persona>.pdf   every screen in order, one per page, each session
                opening with a divider page (needs Chromium)

Usage:
  evento-live/estrai-dati.py "event data" 2026-10-15 [--persona rodolfo] [--out DIR]
"""

import argparse
import csv
import html
import json
import os
import re
import shutil
import subprocess
import sys
from collections import OrderedDict
from pathlib import Path

TOP_N = 3  # Config top_n: points 3-2-1

# The Domande tab as published on 2026-10-15; a Domande.csv in the folder wins.
QUESTIONS = {
    'q1': 'Conosci qualcuno che ha o ha avuto un problema di salute mentale?',
    'q2': 'Per me avere una buona salute mentale significa…',
    'q3': 'Per me stare male psicologicamente significa?',
    'q4': 'Quali sono le situazioni e/o condizioni che mi fanno stare bene?',
    'q5': 'Quali sono le situazioni e/o condizioni che mi fanno stare male?',
}


def split_names(v):
    """The scalette of a Domande row: names separated by |."""
    return [x.strip() for x in (v or '').split('|') if x.strip()]


def read_tab(folder, name):
    """Rows of every CSV whose file name ends with ' - <name>.csv' (or is <name>.csv)."""
    rows = []
    for f in sorted(folder.glob('*.csv')):
        if f.stem == name or f.stem.endswith(' - ' + name):
            with open(f, encoding='utf-8-sig', newline='') as fh:
                rows.extend(csv.DictReader(fh))
    return rows


def iso(stamp):
    """'2026-10-15 09:12:03' as is; '15/10/2026' (a CSV saved from Sheets) as '2026-10-15'."""
    stamp = stamp.strip()
    m = re.match(r'(\d\d)/(\d\d)/(\d{4})(.*)', stamp)
    return '%s-%s-%s%s' % (m.group(3), m.group(2), m.group(1), m.group(4)) if m else stamp


def on_day(row, day):
    """A row belongs to the day it was written; a row with no time, to the day its session started."""
    stamp = iso(row.get('timestamp', ''))
    return stamp.startswith(day) if stamp else row['sessione'].strip().startswith(day)


def first_time(rows):
    """HH:MM of the earliest row, when the export carries times."""
    times = sorted(iso(r['timestamp'])[11:16] for r in rows if len(iso(r['timestamp'])) >= 16)
    return times[0] if times else ''


def latest_poll(rows):
    """A device's latest submission: its last run of consecutive rows (one per option)."""
    by_voter = OrderedDict()
    prev = None
    for r in rows:
        v = r['voterId']
        if v != prev or v not in by_voter:
            by_voter[v] = []
        by_voter[v].append(r['text'].strip())
        prev = v
    return by_voter


def latest_ballots(rows):
    """Each device's last non-empty ballot; rows are in the order they were written."""
    out = OrderedDict()
    for r in rows:
        try:
            ranking = json.loads(r['ranking'])
        except (ValueError, TypeError):
            continue
        if ranking:
            out.pop(r['voterId'], None)
            out[r['voterId']] = ranking
    return out


def score(themes, ballots):
    pts = {t['id']: 0 for t in themes}
    first = {t['id']: 0 for t in themes}
    for ranking in ballots.values():
        for i, tid in enumerate(ranking):
            if tid in pts:
                pts[tid] += max(0, TOP_N - i)
                if i == 0:
                    first[tid] += 1
    ranked = [dict(t, punti=pts[t['id']], primi=first[t['id']]) for t in themes]
    ranked.sort(key=lambda t: (-t['punti'], -t['primi']))
    return ranked


# How the server groups a summary's paragraphs into projector pages (Sintesi.gs pagesOf_).
PAGE_CHARS = 700


def pages_of(paragraphs):
    pages, page, size = [], [], 0
    for i, p in enumerate(paragraphs):
        if page and size + len(p) > PAGE_CHARS:
            pages.append(page)
            page, size = [], 0
        page.append(i)
        size += len(p)
    if page:
        pages.append(page)
    return pages


def write_csv(path, header, rows):
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


SITE = Path(__file__).resolve().parent.parent

SCREEN_PAGE = """<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>%s</style><style>%s</style>
</head><body class="screen"><div class="wrap">
<div class="eyebrow">EcoPsy</div><h1>%s</h1>
<div class="stage">%s</div>
</div></body></html>
"""


def esc(t):
    return html.escape(str(t))


# A summary page shrinks until it fits its 1920x1080 frame, as evento.js summaryPage() does on the projector.
FIT_SCRIPT = """<script>
(document.fonts ? document.fonts.ready : Promise.resolve()).then(function () {
  document.querySelectorAll('.sbody').forEach(function (b) {
    var w = b.closest('.wrap');
    [2, 1.85, 1.7, 1.55, 1.4, 1.3].some(function (s) {
      b.style.fontSize = s + 'rem';
      return w.scrollHeight <= w.clientHeight && w.offsetHeight <= 1080;
    });
  });
});
</script>"""


def screen_body(sc):
    """The markup evento.js screenView() builds for the same phase."""
    b = ''
    if sc['of'] > 1:
        b += '<div class="round">Domanda %d di %d</div>' % (sc['n'], sc['of'])
    b += '<div class="qline">%s</div>' % esc(sc['question'])
    if sc['kind'] == 'sintesi':
        b += ('<div class="spage"><div class="stitle">%s</div><div class="sbody">%s</div></div>'
              % (esc(sc['title']), ''.join('<p>%s</p>' % esc(p) for p in sc['paragraphs'])))
        return b + '<div class="meta">%s</div>' % esc(sc['meta'])
    b += '<div>'
    if sc['kind'] == 'temi':
        for t in sc['themes']:
            b += ('<div class="theme"><span class="badge">•</span><div><div class="label">%s</div>'
                  '<div class="desc">%s</div></div></div>' % (esc(t['label']), esc(t['description'])))
        b += '</div><div class="meta">%d %s</div>' % (sc['ballots'], 'voto espresso' if sc['ballots'] == 1 else 'voti espressi')
        return b
    rows = sc['rows']
    top = max([r[1] for r in rows] + [1])
    for label, value, side in rows:
        b += ('<div class="res"><div class="top"><div class="label">%s</div><div class="pts">%s</div></div>'
              '<div class="bar"><i style="width:%d%%"></i></div></div>' % (esc(label), esc(side), round(100 * value / top)))
    b += '</div><div class="meta">%s</div>' % esc(sc['meta'])
    return b


def find_chrome():
    for name in ('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome-headless-shell'):
        if shutil.which(name):
            return shutil.which(name)
    found = sorted(Path.home().glob('.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell'))
    return str(found[-1]) if found else None


MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
          'settembre', 'ottobre', 'novembre', 'dicembre']

ALL_SCREENS_CSS = """
@page { size: 1920px 1080px; margin: 0; }
html, body { margin: 0; }
body.screen .wrap { width: 1920px; height: 1080px; min-height: 0; max-width: none;
  box-sizing: border-box; padding: 40px 258px; overflow: hidden; break-after: page; }
"""


def write_screens(folder, screens, title, pdf):
    if folder.exists():
        shutil.rmtree(folder)  # screens from an earlier run would otherwise linger
    folder.mkdir()
    css = [(SITE / 'style.css').read_text(encoding='utf-8'), (SITE / 'evento.css').read_text(encoding='utf-8')]
    chrome = find_chrome()
    for sc in screens:
        page = folder / (sc['name'] + '.html')
        body = SCREEN_PAGE % (css[0], css[1], esc(title), screen_body(sc))
        page.write_text(body.replace('</body>', FIT_SCRIPT + '</body>'), encoding='utf-8')
        if chrome:
            subprocess.run([chrome, '--headless', '--hide-scrollbars', '--window-size=1920,1080',
                            '--virtual-time-budget=8000', '--screenshot=' + str(folder / (sc['name'] + '.png')),
                            page.resolve().as_uri()],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not chrome:
        print('note: no headless Chromium found, screens written as HTML only')
        return
    # All screens in one page, one per printed page, for the PDF; each session opens with a divider.
    page = '<div class="wrap"><div class="eyebrow">EcoPsy</div><h1>%s</h1><div class="stage">%%s</div></div>' % esc(title)
    pages, last = '', None
    for sc in screens:
        if sc['session'] != last:
            last = sc['session']
            day, time = (sc['started'].split() + [''])[:2]
            when = '%d %s %s' % (int(day[8:10]), MONTHS[int(day[5:7]) - 1], day[:4])
            if time:
                when += ' · dalle ' + time[:5]
            if sc.get('scaletta'):
                when += ' · ' + sc['scaletta']
            pages += page % ('<div class="waiting"><div class="bignum">Sessione %d</div>%s</div>' % (last, esc(when)))
        pages += page % screen_body(sc)
    full = SCREEN_PAGE.split('</head>')[0] % (css[0], css[1]) + '<style>%s</style></head><body class="screen">%s%s</body></html>' % (ALL_SCREENS_CSS, pages, FIT_SCRIPT)
    tmp = folder / '_tutte.html'
    tmp.write_text(full, encoding='utf-8')
    subprocess.run([chrome, '--headless', '--virtual-time-budget=8000', '--no-pdf-header-footer',
                    '--print-to-pdf=' + str(pdf), tmp.resolve().as_uri()],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tmp.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder', type=Path)
    ap.add_argument('day', help='YYYY-MM-DD')
    ap.add_argument('--persona', default='', help='label for the output (whose sheet it is)')
    ap.add_argument('--out', type=Path)
    ap.add_argument('--titolo', help='the title at the top of the screens (default: Config title, else Sessione EcoPsy)')
    a = ap.parse_args()

    if not a.titolo:
        cfg = {r.get('chiave'): r.get('valore') for r in read_tab(a.folder, 'Config')}
        a.titolo = (cfg.get('title') or '').strip() or 'Sessione EcoPsy'

    questions = dict(QUESTIONS)
    polls = set()  # questions with fixed choices: from Domande, else from a Risultati row with no theme
    summaries = set()  # `sintesi` questions: from Domande, else from a Sintesi row
    planned, added = [], {}  # the rounds of a session: the planned rows of its scaletta, then those added in it
    set_names = []  # the scalette, in order of first appearance
    for r in read_tab(a.folder, 'Domande'):
        for name in split_names(r.get('scaletta')):
            if name.lower() not in [n.lower() for n in set_names]:
                set_names.append(name)
        if r.get('id'):
            questions[r['id']] = r['domanda']
            if (r.get('opzioni') or '').strip():
                polls.add(r['id'])
            if (r.get('tipo') or '').strip().lower().startswith('sint'):
                summaries.add(r['id'])
            if (r.get('origine') or '').strip() == 'aggiunta':
                added.setdefault((r.get('sessione') or '').strip(), []).append(r['id'])
            else:
                planned.append((r['id'], [n.lower() for n in split_names(r.get('scaletta'))]))
    have_domande = bool(questions.keys() - QUESTIONS.keys()) or bool(read_tab(a.folder, 'Domande'))

    # The scaletta each session ran, from Cronologia. Sessions from before
    # scalette existed ran the first one, as the server would today.
    set_of = {r['sessione']: r['scaletta'].strip()
              for r in read_tab(a.folder, 'Cronologia') if (r.get('scaletta') or '').strip()}

    def scaletta_of(sess):
        return (set_of.get(sess) or set_names[0]) if set_names else ''

    def planned_for(sess):
        use = scaletta_of(sess).lower()
        return [qid for qid, sets in planned if not use or not sets or use in sets]

    # The summary on screen: the last one written per session and question. It
    # also carries the question as it was asked: a `sintesi` row is rewritten
    # in each session.
    summary_rows = {}
    for r in read_tab(a.folder, 'Sintesi'):
        if on_day(r, a.day) and (r.get('testo') or '').strip():
            summary_rows[(r['sessione'], r['questionId'])] = r
            summaries.add(r['questionId'])

    # The ranking saved when each vote closed: the last one per session and question.
    results = {}
    for r in read_tab(a.folder, 'Risultati'):
        if not on_day(r, a.day):
            continue
        key = (r['sessione'], r['questionId'])
        if r['posizione'] == '1':
            results[key] = []
        results.setdefault(key, []).append(r)
        questions[r['questionId']] = r['domanda']
        if not have_domande and not r['themeId'].strip():
            polls.add(r['questionId'])

    # Only the rows written that day: a sheet never reset carries a session id from an earlier day.
    answers = [r for r in read_tab(a.folder, 'Archivio risposte') + read_tab(a.folder, 'Risposte') if on_day(r, a.day)]
    themes = [r for r in read_tab(a.folder, 'Archivio temi') + read_tab(a.folder, 'Temi') if on_day(r, a.day)]
    votes = [r for r in read_tab(a.folder, 'Archivio voti') + read_tab(a.folder, 'Voti') if on_day(r, a.day)]

    sessions = sorted({r['sessione'] for r in answers})
    if not sessions:
        sys.exit('no session on ' + a.day)

    out = a.out or a.folder / ('estratto-' + a.day + ('-' + a.persona if a.persona else ''))
    out.mkdir(parents=True, exist_ok=True)

    r_rows, t_rows, v_rows, s_rows, screens = [], [], [], [], []
    md = ['# Evento live — ' + a.day + (' — ' + a.persona if a.persona else ''), '']

    for n, sess in enumerate(sessions, 1):
        first = first_time([r for r in answers if r['sessione'] == sess])
        started = a.day + ' ' + (first or (sess.split()[1] if sess.startswith(a.day) else ''))
        md += ['## Sessione %d (%s %s)%s' % (n, a.day, ('prima risposta alle ' + first) if first else 'avviata ' + sess,
                                           ' — ' + scaletta_of(sess) if scaletta_of(sess) else ''), '']
        qids = sorted({r['questionId'] for r in answers if r['sessione'] == sess},
                      key=lambda q: int(q[1:]) if q[1:].isdigit() else 99)
        order = planned_for(sess) + added.get(sess, [])
        for qn, qid in enumerate(qids, 1):
            srow = summary_rows.get((sess, qid))
            text = srow['domanda'] if srow and srow.get('domanda') else questions.get(qid, qid)
            # As on the projector: the question's place in Domande, even when a session skipped some.
            if qid in order:
                place, of = order.index(qid) + 1, len(order)
            else:
                place, of = (int(qid[1:]) if qid[1:].isdigit() else qn), max(len(questions), len(qids))
            sc = {'n': place, 'of': of, 'question': text, 'session': n, 'started': started, 'scaletta': scaletta_of(sess)}
            prefix = 's%d-%s' % (n, qid)
            q_answers = [r for r in answers if r['sessione'] == sess and r['questionId'] == qid]
            q_themes = [r for r in themes if r['sessione'] == sess and r['questionId'] == qid]
            md += ['### %s — %s' % (qid, text), '']

            if qid in summaries:
                for r in q_answers:
                    r_rows.append([a.persona, sess, qid, text, r['voterId'], r['text'].strip()])
                n_people = len({r['voterId'] for r in q_answers})
                if not srow:
                    print('note: %s %s: no summary saved, answers only' % (sess, qid))
                    md += ['%d risposte. Nessuna sintesi salvata.' % len(q_answers), '']
                else:
                    paragraphs = [p.strip() for p in re.split(r'\s*\n\s*', srow['testo']) if p.strip()]
                    pages = pages_of(paragraphs)
                    for i, idx in enumerate(pages, 1):
                        screens.append(dict(sc, name='%s-sintesi-%d' % (prefix, i), kind='sintesi', title=srow['titolo'],
                                            paragraphs=[paragraphs[k] for k in idx],
                                            meta=('Pagina %d di %d · ' % (i, len(pages)) if len(pages) > 1 else '')
                                                 + '%d %s' % (n_people, 'risposta' if n_people == 1 else 'risposte')))
                    s_rows.append([a.persona, sess, qid, text, srow['titolo'], '\n\n'.join(paragraphs),
                                   srow.get('partecipanti', ''), srow.get('modello', '')])
                    md += ['Sintesi di %d risposte.' % n_people, '', '**%s**' % srow['titolo'], '']
                    for p in paragraphs:
                        md += [p, '']
                md += ['<details><summary>Risposte</summary>', '']
                md += ['- ' + r['text'].strip().replace('\n', ' ') for r in q_answers]
                md += ['', '</details>', '']
                continue

            if qid not in polls and not q_themes:
                # An open question whose analysis never saved themes: answers only, no screens.
                for r in q_answers:
                    r_rows.append([a.persona, sess, qid, text, r['voterId'], r['text'].strip()])
                print('note: %s %s: no themes saved, answers only' % (sess, qid))
                md += ['%d risposte. Nessun tema salvato: l\'analisi non è arrivata al voto.' % len(q_answers), '',
                       '<details><summary>Risposte</summary>', '']
                md += ['- ' + r['text'].strip().replace('\n', ' ') for r in q_answers]
                md += ['', '</details>', '']
                continue

            if qid in polls:
                # A poll: count each device's latest choice.
                latest = latest_poll(q_answers)
                counts = OrderedDict()
                for voter, items in latest.items():
                    for t in items:
                        counts[t] = counts.get(t, 0) + 1
                        r_rows.append([a.persona, sess, qid, text, voter, t])
                saved = results.get((sess, qid))
                if saved:
                    counts = OrderedDict((r['label'], int(r['punti'])) for r in saved)
                    latest = [None] * int(saved[0]['schede'])
                screens.append(dict(sc, name=prefix + '-sondaggio', kind='sondaggio',
                                    rows=[(o, c, '%d · %d%%' % (c, round(100 * c / len(latest))))
                                          for o, c in counts.items()],
                                    meta='%d %s' % (len(latest), 'risposta' if len(latest) == 1 else 'risposte')))
                md += ['Sondaggio, %d partecipanti.' % len(latest), '',
                       '| risposta | n | % |', '|---|---:|---:|']
                for opt, c in sorted(counts.items(), key=lambda kv: -kv[1]):
                    md.append('| %s | %d | %.0f%% |' % (opt, c, 100 * c / len(latest)))
                md.append('')
                continue

            for r in q_answers:
                r_rows.append([a.persona, sess, qid, text, r['voterId'], r['text'].strip()])
            ballots = latest_ballots([r for r in votes if r['sessione'] == sess and r['questionId'] == qid])
            ranked = score([{'id': t['id'], 'label': t['label'], 'description': t['description']}
                            for t in q_themes], ballots)
            saved = results.get((sess, qid))
            if saved:
                desc = {t['id']: t['description'] for t in q_themes}
                recomputed = [(t['id'], t['punti']) for t in ranked]
                ranked = [{'id': r['themeId'], 'label': r['label'], 'description': desc.get(r['themeId'], ''),
                           'punti': int(r['punti']), 'primi': int(r['primi posti'])} for r in saved]
                if recomputed != [(t['id'], t['punti']) for t in ranked]:
                    print('note: %s %s: the latest ballots score differently from Risultati '
                          '(a ballot arrived after the vote closed); using Risultati' % (sess, qid))
            else:
                print('note: %s %s: no Risultati, ranking recomputed from the ballots' % (sess, qid))
            n_ballots = int(saved[0]['schede']) if saved else len(ballots)
            n_people = len({r['voterId'] for r in q_answers})
            screens.append(dict(sc, name=prefix + '-a-temi', kind='temi', ballots=n_ballots,
                                themes=[{'label': t['label'], 'description': t['description']} for t in q_themes]))
            screens.append(dict(sc, name=prefix + '-b-classifica', kind='classifica',
                                rows=[(t['label'], t['punti'], '%d punti · %d primi posti' % (t['punti'], t['primi']))
                                      for t in ranked],
                                meta='%d %s · %d partecipanti' % (n_ballots, 'voto' if n_ballots == 1 else 'voti', n_people)))
            for pos, t in enumerate(ranked, 1):
                t_rows.append([a.persona, sess, qid, text, pos, t['id'], t['label'], t['description'],
                               t['punti'], t['primi'], n_ballots])
            labels = {t['id']: t['label'] for t in ranked}
            for voter, ranking in ballots.items():
                v_rows.append([a.persona, sess, qid, voter] + [labels.get(x, x) for x in ranking[:TOP_N]]
                              + [''] * (TOP_N - len(ranking[:TOP_N])))

            md += ['%d risposte, %d schede di voto.' % (len(q_answers), len(ballots)), '',
                   '**Temi (classifica del voto, punti 3-2-1)**', '',
                   '| # | tema | punti | primi posti | descrizione |', '|---:|---|---:|---:|---|']
            for pos, t in enumerate(ranked, 1):
                md.append('| %d | %s | %d | %d | %s |' % (pos, t['label'], t['punti'], t['primi'],
                                                         t['description'].replace('|', '/')))
            md += ['', '<details><summary>Risposte</summary>', '']
            md += ['- ' + r['text'].strip().replace('\n', ' ') for r in q_answers]
            md += ['', '</details>', '']

    write_csv(out / 'risposte.csv', ['persona', 'sessione', 'questionId', 'domanda', 'voterId', 'risposta'], r_rows)
    write_csv(out / 'temi.csv', ['persona', 'sessione', 'questionId', 'domanda', 'posizione', 'themeId', 'tema',
                                 'descrizione', 'punti', 'primi posti', 'schede'], t_rows)
    write_csv(out / 'voti.csv', ['persona', 'sessione', 'questionId', 'voterId', 'scelta 1', 'scelta 2', 'scelta 3'],
              v_rows)
    write_csv(out / 'sintesi.csv', ['persona', 'sessione', 'questionId', 'domanda', 'titolo', 'testo',
                                    'partecipanti', 'modello'], s_rows)
    (out / 'riepilogo.md').write_text('\n'.join(md), encoding='utf-8')
    write_screens(out / 'schermate', screens, a.titolo,
                  out / ('Risultati-sessione' + ('-' + a.persona if a.persona else '') + '.pdf'))
    print('%d sessions -> %s' % (len(sessions), out))


if __name__ == '__main__':
    main()
