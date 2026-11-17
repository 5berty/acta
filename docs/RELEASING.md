# Publicar una release de acta

acta se publica como un `.zip` con `acta.app` **sin firmar ni notarizar**, en una GitHub Release, y un cask de Homebrew en un tap propio apunta a ese zip. Todo lo hace `.github/workflows/release.yml` al empujar un tag.

## Una sola vez, antes de la primera release

1. **Licencia.** Hoy `Cargo.toml` dice `UNLICENSED` y no hay `LICENSE`. Elige una, añade el archivo y actualiza `license` en `Cargo.toml`. Sin licencia no es código abierto.
2. **Repo público.** Quien instale por Homebrew descarga el zip sin autenticarse, así que las releases tienen que ser públicas.
3. **Tap de Homebrew.** Crea el repo `homebrew-acta` (el nombre tiene que empezar por `homebrew-`):

   ```bash
   gh repo create <usuario>/homebrew-acta --public --description "Homebrew tap de acta"
   ```

4. **Token para que el workflow actualice el tap** (opcional, pero evita copiar el cask a mano). Crea un token *fine-grained* con permiso **Contents: Read and write** solo sobre `homebrew-acta` y guárdalo como secreto del repo de acta:

   ```bash
   gh secret set TAP_GITHUB_TOKEN --repo <usuario>/acta
   ```

   Sin el secreto, la release se publica igual y el workflow avisa: copia `acta.rb` (adjunto en la release) a `Casks/acta.rb` del tap.

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
   - si hay `TAP_GITHUB_TOKEN`, sube el cask al tap.

**Ensayo sin publicar:** Actions › *release* › *Run workflow*. Compila y sube el zip como artefacto, pero no crea la release.

## Cómo instalan y actualizan los usuarios

```bash
brew install --cask <usuario>/acta/acta     # instala (añade el tap solo)
brew upgrade --cask acta                    # actualiza cuando hay versión nueva en el tap
```

`brew upgrade` solo ve versiones nuevas si el cask del tap cambia: por eso el workflow lo actualiza en cada release.

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
