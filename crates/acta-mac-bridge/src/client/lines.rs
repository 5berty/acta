//! Lectura de líneas con tope de tamaño que SIGUE leyendo tras una línea
//! demasiado larga (`tokio_util::codec::LinesCodec` termina el stream tras el
//! primer error, y eso dejaría al cliente sordo).

use tokio::io::{AsyncBufRead, AsyncBufReadExt};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Line {
    Text(String),
    /// La línea superaba el tope; se descartó entera (bytes vistos).
    TooLong(usize),
}

/// Siguiente línea (sin `\n`). `Ok(None)` en EOF.
pub(crate) async fn next_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<Option<Line>> {
    buf.clear();
    let mut overflow = false;
    let mut seen = 0usize;
    loop {
        let avail = reader.fill_buf().await?;
        if avail.is_empty() {
            if seen == 0 {
                return Ok(None);
            }
            break;
        }
        let newline = avail.iter().position(|b| *b == b'\n');
        let chunk = &avail[..newline.unwrap_or(avail.len())];
        seen += chunk.len();
        if !overflow {
            if buf.len() + chunk.len() > max {
                overflow = true;
                buf.clear();
            } else {
                buf.extend_from_slice(chunk);
            }
        }
        let used = newline.map_or(avail.len(), |i| i + 1);
        reader.consume(used);
        if newline.is_some() {
            seen += 1;
            break;
        }
    }
    if overflow {
        return Ok(Some(Line::TooLong(seen)));
    }
    if buf.last() == Some(&b'\r') {
        buf.pop();
    }
    Ok(Some(Line::Text(String::from_utf8_lossy(buf).into_owned())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    async fn all(input: &[u8], max: usize) -> Vec<Line> {
        let mut r = BufReader::with_capacity(4, input);
        let mut buf = Vec::new();
        let mut out = Vec::new();
        while let Some(l) = next_line(&mut r, &mut buf, max).await.unwrap() {
            out.push(l);
        }
        out
    }

    #[tokio::test]
    async fn splits_lines_across_small_buffers() {
        let got = all(b"hello world\nsecond\nlast-no-newline", 100).await;
        assert_eq!(
            got,
            vec![
                Line::Text("hello world".into()),
                Line::Text("second".into()),
                Line::Text("last-no-newline".into()),
            ]
        );
    }

    #[tokio::test]
    async fn too_long_line_is_dropped_and_reading_continues() {
        let got = all(b"short\naaaaaaaaaaaaaaaaaaaa\nafter\n", 10).await;
        assert_eq!(
            got,
            vec![Line::Text("short".into()), Line::TooLong(21), Line::Text("after".into())]
        );
    }
}
