//! The dense products in `correction`: out (m × n) += alpha · a (m × p) · b (p × n),
//! all row-major and contiguous. In wasm a simd128 kernel, since faer has no wasm
//! SIMD path; natively faer.

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn product(
    out: &mut [f64],
    a: &[f64],
    b: &[f64],
    m: usize,
    p: usize,
    n: usize,
    alpha: f64,
) {
    use faer::{Accum, MatMut, MatRef, Par};
    faer::linalg::matmul::matmul(
        MatMut::from_row_major_slice_mut(out, m, n),
        Accum::Add,
        MatRef::from_row_major_slice(a, m, p),
        MatRef::from_row_major_slice(b, p, n),
        alpha,
        Par::Seq,
    );
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn product(
    out: &mut [f64],
    a: &[f64],
    b: &[f64],
    m: usize,
    p: usize,
    n: usize,
    alpha: f64,
) {
    // Inner-dimension block: four rows of `a` and one panel (2 × 256 × 32 B) fit in L1.
    const KC: usize = 256;
    assert!(out.len() == m * n && a.len() == m * p && b.len() == p * n);
    let (m4, n4) = (m - m % 4, n - n % 4);
    for p0 in (0..p).step_by(KC) {
        let p1 = (p0 + KC).min(p);
        // b[p0..p1, j0..j0 + 4] as contiguous runs of four, one panel per j0.
        let panels: Vec<[f64; 4]> = (0..n4)
            .step_by(4)
            .flat_map(|j0| (p0..p1).map(move |q| (q, j0)))
            .map(|(q, j0)| core::array::from_fn(|l| b[q * n + j0 + l]))
            .collect();
        for i0 in (0..m4).step_by(4) {
            let rows: [&[f64]; 4] =
                core::array::from_fn(|r| &a[(i0 + r) * p + p0..(i0 + r) * p + p1]);
            for (j0, panel) in (0..n4).step_by(4).zip(panels.chunks_exact(p1 - p0)) {
                for (r, sums) in tile(rows, panel).iter().enumerate() {
                    for (o, v) in out[(i0 + r) * n + j0..][..4].iter_mut().zip(sums) {
                        *o += alpha * v;
                    }
                }
            }
        }
    }
    // Edges: the last m % 4 rows over every column, then the last n % 4 columns.
    let edge = |out: &mut [f64], i: usize, j: usize| {
        out[i * n + j] += alpha * (0..p).map(|q| a[i * p + q] * b[q * n + j]).sum::<f64>();
    };
    for i in m4..m {
        for j in 0..n {
            edge(out, i, j);
        }
    }
    for i in 0..m4 {
        for j in n4..n {
            edge(out, i, j);
        }
    }
}

// One 4 × 4 tile over a block of the inner dimension. A call of its own: V8 optimises
// a wasm function only from its next call, so one long call would run unoptimised
// through the whole first scenario.
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128")]
#[inline(never)]
fn tile(rows: [&[f64]; 4], panel: &[[f64; 4]]) -> [[f64; 4]; 4] {
    use core::arch::wasm32::{f64x2, f64x2_add, f64x2_extract_lane, f64x2_mul, f64x2_splat};
    let mut acc = [[f64x2_splat(0.0); 2]; 4];
    let [r0, r1, r2, r3] = rows.map(|r| &r[..panel.len()]);
    for (q, bj) in panel.iter().enumerate() {
        let b0 = f64x2(bj[0], bj[1]);
        let b1 = f64x2(bj[2], bj[3]);
        for (acc, a) in acc.iter_mut().zip([r0[q], r1[q], r2[q], r3[q]]) {
            let s = f64x2_splat(a);
            acc[0] = f64x2_add(acc[0], f64x2_mul(s, b0));
            acc[1] = f64x2_add(acc[1], f64x2_mul(s, b1));
        }
    }
    acc.map(|[lo, hi]| {
        [
            f64x2_extract_lane::<0>(lo),
            f64x2_extract_lane::<1>(lo),
            f64x2_extract_lane::<0>(hi),
            f64x2_extract_lane::<1>(hi),
        ]
    })
}
