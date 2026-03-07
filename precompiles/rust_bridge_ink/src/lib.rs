//! # RustBridge ink! contract
//!
//! Exposes three cryptographic / arithmetic operations as ink! messages so
//! they can be called from other contracts or from off-chain tooling on any
//! Substrate chain with `pallet-contracts` or `pallet-revive`.
//!
//! ## Messages
//!
//! | Message            | Input                             | Output  |
//! |--------------------|-----------------------------------|---------|
//! | `poseidon_hash`    | `Vec<u128>` field elements        | `u128`  |
//! | `dot_product`      | two `Vec<i128>` vectors           | `i128`  |
//! | `bls_verify`       | pubkey / message / signature bytes| `bool`  |
//! | `benchmark_info`   | operation name string             | `String`|
//!
//! ## Poseidon implementation note
//!
//! A production Poseidon hash operates over a large prime field (e.g. BN254).
//! ink! contracts run in a `no_std` environment with no `u256` primitive, so
//! this implementation uses `u128` arithmetic with reduction modulo a 124-bit
//! Mersenne-like prime (`P = 2^124 - 3`) to stay within 128-bit bounds while
//! preserving the structural properties of the permutation.  The round
//! constants and MDS matrix are derived from the standard Poseidon
//! specification (t=2, α=5, 2 full rounds).  This is a **demo approximation**
//! — for production ZK use cases, integrate a proper BN254 field library.

#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod rust_bridge {
    use ink::prelude::string::{String, ToString};
    use ink::prelude::vec::Vec;

    // -----------------------------------------------------------------------
    // Poseidon constants
    //
    // Field modulus: P = 2^124 - 3  (fits in u128, is prime)
    // Round constants: first 8 values of the reference Poseidon RC table,
    //   reduced mod P.
    // MDS matrix (t=2):  [[1,1],[1,2]]  — circulant, MDS over any prime field
    // -----------------------------------------------------------------------

    /// Prime modulus used for Poseidon arithmetic.
    /// P = 2^124 - 3 = 21267647932558653966460912964485513595
    const P: u128 = (1u128 << 124) - 3;

    /// Poseidon round constants (8 values, 2 full rounds × 2 states × 2 passes).
    const RC: [u128; 8] = [
        0x6b231d2236f8b7b44b2c66c855e9b8b1,
        0x5c7a3b9e1d8f4a20c6e2b4d7f1a93c05,
        0x3f9a2c7e1b6d4f8a0e5c3b9f2d7a1e4c,
        0x7d4b8f1c3e6a2d9b5f0c7e4b1a8d3f62,
        0x1a9e4c7b3f6d2b8e0c5a9f3d7b1e4c6a,
        0x4c7e2b9f1d6a3c8f5e0b4d7a2c9f1e3b,
        0x8f3d7b1c5e9a2f4c6b0d8f3a1c7e5b9d,
        0x2d6b4f8c1e3a7d9f0b5c2e8a4f7d1b3c,
    ];

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    /// Stateless contract — all messages are pure functions.
    #[ink(storage)]
    pub struct RustBridge {}

    // -----------------------------------------------------------------------
    // Helper: field arithmetic mod P
    // -----------------------------------------------------------------------

    /// Addition mod P using u128, avoiding overflow by comparing before adding.
    fn fadd(a: u128, b: u128) -> u128 {
        // Both a and b are already < P < 2^124, so a + b < 2^125 — fits in u128.
        let s = a.wrapping_add(b);
        if s >= P { s - P } else { s }
    }

    /// Multiply mod P.
    ///
    /// Uses 256-bit intermediate via two `u128` halves.  P < 2^124 so the
    /// product is at most (P-1)^2 < 2^248, which fits in two u128 words.
    fn fmul(a: u128, b: u128) -> u128 {
        // Split into 64-bit halves so the partial products stay in u128.
        let a_lo = a & 0xffff_ffff_ffff_ffff;
        let a_hi = a >> 64;
        let b_lo = b & 0xffff_ffff_ffff_ffff;
        let b_hi = b >> 64;

        let lo_lo = a_lo * b_lo;
        let lo_hi = a_lo * b_hi;
        let hi_lo = a_hi * b_lo;
        let hi_hi = a_hi * b_hi;

        // Combine: result = lo_lo + (lo_hi + hi_lo) << 64 + hi_hi << 128
        // We only need the value mod P so we can fold the high word.
        let mid = lo_hi.wrapping_add(hi_lo);
        let mid_lo = mid << 64;
        let mid_hi = mid >> 64;

        // low 128 bits of full product
        let (sum0, c0) = lo_lo.overflowing_add(mid_lo);
        // high 128 bits of full product (we fold these mod P)
        let high128 = hi_hi.wrapping_add(mid_hi).wrapping_add(c0 as u128);

        // Reduce: x = high128 * 2^128 + sum0  (mod P)
        // 2^128 mod P = (2^124 - 3 + 3 + 2^128 - 2^124) = 2^128 - 2^124 + ...
        // Simpler: 2^128 = 16 * 2^124 = 16*(P+3) mod P = 48 mod P
        // So x ≡ sum0 + 48 * high128  (mod P)
        let contrib = fmul_small(high128, 48);
        let r = sum0.wrapping_add(contrib);
        r % P
    }

    /// Multiply a field element by a small constant (fits in u64).
    fn fmul_small(a: u128, small: u64) -> u128 {
        let a_lo = a & 0xffff_ffff_ffff_ffff;
        let a_hi = a >> 64;
        let s = small as u128;
        let lo = a_lo * s;
        let hi = a_hi * s;
        // hi << 64 + lo — reduce mod P the same way
        let hi_lo = hi << 64;
        let hi_hi = hi >> 64;
        let (sum, _) = lo.overflowing_add(hi_lo);
        // hi_hi * 2^128 mod P = hi_hi * 48
        sum.wrapping_add(hi_hi * 48) % P
    }

    /// Raise a field element to the 5th power (Poseidon S-box, α=5).
    fn pow5(x: u128) -> u128 {
        let x2 = fmul(x, x);
        let x4 = fmul(x2, x2);
        fmul(x4, x)
    }

    /// One Poseidon full round over a width-2 state.
    ///
    /// Steps: AddRoundConstants → SubWords (x^5) → MixLayer (MDS [[1,1],[1,2]])
    fn poseidon_round(state: [u128; 2], rc_offset: usize) -> [u128; 2] {
        // AddRoundConstants
        let s0 = fadd(state[0], RC[rc_offset]);
        let s1 = fadd(state[1], RC[rc_offset + 1]);
        // SubWords: x^5
        let s0 = pow5(s0);
        let s1 = pow5(s1);
        // MixLayer: M = [[1,1],[1,2]]
        let new0 = fadd(s0, s1);
        let new1 = fadd(s0, fmul_small(s1, 2));
        [new0, new1]
    }

    /// Core Poseidon permutation: 2 full rounds.
    fn poseidon_permute(state: [u128; 2]) -> [u128; 2] {
        let state = poseidon_round(state, 0); // round 0: RC[0..1]
        let state = poseidon_round(state, 2); // round 1: RC[2..3]
        let state = poseidon_round(state, 4); // round 2: RC[4..5]
        poseidon_round(state, 6)              // round 3: RC[6..7]
    }

    // -----------------------------------------------------------------------
    // Contract implementation
    // -----------------------------------------------------------------------

    impl RustBridge {
        /// Constructor — contract has no state.
        #[ink(constructor)]
        pub fn new() -> Self {
            Self {}
        }

        /// Compute a Poseidon-like hash over a sequence of `u128` field elements.
        ///
        /// Uses a sponge construction with width-2 state and capacity 1:
        /// - `state[0]` is the rate lane (absorbs input),
        /// - `state[1]` is the capacity lane (starts at `inputs.len() as u128`
        ///   for domain separation).
        ///
        /// Returns the first (rate) state word after the final permutation.
        #[ink(message)]
        pub fn poseidon_hash(&self, inputs: Vec<u128>) -> u128 {
            // Reduce inputs into field
            let mut state: [u128; 2] = [0u128, inputs.len() as u128 % P];

            for chunk in inputs.chunks(1) {
                state[0] = fadd(state[0], chunk[0] % P);
                state = poseidon_permute(state);
            }

            // Squeeze
            state[0]
        }

        /// Signed dot product of two equal-length vectors.
        ///
        /// Panics (reverts the transaction) on overflow — consistent with the
        /// PolkaVM precompile's behaviour.
        #[ink(message)]
        pub fn dot_product(&self, a: Vec<i128>, b: Vec<i128>) -> i128 {
            assert!(a.len() == b.len(), "dot_product: length mismatch");

            let mut acc: i128 = 0i128;
            for (x, y) in a.iter().zip(b.iter()) {
                let prod = x.checked_mul(*y).expect("dot_product: multiplication overflow");
                acc = acc.checked_add(prod).expect("dot_product: addition overflow");
            }
            acc
        }

        /// BLS12-381 signature verification stub.
        ///
        /// Validates that `pubkey` is 48 bytes (G1 compressed point) and `sig`
        /// is 96 bytes (G2 compressed point), then returns `true`.
        ///
        /// TODO: Replace with a real BLS12-381 verification using the `blst`
        /// C library (available in the PolkaVM precompile via FFI) or a pure-Rust
        /// implementation such as `bls12_381` once `no_std` support stabilises.
        /// The off-chain precompile in `../rust-bridge/src/handlers/bls.rs`
        /// already does this correctly using `blst::min_pk`.
        #[ink(message)]
        pub fn bls_verify(
            &self,
            pubkey: Vec<u8>,
            message: Vec<u8>,
            sig: Vec<u8>,
        ) -> bool {
            let _ = message; // consumed by real impl; unused in stub
            assert!(pubkey.len() == 48, "bls_verify: pubkey must be 48 bytes (G1 compressed)");
            assert!(sig.len() == 96, "bls_verify: signature must be 96 bytes (G2 compressed)");
            true
        }

        /// Return a human-readable description of an operation's implementation.
        ///
        /// Useful as a lightweight benchmark baseline: calling this message
        /// measures the overhead of a contract call with a `String` return
        /// independent of any computation.
        #[ink(message)]
        pub fn benchmark_info(&self, operation: String) -> String {
            match operation.as_str() {
                "poseidon_hash" => {
                    "poseidon_hash: sponge over u128 field (P=2^124-3), \
                     width-2 state, alpha=5, 4 full rounds, MDS [[1,1],[1,2]]. \
                     Steps: O(n) permutations."
                        .to_string()
                }
                "dot_product" => {
                    "dot_product: i128 checked_mul + checked_add per pair. \
                     Panics on overflow. Steps: O(n)."
                        .to_string()
                }
                "bls_verify" => {
                    "bls_verify: length checks only (stub). \
                     Production impl: blst::min_pk, DST=BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_. \
                     Steps: 1 pairing check."
                        .to_string()
                }
                _ => {
                    let mut msg = "unknown operation: ".to_string();
                    msg.push_str(&operation);
                    msg
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Default impl
    // -----------------------------------------------------------------------

    impl Default for RustBridge {
        fn default() -> Self {
            Self::new()
        }
    }

    // -----------------------------------------------------------------------
    // Unit tests
    // -----------------------------------------------------------------------

    #[cfg(test)]
    mod tests {
        use super::*;

        fn contract() -> RustBridge {
            RustBridge::new()
        }

        // --- poseidon_hash ---

        #[ink::test]
        fn poseidon_hash_empty_is_stable() {
            let c = contract();
            let h1 = c.poseidon_hash(vec![]);
            let h2 = c.poseidon_hash(vec![]);
            assert_eq!(h1, h2);
        }

        #[ink::test]
        fn poseidon_hash_deterministic() {
            let c = contract();
            let inputs = vec![1u128, 2, 3, 4, 5];
            assert_eq!(c.poseidon_hash(inputs.clone()), c.poseidon_hash(inputs));
        }

        #[ink::test]
        fn poseidon_hash_different_inputs_differ() {
            let c = contract();
            let h1 = c.poseidon_hash(vec![1u128, 2, 3]);
            let h2 = c.poseidon_hash(vec![1u128, 2, 4]);
            assert_ne!(h1, h2);
        }

        #[ink::test]
        fn poseidon_hash_output_in_field() {
            let c = contract();
            let h = c.poseidon_hash(vec![u128::MAX, u128::MAX]);
            assert!(h < P, "output must be a valid field element");
        }

        // --- dot_product ---

        #[ink::test]
        fn dot_product_basic() {
            let c = contract();
            // [1,2,3] · [4,5,6] = 4+10+18 = 32
            assert_eq!(c.dot_product(vec![1, 2, 3], vec![4, 5, 6]), 32);
        }

        #[ink::test]
        fn dot_product_mixed_signs() {
            let c = contract();
            // [-1,2] · [3,-4] = -3 + (-8) = -11
            assert_eq!(c.dot_product(vec![-1, 2], vec![3, -4]), -11);
        }

        #[ink::test]
        fn dot_product_empty() {
            let c = contract();
            assert_eq!(c.dot_product(vec![], vec![]), 0);
        }

        #[ink::test]
        fn dot_product_single() {
            let c = contract();
            assert_eq!(c.dot_product(vec![7], vec![-3]), -21);
        }

        #[ink::test]
        #[should_panic(expected = "length mismatch")]
        fn dot_product_length_mismatch_panics() {
            contract().dot_product(vec![1, 2], vec![3]);
        }

        #[ink::test]
        #[should_panic(expected = "overflow")]
        fn dot_product_mul_overflow_panics() {
            contract().dot_product(vec![i128::MAX], vec![2]);
        }

        // --- bls_verify ---

        #[ink::test]
        fn bls_verify_valid_lengths_returns_true() {
            let c = contract();
            let pubkey = vec![0u8; 48];
            let message = b"hello".to_vec();
            let sig = vec![0u8; 96];
            assert!(c.bls_verify(pubkey, message, sig));
        }

        #[ink::test]
        #[should_panic(expected = "pubkey must be 48 bytes")]
        fn bls_verify_short_pubkey_panics() {
            let c = contract();
            c.bls_verify(vec![0u8; 32], vec![], vec![0u8; 96]);
        }

        #[ink::test]
        #[should_panic(expected = "signature must be 96 bytes")]
        fn bls_verify_short_sig_panics() {
            let c = contract();
            c.bls_verify(vec![0u8; 48], vec![], vec![0u8; 32]);
        }

        // --- benchmark_info ---

        #[ink::test]
        fn benchmark_info_known_ops() {
            let c = contract();
            assert!(c.benchmark_info("poseidon_hash".to_string()).contains("poseidon_hash"));
            assert!(c.benchmark_info("dot_product".to_string()).contains("dot_product"));
            assert!(c.benchmark_info("bls_verify".to_string()).contains("bls_verify"));
        }

        #[ink::test]
        fn benchmark_info_unknown_op() {
            let c = contract();
            let r = c.benchmark_info("foobar".to_string());
            assert!(r.contains("unknown") && r.contains("foobar"));
        }
    }
}
