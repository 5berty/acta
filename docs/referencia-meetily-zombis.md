# Meetily 0.4.1: fuga de procesos zombi

Investigado el 6/11/2026 sobre `/Applications/meetily.app` (versión 0.4.1, `com.meetily.ai`). Código: [Zackriya-Solutions/meeting-minutes @ v0.4.1](https://github.com/Zackriya-Solutions/meeting-minutes/tree/v0.4.1) (commit `a2cb62e`; `main` a 2/11 sigue igual en estos ficheros).

## 1. Qué es un zombi y por qué te deja sin procesos

Cuando un programa lanza otro (aquí, `ffmpeg`), el hijo termina, pero el kernel guarda su entrada en la tabla de procesos hasta que el padre "recoge" su código de salida con `wait()`. Mientras nadie lo recoge, el hijo es un **zombi** (`<defunct>`, estado `Z`): no gasta CPU ni RAM, pero **ocupa un hueco de PID**. macOS limita los procesos por usuario (`kern.maxprocperuid = 5333`, `kern.maxproc = 8000`). Con ~4.870 zombis de Meetily más tus apps normales llegas al tope, y cualquier `fork` falla: `fork failed: resource temporarily unavailable`.

Los zombis desaparecen en cuanto el padre muere (launchd los adopta y los recoge). Comprobado: Meetily se cerró a las 11:23:21 ("voluntary") y a las 11:24 no quedaba ni uno.

## 2. Evidencia

| Dato | Valor |
|---|---|
| Zombis con padre Meetily (PID 74972) | ~4.870 |
| Límite por usuario | 5.333 → prácticamente lleno |
| Binarios del bundle | `Contents/MacOS/`: `meetily`, `ffmpeg` (8.0), `llama-helper` |
| Grabación afectada | `~/Movies/meetily-recordings/Meeting 06_11_26_10_06_59_…` |

En esa grabación (empezó a las 10:07), `.checkpoints/` tiene un `audio_chunk_NNN.mp4` cada 30 s **hasta las 10:13:00 y ninguno más**, aunque el audio seguía capturándose (coreaudiod con actividad constante) y `transcripts.json` se actualizó hasta las 11:07. El último fichero, `audio_chunk_011.mp4` (262 kB frente a ~630 kB de los demás), está **truncado** (`moov atom not found`): el ffmpeg que lo escribía murió a medias. `metadata.json` quedó en `"status": "recording"` y no hay `audio.mp4` final.

No pude muestrear los hijos vivos ni medir la velocidad dos veces porque la app ya estaba cerrada cuando empecé. Por los tiempos, si la fuga arrancó a las 10:13 y se paró al llenarse la tabla hacia las 11:06, sale **~90 zombis/min (~1,5/s)**. Esto es una estimación.

## 3. Causa raíz

**Confirmado en el código y reproducido con el ffmpeg del bundle.** Son tres fallos encadenados:

1. **El hijo no se recoge si falla la escritura.** [`audio/encode.rs` L73-L83](https://github.com/Zackriya-Solutions/meeting-minutes/blob/v0.4.1/frontend/src-tauri/src/audio/encode.rs#L73-L83), `encode_single_audio()`: hace `spawn()` de ffmpeg, `stdin.write_all(data)?` y solo después `wait_with_output()`. Si ffmpeg sale antes de leerlo todo, `write_all` devuelve *Broken pipe*, el `?` sale de la función y el `Child` se descarta **sin `wait()`**. Eso deja un zombi. El aviso de clippy está silenciado a propósito (`#[allow(clippy::zombie_processes)]`).
2. **Se reintenta en cada trozo de audio, para siempre.** [`audio/incremental_saver.rs` L69-L71](https://github.com/Zackriya-Solutions/meeting-minutes/blob/v0.4.1/frontend/src-tauri/src/audio/incremental_saver.rs#L69-L71), `add_chunk()`: `self.save_checkpoint()?; self.checkpoint_buffer.clear();`. Si `save_checkpoint` falla, el buffer **no se vacía**, así que sigue por encima del umbral de 30 s. Cada chunk siguiente lanza otro ffmpeg con el buffer entero, que además crece sin parar.
3. **El reintento falla siempre de la misma forma.** `checkpoint_count` solo sube si el guardado va bien ([L92-L104](https://github.com/Zackriya-Solutions/meeting-minutes/blob/v0.4.1/frontend/src-tauri/src/audio/incremental_saver.rs#L92-L104)), así que se reintenta el mismo `audio_chunk_011.mp4`, que ya existe. Los argumentos de ffmpeg no llevan `-y`, y con la entrada `pipe:0` ffmpeg no pregunta: imprime `File '…' already exists. Exiting.` y sale. Lo reproduje con `/Applications/meetily.app/Contents/MacOS/ffmpeg`, y el escritor recibe SIGPIPE. Resultado: *Broken pipe* → zombi → otro chunk → otro zombi…

**Inferido:** el disparo inicial fue la muerte de ffmpeg a las 10:13:00 a mitad de `audio_chunk_011`. No hay crash report ni log que diga por qué. A partir de ahí el bucle se mantiene solo. También es probable (no confirmado) que se parase al llenarse la tabla: entonces `spawn().expect(...)` hace panic y mata la tarea que guarda el audio.

**Consecuencia extra (grave):** de esa reunión solo se guardaron ~5,5 min de audio (checkpoints 000-010). El resto se perdió al cerrar la app.

Ya existe el issue [#891](https://github.com/Zackriya-Solutions/meeting-minutes/issues/891) (abierto el 28/10/2026, sin PR). Cita la salida temprana de `encode.rs` y otros `spawn()` "dispara y olvida" (`open`, `osascript` en `utils.rs`, `console_utils.rs`, `api.rs`…), que dejan un zombi por clic. **No menciona** el bucle de reintento ni la falta de `-y`, que son lo que convierte un zombi en miles.

## 4. Arreglo para tu fork

**a) `encode.rs`: recoger SIEMPRE al hijo y sobrescribir.**

```rust
let mut child = Command::new(ffmpeg_path)
    .args(["-y", "-loglevel", "error", /* …mismos args… */])
    .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped())
    .spawn()?;                                    // nada de .expect(): que no haga panic
let mut stdin = child.stdin.take().unwrap();
let mut stderr = child.stderr.take().unwrap();
let err_t = std::thread::spawn(move || { let mut s = String::new(); let _ = stderr.read_to_string(&mut s); s });
let write_res = stdin.write_all(data);
drop(stdin);
let status = child.wait()?;                       // se ejecuta aunque write_all haya fallado
let err = err_t.join().unwrap_or_default();
write_res.with_context(|| format!("ffmpeg cerró stdin antes de tiempo: {err}"))?;
anyhow::ensure!(status.success(), "ffmpeg falló: {err}");
```

Leer stderr en un hilo aparte también evita un bloqueo si ffmpeg llena esa tubería mientras tú escribes. Quita los `#[allow(clippy::zombie_processes)]` y pon `#![deny(clippy::zombie_processes)]` para que clippy no deje volver a colar uno. Si prefieres async: `tokio::process::Command` con `.kill_on_drop(true)` y `child.wait().await` en todos los caminos.

**b) `incremental_saver.rs`: no reintentar en bucle ni reutilizar nombres.**

```rust
if total_samples >= self.checkpoint_interval_samples {
    let buf = std::mem::take(&mut self.checkpoint_buffer); // se vacía pase lo que pase
    let idx = self.checkpoint_count;
    self.checkpoint_count += 1;                            // nunca se repite nombre
    if let Err(e) = self.save_checkpoint(buf, idx) {
        error!("checkpoint {idx} falló: {e}");
        // guarda el PCM en crudo (WAV con `hound`) para no perder audio y avisa a la UI
    }
}
```

Para no dejar ficheros a medias: escribe en `audio_chunk_NNN.tmp.mp4` y haz `rename` al terminar.

**c) Resto de #891:** cambia los `open`/`explorer`/`xdg-open` por `tauri-plugin-opener` y, en `osascript`, haz `.output()` o recoge el hijo en un hilo con `child.wait()`.

## 5. Cómo verificar el arreglo

```sh
while true; do
  p=$(pgrep -x meetily); date +%T
  ps -axo ppid=,stat= | awk -v p="$p" '$1==p && $2 ~ /Z/ {n++} END {print n+0}'
  sleep 10
done
```

1. Graba 5 min: el número debe quedarse en **0** y debe aparecer un `audio_chunk_NNN.mp4` cada 30 s.
2. Fuerza el fallo: durante una grabación de prueba crea a mano el siguiente `audio_chunk_NNN.mp4` en `.checkpoints/`. Sin el arreglo verás crecer los zombis; con él, el contador sigue en 0 y la grabación continúa.
3. Test unitario: llama a `encode_single_audio` con una ruta de salida que ya exista y comprueba después que `libc::waitpid(-1, …, WNOHANG)` devuelve `ECHILD` (no queda ningún hijo sin recoger).

## 6. Mientras tanto (sin fork)

- **Cierra y vuelve a abrir Meetily entre grabaciones.** Los zombis desaparecen al salir.
- Durante una reunión, si en `~/Movies/meetily-recordings/<reunión>/.checkpoints/` dejan de aparecer ficheros nuevos cada 30 s, o el contador de arriba pasa de 0, **el audio ya no se está guardando**: para la grabación y reinicia la app.
- Para recuperar los 5,5 min de la reunión de las 10:07, junta los checkpoints válidos: crea `lista.txt` con líneas `file 'audio_chunk_000.mp4'` … `file 'audio_chunk_010.mp4'` y ejecuta `ffmpeg -f concat -safe 0 -i lista.txt -c copy audio.mp4`. El 011 está corrupto.
