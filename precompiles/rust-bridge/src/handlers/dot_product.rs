//! Signed 256-element dot product over int256.
//!
//! Computes Σ aᵢ·bᵢ for two equal-length int256[] arrays using fully
//! checked arithmetic — reverts (Err) on any intermediate overflow.
//!
//! Selector: `dotProduct(int256[],int256[])` → 0x55989ee5

use crate::abi::{self, AbiError, I256};

pub fn handle(args: &[u8]) -> Result<Vec<u8>, AbiError> {
    let (a, b) = abi::decode_int256_array_pair(args)?;

    if a.len() != b.len() {
        return Err("dot_product: array length mismatch");
    }
    if a.is_empty() {
        return Ok(abi::encode_int256(&I256::ZERO));
    }

    let mut acc = I256::ZERO;
    for (ai, bi) in a.iter().zip(b.iter()) {
        let product = ai
            .clone()
            .checked_mul(bi.clone())
            .ok_or("dot_product: multiplication overflow")?;
        acc = acc
            .checked_add(product)
            .ok_or("dot_product: accumulator overflow")?;
    }

    Ok(abi::encode_int256(&acc))
}
