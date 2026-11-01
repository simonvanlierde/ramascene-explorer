//! The browser scenario maths: the small Woodbury system and the flow fold.
//!
//! Matrices arrive as row-major `f64` slices, as the JavaScript worker holds them.
//! See `scenarioFlows` in browser-engine.js for how the pieces are gathered.

use faer::linalg::matmul::matmul;
use faer::linalg::solvers::Solve;
use faer::{Accum, Mat, MatMut, MatRef, Par};

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Dimensions,
    NonFinite,
    Singular,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Dimensions => "invalid solve dimensions",
            Self::NonFinite => "the solve needs finite numbers",
            Self::Singular => "singular or ill-conditioned scenario",
        })
    }
}

fn finite(values: &[f64]) -> Result<(), Error> {
    values
        .iter()
        .all(|v| v.is_finite())
        .then_some(())
        .ok_or(Error::NonFinite)
}

/// W = (I − ΔA T)⁻¹ ΔA X = ΔA (I − T ΔA)⁻¹ X, solved in whichever form is smaller.
///
/// `delta` is ΔA (r × k), `t` is L[K, R] (k × r) and `x` is X₀[K, :] (k × c); the
/// result is W (r × c), row-major. A pivot at or below `epsilon · scale · n` is
/// refused, where the scale includes each row's terms before I − ΔA T cancels.
pub fn correction(
    delta: &[f64],
    t: &[f64],
    x: &[f64],
    r: usize,
    k: usize,
    c: usize,
    epsilon: f64,
) -> Result<Vec<f64>, Error> {
    if r == 0 || k == 0 || c == 0 || delta.len() != r * k || t.len() != k * r || x.len() != k * c {
        return Err(Error::Dimensions);
    }
    finite(delta)?;
    finite(t)?;
    finite(x)?;
    let delta = MatRef::from_row_major_slice(delta, r, k);
    let t = MatRef::from_row_major_slice(t, k, r);
    let x = MatRef::from_row_major_slice(x, k, c);
    let row_abs = |m: MatRef<'_, f64>| -> Vec<f64> {
        (0..m.nrows())
            .map(|i| (0..m.ncols()).map(|j| m[(i, j)].abs()).sum())
            .collect()
    };
    let w = if r <= k {
        // S = I − ΔA T (r × r), right side ΔA X
        let t_abs = row_abs(t);
        let scale = (0..r)
            .map(|i| 1.0 + (0..k).map(|j| delta[(i, j)].abs() * t_abs[j]).sum::<f64>())
            .fold(1.0, f64::max);
        let mut s = Mat::<f64>::identity(r, r);
        matmul(&mut s, Accum::Add, delta, t, -1.0, Par::Seq);
        let mut rhs = Mat::<f64>::zeros(r, c);
        matmul(&mut rhs, Accum::Replace, delta, x, 1.0, Par::Seq);
        solve(s.as_ref(), rhs.as_ref(), scale, epsilon)?
    } else {
        // S = I − T ΔA (k × k), W = ΔA S⁻¹ X
        let d_abs = row_abs(delta);
        let scale = (0..k)
            .map(|i| 1.0 + (0..r).map(|j| t[(i, j)].abs() * d_abs[j]).sum::<f64>())
            .fold(1.0, f64::max);
        let mut s = Mat::<f64>::identity(k, k);
        matmul(&mut s, Accum::Add, t, delta, -1.0, Par::Seq);
        let v = solve(s.as_ref(), x, scale, epsilon)?;
        let mut w = Mat::<f64>::zeros(r, c);
        matmul(&mut w, Accum::Replace, delta, &v, 1.0, Par::Seq);
        w
    };
    let out: Vec<f64> = (0..r)
        .flat_map(|i| (0..c).map(move |j| (i, j)))
        .map(|(i, j)| w[(i, j)])
        .collect();
    finite(&out).map_err(|_| Error::Singular)?;
    Ok(out)
}

// Partial-pivot LU, refusing a pivot that float32 data cannot tell apart from zero.
fn solve(
    s: MatRef<'_, f64>,
    rhs: MatRef<'_, f64>,
    scale: f64,
    epsilon: f64,
) -> Result<Mat<f64>, Error> {
    let n = s.nrows();
    let mut norm = scale;
    for j in 0..n {
        for i in 0..n {
            norm = norm.max(s[(i, j)].abs());
        }
    }
    let lu = s.partial_piv_lu();
    let u = lu.U();
    if (0..n).any(|i| u[(i, i)].abs() <= epsilon * norm * n as f64) {
        return Err(Error::Singular);
    }
    Ok(lu.solve(rhs))
}

/// out (f × c) += hᵀ z, for `h` (b × f) rows of flow totals and `z` (b × c), all row-major.
pub fn fold(out: &mut [f64], h: &[f64], z: &[f64], f: usize, c: usize) -> Result<(), Error> {
    if f == 0 || c == 0 || out.len() != f * c || h.len() % f != 0 || z.len() != h.len() / f * c {
        return Err(Error::Dimensions);
    }
    let b = h.len() / f;
    let h = MatRef::from_row_major_slice(h, b, f);
    let z = MatRef::from_row_major_slice(z, b, c);
    let out = MatMut::from_row_major_slice_mut(out, f, c);
    matmul(out, Accum::Add, h.transpose(), z, 1.0, Par::Seq);
    Ok(())
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn correction(
        delta: &[f64],
        t: &[f64],
        x: &[f64],
        r: usize,
        k: usize,
        c: usize,
        epsilon: f64,
    ) -> Result<Vec<f64>, JsError> {
        super::correction(delta, t, x, r, k, c, epsilon).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn fold(out: &mut [f64], h: &[f64], z: &[f64], f: usize, c: usize) -> Result<(), JsError> {
        super::fold(out, h, z, f, c).map_err(|e| JsError::new(&e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A 2 × 2 economy with a direct oracle: X' = (I − A')⁻¹ y.
    fn direct(a: [[f64; 2]; 2], y: [f64; 2]) -> [f64; 2] {
        let det = (1.0 - a[0][0]) * (1.0 - a[1][1]) - a[0][1] * a[1][0];
        [
            ((1.0 - a[1][1]) * y[0] + a[0][1] * y[1]) / det,
            (a[1][0] * y[0] + (1.0 - a[0][0]) * y[1]) / det,
        ]
    }

    fn inverse(a: [[f64; 2]; 2]) -> [[f64; 2]; 2] {
        let det = (1.0 - a[0][0]) * (1.0 - a[1][1]) - a[0][1] * a[1][0];
        [
            [(1.0 - a[1][1]) / det, a[0][1] / det],
            [a[1][0] / det, (1.0 - a[0][0]) / det],
        ]
    }

    fn close(a: f64, b: f64) {
        assert!(
            (a - b).abs() <= 1e-12 * a.abs().max(b.abs()).max(1.0),
            "{a} != {b}"
        );
    }

    // X' = X + L[:, R] W, checked against the direct solve in both forms.
    #[test]
    fn both_forms_match_a_direct_solve() {
        let a = [[0.1, 0.2], [0.15, 0.05]];
        let l = inverse(a);
        let y = [2.0, 3.0];
        let x = [
            l[0][0] * y[0] + l[0][1] * y[1],
            l[1][0] * y[0] + l[1][1] * y[1],
        ];
        let f = 0.7;
        // one row (product 0) into two columns: the r × r form
        let delta = [a[0][0] * (f - 1.0), a[0][1] * (f - 1.0)];
        let t = [l[0][0], l[1][0]];
        let w = correction(&delta, &t, &x, 1, 2, 1, f64::EPSILON).unwrap();
        let want = direct([[a[0][0] * f, a[0][1] * f], a[1]], y);
        close(x[0] + l[0][0] * w[0], want[0]);
        close(x[1] + l[1][0] * w[0], want[1]);
        // two rows into one column (column 1): the k × k form
        let delta = [a[0][1] * (f - 1.0), a[1][1] * (f - 1.0)];
        let t = [l[1][0], l[1][1]];
        let w = correction(&delta, &t, &[x[1]], 2, 1, 1, f64::EPSILON).unwrap();
        let want = direct([[a[0][0], a[0][1] * f], [a[1][0], a[1][1] * f]], y);
        close(x[0] + l[0][0] * w[0] + l[0][1] * w[1], want[0]);
        close(x[1] + l[1][0] * w[0] + l[1][1] * w[1], want[1]);
    }

    #[test]
    fn cancellation_is_refused_and_inputs_are_checked() {
        // 1 − ΔA·L = 0 for a = 0.092 and a change of 986.95…%
        let l = 1.0 / (1.0 - 0.092);
        let d = 0.092 * 9.869565217391305;
        assert_eq!(
            correction(&[d], &[l], &[1.0], 1, 1, 1, 2f64.powi(-23)),
            Err(Error::Singular)
        );
        assert!(correction(&[0.092 * 9.8], &[l], &[1.0], 1, 1, 1, 2f64.powi(-23)).is_ok());
        assert_eq!(
            correction(&[f64::NAN], &[l], &[1.0], 1, 1, 1, 1e-16),
            Err(Error::NonFinite)
        );
        assert_eq!(
            correction(&[1.0], &[l], &[1.0], 1, 2, 1, 1e-16),
            Err(Error::Dimensions)
        );
    }

    #[test]
    fn fold_adds_h_transposed_times_z() {
        // h: 2 rows of 3 flow totals, z: 2 rows of 2 consumers
        let h = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let z = [1.0, -1.0, 0.5, 2.0];
        let mut out = vec![10.0; 6];
        fold(&mut out, &h, &z, 3, 2).unwrap();
        assert_eq!(out, [13.0, 17.0, 14.5, 18.0, 16.0, 19.0]);
        assert_eq!(fold(&mut out, &h, &z[..3], 3, 2), Err(Error::Dimensions));
    }
}
