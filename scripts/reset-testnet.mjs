// Remise à zéro complète du compte contrat sur testnet.
//
// Pourquoi ce script existe : redéployer un contrat NEAR ne vide PAS son stockage.
// `#[init(ignore_state)]` réécrit la racine de l'état, mais les collections
// (LookupMap / Vector) vivent sous leurs propres clés et survivent. On se retrouve
// avec un état hybride. La seule remise à zéro propre est : supprimer les
// sous-comptes, supprimer le compte (le NEAR revient au parent), le recréer,
// puis redéployer.
//
// Les USDC détenus par le compte auprès du jeton survivent (le jeton indexe par
// identifiant de compte) : après recréation, `sweep_excess` les reconnaît comme
// séquestre hérité et `sweep_to_owner` les rend au propriétaire.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nearApi from "near-api-js";

const { Account, KeyPair, transactions: actions } = nearApi;
const { JsonRpcProvider } = nearApi.providers;
const { PublicKey } = nearApi.utils;

const RPC = process.env.NEAR_NODE_URL ?? "https://rpc.testnet.fastnear.com";
const CREDS = path.join(os.homedir(), ".near-credentials", "testnet");
const CONTRACT = process.env.HIRECLAW_CONTRACT ?? "hireclaw.defraie.testnet";
const PARENT = process.env.HIRECLAW_PARENT ?? CONTRACT.split(".").slice(1).join(".");
const SUBACCOUNTS = ["alice", "bob", "chloe", "agent", "client"];
const NEAR = 10n ** 24n;

const provider = new JsonRpcProvider({ url: RPC });

function secretOf(accountId) {
  const raw = JSON.parse(fs.readFileSync(path.join(CREDS, `${accountId}.json`), "utf8"));
  return raw.private_key ?? raw.secret_key;
}

async function signer(accountId) {
  const ks = new nearApi.keyStores.InMemoryKeyStore();
  await ks.setKey("testnet", accountId, KeyPair.fromString(secretOf(accountId)));
  const conn = nearApi.Connection.fromConfig({
    networkId: "testnet",
    provider: new JsonRpcProvider({ url: RPC }),
    signer: new nearApi.InMemorySigner(ks),
  });
  return new Account(conn, accountId);
}

async function balanceOf(accountId) {
  const acc = await provider.query({ request_type: "view_account", finality: "final", account_id: accountId }).catch(() => null);
  return acc ? Number(acc.amount) / 1e24 : null;
}

async function send(from, to, action, label) {
  try {
    const out = await (await signer(from)).signAndSendTransaction({ receiverId: to, actions: [action], waitUntil: "FINAL" });
    if (out.status?.Failure) {
      console.log(`  ${label} : ÉCHEC ${JSON.stringify(out.status.Failure).slice(0, 110)}`);
      return false;
    }
    console.log(`  ${label} : ok (${out.transaction_outcome?.id})`);
    return true;
  } catch (err) {
    console.log(`  ${label} : ERREUR ${String(err.message ?? err).slice(0, 110)}`);
    return false;
  }
}

async function main() {
  console.log(`=== Remise à zéro de ${CONTRACT} (parent ${PARENT}) ===`);
  console.log("solde avant :", (await balanceOf(CONTRACT))?.toFixed(2), "NEAR");

  console.log("\n1. suppression des sous-comptes (le NEAR revient au contrat)");
  for (const name of SUBACCOUNTS) {
    const id = `${name}.${CONTRACT}`;
    if ((await balanceOf(id)) === null) continue;
    await send(id, id, actions.deleteAccount(CONTRACT), `delete ${name}`);
  }

  console.log("\n2. suppression du compte contrat (le NEAR revient au parent)");
  const deleted = await send(CONTRACT, CONTRACT, actions.deleteAccount(PARENT), "delete contrat");
  if (!deleted) {
    console.log("  → suppression impossible : arrêt (le contrat garde son état hybride)");
    process.exit(1);
  }

  console.log("\n3. recréation du compte, vierge");
  const keyPair = KeyPair.fromRandom("ed25519");
  const funded = await balanceOf(PARENT);
  const wanted = Number(process.env.HIRECLAW_NEW_NEAR ?? 2.9);
  const amount = Math.min(wanted, Math.max(0.5, (funded ?? 0) - 0.4));
  const created = await (await signer(PARENT)).signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [
      actions.createAccount(),
      actions.transfer(BigInt(Math.round(amount * 1000)) * (NEAR / 1000n)),
      actions.addKey(PublicKey.from(keyPair.getPublicKey().toString()), actions.fullAccessKey()),
    ],
    waitUntil: "FINAL",
  });
  if (created.status?.Failure) {
    console.log("  recréation ÉCHOUÉE :", JSON.stringify(created.status.Failure).slice(0, 200));
    process.exit(1);
  }
  fs.writeFileSync(
    path.join(CREDS, `${CONTRACT}.json`),
    JSON.stringify({ account_id: CONTRACT, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }, null, 2),
    { mode: 0o600 },
  );
  console.log(`  recréé avec ${amount.toFixed(2)} NEAR (clé régénérée, ${CREDS})`);
  console.log("\nSuite : FORCE_REDEPLOY=1 node scripts/deploy-testnet.mjs");
}

main().catch((err) => {
  console.error("ERREUR :", err.message ?? err);
  process.exit(1);
});