//! Contrat jetable : son seul but est de libérer le stockage du code précédent
//! quand on redéploie BossBot sur le même compte testnet (le code embarqué coûte
//! ~0,25 NEAR par tranche de 100 Ko). Une fois déployé, on le remplace
//! immédiatement par le vrai contrat, qui réinitialise l'état.
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{near_bindgen, AccountId, PanicOnDefault};

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Stub {
    pub owner: AccountId,
}

impl near_sdk::state::ContractState for Stub {}

#[near_bindgen]
impl Stub {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner }
    }

    pub fn ping(&self) -> bool {
        true
    }
}
