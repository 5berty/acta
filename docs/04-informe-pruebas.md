# Informe de pruebas de extremo a extremo

16 de noviembre de 2026 · macOS 26.5.2 arm64 · `acta.app` sin firmar instalada con `scripts/install-mac.sh`.

**Resultado**: todo lo que se puede probar sin una llamada real pasa. Se encontraron y arreglaron 6 fallos de producto. Queda 1 limitación abierta (macOS pregunta por la carpeta Documentos cuando acta ejecuta `claude`, y el resumen espera a que contestes) y lo que necesita una llamada de Teams o Meet de verdad.

## Cómo se ha probado

| Capa | Qué usa | Cómo se lanza |
|---|---|---|
| Unitarias e integración | Fakes de todos los puertos | `scripts/verify.sh` |
| Sidecar Swift | Lógica pura, sin hardware | `cd sidecars/acta-mac && swift test --disable-get-task-allow-entitlement` |
| E2E real | Sidecar real, FluidAudio, SQLite temporal, `claude` real, Llavero | Ver abajo |
| Humo | La app instalada: con los datos reales y con un directorio de datos nuevo (bienvenida) | A mano, con capturas en `docs/screenshots/smoke/` |

```bash
ACTA_E2E=1 ACTA_MAC_SIDECAR=$PWD/sidecars/acta-mac/.build/release/acta-mac \
ACTA_E2E_MEETING=<carpeta con mic.wav y system.wav> \
ACTA_E2E_DATA_COPY=<copia de ~/Library/Application Support/acta> \
  cargo test -p acta-desktop --features local-embeddings --test e2e_real -- --ignored --test-threads=1 --nocapture
```

La reunión de prueba dura 57 s y tiene dos pistas: Mónica en el micro («Yo») y dos voces (Eddy y Flo) en el sistema, generadas con `say` a 16 kHz. Los datos de las pruebas van siempre a un directorio temporal (`ACTA_DATA_DIR`).

Recuentos (con `verify.sh` en verde): 368 pruebas Rust (11 más ignoradas: las E2E), 67 Swift, 228 de frontend, 7 E2E reales.

## Resultados

| Función | Estado | Evidencia | Arreglo |
|---|---|---|---|
| Captura de micro y audio del sistema | PASS | `e2e_live_recording_with_system_tap`: `system.wav` con 295 368 de 319 531 muestras no nulas, `mic.wav` con 291 221 | — |
| Voz del sistema con auriculares Bluetooth | PASS (tras arreglo) | Antes: «porque no hay diversión, tío». Después: «vamos a revisar el presupuesto del proyecto y la fecha de entrega de la próxima semana» | `11f0a4e` |
| Estado de los modelos y descarga | PASS | `asr` y `diarizer` descargados; `vad` se descargó en la prueba (`done: true`) | — |
| ASR en español | PASS | 17 frases de la reunión de prueba, con errores menores («post-grescle», «día30») | — |
| Diarización | PASS | «Yo», «Speaker 1», «Speaker 2» bien repartidos en las 17 frases | — |
| Pipeline completo hasta «Lista» con `claude` | PASS | 3 reuniones en 60, 76 y 91 s. Título, 1 decisión, 4 tareas (la del presupuesto marcada como mía), escaleta de 4 temas, timeline de 9 eventos | — |
| Indexado y búsqueda | PASS | «presupuesto finanzas» encuentra la frase; la búsqueda semántica devuelve 3 resultados | — |
| Chat sobre la reunión | PASS | Responde quién prepara la demo y para qué cliente, con 1 cita y eventos `chat:delta` | — |
| Sugerencia y nombre de grupos | PASS | «Seguimiento demo y migración PostgreSQL», 3 reuniones, cohesión 1.0; aceptar crea el grupo | — |
| Huellas de voz | PASS | Renombrar a «Ana García» con «recordar» y reprocesar otra reunión la reconoce | — |
| Ajustes: guardar y cargar | PASS | Sobreviven a reiniciar el núcleo | — |
| Detectar el CLI de Claude | PASS | `/opt/homebrew/bin/claude` con `CLAUDE_CONFIG_DIR` | — |
| Probar conexión con Claude | PASS | «Conexión correcta (claude-fable-5-2)», 2,1 s | — |
| Probar conexión con Codex | FAIL (externo) | «The 'gpt-6-astra' model requires a newer version of Codex». No es la cuota: hay que actualizar el CLI de Codex | — |
| Llavero: guardar y borrar | PASS | Servicio de pruebas `acta-e2e-test`, borrado al terminar | — |
| Detección → «¿Grabar?» → «¿Parar?» → autoparada | PASS (simulado) | `e2e_simulated_detection_prompts_and_auto_stops`: detector guionizado, audio real, parada por `AutoSilence` | — |
| Pastilla y preguntas | PASS (simulado) | Pruebas del supervisor y `Overlay.test.tsx` | — |
| Recuperación tras `kill -9` | PASS | Reunión recuperada con 40,8 s de audio, sin sidecar huérfano (murió en 0,3 s) | — |
| Reintentar una reunión fallida | PASS | Copia de los datos reales: la reunión de las 15:31 llega a «Lista» | — |
| Reintentar una reunión sin audio | PASS (tras arreglo) | Antes pasaba a «Lista» vacía; ahora vuelve a fallar con «No se grabó audio…» | `049c8a2` |
| Grabar tras reinstalar (permisos sin decidir) | PASS (tras arreglo) | Antes: «Grabando 00:00» y reunión vacía. Ahora se pregunta antes de empezar | `6f827c0` |
| Menú de la barra según el estado | PASS (tras arreglo) | Capturas 07, 08 y 09 | `596d905` |
| Resumen con la app instalada | PASS con aviso | «Lista» en 26 s. Tras reinstalar, `claude` espera hasta que contestes «acta.app quiere acceder a los archivos de tu carpeta Documentos» | Ver «Limitación abierta» |
| Bienvenida de primer arranque | PASS | Los 6 pasos en la app real con datos nuevos; `onboarding.completed` queda en `true` | — |
| Bienvenida: conceder permisos | PASS | «Conceder» abre el diálogo de macOS y el estado pasa a «Concedido» | — |
| Bienvenida: Ollama y LM Studio sin instalar | PASS | «No está en marcha» y enlace para instalar; «Continuar» desactivado | — |
| Bienvenida: «Crear cuenta» de NaN Builders | PASS | Abre `https://cloud.nan.builders/r/YZ524NPK` en el navegador por defecto (Brave) | — |
| Filas de Automatización con dos navegadores | PASS (tras arreglo) | Antes salían dos filas iguales; ahora «Automatización (Google Chrome)» y «(Brave)» | `b773573` |
| Contrato de comandos Rust ↔ TypeScript | PASS (tras arreglo) | Faltaban 3 comandos en Rust y `audio_inputs_list` en TypeScript | `801fb3d` |
| Nombres de Teams por Accesibilidad | PENDIENTE-HARDWARE | Hace falta una llamada real | — |
| Detección real de Teams y Meet | PENDIENTE-HARDWARE | Hace falta una llamada real | — |
| Capturas de pantalla compartida | PENDIENTE-HARDWARE | Hace falta alguien compartiendo | — |
| Cambio de AirPods a mitad de llamada | PENDIENTE-HARDWARE | Conectar y desconectar a mano | — |
| Reunión de 10 min y de 4 h | PENDIENTE-HARDWARE | Tiempo y memoria sin medir | — |

## Fallos arreglados

### 1. La pista del sistema salía ininteligible con auriculares Bluetooth (`11f0a4e`)

- **Síntoma**: con AirPods, la transcripción de «los demás» era un galimatías, a veces en inglés.
- **Causa**: al abrir el micro, los AirPods pasan a HFP unos segundos **después** de crear el agregado del tap. El agregado sigue anunciando 48 kHz y entrega 24 kHz. Remuestreado como 48 kHz, el audio salía al doble de velocidad con un hueco tras cada trozo: el 50 % de `system.wav` eran ceros en tramos de 50 ms.
- **Arreglo**: `RateEstimator` mide la frecuencia real de entrega por pista y cambia el remuestreador cuando dos ventanas seguidas de 1 s coinciden en otra frecuencia estándar.
- **Límite**: los 2 o 3 primeros segundos tras el cambio siguen saliendo mal.

### 2. Tras reinstalar, grababa «00:00» y dejaba una reunión vacía (`6f827c0`)

- **Causa**: una app sin firmar cambia de identidad al recompilar y macOS vuelve a pedir el micro. La captura arrancaba con el diálogo abierto, la HAL se quedaba bloqueada y `capture.stop` caducaba a los 10 s.
- **Arreglo**: los permisos sin decidir se piden **antes** de empezar la sesión. Si se deniegan, se devuelve un error claro y no se crea ninguna reunión.

### 3. El menú de la barra enseñaba «Grabar ahora» y «Parar grabación» a la vez (`596d905`)

| Estado | Menú |
|---|---|
| Reposo, lista o fallida | Grabar ahora |
| Reunión detectada | «Reunión en Microsoft Teams» · Grabar · Ignorar |
| Grabando | «Grabando · 03:12» · Pausar · Parar grabación |
| En pausa | «En pausa · 03:12» · Reanudar · Parar grabación |
| Parando o recuperando | Estado desactivado |
| Procesando | «Procesando…» · Grabar ahora |

Procesando mantiene «Grabar ahora» porque procesar no bloquea una grabación nueva. El menú solo se rehace cuando cambian sus entradas; el reloj cambia el texto, para no cerrar un menú abierto.

### 4. Reintentar una reunión sin audio la dejaba «Lista» y vacía (`049c8a2`)

«Reintentar» empieza en «Transcribir», después de la comprobación del paso «Unir el audio». Ahora la comprobación también se hace al transcribir.

### 5. Dos filas iguales de «Automatización» (`b773573`)

macOS da un permiso de Automatización por navegador abierto. La bienvenida y Ajustes pintaban dos filas idénticas con la misma clave de React. Ahora cada fila dice su navegador.

### 6. Comandos fuera del contrato (`801fb3d`)

`llm_list_models`, `llm_detect_local` y `open_external_url` no estaban en `acta_core::api::command_names`, y `audio_inputs_list` no estaba en el contrato de TypeScript.

## Limitación abierta: macOS pregunta por la carpeta Documentos

- **Síntoma**: tras reinstalar, «Resumiendo…» o «Probando…» no terminan. En la primera prueba de humo fueron 9 minutos, hasta contestar el diálogo.
- **Causa**: el `claude` que ejecuta acta abre algo dentro de `~/Documents` y macOS atribuye ese acceso a `acta.app`. Mientras nadie contesta, `claude` queda bloqueado en esa lectura, sin CPU ni red. No he podido ver qué ruta abre.
- **Lo que no lo arregla**: `--safe-mode`. Lo probé (`b4d1d55`) y el diálogo sigue saliendo. Lo he dejado puesto porque esas llamadas no necesitan tus hooks ni tus skills.
- **Lo que sí he hecho**: el diálogo ahora explica quién lo pide y que puedes denegarlo (`459f51b`), y está documentado en `docs/03-instalacion.md`.
- **Qué hacer**: contesta el diálogo una vez por instalación. Con «No permitir» el resumen terminó en 20 s y la prueba de conexión dio «Conexión correcta».

## Prueba de humo con la app instalada

| Paso | Resultado | Captura |
|---|---|---|
| Abrir con los datos reales, sin demo | 3 reuniones | `smoke/01-lista-inicial.png` |
| Reunión de las 15:31 (la que falló por `$schema`) | «Lista», con resumen | `smoke/02-reunion-edu-1531.png` |
| Menú de la barra en reposo | Solo «Grabar ahora» | `smoke/07-menu-barra-reposo.png` |
| Grabar desde la barra, 25 s con `say` y un sonido | Graba | `smoke/03-grabando.png`, `smoke/08-menu-barra-grabando.png` |
| Parar | «Procesando…» | `smoke/04-procesando.png`, `smoke/09-menu-barra-procesando.png` |
| Reunión lista | «Prueba de humo de acta: publicación de la versión nueva», 1 decisión, 1 tarea | `smoke/05-lista-ready.png`, `smoke/06-reunion-resumen.png` |
| Transcript | Las tres frases dichas, bien | `smoke/10-reunion-transcript.png` |

La reunión de las 15:31 ya estaba en «Lista» al empezar: alguien la reintentó a las 16:42 con el arreglo de `$schema`.

### Bienvenida y grabación con datos nuevos

Lanzada con `open -a ~/Applications/acta.app --env ACTA_DATA_DIR=<carpeta vacía>`, para no gastar tu bienvenida.

| Paso | Resultado | Captura |
|---|---|---|
| 1. Bienvenida | Aparece sola | `smoke/13-bienvenida-1.png` |
| 2. Permisos | Micro y audio del sistema pasan a «Concedido» | `smoke/14-bienvenida-permisos.png` |
| 3. Transcripción | Los tres modelos descargados | `smoke/15-bienvenida-transcripcion.png` |
| 4. Inteligencia artificial | Claude Code detectado, «Conexión correcta» | `smoke/16-bienvenida-ia.png` |
| 4. Modelo local | Ollama y LM Studio «No está en marcha» | `smoke/17-bienvenida-modelo-local.png` |
| 4. NaN Builders | «Crear cuenta» abre el enlace en Brave | `smoke/18-bienvenida-nan.png` |
| 5. Detección | Valores por defecto | `smoke/19-bienvenida-deteccion.png` |
| 6. Listo | Resumen con los cuatro puntos en verde | `smoke/20-bienvenida-listo.png` |
| Grabar 17 s y parar | «Cierre de versión e informe de pruebas», «Lista» en 26 s | `smoke/12-final-grabando.png`, `smoke/21-final-reunion.png` |

## Lo que he tocado en tu Mac

- **Permisos**: pulsé «Permitir» en los diálogos de micrófono y de audio del sistema de acta, y «No permitir» en el de la carpeta Documentos. En una de las compilaciones intermedias pulsé «Permitir» en el de Documentos por error; la compilación siguiente volvió a preguntar, así que no ha quedado concedido. Cada reinstalación los vuelve a pedir, también la última: te los pedirá a ti.
- **Navegador**: la prueba de «Crear cuenta» abrió una pestaña de NaN Builders en Brave.
- **Disco**: se llenó (226 MB libres) durante las pruebas. Borré 14 GB de cachés de compilación antiguas en `target/` (`wp1`…`wp6*` y `fix`).
- **Modelos**: se descargó el modelo `vad` en la carpeta real de modelos.
- **Reuniones de prueba en tus datos**: 5 de hoy (17:28, 17:45, 17:48, 17:50 y 18:08). Bórralas desde la app si no las quieres.

## Lo que tienes que probar tú

1. Una llamada real de Teams: detección, «¿Grabar?», nombres por Accesibilidad (`ACTA_AX_DUMP_DIR`, ver `docs/02-verificacion-manual.md` §4), hablante activo y «¿Parar?» al colgar.
2. Google Meet en Chrome, Arc, Edge, Brave y Safari.
3. Dictado con Typeless y Orca: no debe disparar la detección.
4. Capturas de pantalla compartida.
5. AirPods: conectar y desconectar a mitad de llamada.
6. Una reunión de 10 min y otra larga: tiempo y memoria.
7. Actualizar el CLI de Codex y repetir «Probar».
8. La bienvenida te saldrá una vez con tus datos reales: complétala o pulsa «Saltar».
