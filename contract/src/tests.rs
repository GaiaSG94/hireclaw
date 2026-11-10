#[cfg(test)]
mod tests {
    use crate::errors::*;
    use crate::BatchItem;
    use crate::HireclawContract;
    use near_sdk::json_types::U128;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{env, testing_env, AccountId};


// ------------------------------------------------------------------ bons signés
use ed25519_dalek::{Signer, SigningKey};

fn agent_keypair() -> (SigningKey, String) {
    let secret = SigningKey::from_bytes(&[7u8; 32]);
    let public = hex::encode(secret.verifying_key().to_bytes());
    (secret, public)
}

fn sign_ticket(secret: &SigningKey, ticket: &crate::claim::Ticket) -> String {
    let payload = crate::claim::canonical_payload(ticket);
    hex::encode(secret.sign(&payload).to_bytes())
}

fn make_ticket(agent: AccountId, worker: AccountId, job_id: &str, task_id: &str, amount: u128, issued_ms: u64) -> crate::claim::Ticket {
    crate::claim::Ticket {
        job_id: job_id.to_string(),
        task_id: task_id.to_string(),
        worker,
        amount: U128(amount),
        reason: "le silence vaut paiement".to_string(),
        issued_ms,
        agent,
        signature: String::new(),
    }
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

    fn accounts() -> (AccountId, AccountId, AccountId, AccountId, AccountId) {
        (
            "owner.near".parse().unwrap(),
            "agent.near".parse().unwrap(),
            "usdc.near".parse().unwrap(),
            "client.near".parse().unwrap(),
            "worker1.near".parse().unwrap(),
        )
    }

    const BASE_NS: u64 = 1_700_000_000_000_000_000;

    fn set_context(account: &AccountId) {
        context_at(account, 0);
    }

    /// Change l'appelant et l'horloge (en ms depuis la base) sans perdre l'autre.
    fn context_at(account: &AccountId, extra_ms: u64) {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(account.clone());
        builder.block_timestamp(BASE_NS + extra_ms * 1_000_000);
        testing_env!(builder.build());
    }

    fn new_contract() -> HireclawContract {
        let (owner, agent, token, _, _) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.current_account_id(agent.clone());
        builder.predecessor_account_id(owner.clone());
        builder.block_timestamp(1_700_000_000_000_000_000); // ns
        testing_env!(builder.build());
        HireclawContract::new(owner, agent, token, None)
    }

    fn order_default_job(c: &mut HireclawContract) -> String {
        let (_, _, token, client, _) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(token);
        builder.block_timestamp(1_700_000_000_000_000_000);
        testing_env!(builder.build());
        let msg = serde_json::to_string(&crate::order::OrderMsg {
            action: "order".into(),
            n_items: 12,
            deadline_ms: 1_700_003_600_000,
            spec_hash: "hash".into(),
        })
        .unwrap();
        let _ = c.ft_on_transfer(client, U128(1_200_000), msg);
        "job-0001".to_string()
    }

    #[test]
    fn test_order_and_accept_and_hire() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);

        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent.clone());
        builder.block_timestamp(1_700_000_000_000_000_000);
        testing_env!(builder.build());

        c.accept_job(jid.clone(), U128(20_000), "dummy_commit".into());
        let job = c.get_job(jid).unwrap();
        assert_eq!(job.margin_reserved.0, 180_000); // 15% of 1.2M
        assert_eq!(job.payroll_budget.0, 1_020_000);

        let _ = c.hire(w1.clone());
        let w = c.get_worker(w1).unwrap();
        assert_eq!(w.status, WorkerStatus::Trial);
    }

    #[test]
    #[should_panic(expected = "ERR_PAY_ABOVE_MAX")]
    fn test_attack_pay_above_max() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        c.pay_batch(
            jid,
            vec![BatchItem {
                task_id: "t1".into(),
                worker: w1,
                gold: false,
            }],
            Some(U128(1_000_000)), // 1 USDC > 0.10 max
        );
    }

    #[test]
    #[should_panic(expected = "ERR_ALREADY_SETTLED")]
    fn test_attack_double_payment() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        let item = BatchItem {
            task_id: "t1".into(),
            worker: w1.clone(),
            gold: false,
        };
        c.pay_batch(jid.clone(), vec![item], None);
        // 2nd pay of same task
        c.pay_batch(
            jid,
            vec![BatchItem {
                task_id: "t1".into(),
                worker: w1,
                gold: false,
            }],
            None,
        );
    }

    #[test]
    #[should_panic(expected = "ERR_FIRE_NOT_JUSTIFIED")]
    fn test_fire_not_justified() {
        let mut c = new_contract();
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        let _ = c.hire(w1.clone());
        c.fire(w1); // 0 golds -> cannot fire
    }

    #[test]
    fn test_fire_justified_after_5_bad_golds() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        for i in 0..5 {
            c.reject(jid.clone(), format!("gold-{}", i), w1.clone(), "gold_wrong".into(), true);
        }
        let w = c.get_worker(w1.clone()).unwrap();
        assert_eq!(w.golds(), 5);
        assert_eq!(w.accuracy_pct(), 0);
        c.fire(w1.clone());
        let fired = c.get_worker(w1).unwrap();
        assert_eq!(fired.status, WorkerStatus::Fired);
    }

    #[test]
    #[should_panic(expected = "ERR_PAY_BELOW_MIN")]
    fn test_attack_pay_below_min() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        c.pay_batch(
            jid,
            vec![BatchItem {
                task_id: "t1".into(),
                worker: w1,
                gold: false,
            }],
            Some(U128(1_000)), // 0.001 < 0.02 min
        );
    }

    #[test]
    #[should_panic(expected = "ERR_WORKER_FIRED")]
    fn test_attack_pay_fired_worker() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        for i in 0..5 {
            c.reject(jid.clone(), format!("gold-{}", i), w1.clone(), "gold_wrong".into(), true);
        }
        c.fire(w1.clone());
        c.pay_batch(
            jid,
            vec![BatchItem {
                task_id: "tx".into(),
                worker: w1,
                gold: false,
            }],
            None,
        );
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_HIRED")]
    fn test_attack_pay_unhired() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, _) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let unhired: AccountId = "stranger.near".parse().unwrap();
        c.pay_batch(
            jid,
            vec![BatchItem {
                task_id: "t1".into(),
                worker: unhired,
                gold: false,
            }],
            None,
        );
    }

    #[test]
    #[should_panic(expected = "ERR_PAYROLL_BUDGET")]
    fn test_attack_exceed_payroll_budget() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c); // 1.2M total, 1.02M payroll
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        c.accept_job(jid.clone(), U128(100_000), "dummy".into()); // 100k per task
        let _ = c.hire(w1.clone());
        // 11 tasks * 100k = 1.1M > 1.02M budget
        let items: Vec<BatchItem> = (0..10)
            .map(|i| BatchItem {
                task_id: format!("t{}", i),
                worker: w1.clone(),
                gold: false,
            })
            .collect();
        c.pay_batch(jid.clone(), items, None); // 1.0M spent, remaining 20k
        c.pay_batch(
            jid,
            vec![BatchItem {
                task_id: "t11".into(),
                worker: w1,
                gold: false,
            }],
            None, // 100k > 20k remaining
        );
    }

    #[test]
    #[should_panic(expected = "ERR_PAUSED")]
    fn test_pause_and_attack() {
        let mut c = new_contract();
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        c.pause(Some("kill switch test".into()));

        // trying to hire while paused
        let _ = c.hire(w1);
    }

    #[test]
    fn test_deliver_and_solvency() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(agent);
        testing_env!(builder.build());
        let reveal = "test_gold_answers";
        let commit_hash = hex::encode(env::sha256(reveal.as_bytes()));
        c.accept_job(jid.clone(), U128(20_000), commit_hash);
        let _ = c.hire(w1.clone());

        c.pay_batch(
            jid.clone(),
            vec![BatchItem {
                task_id: "t1".into(),
                worker: w1,
                gold: false,
            }],
            None,
        );

        c.deliver(jid, "res_hash".into(), 12, reveal.into());
        let solv = c.get_solvency();
        assert_eq!(solv.balance.0, 1_200_000);
        assert_eq!(solv.balance.0, solv.sum.0, "solvency invariant must hold");
    }

    #[test]
    fn test_claim_unpaid_pays_after_the_delay() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let (secret, pk) = agent_keypair();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        c.set_agent_key(pk);

        let issued = now_ms();
        let mut ticket = make_ticket(agent.clone(), w1.clone(), &jid, "t-silence", 20_000, issued);
        ticket.signature = sign_ticket(&secret, &ticket);

        // On avance de 121 s puis le travailleur réclame
        context_at(&w1, 121_000);
        let paid = c.claim_unpaid(ticket.clone());
        assert_eq!(paid.0, 20_000);
        assert_eq!(c.get_worker(w1).unwrap().tasks_paid, 1);
        assert_eq!(c.get_solvency().balanced, true);
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_DUE")]
    fn test_claim_unpaid_too_early() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let (secret, pk) = agent_keypair();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        c.set_agent_key(pk);
        let mut ticket = make_ticket(agent.clone(), w1.clone(), &jid, "t-early", 20_000, now_ms());
        ticket.signature = sign_ticket(&secret, &ticket);
        set_context(&w1);
        c.claim_unpaid(ticket);
    }

    #[test]
    #[should_panic(expected = "ERR_BAD_SIGNATURE")]
    fn test_claim_unpaid_bad_signature() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let rogue = SigningKey::from_bytes(&[8u8; 32]);
        let (_real, real_pk) = agent_keypair();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        c.set_agent_key(real_pk);
        let mut ticket = make_ticket(agent.clone(), w1.clone(), &jid, "t-forged", 20_000, now_ms() - 200_000);
        ticket.signature = sign_ticket(&rogue, &ticket);
        context_at(&w1, 0);
        c.claim_unpaid(ticket);
    }

    #[test]
    #[should_panic(expected = "ERR_ALREADY_SETTLED")]
    fn test_claim_unpaid_twice() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let (secret, pk) = agent_keypair();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        c.set_agent_key(pk);
        let mut ticket = make_ticket(agent.clone(), w1.clone(), &jid, "t-twice", 20_000, now_ms());
        ticket.signature = sign_ticket(&secret, &ticket);
        context_at(&w1, 121_000);
        c.claim_unpaid(ticket.clone());
        c.claim_unpaid(ticket);
    }

    #[test]
    #[should_panic(expected = "ERR_PAY_ABOVE_MAX")]
    fn test_claim_unpaid_amount_out_of_bounds() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let (secret, pk) = agent_keypair();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        c.set_agent_key(pk);
        let mut ticket = make_ticket(agent.clone(), w1.clone(), &jid, "t-greedy", 1_000_000, now_ms());
        ticket.signature = sign_ticket(&secret, &ticket);
        context_at(&w1, 121_000);
        c.claim_unpaid(ticket);
    }
}
