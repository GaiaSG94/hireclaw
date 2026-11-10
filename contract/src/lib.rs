use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, Vector};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near_bindgen, AccountId, PanicOnDefault};

pub mod admin;
pub mod errors;
pub mod models;
pub mod order;
pub mod payout;
pub mod payouts;
pub mod rules;
pub mod settle;

#[cfg(test)]
mod tests;

use errors::*;
use models::*;
use rules::RulesConfig;

#[derive(Serialize, Deserialize)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct BatchItem {
    pub task_id: String,
    pub worker: AccountId,
    pub gold: bool,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct HireclawContract {
    pub owner: AccountId,
    pub agent: AccountId,
    pub token: AccountId,
    pub rules: RulesConfig,
    pub paused: bool,
    pub balance: u128,
    pub buckets: Buckets,
    pub jobs: LookupMap<String, Job>,
    pub job_keys: Vector<String>,
    pub workers: LookupMap<AccountId, Worker>,
    pub worker_keys: Vector<AccountId>,
    pub settled: LookupMap<String, bool>,
    pub ledger: Vector<Entry>,
    pub withdrawable: LookupMap<AccountId, u128>,
    pub pending_out: LookupMap<AccountId, u128>,
    pub payees: Vector<AccountId>,
    pub payee_index: LookupMap<AccountId, bool>,
    pub daily_day: u64,
    pub daily_payroll: u128,
    pub daily_inference: u128,
    pub seq: u64,
}

impl near_sdk::state::ContractState for HireclawContract {}

#[near_bindgen]
impl HireclawContract {
    #[init]
    pub fn new(owner: AccountId, agent: AccountId, token: AccountId, rules: Option<RulesConfig>) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let conf = rules.unwrap_or_default();
        conf.validate();
        let paused = conf.kill_switch;
        Self {
            owner,
            agent,
            token,
            rules: conf,
            paused,
            balance: 0,
            buckets: Buckets::default(),
            jobs: LookupMap::new(b"j"),
            job_keys: Vector::new(b"k"),
            workers: LookupMap::new(b"w"),
            worker_keys: Vector::new(b"x"),
            settled: LookupMap::new(b"s"),
            ledger: Vector::new(b"l"),
            withdrawable: LookupMap::new(b"m"),
            pending_out: LookupMap::new(b"p"),
            payees: Vector::new(b"y"),
            payee_index: LookupMap::new(b"i"),
            daily_day: env::block_timestamp() / errors::DAY_NS,
            daily_payroll: 0,
            daily_inference: 0,
            seq: 0,
        }
    }

    pub fn now_ms(&self) -> u64 {
        env::block_timestamp() / 1_000_000
    }

    pub(crate) fn require_active(&self) {
        if self.paused {
            env::panic_str(ERR_PAUSED);
        }
    }

    pub(crate) fn require_agent(&self) {
        if env::predecessor_account_id() != self.agent {
            env::panic_str(ERR_NOT_AGENT);
        }
    }

    pub(crate) fn require_owner(&self) {
        if env::predecessor_account_id() != self.owner {
            env::panic_str(ERR_NOT_OWNER);
        }
    }

    pub(crate) fn log_entry(&mut self, kind: &str, actor: AccountId, job: &str, amount: u128, detail: &str, reason: &str) {
        self.seq += 1;
        self.ledger.push(&Entry {
            seq: self.seq,
            at_ms: self.now_ms(),
            kind: kind.to_string(),
            actor,
            job: job.to_string(),
            amount: U128(amount),
            detail: detail.to_string(),
            reason: reason.to_string(),
        });
    }

    /// Événement NEP-297 : les indexeurs suivent la paie et les refus sans lire l'état.
    pub(crate) fn emit(&self, event: &str, data: &str) {
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"hireclaw\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{}}}",
            event, data
        ));
    }

    pub(crate) fn roll_day(&mut self) {
        let today = env::block_timestamp() / errors::DAY_NS;
        if today != self.daily_day {
            self.daily_day = today;
            self.daily_payroll = 0;
            self.daily_inference = 0;
            for i in 0..self.worker_keys.len() {
                let acc = self.worker_keys.get(i).unwrap();
                if let Some(mut w) = self.workers.get(&acc) {
                    w.earned_today = U128(0);
                    self.workers.insert(&acc, &w);
                }
            }
        }
    }

    pub(crate) fn credit(&mut self, account: &AccountId, amount: u128) {
        let prev = self.withdrawable.get(account).unwrap_or(0);
        self.withdrawable.insert(account, &(prev + amount));
        if !self.payee_index.get(account).unwrap_or(false) {
            self.payee_index.insert(account, &true);
            self.payees.push(account);
        }
    }

    pub(crate) fn check_bounds(&self, pay: u128) {
        if pay < self.rules.task_pay_min.0 {
            env::panic_str(ERR_PAY_BELOW_MIN);
        }
        if pay > self.rules.task_pay_max.0 {
            env::panic_str(ERR_PAY_ABOVE_MAX);
        }
    }
}