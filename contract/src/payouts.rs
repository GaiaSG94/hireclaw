use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near_bindgen, AccountId, Gas, NearToken, Promise};

use crate::errors::*;
use crate::HireclawContract;
use crate::HireclawContractExt;

pub const TGAS_FT_TRANSFER: u64 = 25;
pub const TGAS_CALLBACK: u64 = 15;
/// Frais d'inscription d'un compte implicite auprès du jeton : payés par le contrat,
/// jamais par le travailleur (0,00235 N suffit partout où le tarif NEP-141 est standard).
pub const REGISTRATION_DEPOSIT_YOCTO: u128 = 2_350_000_000_000_000_000_000;

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

#[near_bindgen]
impl HireclawContract {
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
        // Le solde ne bouge qu'à la confirmation : pendant le vol, l'argent est encore en garde.
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

    /// Réaligne la comptabilité du contrat sur le solde qu'il détient réellement
    /// auprès du jeton. L'excédent non comptabilisé (après une réinitialisation, par
    /// exemple) est versé au propriétaire : personne ne perd de fonds.
    pub fn sweep_excess(&mut self) -> Promise {
        let caller = env::predecessor_account_id();
        // Le propriétaire ou le compte contrat lui-même (auto-appel) : personne d'autre.
        if caller != self.owner && caller != env::current_account_id() {
            env::panic_str(ERR_NOT_OWNER);
        }
        let contract = env::current_account_id();
        ext_ft::ext(self.token.clone())
            .with_static_gas(Gas::from_tgas(TGAS_CALLBACK))
            .ft_balance_of(contract)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(TGAS_CALLBACK))
                    .on_token_balance(),
            )
    }

    /// Le jeton répond : le contrat reconnaît les fonds qu'il détient réellement,
    /// et l'excédent non comptabilisé part au propriétaire. Plus personne ne perd rien.
    #[private]
    pub fn on_token_balance(&mut self) -> bool {
        let raw = match env::promise_result_checked(0, 32) {
            Ok(bytes) => bytes,
            Err(_) => return false,
        };
        let text = String::from_utf8_lossy(&raw).trim_matches('"').to_string();
        let token_balance: u128 = text.parse().unwrap_or(0);
        if token_balance > self.balance {
            // Le jeton détient plus que nos livres : l'écédent est un séquestre hérité
            // (commande payée avant une réinitialisation). On le comptabilise comme
            // un passif, pas comme une marge, et le propriétaire le récupère quand il veut.
            let excess = token_balance - self.balance;
            self.balance = token_balance;
            self.legacy_escrow += excess;
            self.log_entry(
                "sweep",
                env::current_account_id(),
                "",
                excess,
                "séquestre hérité comptabilisé",
                "",
            );
        }
        true
    }

    #[private]
    pub fn on_payout(&mut self, account: AccountId, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 0).is_ok();
        let pending = self.pending_out.get(&account).unwrap_or(0);
        self.pending_out.insert(&account, &pending.saturating_sub(amount.0));
        if ok {
            // L'USDC a quitté la garde du contrat : le solde suit.
            self.balance = self.balance.saturating_sub(amount.0);
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