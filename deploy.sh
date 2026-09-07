#!/usr/bin/env bash
# Deploy the EcoPsy site to the Tor Vergata web server (SFTP-only account).
#
#   ./deploy.sh --check     show what's currently on the server
#   ./deploy.sh --dry-run   print the exact SFTP batch, send nothing
#   ./deploy.sh             upload
#
# The account has no shell, so this uploads over plain SFTP: every run sends
# every file. Deleting remote files is not done here; use --check to inspect.

set -euo pipefail

HOST="www-2026.ecopsy.uniroma2.it"
USER="pmpgcm00_local"
KEY="$HOME/.ssh/id_ed25519"
SITE="siti/www-2026_ecopsy_uniroma2_it_apache2_trixie"
REMOTE="$SITE/web/htdocs"

LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Never publish these to a public web server.
EXCLUDES=(
  ".git" ".gitignore" ".gitattributes"
  ".DS_Store" ".Rhistory" ".claude"
  "*.tmp" ".~lock.*#"
  "TODO.md" "deploy_instructions.md" "deploy.sh"
  # Superseded funder-logo iterations: referenced by no page. Still in the repo.
  "assets/hero_img.png" "assets/loghi_mur_fis.png" "assets/logo fis2.jpg"
  "assets/logo_fis_mur.png" "assets/logo_fis.png"
)

SFTP=(sftp -i "$KEY" -o IdentitiesOnly=yes "$USER@$HOST")

MODE="upload"
for arg in "$@"; do
  case "$arg" in
    --check)   MODE="check" ;;
    --dry-run) MODE="dry" ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$MODE" == "check" ]]; then
  echo "Listing $USER@$HOST ..."
  "${SFTP[@]}" <<EOF
ls -la $SITE
ls -la $SITE/web
ls -la $REMOTE
bye
EOF
  exit 0
fi

# Build a clean copy, then derive an explicit SFTP batch from it.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

COPY=(-a)
for e in "${EXCLUDES[@]}"; do COPY+=(--exclude "$e"); done
rsync "${COPY[@]}" "$LOCAL/" "$STAGE/"

BATCH="$STAGE/.sftp-batch"
{
  echo "cd $REMOTE"
  # "-" prefix = keep going if the directory already exists
  (cd "$STAGE" && find . -mindepth 1 -type d -not -name '.sftp-batch' -printf '%P\n' | sort) \
    | while read -r d; do echo "-mkdir $d"; done
  (cd "$STAGE" && find . -type f -not -name '.sftp-batch' -printf '%P\n' | sort) \
    | while read -r f; do echo "put \"$f\" \"$f\""; done
  # Force world-readable perms: Apache runs as another user and would 403 otherwise.
  # "-" prefix tolerates files we do not own (e.g. the pre-existing index.html).
  (cd "$STAGE" && find . -mindepth 1 -type d -printf '%P\n' | sort) \
    | while read -r d; do echo "-chmod 755 \"$d\""; done
  (cd "$STAGE" && find . -type f -not -name '.sftp-batch' -printf '%P\n' | sort) \
    | while read -r f; do echo "-chmod 644 \"$f\""; done
  echo "bye :)"
} > "$BATCH"

FILES=$(grep -c '^put ' "$BATCH")
BYTES=$(cd "$STAGE" && find . -type f -not -name '.sftp-batch' -printf '%s\n' | paste -sd+ | bc)

if [[ "$MODE" == "dry" ]]; then
  echo "Would upload $FILES files ($(numfmt --to=iec "$BYTES")) to $USER@$HOST:$REMOTE/"
  echo "--- SFTP batch ---"
  cat "$BATCH"
  exit 0
fi

echo "Uploading $FILES files ($(numfmt --to=iec "$BYTES")) to $USER@$HOST:$REMOTE/"
(cd "$STAGE" && "${SFTP[@]}" -b "$BATCH")
echo "Done. Check http://$HOST"
