# Verificación manual

Esta checklist se usa antes de dar por buena una fase. Cada WP añade aquí sus casos. Está pensada para una `.app` **sin firmar** en este Mac.

## Siempre

- [ ] `scripts/verify.sh` pasa.
- [ ] Durante 10 min de grabación, `ps -axo ppid=,stat= | awk -v p="$(pgrep -x acta)" '$1==p && $2 ~ /Z/' | wc -l` da **0**: no hay zombis.
- [ ] Al matar la app (`kill -9`), el proceso `acta-mac` desaparece en menos de 3 s.

## Fase 1: grabación (WP1 + WP4)

- [ ] Grabación manual de 5 min: aparece un `seg-*.wav` cada 30 s en cada pista.
- [ ] Al matar la app a mitad de un segmento y volver a abrirla, la reunión se recupera y se pierde ≤ 1 s.
- [ ] Al quitar el permiso de micro, salta el aviso "solo ceros" en menos de 10 s.
- [ ] Al cambiar a AirPods en mitad de la llamada, el audio sigue y se emite `audio.device_changed`.
- [ ] Las dos pistas quedan alineadas: una palmada que suene por altavoz aparece en el mismo instante en las dos.

## Fase 2: detección y autoparada

- [ ] Al entrar en una reunión de Teams, aparece "Reunión de Teams detectada — ¿Grabar?".
- [ ] Al colgar, aparece "La llamada ha terminado — ¿Parar?".
- [ ] Si no se responde y hay 2 min de silencio, la grabación se para sola.
- [ ] Typeless u Orca usando el micro no disparan la detección.

## Fase 3 en adelante

- [ ] Pendiente: diarización, nombres de Teams, escaleta, capturas, grupos y chat.
