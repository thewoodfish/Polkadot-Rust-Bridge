//! rust-bridge — PolkaVM precompile dispatcher
//!
//! Entry point: `call()` (extern "C") receives raw ABI-encoded bytes from the
//! PolkaVM host, dispatches on the 4-byte Solidity function selector, and
//! writes the ABI-encoded result back.
//!
//! Registered selectors (keccak256 of signature, first 4 bytes):
//!   poseidonHash(uint256[])       → 0x2a58cd44
//!   blsVerify(bytes,bytes,bytes)  → 0xa65ebb25
//!   dotProduct(int256[],int256[]) → 0x55989ee5

pub mod abi;
pub mod handlers;

use handlers::{bls, dot_product, poseidon};

// ---------------------------------------------------------------------------
// Selector constants
// ---------------------------------------------------------------------------

const SEL_POSEIDON: [u8; 4] = [0x2a, 0x58, 0xcd, 0x44];
const SEL_BLS_VERIFY: [u8; 4] = [0xa6, 0x5e, 0xbb, 0x25];
const SEL_DOT_PRODUCT: [u8; 4] = [0x55, 0x98, 0x9e, 0xe5];

// ---------------------------------------------------------------------------
// Safe dispatcher (used by tests and the extern "C" entry point)
// ---------------------------------------------------------------------------

/// Dispatch ABI-encoded `input` (selector + args) to the correct handler.
pub fn dispatch(input: &[u8]) -> Result<Vec<u8>, &'static str> {
    if input.len() < 4 {
        return Err("dispatch: input too short (need ≥ 4 bytes for selector)");
    }

    let selector: [u8; 4] = input[..4].try_into().unwrap();
    let args = &input[4..];

    match selector {
        SEL_POSEIDON => poseidon::handle(args),
        SEL_BLS_VERIFY => bls::handle(args),
        SEL_DOT_PRODUCT => dot_product::handle(args),
        _ => Err("dispatch: unknown selector"),
    }
}

// ---------------------------------------------------------------------------
// PolkaVM extern "C" entry point
// ---------------------------------------------------------------------------

/// Called by the PolkaVM host for every precompile invocation.
///
/// # Safety
/// The caller must guarantee:
/// - `input` is valid for `input_len` bytes.
/// - `output` has capacity for the result (the host is responsible for sizing).
/// - `output_len` is a valid writable pointer.
#[no_mangle]
pub unsafe extern "C" fn call(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: *mut usize,
) -> i32 {
    let input_slice = core::slice::from_raw_parts(input, input_len);

    match dispatch(input_slice) {
        Ok(result) => {
            let write_len = result.len();
            core::ptr::copy_nonoverlapping(result.as_ptr(), output, write_len);
            *output_len = write_len;
            0
        }
        Err(_) => {
            *output_len = 0;
            -1
        }
    }
}

// ---------------------------------------------------------------------------
// Legacy fibonacci kept for benchmark continuity
// ---------------------------------------------------------------------------

/// Iterative Fibonacci (wrapping). Used by the Hardhat benchmark.
pub fn fibonacci(n: u64) -> u64 {
    if n <= 1 {
        return n;
    }
    let (mut a, mut b) = (0u64, 1u64);
    for _ in 2..=n {
        let c = a.wrapping_add(b);
        a = b;
        b = c;
    }
    b
}
