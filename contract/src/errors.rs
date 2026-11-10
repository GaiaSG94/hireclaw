use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};

pub const ERR_PAUSED: &str = "ERR_PAUSED";
pub const ERR_NOT_AGENT: &str = "ERR_NOT_AGENT";
pub const ERR_NOT_OWNER: &str = "ERR_NOT_OWNER";
pub const ERR_PAY_BELOW_MIN: &str = "ERR_PAY_BELOW_MIN";
pub const ERR_PAY_ABOVE_MAX: &str = "ERR_PAY_ABOVE_MAX";
pub const ERR_PAYROLL_BUDGET: &str = "ERR_PAYROLL_BUDGET";
pub const ERR_DAILY_CAP: &str = "ERR_DAILY_CAP";
pub const ERR_WORKER_CAP: &str = "ERR_WORKER_CAP";
pub const ERR_ALREADY_SETTLED: &str = "ERR_ALREADY_SETTLED";
pub const ERR_WORKER_FIRED: &str = "ERR_WORKER_FIRED";
pub const ERR_NOT_HIRED: &str = "ERR_NOT_HIRED";
pub const ERR_FIRE_NOT_JUSTIFIED: &str = "ERR_FIRE_NOT_JUSTIFIED";
pub const ERR_NOT_DELIVERABLE: &str = "ERR_NOT_DELIVERABLE";
pub const ERR_GOLD_MISMATCH: &str = "ERR_GOLD_MISMATCH";
pub const ERR_ALREADY_ACCEPTED: &str = "ERR_ALREADY_ACCEPTED";
pub const ERR_ALREADY_HIRED: &str = "ERR_ALREADY_HIRED";
pub const ERR_FORBIDDEN_WORKER: &str = "ERR_FORBIDDEN_WORKER";
pub const ERR_INFERENCE_CAP: &str = "ERR_INFERENCE_CAP";
pub const ERR_NOT_DUE: &str = "ERR_NOT_DUE";
pub const ERR_ALREADY_DELIVERED: &str = "ERR_ALREADY_DELIVERED";
pub const ERR_UNKNOWN_JOB: &str = "ERR_UNKNOWN_JOB";
pub const ERR_INSUFFICIENT: &str = "ERR_INSUFFICIENT";
pub const ERR_BAD_ORDER: &str = "ERR_BAD_ORDER";
pub const ERR_BAD_SIGNATURE: &str = "ERR_BAD_SIGNATURE";

pub const DAY_NS: u64 = 86_400_000_000_000;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub enum WorkerStatus {
    Trial,
    Active,
    Senior,
    Fired,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub enum JobState {
    Ordered,
    Accepted,
    Delivered,
    Refunded,
}