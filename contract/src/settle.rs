use near_sdk::json_types::U128;
use near_sdk::{env, near_bindgen, AccountId, Promise};

use crate::errors::*;

use crate::BossContract;
use crate::BossContractExt;

#[near_bindgen]
impl BossContract {
    pub fn deliver(&mut self, job_id: String, result_hash: String, n_validated: u32, gold_reveal: String) {
        self.require_agent();
        let mut job = self.jobs.get(&job_id).unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_JOB));
        if job.state != JobState::Accepted || n_validated < job.n_items {
            env::panic_str(ERR_NOT_DELIVERABLE);
        }
        let commit_hash = env::sha256(gold_reveal.as_bytes());
        let hex_commit = hex::encode(commit_hash);
        if hex_commit != job.gold_commit {
            env::panic_str(ERR_GOLD_MISMATCH);
        }
        let unspent_payroll = job.payroll_budget.0.saturating_sub(job.payroll_spent.0);
        let margin_total = job.margin_reserved.0 + unspent_payroll;
        let (owner_amt, res_amt, contrib_amt) = self.split_margin(margin_total);
        self.buckets.add(owner_amt, res_amt, contrib_amt);
        job.margin_reserved = U128(0);
        job.payroll_budget = job.payroll_spent;
        job.state = JobState::Delivered;
        job.gold_reveal = Some(gold_reveal);
        job.result_hash = result_hash.clone();
        job.n_validated = n_validated;
        job.delivered_ms = Some(self.now_ms());
        self.jobs.insert(&job_id, &job);
        self.log_entry(
            "sale",
            env::predecessor_account_id(),
            &job_id,
            job.budget.0,
            &format!("hash {}", &result_hash[..result_hash.len().min(16)]),
            "",
        );
        self.log_entry(
            "margin",
            env::predecessor_account_id(),
            &job_id,
            margin_total,
            &format!("owner {} res {} contrib {}", owner_amt, res_amt, contrib_amt),
            "",
        );
        self.emit(
            "deliver",
            &format!(
                "{{\"job\":\"{}\",\"margin\":\"{}\",\"owner\":\"{}\",\"reserve\":\"{}\",\"contributors\":\"{}\"}}",
                job_id, margin_total, owner_amt, res_amt, contrib_amt
            ),
        );
    }

    fn split_margin(&self, total: u128) -> (u128, u128, u128) {
        let (p_o, p_r, _) = self.rules.revenue_split;
        let owner = (total * p_o as u128) / 100;
        let reserve = (total * p_r as u128) / 100;
        let contrib = total.saturating_sub(owner + reserve);
        (owner, reserve, contrib)
    }

    pub fn refund(&mut self, job_id: String) -> Promise {
        let mut job = self.jobs.get(&job_id).unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_JOB));
        if env::predecessor_account_id() != job.client {
            env::panic_str(ERR_NOT_AGENT);
        }
        if job.state == JobState::Delivered {
            env::panic_str(ERR_ALREADY_DELIVERED);
        }
        if job.state != JobState::Ordered && job.state != JobState::Accepted {
            env::panic_str(ERR_ALREADY_DELIVERED);
        }
        if self.now_ms() < job.deadline_ms {
            env::panic_str(ERR_NOT_DUE);
        }
        let unspent = job.budget.0.saturating_sub(job.payroll_spent.0);
        job.margin_reserved = U128(0);
        job.payroll_budget = job.payroll_spent;
        job.state = JobState::Refunded;
        self.jobs.insert(&job_id, &job);
        let client = job.client.clone();
        self.log_entry("refund", client.clone(), &job_id, unspent, "refund unspent", "");
        self.pay_out(client, unspent)
    }

    pub fn record_cost(&mut self, provider: AccountId, amount: U128, job_id: Option<String>) {
        self.require_agent();
        self.roll_day();
        if amount.0 == 0 {
            env::panic_str(ERR_BAD_ORDER);
        }
        if self.daily_inference + amount.0 > self.rules.inference_max_spend_per_day.0 {
            env::panic_str(ERR_INFERENCE_CAP);
        }
        if let Some(ref jid) = job_id {
            let mut job = self.jobs.get(jid).unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_JOB));
            if job.margin_reserved.0 < amount.0 {
                env::panic_str(ERR_INFERENCE_CAP);
            }
            job.margin_reserved = U128(job.margin_reserved.0 - amount.0);
            job.inference_spent = U128(job.inference_spent.0 + amount.0);
            self.jobs.insert(jid, &job);
        }
        self.daily_inference += amount.0;
        self.credit(&provider, amount.0);
        self.log_entry("cost", env::predecessor_account_id(), job_id.as_deref().unwrap_or(""), amount.0, provider.as_str(), "");
    }
}