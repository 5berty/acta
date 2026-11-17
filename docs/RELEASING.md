# Publicar una release de acta

acta se publica como un `.zip` con `acta.app` **sin firmar ni notarizar**, en una GitHub Release, y un cask de Homebrew en un tap propio apunta a ese zip. Todo lo hace `.github/workflows/release.yml` al empujar un tag.

## Una sola vez, antes de la primera release

1. **Licencia.** Hecho: GPL-3.0-or-later (`LICENSE`, `Cargo.toml` y `package.json`).
2. **Repo público.** Quien instale por Homebrew descarga el zip sin autenticarse, así que las releases tienen que ser públicas.

No hace falta crear un repo aparte para Homebrew: este mismo repo es el tap (el cask vive en `Casks/acta.rb`). Ver más abajo.

## Publicar

1. Sube la versión en **tres** sitios (tienen que coincidir): `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/package.json` y `version` en `Cargo.toml`.
2. Commit, y:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. El workflow, en un runner macOS de GitHub:
   - comprueba que el tag coincide con la versión de `tauri.conf.json`;
   - pasa `scripts/guards.sh`;
   - compila el sidecar Swift y empaqueta con `tauri build --bundles app --no-sign`;
   - aborta si el bundle no trae el sidecar o trae `_CodeSignature`;
   - crea `acta-X.Y.Z-macos-arm64.zip` y su `.sha256`;
   - genera el cask (`packaging/homebrew/render-cask.sh`);
   - publica la release con el zip, el hash y `acta.rb`;
   - hace commit del cask en `Casks/acta.rb` de `main` (con el `GITHUB_TOKEN` del workflow; si `main` tiene protección de rama que bloquea al bot, este paso falla y el cask se copia a mano desde la release).

**Ensayo sin publicar:** Actions › *release* › *Run workflow*. Compila y sube el zip como artefacto, pero no crea la release.

## Cómo instalan y actualizan los usuarios

```bash
brew tap <usuario>/acta https://github.com/<usuario>/acta     # una sola vez
brew install --cask <usuario>/acta/acta
brew update && brew upgrade --cask acta                        # cuando haya versión nueva
```

La URL es necesaria porque Homebrew, sin ella, buscaría un repo llamado `homebrew-acta`. Según su [documentación](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap), ese prefijo es una recomendación para poder usar el `brew tap` corto, no un requisito.

`brew upgrade` solo ve versiones nuevas si el cask cambia: por eso el workflow lo actualiza en cada release.

**Inconvenientes de usar el repo principal como tap:**
- el comando de instalación es más largo (lleva la URL);
- `brew tap` clona el repo entero (código, capturas, historial) y cada `brew update` lo actualiza; un repo aparte `homebrew-acta` solo tendría el cask;
- el bot hace commits en `main`.

Si molesta, se pasa a un repo `homebrew-acta`: el comando queda en `brew install --cask <usuario>/acta/acta` sin tap previo, pero el workflow necesita un token con permiso sobre ese repo (secreto del repo principal) para subir el cask.

## Gatekeeper (el peaje de no firmar)

Un zip descargado de internet lleva cuarentena y macOS bloquea la primera apertura. El usuario tiene que hacer una vez: Ajustes del Sistema › Privacidad y seguridad › **Abrir igualmente** (o `xattr -dr com.apple.quarantine /Applications/acta.app`). El cask lo explica en sus `caveats`.

Decisión pendiente: el cask **no** quita la cuarentena solo. Se podría hacer con un `postflight`, pero implica saltarse Gatekeeper en nombre del usuario. Además, Homebrew ha retirado el soporte oficial de `--no-quarantine`, y no he comprobado que un `postflight` siga funcionando.

Cada versión nueva cambia el hash del binario, así que macOS puede volver a pedir los permisos (micrófono, audio del sistema, accesibilidad).

## Por qué no en homebrew/cask oficial

La documentación de Homebrew exige que la app no obligue a saltarse Gatekeeper, y varios informes indican que los casks sin firmar ni notarizar se están deshabilitando. No lo he podido confirmar en la documentación oficial. Entrar en el repositorio oficial requeriría firmar con un certificado de Apple Developer y notarizar. Con un tap propio no hace falta.

## Por qué se compila en GitHub y no en servidores propios

El sidecar usa Core Audio, ScreenCaptureKit y Accessibility, y el bundle necesita el SDK de macOS: solo se puede compilar en macOS. Un servidor Linux no sirve. Se usa el runner `macos-15` (Apple Silicon) de GitHub.

**Coste:** según la política de GitHub, los runners estándar son gratuitos en repos públicos; en privados los minutos de macOS cuentan por diez. Una compilación completa tarda decenas de minutos, así que conviene comprobarlo en tu plan antes de lanzar muchas en un repo privado. Por eso `ci.yml` solo corre en pull requests y a mano.

## Actualizaciones dentro de la app (no implementado)

El plugin [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/) permitiría actualizar sin Homebrew. Requiere:

- un par de claves propio (`tauri signer generate`), con la clave pública en `tauri.conf.json` y la privada como secreto del repo. **Si se pierde la privada, no se podrá actualizar a quien ya tenga la app**;
- subir `.app.tar.gz`, su `.sig` y un `latest.json` a cada release.

La firma del updater es independiente de la de Apple. No he encontrado confirmación de que funcione con una app sin firmar: habría que probarlo antes de depender de ello. Y si se activa, el cask debería declarar `auto_updates true`.

## Pendiente de comprobar en la primera ejecución real

Los workflows pasan `actionlint`, pero **no se han ejecutado todavía**. Puede fallar:

- el sidecar con el Xcode del runner (`Package.swift` pide `swift-tools-version: 6.0`);
- `cargo test --workspace` en un runner sin dispositivos de audio;
- que la app descomprimida desde el zip abra en Apple Silicon (el enlazador la firma ad hoc de serie; `ditto` conserva el binario tal cual).
