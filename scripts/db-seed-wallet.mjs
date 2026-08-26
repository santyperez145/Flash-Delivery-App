import { readDb } from "../server/store.js";
import { creditWallet } from "../server/wallet-repository.js";
import { closePostgres } from "../server/postgres.js";
try {
  for (const user of readDb().users) {
    if (Number(user.wallet) > 0)
      await creditWallet({
        publicUserId: user.id,
        amount: Number(user.wallet),
        idempotencyKey: `seed-wallet-${user.id}`,
        kind: "adjustment",
        description: "Saldo inicial migrado",
        metadata: { source: "sqlite_migration" },
      });
  }
  console.log("wallet balances seeded into double-entry ledger");
} finally {
  await closePostgres();
}
