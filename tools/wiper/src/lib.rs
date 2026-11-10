//! Contrat utilitaire : purge TOUT le stockage d'un compte NEAR, sauf `STATE`.
//!
//! Pourquoi : redéployer un contrat ne vide pas son état. Les collections
//! (`LookupMap`, `Vector`) vivent sous leurs propres clés et survivent à une
//! réinitialisation de la racine — d'où des états hybrides incohérents.
//! `near-sdk` n'expose pas d'itérateur de stockage : on passe par `near-sys`.
//!
//! Usage : déployer ce contrat à la place de l'ancien, appeler `wipe()`,
//! puis redéployer le vrai contrat (état vierge).
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen};

const KEY_REGISTER: u64 = 0;
const VALUE_REGISTER: u64 = 1;
const BUF: u64 = 1 << 20; // tampon de 1 Mio pour la clé courante

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct Wiper;

impl near_sdk::state::ContractState for Wiper {}

#[near_bindgen]
impl Wiper {
    #[init(ignore_state)]
    pub fn new() -> Self {
        Self
    }

    /// Supprime toutes les clés sauf `STATE`. Retourne le nombre de clés supprimées.
    pub fn wipe(&mut self) -> u64 {
        let keys = unsafe { collect_keys() };
        let mut removed = 0u64;
        for key in keys {
            if key == b"STATE" {
                continue;
            }
            if env::storage_remove(&key) {
                removed += 1;
            }
        }
        env::log_str(&format!("wiped {} keys", removed));
        removed
    }

    pub fn count(&self) -> u64 {
        unsafe { collect_keys().len() as u64 }
    }
}

/// Parcourt tout le stockage du compte (préfixe vide) et collecte les clés.
///
/// On collecte d'abord, puis on supprime : modifier le trie pendant l'itération
/// invalide l'itérateur.
unsafe fn collect_keys() -> Vec<Vec<u8>> {
    let mut keys = Vec::new();
    let iter_id = near_sys::storage_iter_prefix(0, 0);
    loop {
        let found = near_sys::storage_iter_next(iter_id, BUF, BUF + 4096);
        if found != 1 {
            break;
        }
        let len = near_sys::register_len(KEY_REGISTER);
        if len == u64::MAX || len > 1 << 20 {
            break;
        }
        let mut key = vec![0u8; len as usize];
        near_sys::read_register(KEY_REGISTER, key.as_mut_ptr() as u64);
        keys.push(key);
    }
    keys
}
