//! Tests du relais sans gas : `claim_unpaid` relayé et `withdraw_signed` depuis un compte implicite.
#[cfg(test)]
mod tests {
    use crate::errors::*;
    use crate::relay::{canonical_withdraw, WithdrawTicket};
    use crate::{BatchItem, HireclawContract};
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::json_types::U128;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId};

    const BASE_NS: u64 = 1_700_000_000_000_000_000;

    fn accounts() -> (AccountId, AccountId, AccountId, AccountId, AccountId) {
        ("owner.near".parse().unwrap(), "agent.near".parse().unwrap(),
         "usdc.near".parse().unwrap(), "client.near".parse().unwrap(),
         "worker1.near".parse().unwrap())
    }

    fn context_at(account: &AccountId, extra_ms: u64) {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(account.clone());
        builder.block_timestamp(BASE_NS + extra_ms * 1_000_000);
        testing_env!(builder.build());
    }

    fn new_contract() -> HireclawContract {
        let (owner, agent, token, _, _) = accounts();
        context_at(&owner, 0);
        HireclawContract::new(owner, agent, token, None)
    }

    fn order_default_job(c: &mut HireclawContract) -> String {
        let (_, _, token, client, _) = accounts();
        context_at(&token, 0);
        let msg = serde_json::to_string(&crate::order::OrderMsg {
            action: "order".into(), n_items: 12, deadline_ms: 1_700_003_600_000, spec_hash: "h".into(),
        }).unwrap();
        let _ = c.ft_on_transfer(client, U128(1_200_000), msg);
        "job-0001".to_string()
    }

    fn set_context(account: &AccountId) { context_at(account, 0); }

    fn agent_keypair() -> (SigningKey, String) {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        (sk.clone(), hex::encode(sk.verifying_key().to_bytes()))
    }

    fn make_ticket(agent: AccountId, worker: AccountId, job_id: &str, task_id: &str, amount: u128, issued_ms: u64) -> crate::claim::Ticket {
        crate::claim::Ticket {
            job_id: job_id.to_string(), task_id: task_id.to_string(), worker, amount: U128(amount),
            reason: "silence".to_string(), issued_ms, agent, signature: String::new(),
        }
    }

    fn sign_ticket(secret: &SigningKey, ticket: &crate::claim::Ticket) -> String {
        hex::encode(secret.sign(&crate::claim::canonical_payload(ticket)).to_bytes())
    }

    fn now_ms() -> u64 { near_sdk::env::block_timestamp_ms() }

    #[test]
    fn test_claim_unpaid_can_be_relayed_by_third_party() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, w1) = accounts();
        let (secret, pk) = agent_keypair();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(w1.clone());
        c.set_agent_key(pk);
        let mut ticket = make_ticket(agent.clone(), w1.clone(), &jid, "t-relayed", 20_000, now_ms());
        ticket.signature = sign_ticket(&secret, &ticket);
        // Un tiers quelconque (ici owner) paie le gas pour le travailleur sans NEAR
        let relayer: AccountId = "relayer.near".parse().unwrap();
        context_at(&relayer, 121_000);
        let paid = c.claim_unpaid(ticket);
        assert_eq!(paid.0, 20_000);
        assert_eq!(c.get_worker(w1).unwrap().earned_total.0, 20_000);
        assert_eq!(c.get_solvency().balanced, true);
    }

    #[test]
    fn test_withdraw_signed_relayed_from_implicit_account() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, _) = accounts();
        let worker_sk = SigningKey::from_bytes(&[9u8; 32]);
        let worker_pk_hex = hex::encode(worker_sk.verifying_key().to_bytes());
        let worker_acc: AccountId = worker_pk_hex.parse().unwrap();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(worker_acc.clone());
        c.pay_batch(jid, vec![BatchItem { task_id: "tw".into(), worker: worker_acc.clone(), gold: false }], None);

        let mut ticket = crate::relay::WithdrawTicket {
            worker: worker_acc.clone(),
            amount: U128(20_000),
            nonce: 1,
            deadline_ms: now_ms() + 60_000,
            signature: String::new(),
        };
        let bytes = crate::relay::canonical_withdraw(&ticket);
        ticket.signature = hex::encode(worker_sk.sign(&bytes).to_bytes());

        let relayer: AccountId = "relayer.near".parse().unwrap();
        set_context(&relayer);
        let _ = c.withdraw_signed(ticket);
        assert_eq!(c.get_solvency().withdrawable_total.0, 0);
        assert_eq!(c.get_solvency().pending_out_total.0, 20_000);
        assert_eq!(c.get_solvency().balanced, true);
    }

    #[test]
    #[should_panic(expected = "ERR_ALREADY_SETTLED")]
    fn test_withdraw_signed_replay_refused() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, _) = accounts();
        let worker_sk = SigningKey::from_bytes(&[9u8; 32]);
        let worker_acc: AccountId = hex::encode(worker_sk.verifying_key().to_bytes()).parse().unwrap();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(worker_acc.clone());
        c.pay_batch(jid.clone(), vec![
            BatchItem { task_id: "tw1".into(), worker: worker_acc.clone(), gold: false },
            BatchItem { task_id: "tw2".into(), worker: worker_acc.clone(), gold: false },
        ], None);
        let mut ticket = crate::relay::WithdrawTicket {
            worker: worker_acc,
            amount: U128(20_000),
            nonce: 42,
            deadline_ms: now_ms() + 60_000,
            signature: String::new(),
        };
        ticket.signature = hex::encode(worker_sk.sign(&crate::relay::canonical_withdraw(&ticket)).to_bytes());
        let _ = c.withdraw_signed(ticket.clone());
        let _ = c.withdraw_signed(ticket);
    }

    #[test]
    #[should_panic(expected = "ERR_BAD_SIGNATURE")]
    fn test_withdraw_signed_forged_refused() {
        let mut c = new_contract();
        let jid = order_default_job(&mut c);
        let (_, agent, _, _, _) = accounts();
        let real_sk = SigningKey::from_bytes(&[9u8; 32]);
        let rogue_sk = SigningKey::from_bytes(&[10u8; 32]);
        let worker_acc: AccountId = hex::encode(real_sk.verifying_key().to_bytes()).parse().unwrap();
        set_context(&agent);
        c.accept_job(jid.clone(), U128(20_000), "dummy".into());
        let _ = c.hire(worker_acc.clone());
        c.pay_batch(jid, vec![BatchItem { task_id: "tw".into(), worker: worker_acc.clone(), gold: false }], None);
        let mut ticket = crate::relay::WithdrawTicket {
            worker: worker_acc,
            amount: U128(20_000),
            nonce: 1,
            deadline_ms: now_ms() + 60_000,
            signature: String::new(),
        };
        ticket.signature = hex::encode(rogue_sk.sign(&crate::relay::canonical_withdraw(&ticket)).to_bytes());
        let _ = c.withdraw_signed(ticket);
    }
}
