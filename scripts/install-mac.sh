#!/usr/bin/env bash
# Compila e instala acta.app EN ESTE MAC, SIN FIRMAR (el EDR de empresa no lo permite).
#
# Uso:
#   scripts/install-mac.sh            # instala en ~/Applications
#   scripts/install-mac.sh --system   # instala en /Applications (puede pedir sudo)
#
# Qué hace: sidecar Swift -> frontend + app Tauri (solo .app) -> verifica -> instala.
# Garantía de "cero firma": ver docs/03-instalacion.md (sección "Por qué no se firma").
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
SIDECAR_DIR="$ROOT/sidecars/acta-mac"
BIN_DIR="$DESKTOP/src-tauri/binaries"
OVERLAY_CONF="src-tauri/tauri.bundle.conf.json"
APP_NAME="acta"

DEST_DIR="$HOME/Applications"
for arg in "$@"; do
  case "$arg" in
    --system) DEST_DIR="/Applications" ;;
    -h|--help) echo "Uso: scripts/install-mac.sh [--system]"; exit 0 ;;
    *) echo "Argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done

paso() { printf '\n==> %s\n' "$*"; }
fallo() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# --- 1. Requisitos ---------------------------------------------------------
paso "Comprobando requisitos"
[[ "$(uname -s)" == "Darwin" ]] || fallo "Solo macOS."
[[ "$(uname -m)" == "arm64" ]] || fallo "Hace falta Apple Silicon (arm64)."

macos="$(sw_vers -productVersion)"
IFS=. read -r mayor menor _ <<<"$macos"
menor="${menor:-0}"
if (( mayor < 14 || (mayor == 14 && menor < 2) )); then
  fallo "macOS $macos es demasiado antiguo: el process tap necesita 14.2 o superior."
fi

for herramienta in swift cargo rustc node pnpm; do
  command -v "$herramienta" >/dev/null 2>&1 || fallo "Falta '$herramienta' en el PATH."
done

TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
[[ -n "$TRIPLE" ]] || fallo "No pude leer el target triple de rustc."
echo "macOS $macos, target $TRIPLE"

# --- 2. Sidecar Swift ------------------------------------------------------
paso "Compilando el sidecar acta-mac (Swift, release)"
( cd "$SIDECAR_DIR" && swift build -c release --disable-get-task-allow-entitlement )
mkdir -p "$BIN_DIR"
cp -f "$SIDECAR_DIR/.build/release/acta-mac" "$BIN_DIR/acta-mac-$TRIPLE"
chmod +x "$BIN_DIR/acta-mac-$TRIPLE"
echo "Sidecar copiado a $BIN_DIR/acta-mac-$TRIPLE"

# --- 3. Dependencias del frontend ------------------------------------------
paso "Instalando dependencias (pnpm, lockfile congelado)"
( cd "$DESKTOP" && pnpm install --frozen-lockfile )

# --- 4. Bundle SIN firma ---------------------------------------------------
# Defensa en profundidad:
#  a) quitamos del entorno cualquier variable que active la firma o la notarización
#     (APPLE_SIGNING_IDENTITY sobreescribe a tauri.conf.json; APPLE_CERTIFICATE importa
#     un certificado en un llavero);
#  b) pasamos --no-sign, que salta TODA la firma del bundler;
#  c) las config fijan signingIdentity=null y hardenedRuntime=false.
paso "Empaquetando acta.app (solo .app, sin firma)"
unset APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD \
      APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER \
      APPLE_API_KEY_PATH APPLE_PROVIDER_SHORT_NAME

AYUDA="$( cd "$DESKTOP" && pnpm exec tauri build --help 2>/dev/null || true )"
if [[ "$AYUDA" != *--no-sign* ]]; then
  fallo "Este tauri-cli no tiene --no-sign. Abortamos antes de empaquetar (ver docs/03-instalacion.md)."
fi

( cd "$DESKTOP" && pnpm exec tauri build --bundles app --no-sign --features local-embeddings --config "$OVERLAY_CONF" )

# --- 5. Verificación del bundle --------------------------------------------
paso "Verificando el bundle"
APP=""
for candidato in \
  "$ROOT/target/release/bundle/macos/$APP_NAME.app" \
  "$DESKTOP/src-tauri/target/release/bundle/macos/$APP_NAME.app"; do
  if [[ -d "$candidato" ]]; then APP="$candidato"; break; fi
done
[[ -n "$APP" ]] || fallo "No encuentro $APP_NAME.app tras el bundle."

[[ -x "$APP/Contents/MacOS/acta-mac" ]] \
  || fallo "Falta Contents/MacOS/acta-mac en el bundle: el sidecar no se ha incluido (revisa externalBin)."

if [[ -e "$APP/Contents/_CodeSignature" ]]; then
  fallo "El bundle trae _CodeSignature: algo ha firmado la app. Esto no debe pasar en este Mac. No se instala."
fi
if command -v fd >/dev/null 2>&1 && [[ -n "$(fd -HI -t d '^_CodeSignature$' "$APP" 2>/dev/null)" ]]; then
  fallo "Hay un _CodeSignature dentro del bundle (framework o recurso firmado). No se instala."
fi
echo "OK: $APP (con sidecar, sin _CodeSignature)"

# --- 6. Instalación --------------------------------------------------------
paso "Instalando en $DEST_DIR"
# Cierra la app si está abierta (best effort).
osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
sleep 1

TARGET="$DEST_DIR/$APP_NAME.app"
if [[ "$DEST_DIR" == "/Applications" && ! -w "$DEST_DIR" ]]; then
  sudo rm -rf "$TARGET"
  sudo ditto "$APP" "$TARGET"
else
  mkdir -p "$DEST_DIR"
  rm -rf "$TARGET"
  ditto "$APP" "$TARGET"
fi

# No hace falta quitar la cuarentena: una app compilada aquí no la lleva.
cat <<MSG

Listo: $TARGET

Siguientes pasos:
  1. Ábrela. Si macOS la bloquea: Ajustes del Sistema > Privacidad y seguridad > "Abrir igualmente".
  2. Concede Micrófono y Audio del sistema cuando los pida. Accesibilidad se activa a mano.
  3. Ajustes > Modelos: descarga asr, diarizer y vad.
  4. Ajustes > Proveedores: configura el CLI de Claude.
Guía completa: docs/03-instalacion.md
MSG
