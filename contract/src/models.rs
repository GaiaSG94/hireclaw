use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::AccountId;

use crate::errors::{JobState, WorkerStatus};

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct Job {
    pub id: String,
    pub client: AccountId,
    pub budget: U128,
    pub n_items: u32,
    pub deadline_ms: u64,
    pub spec_hash: String,
    pub created_ms: u64,
    pub state: JobState,
    pub pay_per_task: U128,
    pub margin_reserved: U128,
    pub payroll_budget: U128,
    pub payroll_spent: U128,
    pub gold_commit: String,
    pub gold_reveal: Option<String>,
    pub result_hash: String,
    pub n_validated: u32,
    pub delivered_ms: Option<u64>,
    pub inference_spent: U128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct Worker {
    pub account: AccountId,
    pub status: WorkerStatus,
    pub tasks_paid: u32,
    pub tasks_rejected: u32,
    pub gold_ok: u32,
    pub gold_ko: u32,
    pub earned_total: U128,
    pub earned_today: U128,
    pub hired_ms: u64,
    pub fired_ms: Option<u64>,
}

impl Worker {
    pub fn new(account: AccountId, hired_ms: u64) -> Self {
        Self {
            account,
            status: WorkerStatus::Trial,
            tasks_paid: 0,
            tasks_rejected: 0,
            gold_ok: 0,
            gold_ko: 0,
            earned_total: U128(0),
            earned_today: U128(0),
            hired_ms,
            fired_ms: None,
        }
    }

    pub fn golds(&self) -> u32 {
        self.gold_ok + self.gold_ko
    }

    pub fn accuracy_pct(&self) -> u8 {
        let total = self.golds();
        if total == 0 {
            0
        } else {
            ((self.gold_ok as u64 * 100) / total as u64) as u8
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct Entry {
    pub seq: u64,
    pub at_ms: u64,
    pub kind: String,
    pub actor: AccountId,
    pub job: String,
    pub amount: U128,
    pub detail: String,
    pub reason: String,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, Default)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct Buckets {
    pub owner: U128,
    pub reserve: U128,
    pub contributors: U128,
}

impl Buckets {
    pub fn add(&mut self, owner: u128, reserve: u128, contrib: u128) {
        self.owner = U128(self.owner.0 + owner);
        self.reserve = U128(self.reserve.0 + reserve);
        self.contributors = U128(self.contributors.0 + contrib);
    }

    pub fn total(&self) -> u128 {
        self.owner.0 + self.reserve.0 + self.contributors.0
    }
}