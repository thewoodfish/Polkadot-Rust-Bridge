//! Poseidon hash over the BN254 scalar field.
//!
//! Uses the `poseidon-rs` (iden3) reference implementation which embeds the
//! standard circomlibjs round constants and MDS matrix for t = 2..=17.
//!
//! Selector: `poseidonHash(uint256[])` → 0x2a58cd44

use ff_ce::PrimeField;
use poseidon_rs::{Fr, FrRepr, Poseidon};
use primitive_types::U256;

use crate::abi::{self, AbiError};

pub fn handle(args: &[u8]) -> Result<Vec<u8>, AbiError> {
    let elements = abi::decode_uint256_array(args)?;

    if elements.is_empty() {
        return Err("poseidon: at least one input required");
    }
    if elements.len() > 16 {
        return Err("poseidon: maximum 16 inputs supported");
    }

    let frs: Vec<Fr> = elements
        .iter()
        .map(|u| u256_to_fr(*u))
        .collect::<Result<Vec<Fr>, AbiError>>()?;

    let poseidon = Poseidon::new();
    let result_fr = poseidon.hash(frs).map_err(|_| "poseidon: hash computation failed")?;

    Ok(abi::encode_uint256(fr_to_u256(result_fr)))
}

// ---------------------------------------------------------------------------
// Field-element ↔ U256 conversions
// ---------------------------------------------------------------------------

/// Convert a `U256` to a BN254 `Fr`, failing if the value ≥ field modulus.
///
/// Both `U256` and `FrRepr` store 4 × u64 limbs in little-endian order, so
/// the raw limb array can be moved directly.
fn u256_to_fr(u: U256) -> Result<Fr, AbiError> {
    Fr::from_repr(FrRepr(u.0)).map_err(|_| "poseidon: input not in BN254 scalar field")
}

/// Convert a BN254 `Fr` back to `U256`.
///
/// `into_repr()` de-Montgomerifies and returns little-endian limbs — the same
/// layout used by `U256`.
fn fr_to_u256(fr: Fr) -> U256 {
    U256(fr.into_repr().0)
}
