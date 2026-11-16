# acta

Grabador de reuniones **local** para Mac (Windows más adelante). Detecta llamadas de Teams y Meet, graba dos pistas separadas (tú y los demás) a prueba de cierres inesperados, transcribe y diariza en local, y genera con un LLM el resumen, las decisiones, **tus tareas**, la escaleta y las capturas de la pantalla compartida. Todo se queda en tu disco.

## Estructura

| Carpeta | Qué es |
|---|---|
| `crates/acta-core` | Dominio, puertos y máquina de estados (sin I/O) |
| `crates/acta-audio` | Escritura WAV por segmentos, recuperación, autoparada, supervisor y procesado |
| `crates/acta-store` | SQLite + FTS5 + sqlite-vec, búsqueda híbrida, grupos |
| `crates/acta-llm` | `claude -p`, `codex exec`, OpenAI-compatible y Anthropic; acta y chat |
| `crates/acta-mac-bridge` | Cliente Rust del sidecar Swift |
| `sidecars/acta-mac` | Sidecar Swift: process tap, micro, Accessibility, ScreenCaptureKit, FluidAudio |
| `apps/desktop` | App Tauri v2 (React + TypeScript): ventana principal y pastilla flotante |

## Comprobar que todo compila

```sh
scripts/verify.sh
```

Lanza los guards, `cargo check`, clippy, los tests de Rust, `swift build --disable-get-task-allow-entitlement`, `tsc` y `vitest`.

> **No** se firma nada ni se empaqueta en este Mac (EDR de empresa): `signingIdentity: null`, sin `codesign`, sin `tauri build`.

## Documentación

- [docs/00-analisis.md](docs/00-analisis.md): análisis y decisión de base
- [docs/01-arquitectura.md](docs/01-arquitectura.md): arquitectura, contratos y plan de implementación
- [docs/02-verificacion-manual.md](docs/02-verificacion-manual.md): pruebas manuales
- [docs/referencia-meetily-zombis.md](docs/referencia-meetily-zombis.md): el bug que nunca debemos repetir
