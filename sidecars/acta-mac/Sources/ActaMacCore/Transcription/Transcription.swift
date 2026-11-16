// TODO(WP4): ASR (Parakeet TDT v3) y diarización (pyannote community-1) con FluidAudio.
// Escribe AsrFile / DiarizationFile en `out_path` (vía .tmp + rename) y
// emite `job.progress`. Los modelos se cachean en
// ~/Library/Application Support/acta/models/fluidaudio.
import ActaMacProtocol
import FluidAudio
import Foundation

enum TranscriptionPlaceholder {}
