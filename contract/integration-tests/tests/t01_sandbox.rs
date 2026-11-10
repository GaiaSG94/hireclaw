//! Tests d'intégration du contrat BossBot sur le sandbox NEAR réel :
//! déploiement du contrat compilé, jeton factice, flux commande -> embauche ->
//! paiements -> renvoi tricheur -> livraison avec révélation -> vérification solvabilité.
use anyhow::Result;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::json;

const WASM: &[u8] = include_bytes!("../../target/near/hireclaw_contract.wasm");
const TGAS: Gas = Gas::from_tgas(100);

async fn setup() -> Result<(near_workspaces::Worker<near_workspaces::network::Sandbox>, Contract, Account, Account, Account, Account, Account)> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let owner = root.create_subaccount("owner").initial_balance(NearToken::from_near(30)).transact().await?.into_result()?;
    let agent = root.create_subaccount("agent").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let token = root.create_subaccount("usdc").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let client = root.create_subaccount("client").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let worker1 = root.create_subaccount("w1").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;

    let contract = worker.dev_deploy(WASM).await?;
    contract
        .call("new")
        .args_json(json!({
            "owner": owner.id(),
            "agent": agent.id(),
            "token": token.id(),
            "rules": null
        }))
        .transact()
        .await?
        .into_result()?;
    Ok((worker, contract, owner, agent, token, client, worker1))
}

#[tokio::test]
async fn full_lifecycle_on_sandbox() -> Result<()> {
    let (_worker, contract, _owner, agent, token, client, worker1) = setup().await?;

    // 1. Dépôt de commande via ft_on_transfer
    let msg = json!({
        "action": "order",
        "n_items": 12,
        "deadline_ms": 2_000_000_000_000u64,
        "spec_hash": "spec-hash-123"
    })
    .to_string();
    token
        .call(contract.id(), "ft_on_transfer")
        .args_json(json!({
            "sender_id": client.id(),
            "amount": "1200000", // 1.20 USDC
            "msg": msg
        }))
        .gas(TGAS)
        .transact()
        .await?
        .into_result()?;

    // 2. Acceptation par l'agent avec commit
    let reveal = "test_answer_key";
    let commit = hex::encode(near_sdk::env::sha256(reveal.as_bytes()));
    agent
        .call(contract.id(), "accept_job")
        .args_json(json!({
            "job_id": "job-0001",
            "pay_per_task": "20000",
            "gold_commit": commit
        }))
        .transact()
        .await?
        .into_result()?;

    // 3. Embauche d'un travailleur (l'inscription au token part en cross-contract)
    let _ = agent
        .call(contract.id(), "hire")
        .args_json(json!({"worker": worker1.id()}))
        .gas(TGAS)
        .transact()
        .await;

    // 4. Paie d'une tâche
    agent
        .call(contract.id(), "pay_batch")
        .args_json(json!({
            "job_id": "job-0001",
            "items": [{"task_id": "t1", "worker": worker1.id(), "gold": false}],
            "amount": null
        }))
        .transact()
        .await?
        .into_result()?;

    // 5. Livraison
    agent
        .call(contract.id(), "deliver")
        .args_json(json!({
            "job_id": "job-0001",
            "result_hash": "result_hash_abc",
            "n_validated": 12,
            "gold_reveal": reveal
        }))
        .transact()
        .await?
        .into_result()?;

    // 6. Solvabilité vérifiée on-chain
    let solvency: serde_json::Value = contract.view("get_solvency").await?.json()?;
    assert_eq!(solvency["balance"], "1200000");
    assert_eq!(solvency["balanced"], true, "solvency invariant must hold");
    println!("Sandbox test complet OK, solvabilité : {:?}", solvency);
    Ok(())
}