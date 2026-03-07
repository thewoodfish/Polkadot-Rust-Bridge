//! BLS12-381 signature verification.
//!
//! Uses the `blst` crate (min_pk scheme):
//!   • public key  — 48-byte compressed G1 point
//!   • message     — arbitrary bytes
//!   • signature   — 96-byte compressed G2 point
//!
//! DST: BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_
//!
//! Selector: `blsVerify(bytes,bytes,bytes)` → 0xa65ebb25

use blst::{min_pk::PublicKey, min_pk::Signature, BLST_ERROR};

use crate::abi::{self, AbiError};

/// Domain-separation tag for the BLS signature scheme used here.
const DST: &[u8] = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_";

/// Expected byte lengths.
const PUBKEY_LEN: usize = 48;
const SIG_LEN: usize = 96;

pub fn handle(args: &[u8]) -> Result<Vec<u8>, AbiError> {
    let (pubkey_bytes, msg, sig_bytes) = abi::decode_bytes_tuple_3(args)?;

    if pubkey_bytes.len() != PUBKEY_LEN {
        return Err("bls: pubkey must be 48 bytes");
    }
    if sig_bytes.len() != SIG_LEN {
        return Err("bls: signature must be 96 bytes");
    }

    let pk = PublicKey::from_bytes(&pubkey_bytes).map_err(|_| "bls: invalid public key")?;
    let sig = Signature::from_bytes(&sig_bytes).map_err(|_| "bls: invalid signature")?;

    // sig_groupcheck=true, pk_validate=true for full security.
    let err = sig.verify(true, &msg, DST, &[], &pk, true);
    let valid = matches!(err, BLST_ERROR::BLST_SUCCESS);

    Ok(abi::encode_bool(valid))
}
