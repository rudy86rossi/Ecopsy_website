#!/usr/bin/env python3
"""
Downloads each person's sheet and builds their results for one day.

For every person in evento-config.js (or the ones named), asks their web app for
an export with their facilitator key, saves each tab as CSV and runs
estrai-dati.py on it. Writes into the output folder (default: "event data"):

  <nome>/dati/<Tab>.csv           the sheet as it is now
  <nome>/estratto-<day>/          answers, themes, ballots, summaries, screens, PDF
  Risultati-<day>/Risultati-sessione-<nome>.pdf   every person's PDF, together

The keys live in evento-live/chiavi.local, one per line, as `nome = chiave`
(the key from EcoPsy -> Mostra chiave e link). That file stays out of git and,
like all of evento-live, out of the site.

Usage:
  evento-live/scarica-risultati.py 2026-10-15
  evento-live/scarica-risultati.py 2026-10-15 rodolfo roberta
"""

import argparse
import csv
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent


def read_urls():
    text = (SITE / 'evento-config.js').read_text(encoding='utf-8')
    return dict(re.findall(r"^\s*(\w+):\s*'(https://script\.google\.com/macros/s/[^']+/exec)'", text, re.M))


def read_keys(path):
    keys = {}
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.split('#', 1)[0].strip()
            if '=' in line:
                nome, key = line.split('=', 1)
                keys[nome.strip()] = key.strip().strip('"\'')
    return keys


def fetch(url, key):
    # text/plain, as the pages send it: Apps Script cannot answer a CORS preflight.
    # urllib follows the 302 to googleusercontent.com with a GET, as Apps Script expects.
    req = urllib.request.Request(url, data=json.dumps({'action': 'export', 'key': key}).encode('utf-8'),
                                 headers={'Content-Type': 'text/plain;charset=utf-8'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode('utf-8'))


def save_tabs(folder, tabs):
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for name, rows in tabs.items():
        with open(folder / (name + '.csv'), 'w', encoding='utf-8', newline='') as fh:
            csv.writer(fh).writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('day', help='YYYY-MM-DD')
    ap.add_argument('persone', nargs='*', help='default: everyone in evento-config.js')
    ap.add_argument('--chiavi', type=Path, default=HERE / 'chiavi.local')
    ap.add_argument('--out', type=Path, default=SITE / 'event data')
    a = ap.parse_args()

    urls = read_urls()
    keys = read_keys(a.chiavi)
    people = a.persone or list(urls)
    together = a.out / ('Risultati-' + a.day)
    failed = []

    for nome in people:
        print('== ' + nome)
        if nome not in urls:
            print('   no /exec URL in evento-config.js'); failed.append(nome); continue
        if not keys.get(nome):
            print('   no key in %s (line: %s = <chiave>)' % (a.chiavi, nome)); failed.append(nome); continue
        try:
            res = fetch(urls[nome], keys[nome])
        except Exception as err:
            print('   download failed: %s' % err); failed.append(nome); continue
        if not res.get('ok') or 'tabs' not in res:
            # 'azione sconosciuta' means the sheet runs code from before the export: pubblica-script.sh
            print('   the sheet answered: %s' % (res.get('error') or 'no data (keys: %s)' % ', '.join(res)))
            failed.append(nome); continue

        person = a.out / nome
        save_tabs(person / 'dati', res['tabs'])
        out = person / ('estratto-' + a.day)
        run = subprocess.run([sys.executable, '-I', str(HERE / 'estrai-dati.py'), str(person / 'dati'), a.day,
                              '--persona', nome, '--out', str(out)], text=True, capture_output=True)
        print('   ' + (run.stdout + run.stderr).strip().replace('\n', '\n   '))
        pdf = out / ('Risultati-sessione-' + nome + '.pdf')
        if run.returncode == 0 and pdf.exists():
            together.mkdir(parents=True, exist_ok=True)
            shutil.copy2(pdf, together / pdf.name)
        elif 'no session' not in run.stderr:
            failed.append(nome)

    if together.exists():
        print('\nPDF: %s' % together)
    if failed:
        print('not done: ' + ', '.join(failed))
        sys.exit(1)


if __name__ == '__main__':
    main()
