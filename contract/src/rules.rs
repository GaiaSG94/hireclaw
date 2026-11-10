use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(schemars::JsonSchema))]
#[cfg_attr(not(target_arch = "wasm32"), schemars(crate = "schemars"))]
#[serde(crate = "near_sdk::serde")]
pub struct RulesConfig {
    pub task_pay_min: U128,
    pub task_pay_max: U128,
    pub payroll_cap_per_day: U128,
    pub worker_cap_per_day: U128,
    pub min_margin_pct: u8,
    pub redundancy: u8,
    pub gold_share_pct: u8,
    pub min_golds_before_fire: u32,
    pub fire_below_accuracy_pct: u8,
    pub pay_or_reject_seconds: u32,
    pub inference_max_spend_per_day: U128,
    pub revenue_split: (u8, u8, u8),
    pub kill_switch: bool,
}

impl Default for RulesConfig {
    fn default() -> Self {
        Self {
            task_pay_min: U128(20_000),             // 0.02 USDC (6 dec)
            task_pay_max: U128(100_000),            // 0.10 USDC
            payroll_cap_per_day: U128(20_000_000),  // 20 USDC
            worker_cap_per_day: U128(2_000_000),    // 2 USDC
            min_margin_pct: 15,
            redundancy: 3,
            gold_share_pct: 20,
            min_golds_before_fire: 5,
            fire_below_accuracy_pct: 60,
            pay_or_reject_seconds: 120,
            inference_max_spend_per_day: U128(500_000), // 0.50 USDC
            revenue_split: (60, 30, 10),
            kill_switch: false,
        }
    }
}

impl RulesConfig {
    pub fn validate(&self) {
        assert!(self.task_pay_min.0 > 0, "min > 0");
        assert!(self.task_pay_min.0 <= self.task_pay_max.0, "min <= max");
        assert!(self.min_margin_pct < 100, "margin < 100");
        assert!(self.redundancy >= 3, "redundancy >= 3");
        let (a, b, c) = self.revenue_split;
        assert_eq!(a as u32 + b as u32 + c as u32, 100, "split sum 100");
        assert!(self.min_golds_before_fire >= 1, "min golds >= 1");
    }
}