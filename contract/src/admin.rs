use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{env, near_bindgen, AccountId, Promise};

use crate::errors::*;
use crate::models::*;
use crate::rules::RulesConfig;
use crate::HireclawContract;
use crate::HireclawContractExt;

#[derive(Serialize)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct SolvencyView {
    pub balance: U128,
    pub payroll_held: U128,
    pub margins_held: U128,
    pub buckets: Buckets,
    pub withdrawable_total: U128,
    pub pending_out_total: U128,
    pub legacy_escrow: U128,
    pub sum: U128,
    pub balanced: bool,
}

#[near_bindgen]
impl HireclawContract {
    pub fn pause(&mut self, reason: Option<String>) {
        let caller = env::predecessor_account_id();
        if caller != self.owner && caller != self.agent {
            env::panic_str(ERR_NOT_AGENT);
        }
        self.paused = true;
        self.log_entry("pause", caller, "", 0, "", reason.as_deref().unwrap_or(""));
    }

    pub fn resume(&mut self) {
        let caller = env::predecessor_account_id();
        if caller != self.owner && caller != self.agent {
            env::panic_str(ERR_NOT_AGENT);
        }
        self.paused = false;
        self.log_entry("resume", caller, "", 0, "resumed", "");
    }

    #[payable]
    pub fn set_agent(&mut self, agent: AccountId) {
        near_sdk::assert_one_yocto();
        self.require_owner();
        assert_ne!(agent, self.owner, "agent != owner");
        let old = self.agent.clone();
        self.agent = agent.clone();
        self.log_entry("set_agent", old, "", 0, agent.as_str(), "cle de l'agent changee");
    }

    #[payable]
    pub fn set_rules(&mut self, rules: RulesConfig) {
        near_sdk::assert_one_yocto();
        self.require_owner();
        rules.validate();
        self.rules = rules;
        self.log_entry("set_rules", env::predecessor_account_id(), "", 0, "regles mises a jour", "");
    }

    pub fn withdraw(&mut self, amount: Option<U128>) -> Promise {
        let caller = env::predecessor_account_id();
        let avail = self.withdrawable.get(&caller).unwrap_or(0);
        let withdraw_amt = amount.map(|a| a.0).unwrap_or(avail);
        if withdraw_amt == 0 || withdraw_amt > avail {
            env::panic_str(ERR_INSUFFICIENT);
        }
        self.withdrawable.insert(&caller, &(avail - withdraw_amt));
        self.pay_out(caller, withdraw_amt)
    }

    /// Le propriétaire récupère le séquestre hérité (USDC déposés au contrat avant une
    /// réinitialisation). Le jeton refuse le transfert s'il n'y a rien : le callback
    /// rend alors les fonds.
    #[payable]
    pub fn sweep_to_owner(&mut self, amount: Option<U128>) -> Promise {
        let caller = env::predecessor_account_id();
        if caller != self.owner {
            env::panic_str(ERR_NOT_OWNER);
        }
        let value = amount.map(|a| a.0).unwrap_or(self.legacy_escrow);
        if value == 0 || value > self.legacy_escrow {
            env::panic_str(ERR_INSUFFICIENT);
        }
        self.legacy_escrow -= value;
        self.pay_out(caller, value)
    }

    pub fn get_job(&self, job_id: String) -> Option<Job> {
        self.jobs.get(&job_id)
    }

    pub fn get_worker(&self, account: AccountId) -> Option<Worker> {
        self.workers.get(&account)
    }

    pub fn get_rules(&self) -> RulesConfig {
        self.rules.clone()
    }

    pub fn get_ledger(&self, from: Option<u64>, limit: Option<u32>) -> Vec<Entry> {
        let total = self.ledger.len();
        let start = from.unwrap_or(0).min(total);
        let count = limit.unwrap_or(50).min((total - start) as u32);
        (start..start + count as u64)
            .filter_map(|i| self.ledger.get(i))
            .collect()
    }

    pub fn get_solvency(&self) -> SolvencyView {
        let mut payroll_held = 0u128;
        let mut margins_held = 0u128;
        for key in self.job_keys.iter() {
            if let Some(j) = self.jobs.get(&key) {
                if j.state == JobState::Ordered || j.state == JobState::Accepted {
                    payroll_held += j.payroll_budget.0.saturating_sub(j.payroll_spent.0);
                    margins_held += j.margin_reserved.0;
                }
            }
        }
        let mut withdrawable_total = 0u128;
        let mut pending_out_total = 0u128;
        for key in self.payees.iter() {
            withdrawable_total += self.withdrawable.get(&key).unwrap_or(0);
            pending_out_total += self.pending_out.get(&key).unwrap_or(0);
        }
        let bucket_total = self.buckets.total();
        let legacy = self.legacy_escrow;
        let sum = payroll_held + margins_held + bucket_total + withdrawable_total + pending_out_total + legacy;
        SolvencyView {
            balance: U128(self.balance),
            payroll_held: U128(payroll_held),
            margins_held: U128(margins_held),
            buckets: self.buckets.clone(),
            withdrawable_total: U128(withdrawable_total),
            pending_out_total: U128(pending_out_total),
            legacy_escrow: U128(legacy),
            sum: U128(sum),
            balanced: sum == self.balance,
        }
    }
}