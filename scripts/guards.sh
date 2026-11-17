#!/usr/bin/env bash
# Comprobaciones que NUNCA deben fallar (lecciones de Meetily + la regla de no firmar nunca).
# Uso: scripts/guards.sh   (sale con 1 si algo se cuela)
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
check() { # $1 = descripción, $2.. = rg args; falla si hay coincidencias
  local desc=$1; shift
  if rg -n "$@" >/dev/null 2>&1; then
    echo "✗ $desc"; rg -n "$@" || true; fail=1
  else
    echo "✓ $desc"
  fi
}
SRC=(crates apps/desktop/src apps/desktop/src-tauri/src sidecars/acta-mac/Sources)
check "sin ffmpeg en el código" -P -i '^(?!\s*(//|#|\*|--)).*ffmpeg' "${SRC[@]}" -g '!*.md'
check "nadie silencia clippy::zombie_processes" 'allow\(clippy::zombie_processes\)' "${SRC[@]}"
check "sin std::process::Command (usar tokio::process supervisado)" 'std::process::Command' crates apps/desktop/src-tauri/src
check "signingIdentity nunca es \"-\"" '"signingIdentity"\s*:\s*"-"' apps/desktop/src-tauri
check "sin codesign en scripts ni código" -P '^(?!\s*(//|#|\*|--)).*\bcodesign\b' "${SRC[@]}" scripts -g '!guards.sh'
for lib in crates/*/src/lib.rs apps/desktop/src-tauri/src/lib.rs; do
  if ! rg -q 'deny\(clippy::zombie_processes\)' "$lib"; then echo "✗ falta #![deny(clippy::zombie_processes)] en $lib"; fail=1; fi
done
[ $fail -eq 0 ] && echo "guards OK"
exit $fail
