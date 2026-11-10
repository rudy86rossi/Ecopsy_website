#!/usr/bin/env bash
#
# Publishes the Apps Script code in this folder to each person's sheet.
#
#   ./pubblica-script.sh                  every person with a clasp-<nome>.json
#   ./pubblica-script.sh roberta          only roberta
#   ./pubblica-script.sh --dry-run        show what would be published, change nothing
#
# For each person: uploads the .gs files and appsscript.json to their script
# (clasp push), then publishes a new version on their existing web app
# (clasp update-deployment), so the /exec URL in evento-config.js stays the same.
# A person without a URL in evento-config.js gets a first deployment, and the
# script prints the URL to paste there.
#
# Script Properties (API key, facilitator key, name) and the sheet's data are
# never touched. After a new version, it runs what EcoPsy → Inizializza fogli
# does (the `setup` action) with the person's key from chiavi.local; without a
# key there, run the menu item by hand.
#
# One-time setup: turn on "Google Apps Script API" at
# https://script.google.com/home/usersettings, then `npx @google/clasp login`.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/../evento-config.js"
CLASP=(npx -y @google/clasp@3.4.1)
KEYS="$HERE/chiavi.local"

# The key of person $1 in chiavi.local, as scarica-risultati.py reads it.
key_of() {
  [ -f "$KEYS" ] || return 0
  python3 -I - "$KEYS" "$1" <<'PY'
import sys
for line in open(sys.argv[1], encoding='utf-8'):
    line = line.split('#', 1)[0].strip()
    if '=' in line:
        nome, key = line.split('=', 1)
        if nome.strip() == sys.argv[2]:
            print(key.strip().strip('"\''))
PY
}

# Runs Inizializza fogli on person $1's web app at $2. A failure is reported, not fatal.
run_setup() {
  local key out
  key="$(key_of "$1")"
  if [ -z "$key" ]; then
    echo "Nessuna chiave per $1 in chiavi.local: esegui EcoPsy → Inizializza fogli a mano."
    return 0
  fi
  # -L follows Apps Script's 302 with a GET, as it expects; text/plain avoids a CORS preflight.
  out="$(curl -sL --max-time 300 -H 'Content-Type: text/plain;charset=utf-8' \
         --data "{\"action\":\"setup\",\"key\":\"$key\"}" "$2" || true)"
  case "$out" in
    *'"ok":true'*) echo "Inizializza fogli: fatto" ;;
    *) echo "Inizializza fogli NON riuscito per $1 (eseguilo dal menu): ${out:0:200}" ;;
  esac
}

DRY=0
PEOPLE=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Opzione sconosciuta: $arg" >&2; exit 1 ;;
    *) PEOPLE+=("$arg") ;;
  esac
done

if [ ${#PEOPLE[@]} -eq 0 ]; then
  for f in "$HERE"/clasp-*.json; do
    [ -e "$f" ] || continue
    n="${f##*/clasp-}"; PEOPLE+=("${n%.json}")
  done
fi
if [ ${#PEOPLE[@]} -eq 0 ]; then
  echo "Nessun clasp-<nome>.json in $HERE." >&2; exit 1
fi

# Written on each new version, so the Apps Script editor shows which code a sheet runs.
DESC="$(date '+%Y-%m-%d %H:%M') $(git -C "$HERE" rev-parse --short HEAD)"
if ! git -C "$HERE" diff --quiet HEAD -- . ; then DESC="$DESC + modifiche non committate"; fi

for nome in "${PEOPLE[@]}"; do
  project="$HERE/clasp-$nome.json"
  if [ ! -f "$project" ]; then
    echo "== $nome: manca $project (serve lo script ID: Impostazioni progetto → ID)" >&2
    exit 1
  fi

  url="$(grep -oE "^[[:space:]]*$nome:[[:space:]]*'https://script\.google\.com/macros/s/[^/']+/exec'" "$CONFIG" \
         | grep -oE "https://[^']+" || true)"
  deployment=""
  if [ -n "$url" ]; then
    deployment="${url#https://script.google.com/macros/s/}"
    deployment="${deployment%/exec}"
  fi

  echo "== $nome"
  if [ "$DRY" -eq 1 ]; then
    "${CLASP[@]}" -P "$project" show-file-status
    if [ -n "$deployment" ]; then
      echo "Pubblicherei una nuova versione su $url"
    else
      echo "Nessun URL per $nome in evento-config.js: creerei una prima distribuzione"
    fi
    echo "Descrizione: $DESC"
    continue
  fi

  "${CLASP[@]}" -P "$project" push --force
  if [ -n "$deployment" ]; then
    "${CLASP[@]}" -P "$project" update-deployment "$deployment" -d "$DESC"
    run_setup "$nome" "$url"
  else
    "${CLASP[@]}" -P "$project" create-deployment -d "$DESC"
    echo
    echo "Prima distribuzione creata. In evento-config.js, accanto a $nome, incolla:"
    echo "  https://script.google.com/macros/s/<deploymentId stampato sopra>/exec"
  fi
done
