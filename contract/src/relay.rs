//! Retrait relayé : le travailleur signe, n'importe qui peut déposer la transaction.
//!
//! Un travailleur n'a jamais de NEAR (son compte implicite est créé dans le
//! navigateur). Il signe donc un ordre de retrait avec sa clé Ed25519 — la clé dont
//! l'hexadécimal EST son identifiant de compte implicite — et un relais (le site,
//! l'agent, n'importe qui) paie le gas. Le bénéficiaire et le montant sont figés
//! par la signature : un relais ne peut ni se substituer au travailleur, ni gonfler
//! le montant, ni rejouer l'ordre (nonce unique + échéance).
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near_bindgen, AccountId, Promise};

use crate::errors::*;
use crate::{HireclawContract, HireclawContractExt};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct WithdrawTicket {
    pub worker: AccountId,
    pub amount: U128,
    pub nonce: u64,
    pub deadline_ms: u64,
    pub signature: String,
}

/// Empreinte canonique signée par le travailleur : mêmes octets que le code Python
/// (`json.dumps(payload, sort_keys=True, separators=(",", ":"))`).
pub fn canonical_withdraw(ticket: &WithdrawTicket) -> Vec<u8> {
    let mut map = std::collections::BTreeMap::new();
    map.insert(
        "amount",
        serde_json::Value::Number(u64::try_from(ticket.amount.0).unwrap_or(u64::MAX).into()),
    );
    map.insert("deadline_ms", serde_json::Value::Number(ticket.deadline_ms.into()));
    map.insert("nonce", serde_json::Value::Number(ticket.nonce.into()));
    map.insert("worker", serde_json::Value::String(ticket.worker.to_string()));
    serde_json::to_vec(&map).unwrap_or_default()
}

/// Un compte implicite NEAR est exactement l'hexadécimal de sa clé publique (64 caractères).
pub fn implicit_pubkey(account: &AccountId) -> Option<[u8; 32]> {
    let text = account.as_str();
    if text.len() != 64 || !text.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    hex::decode(text).ok()?.try_into().ok()
}

fn nonce_key(worker: &AccountId, nonce: u64) -> String {
    format!("{}#{}", worker, nonce)
}

#[near_bindgen]
impl HireclawContract {
    pub fn withdraw_signed(&mut self, ticket: WithdrawTicket) -> Promise {
        self.verify_withdrawal(&ticket);
        let key = nonce_key(&ticket.worker, ticket.nonce);
        if self.nonces.get(&key).unwrap_or(false) {
            env::panic_str(ERR_ALREADY_SETTLED);
        }
        let available = self.withdrawable.get(&ticket.worker).unwrap_or(0);
        if ticket.amount.0 == 0 || ticket.amount.0 > available {
            env::panic_str(ERR_INSUFFICIENT);
        }
        self.nonces.insert(&key, &true);
        self.withdrawable.insert(&ticket.worker, &(available - ticket.amount.0));
        self.log_entry(
            "withdraw_signed",
            env::predecessor_account_id(),
            "",
            ticket.amount.0,
            ticket.worker.as_str(),
            "ordre signé, relayé",
        );
        self.emit(
            "withdraw_signed",
            &format!("{{\"worker\":\"{}\",\"amount\":\"{}\"}}", ticket.worker, ticket.amount.0),
        );
        self.pay_out(ticket.worker.clone(), ticket.amount.0)
    }

    fn verify_withdrawal(&self, ticket: &WithdrawTicket) {
        let pubkey =
            implicit_pubkey(&ticket.worker).unwrap_or_else(|| env::panic_str(ERR_BAD_SIGNATURE));
        let signature: [u8; 64] = hex::decode(&ticket.signature)
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .unwrap_or_else(|| env::panic_str(ERR_BAD_SIGNATURE));
        let payload = canonical_withdraw(ticket);
        if !env::ed25519_verify(&signature, payload.as_slice(), &pubkey) {
            env::panic_str(ERR_BAD_SIGNATURE);
        }
        if env::block_timestamp_ms() > ticket.deadline_ms {
            env::panic_str(ERR_NOT_DUE);
        }
        if self.withdrawable.get(&ticket.worker).is_none() {
            env::panic_str(ERR_NOT_HIRED);
        }
    }
}
