//! Utilidades de vectores para huellas de voz.

pub fn normalize(v: &[f32]) -> Vec<f32> {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n == 0.0 { v.to_vec() } else { v.iter().map(|x| x / n).collect() }
}

/// Media ponderada (`old` cuenta `samples` veces) y normalizada.
pub fn merge_mean(old: &[f32], samples: u32, new: &[f32]) -> Vec<f32> {
    if old.len() != new.len() {
        return normalize(new);
    }
    let w = samples.max(1) as f32;
    let mixed: Vec<f32> = old.iter().zip(new).map(|(a, b)| (a * w + b) / (w + 1.0)).collect();
    normalize(&mixed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_weights_previous_samples() {
        let m = merge_mean(&[1.0, 0.0], 3, &[0.0, 1.0]);
        assert!(m[0] > m[1] && (m[0] * m[0] + m[1] * m[1] - 1.0).abs() < 1e-5);
        assert_eq!(merge_mean(&[1.0], 1, &[0.0, 2.0]), vec![0.0, 1.0]);
    }
}
