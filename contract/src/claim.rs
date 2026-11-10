//! Le bon de travail signé (C-F14) : « le silence vaut paiement ».
//!
//! L'agent signe un bon pour une tâche validée qu'il n'a pas réglée. Passé le délai
//! `pay_or_reject_seconds`, n'importe quel relais peut présenter le bon : le contrat
//! vérifie la signature, le délai, les bornes et les plafonds, puis paie le bénéficiaire.
use std::collections::BTreeMap;

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near_bindgen, AccountId};

use crate::errors::*;
use crate::models::*;
use crate::{HireclawContract, HireclawContractExt};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct Ticket {
    pub job_id: String,
    pub task_id: String,
    pub worker: AccountId,
    pub amount: U128,
    pub reason: String,
    pub issued_ms: u64,
    pub agent: AccountId,
    pub signature: String,
}

/// Empreinte canonique signée par l'agent : mêmes octets que le code Python
/// (`json.dumps(payload, sort_keys=True, separators=(",", ":"))`).
pub fn canonical_payload(ticket: &Ticket) -> Vec<u8> {
    let mut map = BTreeMap::new();
    map.insert("agent", serde_json::Value::String(ticket.agent.to_string()));
    map.insert(
        "amount",
        serde_json::Value::Number(serde_json::Number::from(u64::try_from(ticket.amount.0).unwrap_or(u64::MAX))),
    );
    map.insert("issued_ms", serde_json::Value::Number(ticket.issued_ms.into()));
    map.insert("job_id", serde_json::Value::String(ticket.job_id.clone()));
    map.insert("reason", serde_json::Value::String(ticket.reason.clone()));
    map.insert("task_id", serde_json::Value::String(ticket.task_id.clone()));
    map.insert("worker", serde_json::Value::String(ticket.worker.to_string()));
    serde_json::to_vec(&map).unwrap_or_default()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(env::sha256(bytes))
}

fn hex32(value: &str) -> Option<[u8; 32]> {
    hex::decode(value).ok()?.try_into().ok()
}

fn hex64(value: &str) -> Option<[u8; 64]> {
    hex::decode(value).ok()?.try_into().ok()
}

#[near_bindgen]
impl HireclawContract {
    /// L'agent (ou le propriétaire) enregistre la clé publique qui signe les bons.
    pub fn set_agent_key(&mut self, agent_pk: String) {
        let caller = env::predecessor_account_id();
        if caller != self.agent && caller != self.owner {
            env::panic_str(ERR_NOT_AGENT);
        }
        if hex32(&agent_pk).is_none() {
            env::panic_str(ERR_BAD_SIGNATURE);
        }
        self.agent_pk = agent_pk.clone();
        self.log_entry("set_agent_key", caller, "", 0, &agent_pk[..16.min(agent_pk.len())], "");
    }

    pub fn claim_unpaid(&mut self, ticket: Ticket) -> U128 {
        if env::predecessor_account_id() != ticket.worker {
            env::panic_str(ERR_NOT_AGENT);
        }
        let digest = self.verify_ticket(&ticket);
        let mut job = self.jobs.get(&ticket.job_id).unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_JOB));
        if job.state != JobState::Accepted {
            env::panic_str(ERR_PAYROLL_BUDGET);
        }
        let key = format!("{}:{}:{}", job.id, ticket.task_id, ticket.worker);
        if self.settled.get(&key).unwrap_or(false) || self.claimed.get(&digest).unwrap_or(false) {
            env::panic_str(ERR_ALREADY_SETTLED);
        }
        self.check_bounds(ticket.amount.0);
        self.roll_day();
        let amount = self.apply_claim(&mut job, &ticket, key, digest);
        self.jobs.insert(&job.id, &job);
        self.log_entry(
            "claim",
            ticket.worker.clone(),
            &job.id,
            amount,
            &format!("{} — le silence valait paiement", ticket.task_id),
            &ticket.reason,
        );
        self.emit(
            "claim",
            &format!(
                "{{\"job\":\"{}\",\"worker\":\"{}\",\"amount\":\"{}\"}}",
                job.id, ticket.worker, amount
            ),
        );
        U128(amount)
    }

    fn verify_ticket(&self, ticket: &Ticket) -> String {
        let pk = hex32(&self.agent_pk).unwrap_or_else(|| env::panic_str(ERR_BAD_SIGNATURE));
        let sig = hex64(&ticket.signature).unwrap_or_else(|| env::panic_str(ERR_BAD_SIGNATURE));
        if ticket.agent != self.agent {
            env::panic_str(ERR_BAD_SIGNATURE);
        }
        let payload = canonical_payload(ticket);
        if !env::ed25519_verify(&sig, payload.as_slice(), &pk) {
            env::panic_str(ERR_BAD_SIGNATURE);
        }
        let deadline = ticket.issued_ms.saturating_add((self.rules.pay_or_reject_seconds as u64) * 1000);
        if env::block_timestamp_ms() < deadline {
            env::panic_str(ERR_NOT_DUE);
        }
        sha256_hex(&payload)
    }

    fn apply_claim(&mut self, job: &mut Job, ticket: &Ticket, key: String, digest: String) -> u128 {
        let amount = ticket.amount.0;
        let mut worker = self.workers.get(&ticket.worker).unwrap_or_else(|| env::panic_str(ERR_NOT_HIRED));
        if worker.status == WorkerStatus::Fired {
            env::panic_str(ERR_WORKER_FIRED);
        }
        if job.payroll_spent.0 + amount > job.payroll_budget.0 {
            env::panic_str(ERR_PAYROLL_BUDGET);
        }
        if self.daily_payroll + amount > self.rules.payroll_cap_per_day.0 {
            env::panic_str(ERR_DAILY_CAP);
        }
        if worker.earned_today.0 + amount > self.rules.worker_cap_per_day.0 {
            env::panic_str(ERR_WORKER_CAP);
        }
        self.settled.insert(&key, &true);
        self.claimed.insert(&digest, &true);
        worker.tasks_paid += 1;
        worker.earned_total = U128(worker.earned_total.0 + amount);
        worker.earned_today = U128(worker.earned_today.0 + amount);
        self.workers.insert(&ticket.worker, &worker);
        self.credit(&ticket.worker, amount);
        job.payroll_spent = U128(job.payroll_spent.0 + amount);
        self.daily_payroll += amount;
        amount
    }
}