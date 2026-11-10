#[cfg(test)]
mod tests {
    use crate::errors::*;
    use crate::BatchItem;
    use crate::BossContract;
    use near_sdk::json_types::U128;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{env, testing_env, AccountId};

    fn accounts() -> (AccountId, AccountId, AccountId, AccountId, AccountId) {
        (
            "owner.near".parse().unwrap(),
            "agent.near".parse().unwrap(),
            "usdc.near".parse().unwrap(),
            "client.near".parse().unwrap(),
            "worker1.near".parse().unwrap(),
        )
    }

    fn new_contract() -> BossContract {
        let (owner, agent, token, _, _) = accounts();
        let mut builder = VMContextBuilder::new();
        builder.current_account_id(agent.clone());
        builder.predecessor_account_id(owner.clone());
        builder.block_timestamp(1_700_000_000_000_000_000); // ns
        testing_env!(builder.build());
        BossContract::new(owner, agent, token, None)
    }

    fn order_default_job(c: &mut BossContract) -> String {
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

        c.hire(w1.clone());
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
        c.hire(w1.clone());
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
        c.hire(w1.clone());
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
        c.hire(w1.clone());
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
        c.hire(w1.clone());
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
        c.hire(w1.clone());
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
        c.hire(w1.clone());
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
        c.hire(w1.clone());
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
        c.hire(w1);
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
        c.hire(w1.clone());

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
}