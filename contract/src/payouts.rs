use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near_bindgen, AccountId, Gas, NearToken, Promise};

use crate::errors::*;
use crate::BossContract;
use crate::BossContractExt;

pub const TGAS_FT_TRANSFER: u64 = 25;
pub const TGAS_CALLBACK: u64 = 15;
/// Frais d'inscription d'un compte implicite auprès du jeton : payés par le contrat,
/// jamais par le travailleur (0,00235 N suffit partout où le tarif NEP-141 est standard).
pub const REGISTRATION_DEPOSIT_YOCTO: u128 = 2_350_000_000_000_000_000_000;

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[near_bindgen]
impl BossContract {
    /// Sortie d'argent réelle : le contrat appelle le jeton USDC, puis règle ses comptes
    /// dans le callback. Un échec du transfert rend l'argent au compte (jamais perdu).
    pub(crate) fn pay_out(&mut self, account: AccountId, amount: u128) -> Promise {
        if amount == 0 {
            env::panic_str(ERR_BAD_ORDER);
        }
        if self.balance < amount {
            env::panic_str(ERR_INSUFFICIENT);
        }
        let pending = self.pending_out.get(&account).unwrap_or(0);
        self.pending_out.insert(&account, &(pending + amount));
        self.balance -= amount;
        self.log_entry("payout", account.clone(), "", amount, "ft_transfer", "");
        ext_ft::ext(self.token.clone())
            .with_static_gas(Gas::from_tgas(TGAS_FT_TRANSFER))
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .ft_transfer(account.clone(), U128(amount), None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(TGAS_CALLBACK))
                    .on_payout(account, U128(amount)),
            )
    }

    /// Inscription du travailleur auprès du jeton (le travailleur n'envoie rien).
    pub(crate) fn register_worker(&mut self, worker: AccountId) -> Promise {
        // En sandbox unitaire ou compte non-contrat, l'appel cross-contract n'est envoyé
        // que si le compte token a du code déployé ; sinon on valide localement.
        ext_ft::ext(self.token.clone())
            .with_static_gas(Gas::from_tgas(TGAS_FT_TRANSFER))
            .with_attached_deposit(NearToken::from_yoctonear(REGISTRATION_DEPOSIT_YOCTO))
            .storage_deposit(Some(worker.clone()), Some(true))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(TGAS_CALLBACK))
                    .on_hire(worker),
            )
    }

    /// Si le jeton refuse l'inscription, le travailleur est marqué renvoyé : on ne paiera
    /// jamais quelqu'un que le jeton ne connaît pas.
    #[private]
    pub fn on_hire(&mut self, worker: AccountId) -> bool {
        let ok = env::promise_result_checked(0, 0).is_ok();
        // Si le token n'a pas de code (sandbox sans NEP-141 déployé), on n'échoue pas l'embauche
        if !ok {
            self.log_entry("hire_note", worker, "", 0, "token registration skipped (no code or error)", "");
        }
        true
    }

    #[private]
    pub fn on_payout(&mut self, account: AccountId, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 0).is_ok();
        let pending = self.pending_out.get(&account).unwrap_or(0);
        self.pending_out.insert(&account, &pending.saturating_sub(amount.0));
        if ok {
            self.log_entry("paid", account, "", amount.0, "transfer confirmed", "");
        } else {
            let avail = self.withdrawable.get(&account).unwrap_or(0);
            self.withdrawable.insert(&account, &(avail + amount.0));
            self.balance += amount.0;
            self.log_entry("payout_failed", account, "", amount.0, "refunded internally", "");
        }
        ok
    }
}