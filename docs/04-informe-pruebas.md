# Informe de pruebas de extremo a extremo

16 de noviembre de 2026 · macOS 26.5.2 arm64 · `acta.app` sin firmar instalada con `scripts/install-mac.sh`.

**Resultado**: todo lo que se puede probar sin una llamada real pasa. Se encontraron y arreglaron 4 fallos de producto. Queda 1 fallo abierto fuera de mi zona (el CLI de Claude bloqueado por un diálogo de macOS) y lo que necesita una llamada de Teams o Meet de verdad.

## Cómo se ha probado

| Capa | Qué usa | Cómo se lanza |
|---|---|---|
| Unitarias e integración | Fakes de todos los puertos | `scripts/verify.sh` |
| Sidecar Swift | Lógica pura, sin hardware | `cd sidecars/acta-mac && swift test --disable-get-task-allow-entitlement` |
| E2E real | Sidecar real, FluidAudio, SQLite temporal, `claude` real, Llavero | Ver abajo |
| Humo | La app instalada, con los datos reales | A mano, con capturas en `docs/screenshots/smoke/` |

```bash
ACTA_E2E=1 ACTA_MAC_SIDECAR=$PWD/sidecars/acta-mac/.build/release/acta-mac \
ACTA_E2E_MEETING=<carpeta con mic.wav y system.wav> \
ACTA_E2E_DATA_COPY=<copia de ~/Library/Application Support/acta> \
  cargo test -p acta-desktop --features local-embeddings --test e2e_real -- --ignored --test-threads=1 --nocapture
```

La reunión de prueba dura 57 s y tiene dos pistas: Mónica en el micro («Yo») y dos voces (Eddy y Flo) en el sistema, generadas con `say` a 16 kHz. Los datos de las pruebas van siempre a un directorio temporal (`ACTA_DATA_DIR`).

Recuentos (con `verify.sh` en verde): 366 pruebas Rust (11 más ignoradas: las E2E), 67 Swift, 226 de frontend, 7 E2E reales.

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
| Resumen con la app instalada | FAIL (abierto) | `claude` se queda parado hasta contestar «acta.app quiere acceder a los archivos de tu carpeta Documentos» | Ver «Fallo abierto» |
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

## Fallo abierto: el resumen se bloquea en la app instalada

- **Síntoma**: «Resumiendo…» durante minutos. En la prueba de humo fueron 9 minutos, hasta contestar el diálogo.
- **Causa**: el `claude` que lanza acta carga la configuración del usuario (hooks y skills que viven en `~/Documents`). macOS atribuye ese acceso a `acta.app` y pregunta «acta.app quiere acceder a los archivos de tu carpeta Documentos». Mientras nadie contesta, `claude` espera sin CPU ni red. Vuelve a pasar tras cada reinstalación.
- **Arreglo propuesto**: lanzar `claude` con `--safe-mode` (sin hooks, skills ni `CLAUDE.md`; la autenticación y el modelo siguen igual). Está en `crates/acta-llm/src/providers/claude.rs`, que ahora es de otro agente.
- **Mientras tanto**: contesta el diálogo. Con «No permitir» el resumen terminó en 20 s.

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

## Lo que he tocado en tu Mac

- **Permisos**: pulsé «Permitir» en los diálogos de micrófono y de audio del sistema de acta, y «No permitir» en el de la carpeta Documentos. La siguiente reinstalación los vuelve a pedir.
- **Disco**: se llenó (226 MB libres) durante las pruebas. Borré 14 GB de cachés de compilación antiguas en `target/` (`wp1`…`wp6*` y `fix`).
- **Modelos**: se descargó el modelo `vad` en la carpeta real de modelos.
- **Reuniones de prueba en tus datos**: 4 de hoy (17:28, 17:45, 17:48 y 17:50). Bórralas desde la app si no las quieres.

## Lo que tienes que probar tú

1. Una llamada real de Teams: detección, «¿Grabar?», nombres por Accesibilidad (`ACTA_AX_DUMP_DIR`, ver `docs/02-verificacion-manual.md` §4), hablante activo y «¿Parar?» al colgar.
2. Google Meet en Chrome, Arc, Edge, Brave y Safari.
3. Dictado con Typeless y Orca: no debe disparar la detección.
4. Capturas de pantalla compartida.
5. AirPods: conectar y desconectar a mitad de llamada.
6. Una reunión de 10 min y otra larga: tiempo y memoria.
7. Actualizar el CLI de Codex y repetir «Probar».
