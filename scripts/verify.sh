#!/usr/bin/env bash
# Verificación del proyecto (NUNCA build de bundle ni firma).
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/guards.sh
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
# --disable-get-task-allow-entitlement: evita que SwiftPM llame a `codesign`
# en builds debug (firmaría el binario de depuración).
(cd sidecars/acta-mac && swift build --disable-get-task-allow-entitlement)
(cd apps/desktop && pnpm install --frozen-lockfile && pnpm exec tsc --noEmit && pnpm exec vitest run)
