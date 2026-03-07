//! Minimal Solidity ABI encode / decode utilities.
//!
//! All `decode_*` functions expect the 4-byte selector to have been stripped
//! already (i.e. they receive only the argument data).

use primitive_types::{U256, U512};

pub type AbiError = &'static str;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn read_u256(data: &[u8], offset: usize) -> Result<U256, AbiError> {
    if offset + 32 > data.len() {
        return Err("abi: read out of bounds");
    }
    Ok(U256::from_big_endian(&data[offset..offset + 32]))
}

fn read_usize(data: &[u8], offset: usize) -> Result<usize, AbiError> {
    let v = read_u256(data, offset)?;
    // Reject implausibly large offsets / lengths early.
    if v > U256::from(u32::MAX) {
        return Err("abi: offset/length too large");
    }
    Ok(v.low_u64() as usize)
}

fn read_bytes_at(data: &[u8], bytes_offset: usize) -> Result<Vec<u8>, AbiError> {
    let len = read_usize(data, bytes_offset)?;
    let start = bytes_offset + 32;
    if start + len > data.len() {
        return Err("abi: bytes data out of bounds");
    }
    Ok(data[start..start + len].to_vec())
}

fn read_uint256_array_at(data: &[u8], arr_offset: usize) -> Result<Vec<U256>, AbiError> {
    let len = read_usize(data, arr_offset)?;
    let data_start = arr_offset + 32;
    if data_start + len * 32 > data.len() {
        return Err("abi: uint256[] data out of bounds");
    }
    (0..len)
        .map(|i| read_u256(data, data_start + i * 32))
        .collect()
}

fn read_int256_array_at(data: &[u8], arr_offset: usize) -> Result<Vec<I256>, AbiError> {
    let len = read_usize(data, arr_offset)?;
    let data_start = arr_offset + 32;
    if data_start + len * 32 > data.len() {
        return Err("abi: int256[] data out of bounds");
    }
    let mut result = Vec::with_capacity(len);
    for i in 0..len {
        let start = data_start + i * 32;
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(&data[start..start + 32]);
        result.push(I256(bytes));
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Public decode functions
// ---------------------------------------------------------------------------

/// Decode `uint256[]` — single dynamic-array argument.
pub fn decode_uint256_array(data: &[u8]) -> Result<Vec<U256>, AbiError> {
    let arr_offset = read_usize(data, 0)?;
    read_uint256_array_at(data, arr_offset)
}

/// Decode `int256[]` — single dynamic-array argument.
pub fn decode_int256_array(data: &[u8]) -> Result<Vec<I256>, AbiError> {
    let arr_offset = read_usize(data, 0)?;
    read_int256_array_at(data, arr_offset)
}

/// Decode `(int256[], int256[])` — two dynamic-array arguments.
pub fn decode_int256_array_pair(data: &[u8]) -> Result<(Vec<I256>, Vec<I256>), AbiError> {
    let off0 = read_usize(data, 0)?;
    let off1 = read_usize(data, 32)?;
    Ok((
        read_int256_array_at(data, off0)?,
        read_int256_array_at(data, off1)?,
    ))
}

/// Decode `(bytes, bytes, bytes)` — three dynamic byte-array arguments.
pub fn decode_bytes_tuple_3(data: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), AbiError> {
    let off0 = read_usize(data, 0)?;
    let off1 = read_usize(data, 32)?;
    let off2 = read_usize(data, 64)?;
    Ok((
        read_bytes_at(data, off0)?,
        read_bytes_at(data, off1)?,
        read_bytes_at(data, off2)?,
    ))
}

// ---------------------------------------------------------------------------
// Public encode functions
// ---------------------------------------------------------------------------

pub fn encode_uint256(u: U256) -> Vec<u8> {
    let mut out = vec![0u8; 32];
    u.to_big_endian(&mut out);
    out
}

pub fn encode_bool(b: bool) -> Vec<u8> {
    encode_uint256(if b { U256::one() } else { U256::zero() })
}

pub fn encode_int256(i: &I256) -> Vec<u8> {
    i.0.to_vec()
}

// ---------------------------------------------------------------------------
// I256 — big-endian two's-complement signed 256-bit integer
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct I256(pub [u8; 32]);

impl I256 {
    pub const ZERO: I256 = I256([0u8; 32]);

    pub fn is_negative(&self) -> bool {
        self.0[0] & 0x80 != 0
    }

    /// Returns `(is_negative, |self| as U256)`.
    ///
    /// For the minimum value −2^255 the magnitude is 2^255, which fits in U256.
    fn to_abs(&self) -> (bool, U256) {
        if self.is_negative() {
            // Two's complement negation: flip all bits, add 1.
            let mut inv = [0u8; 32];
            for i in 0..32 {
                inv[i] = !self.0[i];
            }
            let flipped = U256::from_big_endian(&inv);
            // flipped is at most 2^255 - 1; +1 is at most 2^255 — no U256 overflow.
            (true, flipped + U256::one())
        } else {
            (false, U256::from_big_endian(&self.0))
        }
    }

    /// Construct from a non-negative magnitude. Returns `None` if `u >= 2^255`.
    fn from_positive(u: U256) -> Option<I256> {
        if u.bit(255) {
            return None; // would look negative in two's complement
        }
        let mut bytes = [0u8; 32];
        u.to_big_endian(&mut bytes);
        Some(I256(bytes))
    }

    /// Construct the negative value −`u` where `u` is the magnitude.
    /// Returns `None` if `u > 2^255` (out of I256 range).
    fn from_negative_magnitude(u: U256) -> Option<I256> {
        if u.is_zero() {
            return Some(I256::ZERO);
        }
        let max_neg_mag = U256::one() << 255usize; // = 2^255
        if u > max_neg_mag {
            return None;
        }
        // −u in two's complement = ~(u − 1)
        let u_minus_1 = u - U256::one();
        let mut bytes = [0u8; 32];
        u_minus_1.to_big_endian(&mut bytes);
        for b in bytes.iter_mut() {
            *b = !*b;
        }
        Some(I256(bytes))
    }

    /// Checked addition. Returns `None` on overflow.
    pub fn checked_add(self, other: I256) -> Option<I256> {
        let (neg_a, abs_a) = self.to_abs();
        let (neg_b, abs_b) = other.to_abs();

        if neg_a == neg_b {
            // Same sign: add magnitudes. Overflow of U256 itself → None.
            let sum = abs_a.checked_add(abs_b)?;
            if neg_a {
                I256::from_negative_magnitude(sum)
            } else {
                I256::from_positive(sum)
            }
        } else if abs_a >= abs_b {
            let diff = abs_a - abs_b;
            if neg_a {
                I256::from_negative_magnitude(diff)
            } else {
                I256::from_positive(diff)
            }
        } else {
            let diff = abs_b - abs_a;
            if neg_b {
                I256::from_negative_magnitude(diff)
            } else {
                I256::from_positive(diff)
            }
        }
    }

    /// Checked multiplication. Returns `None` on overflow.
    pub fn checked_mul(self, other: I256) -> Option<I256> {
        let (neg_a, abs_a) = self.to_abs();
        let (neg_b, abs_b) = other.to_abs();
        let result_neg = neg_a ^ neg_b;

        // U512 intermediate: U256×U256 ≤ (2^256−1)² < 2^512.
        let prod = u256_to_u512(abs_a) * u256_to_u512(abs_b);

        // Maximum representable magnitude:
        //   positive → 2^255 − 1
        //   negative → 2^255
        let max_mag: U512 = if result_neg {
            U512::one() << 255usize
        } else {
            (U512::one() << 255usize) - U512::one()
        };

        if prod > max_mag {
            return None;
        }

        // Extract lower 256 bits (safe: prod < 2^255 ≤ 2^256).
        let mut prod_bytes = [0u8; 64];
        prod.to_big_endian(&mut prod_bytes);
        let prod_u256 = U256::from_big_endian(&prod_bytes[32..]);

        if result_neg {
            I256::from_negative_magnitude(prod_u256)
        } else {
            I256::from_positive(prod_u256)
        }
    }
}

/// Zero-extend a U256 to U512.
fn u256_to_u512(u: U256) -> U512 {
    let mut bytes = [0u8; 64];
    u.to_big_endian(&mut bytes[32..]);
    U512::from_big_endian(&bytes)
}
