use near_sdk::json_types::U128;
use near_sdk::{env, near_bindgen, AccountId};

use crate::errors::*;
use crate::models::*;
use crate::BatchItem;
use crate::BossContract;
use crate::BossContractExt;

#[near_bindgen]
impl BossContract {
    pub fn pay_batch(&mut self, job_id: String, items: Vec<BatchItem>, amount: Option<U128>) -> U128 {
        self.require_agent();
        self.require_active();
        let mut job = self.jobs.get(&job_id).unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_JOB));
        if job.state != JobState::Accepted {
            env::panic_str(ERR_PAYROLL_BUDGET);
        }
        let pay = amount.map(|a| a.0).unwrap_or(job.pay_per_task.0);
        self.check_bounds(pay);
        assert!(!items.is_empty() && items.len() <= 10, "1 to 10 items per batch");
        self.roll_day();
        let total = self.pre_validate_batch(&job, &items, pay);
        self.apply_batch_payout(&mut job, &items, pay, total);
        self.jobs.insert(&job_id, &job);
        self.log_entry(
            "payroll",
            env::predecessor_account_id(),
            &job_id,
            total,
            &format!("{} tasks at {}", items.len(), pay),
            "",
        );
        self.emit(
            "payroll",
            &format!(
                "{{\"job\":\"{}\",\"amount\":\"{}\",\"tasks\":{}}}",
                job_id,
                total,
                items.len()
            ),
        );
        U128(total)
    }

    fn pre_validate_batch(&self, job: &Job, items: &[BatchItem], pay: u128) -> u128 {
        let mut total = 0u128;
        let mut seen_keys = std::collections::HashSet::new();
        for item in items {
            let key = format!("{}:{}:{}", job.id, item.task_id, item.worker);
            if seen_keys.contains(&key) || self.settled.get(&key).unwrap_or(false) {
                env::panic_str(ERR_ALREADY_SETTLED);
            }
            let w = self.workers.get(&item.worker).unwrap_or_else(|| env::panic_str(ERR_NOT_HIRED));
            if w.status == WorkerStatus::Fired {
                env::panic_str(ERR_WORKER_FIRED);
            }
            if job.payroll_spent.0 + total + pay > job.payroll_budget.0 {
                env::panic_str(ERR_PAYROLL_BUDGET);
            }
            if self.daily_payroll + total + pay > self.rules.payroll_cap_per_day.0 {
                env::panic_str(ERR_DAILY_CAP);
            }
            if w.earned_today.0 + pay > self.rules.worker_cap_per_day.0 {
                env::panic_str(ERR_WORKER_CAP);
            }
            seen_keys.insert(key);
            total += pay;
        }
        total
    }

    fn apply_batch_payout(&mut self, job: &mut Job, items: &[BatchItem], pay: u128, total: u128) {
        for item in items {
            let key = format!("{}:{}:{}", job.id, item.task_id, item.worker);
            self.settled.insert(&key, &true);
            let mut w = self.workers.get(&item.worker).unwrap();
            w.tasks_paid += 1;
            w.earned_total = U128(w.earned_total.0 + pay);
            w.earned_today = U128(w.earned_today.0 + pay);
            if item.gold {
                w.gold_ok += 1;
            }
            self.workers.insert(&item.worker, &w);
            self.credit(&item.worker, pay);
        }
        job.payroll_spent = U128(job.payroll_spent.0 + total);
        self.daily_payroll += total;
    }

    pub fn reject(&mut self, job_id: String, task_id: String, worker: AccountId, reason: String, gold: bool) {
        self.require_agent();
        self.require_active();
        assert!(self.jobs.get(&job_id).is_some(), "{}", ERR_UNKNOWN_JOB);
        let mut w = self.workers.get(&worker).unwrap_or_else(|| env::panic_str(ERR_NOT_HIRED));
        let key = format!("{}:{}:{}", job_id, task_id, worker);
        if self.settled.get(&key).unwrap_or(false) {
            env::panic_str(ERR_ALREADY_SETTLED);
        }
        self.settled.insert(&key, &true);
        w.tasks_rejected += 1;
        if gold {
            w.gold_ko += 1;
        }
        self.workers.insert(&worker, &w);
        self.log_entry(
            "reject",
            env::predecessor_account_id(),
            &job_id,
            0,
            &format!("{}:{}", task_id, worker),
            &reason,
        );
        self.emit(
            "reject",
            &format!(
                "{{\"job\":\"{}\",\"task\":\"{}\",\"worker\":\"{}\",\"reason\":\"{}\"}}",
                job_id, task_id, worker, reason
            ),
        );
    }

    pub fn fire(&mut self, worker: AccountId) {
        self.require_agent();
        self.require_active();
        let mut w = self.workers.get(&worker).unwrap_or_else(|| env::panic_str(ERR_NOT_HIRED));
        if w.status == WorkerStatus::Fired {
            env::panic_str(ERR_FIRE_NOT_JUSTIFIED);
        }
        if w.golds() < self.rules.min_golds_before_fire {
            env::panic_str(ERR_FIRE_NOT_JUSTIFIED);
        }
        if w.accuracy_pct() >= self.rules.fire_below_accuracy_pct {
            env::panic_str(ERR_FIRE_NOT_JUSTIFIED);
        }
        w.status = WorkerStatus::Fired;
        w.fired_ms = Some(self.now_ms());
        self.workers.insert(&worker, &w);
        let (pct, golds) = (w.accuracy_pct(), w.golds());
        self.log_entry(
            "fire",
            env::predecessor_account_id(),
            "",
            0,
            worker.as_str(),
            &format!("{}% on {} golds", pct, golds),
        );
        self.emit(
            "fire",
            &format!(
                "{{\"worker\":\"{}\",\"accuracy_pct\":{},\"golds\":{}}}",
                worker, pct, golds
            ),
        );
    }
}