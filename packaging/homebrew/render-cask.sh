#!/usr/bin/env bash
# Genera el cask de Homebrew a partir de la plantilla.
# Uso: packaging/homebrew/render-cask.sh <versión> <sha256> <usuario/repo>
set -euo pipefail

[[ $# -eq 3 ]] || { echo "Uso: $0 <versión> <sha256> <usuario/repo>" >&2; exit 2; }
VERSION="$1"; SHA="$2"; REPO="$3"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || { echo "Versión no válida: $VERSION" >&2; exit 2; }
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "sha256 no válido: $SHA" >&2; exit 2; }
[[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "Repo no válido: $REPO" >&2; exit 2; }

DIR="$(cd "$(dirname "$0")" && pwd)"
sed -e "s|@VERSION@|$VERSION|g" -e "s|@SHA256@|$SHA|g" -e "s|@REPO@|$REPO|g" "$DIR/acta.rb.tmpl"
