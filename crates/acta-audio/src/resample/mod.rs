//! Remuestreo mono a 16 kHz (interpolación lineal, con estado entre frames).
//! Suficiente para voz de 8 kHz de ancho útil; el sidecar ya entrega 16 kHz,
//! esto es la red de seguridad si algún dispositivo no lo hace.

#[derive(Debug, Clone)]
pub struct Resampler {
    ratio: f64,
    prev: Option<f32>,
    phase: f64,
}

impl Resampler {
    pub fn new(from_rate: u32, to_rate: u32) -> Self {
        Self {
            ratio: f64::from(from_rate) / f64::from(to_rate),
            prev: None,
            phase: 0.0,
        }
    }

    pub fn process(&mut self, input: &[i16]) -> Vec<i16> {
        if input.is_empty() {
            return Vec::new();
        }
        let mut seq: Vec<f32> = Vec::with_capacity(input.len() + 1);
        if let Some(p) = self.prev {
            seq.push(p);
        }
        seq.extend(input.iter().map(|&s| f32::from(s)));
        let last = seq.len() - 1;
        let mut out = Vec::with_capacity((input.len() as f64 / self.ratio) as usize + 2);
        let mut p = self.phase;
        loop {
            let i = p.floor() as usize;
            if i + 1 > last {
                break;
            }
            let frac = (p - i as f64) as f32;
            let y = seq[i] + (seq[i + 1] - seq[i]) * frac;
            out.push(y.round().clamp(f32::from(i16::MIN), f32::from(i16::MAX)) as i16);
            p += self.ratio;
        }
        self.phase = p - last as f64;
        self.prev = Some(seq[last]);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, ms: u32, hz: f64) -> Vec<i16> {
        (0..rate * ms / 1000)
            .map(|n| {
                ((n as f64 / f64::from(rate) * hz * std::f64::consts::TAU).sin() * 10_000.0) as i16
            })
            .collect()
    }

    #[test]
    fn downsamples_48k_to_16k_keeping_duration() {
        let mut r = Resampler::new(48_000, 16_000);
        let out = r.process(&sine(48_000, 1_000, 440.0));
        assert!((out.len() as i64 - 16_000).abs() <= 2, "{}", out.len());
    }

    #[test]
    fn chunked_equals_whole_within_rounding() {
        let input = sine(44_100, 1_000, 300.0);
        let whole = Resampler::new(44_100, 16_000).process(&input);
        let mut r = Resampler::new(44_100, 16_000);
        let mut chunked = Vec::new();
        for c in input.chunks(4_410) {
            chunked.extend(r.process(c));
        }
        assert_eq!(whole.len(), chunked.len());
        assert!(whole.iter().zip(&chunked).all(|(a, b)| (a - b).abs() <= 1));
    }

    #[test]
    fn upsamples_8k_to_16k() {
        let out = Resampler::new(8_000, 16_000).process(&sine(8_000, 500, 200.0));
        assert!((out.len() as i64 - 8_000).abs() <= 2);
    }

    #[test]
    fn constant_signal_stays_constant() {
        let out = Resampler::new(48_000, 16_000).process(&[1000; 4800]);
        assert!(out.iter().all(|&s| s == 1000));
    }
}
