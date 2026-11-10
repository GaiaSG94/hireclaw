//! Tests d'intégration du contrat BossBot sur un vrai sandbox NEAR.
#[cfg(test)]
mod smoke {
    use near_workspaces::types::NearToken;

    #[tokio::test]
    async fn sandbox_starts() -> anyhow::Result<()> {
        let worker = near_workspaces::sandbox().await?;
        let alice = worker.dev_create_account().await?;
        let bal = alice.view_account().await?;
        assert!(bal.balance > NearToken::from_near(1));
        Ok(())
    }
}
