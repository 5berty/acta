# Grabador de reuniones propio: análisis y propuesta (16-nov-2026)

## 1. Decisión de base
**Construir desde cero en Rust + Tauri v2. NO hacer fork de Meetily.**
- Meetily (MIT, Tauri+Rust+Next.js): sin diarización ni detección automática. Su deuda está justo en captura, arranque y parada (#885 #871 #886 #851 #835), con ffmpeg-sidecar, código muerto y un backend Python heredado. Sirve como referencia de UX y de proveedores LLM.
- anarlog (antes Hyprnote/Char, MIT salvo `enterprise/`): monorepo de más de 150 crates. Tiene piezas valiosas para estudiar o copiar respetando la licencia: `detect` (meeting_ax), `audio-actual` (cidre/wasapi + `recovery.rs`), `aec`, `vad`, `voiceprint`, `overlay-kit`, `tcc`.
- El fallo de los zombis ([meetily-procesos-zombi.md](referencia-meetily-zombis.md)) viene del diseño: un ffmpeg por cada chunk. En nuestra app el audio se escribe desde Rust (WAV/Opus por segmentos, `.tmp` + `rename`) y no se lanza ningún proceso por chunk.

## 2. Arquitectura (hexagonal)
Dominio: `Session` (máquina de estados), `Meeting`, `Speaker`, `Group`, `ActionItem`.

```
Idle → Detectada → Grabando → Parando → Procesando → Lista
          │             │  ▲
          └ ignorar     └ pausa / recuperación tras crash
```

Puertos y adaptadores:

| Puerto | macOS (fase 1) | Windows (después) |
|---|---|---|
| AudioSource (otros) | Core Audio process tap (macOS 14.2+), sidecar Swift o `cidre` | WASAPI process loopback (crate `wasapi`); plan B, loopback del dispositivo |
| AudioSource (yo) | cpal / AVAudioEngine | cpal |
| MeetingDetector | mic en uso por proceso (`kAudioProcessPropertyIsRunningInput`) + ventana de Teams por AX + URL de Meet por AppleScript | registro CapabilityAccessManager + UI Automation |
| SpeakerNames | Accessibility sobre Teams escritorio, como hace Granola | UI Automation |
| Transcriber | Parakeet TDT v3 vía FluidAudio (ANE, unas 190x tiempo real) | whisper-rs o Parakeet ONNX |
| Diarizer | FluidAudio (pyannote community-1, ~15 % DER), solo en el canal del sistema | sherpa/pyannote ONNX |
| LlmProvider | OpenAI-compatible (Ollama, LM Studio, OpenRouter), Anthropic, CLI local (`claude -p` / `codex exec`) | igual |
| Store / Search | SQLite + FTS5 + sqlite-vec, embeddings multilingües (bge-m3 / e5) | igual |
| Overlay | NSPanel no activable (`tauri-nspanel`), visible en todos los Spaces y a pantalla completa | WS_EX_TOOLWINDOW / NOACTIVATE |

Principios:
- Pistas separadas (yo / otros). Así "yo" es gratis y solo se diariza a los demás.
- Persistencia incremental. Si la app muere, la sesión se recupera al abrir.
- Todo proceso hijo supervisado: `kill_on_drop` + `wait()` en todos los caminos + `#![deny(clippy::zombie_processes)]`.
- Parada garantizada: cuando la llamada termina, la app propone parar. Si no respondes, para sola tras N minutos de silencio. Hay además un tope duro configurable.

## 3. Funcionalidades
1. Detecta la llamada de Teams o Meet y muestra la pastilla flotante "¿Grabar?".
2. La pastilla se queda en primer plano mientras graba (tiempo, nivel de las dos pistas, pausa, parar).
3. Al terminar la llamada: "¿Parar?", con autoparada por silencio.
4. Transcript con hablantes: tú, más Speaker 1..N renombrables, con nombres sacados de la UI de Teams y huellas de voz que se recuerdan entre reuniones (siempre confirmadas por ti).
5. Resumen, action items **tuyos** ("en tu tejado") y decisiones, con plantillas.
6. Escaleta: JSON del LLM pintado como árbol o markmap, más una línea de tiempo con saltos al minuto exacto del audio.
7. Grupos: manuales y sugeridos por clustering de embeddings, con nombre puesto por el LLM.
8. Chat: sobre una reunión (contexto completo) o sobre un grupo (RAG híbrido).

## 4. LLM y suscripciones (lo legal)
- Anthropic **prohíbe** que una app de terceros use el login o los tokens de Claude.ai/Pro/Max. Con OpenAI, "Sign in with ChatGPT" solo funciona en apps aprobadas.
- Opciones válidas:
  - API key propia.
  - Modelos locales (Ollama).
  - Para uso personal: lanzar el `claude` o `codex` que ya tienes instalados, sin tocar sus credenciales. Es zona gris tolerada y lleva aviso.

## 5. Riesgos que hay que probar primero (spike de 1 día)
1. Process tap sobre MSTeams en una `.app` **sin firmar**: si el permiso TCC persiste entre rebuilds y reinicios.
2. Si el tap sobrevive a un cambio de AirPods o auriculares.
3. Lectura AX de Teams: participantes y hablante activo.
4. Calidad de Parakeet frente a Whisper en 10 min de Teams real en castellano.
5. Señal de mic en uso por proceso para el inicio y el fin, y falsos positivos con Typeless u Orca.

## 6. Fases
| Fase | Entregable |
|---|---|
| 0 | Spike de los riesgos (sección 5) |
| 1 (MVP) | Pastilla manual, grabación en dos pistas a prueba de crash, transcripción Parakeet, yo/otros, resumen + action items (API key / CLI) |
| 2 | Detección de Teams y Meet, avisos de inicio y fin, autoparada |
| 3 | Diarización, huellas de voz, nombres desde Teams |
| 4 | Escaleta, timeline, grupos, chat RAG |
| 5 | Windows |

## 7. Legal / empresa
España: grabar una conversación en la que participas es lícito. Difundirla o tratar voces de terceros cae bajo el RGPD, y en la empresa manda su política. Conviene avisar a los participantes. Las huellas de voz son datos biométricos: se guardan solo los embeddings y deben poder borrarse.

## Fuentes clave
recall.ai/blog/core-audio-taps · github.com/insidegui/AudioCap · github.com/FluidInference/FluidAudio · docs.granola.ai (speaker attribution Teams) · github.com/fastrepl/anarlog · github.com/Zackriya-Solutions/meeting-minutes · code.claude.com/docs/en/legal-and-compliance · learn.microsoft.com (process loopback)
