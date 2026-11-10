use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near_bindgen, AccountId, PromiseOrValue};

use crate::errors::*;
use crate::models::*;
use crate::HireclawContract;
use crate::HireclawContractExt;

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct OrderMsg {
    pub action: String,
    pub n_items: u32,
    pub deadline_ms: u64,
    pub spec_hash: String,
}

#[near_bindgen]
impl HireclawContract {
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        assert_eq!(env::predecessor_account_id(), self.token, "token only");
        self.require_active();
        let parsed: OrderMsg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str(ERR_BAD_ORDER));
        if parsed.action != "order" || parsed.n_items == 0 || amount.0 == 0 {
            env::panic_str(ERR_BAD_ORDER);
        }
        if parsed.deadline_ms <= self.now_ms() {
            env::panic_str(ERR_BAD_ORDER);
        }
        let job_id = format!("job-{:04}", self.job_keys.len() + 1);
        let job = Job {
            id: job_id.clone(),
            client: sender_id.clone(),
            budget: amount,
            n_items: parsed.n_items,
            deadline_ms: parsed.deadline_ms,
            spec_hash: parsed.spec_hash,
            created_ms: self.now_ms(),
            state: JobState::Ordered,
            pay_per_task: U128(0),
            margin_reserved: U128(0),
            payroll_budget: U128(0),
            payroll_spent: U128(0),
            gold_commit: String::new(),
            gold_reveal: None,
            result_hash: String::new(),
            n_validated: 0,
            delivered_ms: None,
            inference_spent: U128(0),
        };
        self.jobs.insert(&job_id, &job);
        self.job_keys.push(&job_id);
        self.balance += amount.0;
        self.log_entry("order", sender_id.clone(), &job_id, amount.0, &format!("{} elements", parsed.n_items), "");
        self.emit(
            "order",
            &format!(
                "{{\"job\":\"{}\",\"client\":\"{}\",\"budget\":\"{}\"}}",
                job_id, sender_id, amount.0
            ),
        );
        PromiseOrValue::Value(U128(0))
    }

    pub fn accept_job(&mut self, job_id: String, pay_per_task: U128, gold_commit: String) {
        self.require_agent();
        self.require_active();
        let mut job = self.jobs.get(&job_id).unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_JOB));
        if job.state != JobState::Ordered {
            env::panic_str(ERR_ALREADY_ACCEPTED);
        }
        self.check_bounds(pay_per_task.0);
        if gold_commit.is_empty() {
            env::panic_str(ERR_BAD_ORDER);
        }
        let margin = (job.budget.0 * self.rules.min_margin_pct as u128 + 99) / 100;
        let payroll = job.budget.0.checked_sub(margin).unwrap_or(0);
        if payroll < pay_per_task.0 {
            env::panic_str(ERR_PAYROLL_BUDGET);
        }
        job.pay_per_task = pay_per_task;
        job.margin_reserved = U128(margin);
        job.payroll_budget = U128(payroll);
        job.gold_commit = gold_commit;
        job.state = JobState::Accepted;
        self.jobs.insert(&job_id, &job);
        self.log_entry(
            "accept",
            env::predecessor_account_id(),
            &job_id,
            job.budget.0,
            &format!("pay {} margin {} payroll {}", pay_per_task.0, margin, payroll),
            "",
        );
    }

    pub fn hire(&mut self, worker: AccountId) -> near_sdk::Promise {
        self.require_agent();
        self.require_active();
        if worker == self.agent || worker == self.owner {
            env::panic_str(ERR_FORBIDDEN_WORKER);
        }
        if self.workers.get(&worker).is_some() {
            env::panic_str(ERR_ALREADY_HIRED);
        }
        let w = Worker::new(worker.clone(), self.now_ms());
        self.workers.insert(&worker, &w);
        self.worker_keys.push(&worker);
        self.log_entry("hire", env::predecessor_account_id(), "", 0, worker.as_str(), "hired");
        self.emit("hire", &format!("{{\"worker\":\"{}\"}}", worker));
        self.register_worker(worker)
    }
}