//! The browser scenario maths: the small Woodbury system and the flow fold.
//!
//! Matrices arrive as row-major `f64` slices, as the JavaScript worker holds them.
//! See `scenarioFlows` in browser-engine.js for how the pieces are gathered.

use faer::linalg::matmul::matmul;
use faer::linalg::solvers::Solve;
use faer::{Accum, Mat, MatMut, MatRef, Par};

/// Why a scenario was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    /// A slice's length disagrees with the dimensions given.
    Dimensions,
    /// An input holds NaN or an infinity.
    NonFinite,
    /// A pivot is too small for float32 data, or the result is not finite.
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
///
/// # Errors
///
/// [`Error::Dimensions`] when a length disagrees with `r`, `k` and `c`,
/// [`Error::NonFinite`] for a NaN or infinite input, and [`Error::Singular`]
/// when a pivot is refused or the result is not finite.
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
    let (delta_slice, t_slice, x_slice) = (delta, t, x);
    let delta = MatRef::from_row_major_slice(delta, r, k);
    let t = MatRef::from_row_major_slice(t, k, r);
    let x = MatRef::from_row_major_slice(x, k, c);
    let row_abs = |m: MatRef<'_, f64>| -> Vec<f64> {
        (0..m.nrows())
            .map(|i| (0..m.ncols()).map(|j| m[(i, j)].abs()).sum())
            .collect()
    };
    let w = if r <= k {
        let dense = prefer_dense(delta_slice);
        let (s, rhs, scale) = small_system(delta_slice, t_slice, x_slice, r, k, c, dense);
        solve(
            MatRef::from_row_major_slice(&s, r, r),
            MatRef::from_row_major_slice(&rhs, r, c),
            scale,
            epsilon,
        )?
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

// Measured break-even of the two builds in `small_system`.
fn prefer_dense(delta: &[f64]) -> bool {
    delta.iter().filter(|&&v| v != 0.0).count() * 5 > delta.len()
}

// S = I − ΔA T (r × r) and ΔA X (r × c), row-major, and the largest row scale
// before I − ΔA T cancels. A scenario's rows of A are often mostly zero: then each
// nonzero adds a contiguous row of T and of X. Above about one nonzero in five,
// faer's dense products are faster.
fn small_system(
    delta: &[f64],
    t: &[f64],
    x: &[f64],
    r: usize,
    k: usize,
    c: usize,
    dense: bool,
) -> (Vec<f64>, Vec<f64>, f64) {
    let t_rows: Vec<&[f64]> = t.chunks_exact(r).collect();
    let x_rows: Vec<&[f64]> = x.chunks_exact(c).collect();
    let t_abs: Vec<f64> = t_rows
        .iter()
        .map(|row| row.iter().map(|v| v.abs()).sum())
        .collect();
    let scale = delta
        .chunks_exact(k)
        .map(|d_row| {
            1.0 + d_row
                .iter()
                .zip(&t_abs)
                .map(|(v, a)| v.abs() * a)
                .sum::<f64>()
        })
        .fold(1.0, f64::max);
    let mut s = vec![0.0; r * r];
    let mut rhs = vec![0.0; r * c];
    if dense {
        let d = MatRef::from_row_major_slice(delta, r, k);
        matmul(
            MatMut::from_row_major_slice_mut(&mut s, r, r),
            Accum::Replace,
            d,
            MatRef::from_row_major_slice(t, k, r),
            -1.0,
            Par::Seq,
        );
        matmul(
            MatMut::from_row_major_slice_mut(&mut rhs, r, c),
            Accum::Replace,
            d,
            MatRef::from_row_major_slice(x, k, c),
            1.0,
            Par::Seq,
        );
    } else {
        for (d_row, (s_row, rhs_row)) in delta
            .chunks_exact(k)
            .zip(s.chunks_exact_mut(r).zip(rhs.chunks_exact_mut(c)))
        {
            for (j, &v) in d_row.iter().enumerate() {
                if v == 0.0 {
                    continue;
                }
                for (sq, tq) in s_row.iter_mut().zip(t_rows[j]) {
                    *sq -= v * tq;
                }
                for (rq, xq) in rhs_row.iter_mut().zip(x_rows[j]) {
                    *rq += v * xq;
                }
            }
        }
    }
    for i in 0..r {
        s[i * r + i] += 1.0;
    }
    (s, rhs, scale)
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
///
/// # Errors
///
/// [`Error::Dimensions`] when a length disagrees with `f` and `c`.
pub fn fold(out: &mut [f64], h: &[f64], z: &[f64], f: usize, c: usize) -> Result<(), Error> {
    if f == 0
        || c == 0
        || out.len() != f * c
        || !h.len().is_multiple_of(f)
        || z.len() != h.len() / f * c
    {
        return Err(Error::Dimensions);
    }
    let b = h.len() / f;
    let h = MatRef::from_row_major_slice(h, b, f);
    let z = MatRef::from_row_major_slice(z, b, c);
    let out = MatMut::from_row_major_slice_mut(out, f, c);
    matmul(out, Accum::Add, h.transpose(), z, 1.0, Par::Seq);
    Ok(())
}

/// The exports browser-engine.js calls, with errors as JavaScript exceptions.
#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use wasm_bindgen::prelude::*;

    /// [`super::correction`] for JavaScript.
    ///
    /// # Errors
    ///
    /// As [`super::correction`], with the message as a JavaScript `Error`.
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

    /// [`super::fold`] for JavaScript; `out` is updated in place.
    ///
    /// # Errors
    ///
    /// As [`super::fold`], with the message as a JavaScript `Error`.
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
        let d = 0.092 * 9.869_565_217_391_305;
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
    fn solve_pivots_and_refuses_a_singular_matrix() {
        // a zero first pivot needs a row swap
        let s = [0.0, 2.0, 1.0, 3.0];
        let x = solve(
            MatRef::from_row_major_slice(&s, 2, 2),
            MatRef::from_row_major_slice(&[4.0, 7.0], 2, 1),
            1.0,
            f64::EPSILON,
        )
        .unwrap();
        assert_eq!((x[(0, 0)], x[(1, 0)]), (1.0, 2.0));
        let s = [1.0, 2.0, 2.0, 4.0];
        let singular = solve(
            MatRef::from_row_major_slice(&s, 2, 2),
            MatRef::from_row_major_slice(&[1.0, 2.0], 2, 1),
            1.0,
            f64::EPSILON,
        );
        assert_eq!(singular.err(), Some(Error::Singular));
    }

    // A pivot p after cancellation, with the terms before it near 2: refused at or
    // below epsilon · 2 · n, so 1.5ε (n = 1) and 3ε (n = 2) fail and 2.5ε, 5ε pass.
    #[test]
    fn the_threshold_uses_the_scale_before_cancellation() {
        let eps = 2f64.powi(-23);
        let one = |p: f64| correction(&[(1.0 - p) / 2.0], &[2.0], &[1.0], 1, 1, 1, eps);
        assert_eq!(one(1.5 * eps), Err(Error::Singular));
        assert!(one(2.5 * eps).is_ok());
        // the K × K form: two rows into one column
        let wide = |p: f64| {
            correction(
                &[(1.0 - p) / 4.0, (1.0 - p) / 4.0],
                &[2.0, 2.0],
                &[1.0],
                2,
                1,
                1,
                eps,
            )
        };
        assert_eq!(wide(1.5 * eps), Err(Error::Singular));
        assert!(wide(2.5 * eps).is_ok());
        // n = 2: S = diag(1, p)
        let two = |p: f64| {
            correction(
                &[0.0, 0.0, 0.0, (1.0 - p) / 2.0],
                &[0.0, 0.0, 0.0, 2.0],
                &[1.0, 1.0],
                2,
                2,
                1,
                eps,
            )
        };
        assert_eq!(two(3.0 * eps), Err(Error::Singular));
        assert!(two(5.0 * eps).is_ok());
    }

    #[test]
    fn each_length_is_checked() {
        let ok = correction(&[0.1; 4], &[0.1; 4], &[1.0; 4], 2, 2, 2, 1e-16);
        assert!(ok.is_ok());
        for (d, t, x, r, k, c) in [
            (3, 4, 4, 2, 2, 2),
            (4, 3, 4, 2, 2, 2),
            (4, 4, 3, 2, 2, 2),
            (4, 4, 1, 2, 2, 2),
            (0, 0, 4, 0, 2, 2),
            (0, 0, 4, 2, 0, 2),
            (4, 4, 0, 2, 2, 0),
        ] {
            let got = correction(&vec![0.1; d], &vec![0.1; t], &vec![1.0; x], r, k, c, 1e-16);
            assert_eq!(got, Err(Error::Dimensions), "{d} {t} {x} {r} {k} {c}");
        }
        let mut out = vec![0.0; 6];
        let h = [1.0; 4];
        assert!(fold(&mut out, &h, &[1.0; 6], 2, 3).is_ok());
        assert_eq!(fold(&mut out, &h, &[1.0; 5], 2, 3), Err(Error::Dimensions));
        assert_eq!(
            fold(&mut out, &h[..3], &[1.0; 6], 2, 3),
            Err(Error::Dimensions)
        );
        assert_eq!(
            fold(&mut out[..5], &h, &[1.0; 6], 2, 3),
            Err(Error::Dimensions)
        );
        assert_eq!(fold(&mut [], &[], &[], 0, 3), Err(Error::Dimensions));
        assert_eq!(fold(&mut [], &[], &[], 2, 0), Err(Error::Dimensions));
    }

    #[test]
    fn errors_read_as_the_page_shows_them() {
        assert_eq!(
            Error::Singular.to_string(),
            "singular or ill-conditioned scenario"
        );
        assert_eq!(Error::Dimensions.to_string(), "invalid solve dimensions");
    }

    #[test]
    fn sparse_and_dense_builds_agree() {
        // 3 × 4 ΔA with zeros, T 4 × 3, X 4 × 2
        let delta = [
            0.1, 0.0, -0.2, 0.0, 0.0, 0.0, 0.3, 0.05, -0.4, 0.0, 0.0, 0.0,
        ];
        let t = [
            0.5, 1.0, -0.25, 2.0, 0.0, 0.75, 1.5, -1.0, 0.25, 0.1, 0.2, 0.3,
        ];
        let x = [1.0, 2.0, -1.0, 0.5, 3.0, 0.0, 0.25, 4.0];
        let sparse = small_system(&delta, &t, &x, 3, 4, 2, false);
        let dense = small_system(&delta, &t, &x, 3, 4, 2, true);
        assert_eq!(sparse.2, dense.2);
        for (a, b) in sparse
            .0
            .iter()
            .zip(&dense.0)
            .chain(sparse.1.iter().zip(&dense.1))
        {
            close(*a, *b);
        }
        // row 0 of S: 1 − (0.1·0.5 − 0.2·1.5), and of ΔA X: 0.1·1 − 0.2·3
        close(sparse.0[0], 1.0 - (0.05 - 0.3));
        close(sparse.1[0], 0.1 - 0.6);
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
