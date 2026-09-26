// Cuentas ledger de wallet (ARC-001).
//
// `cash_clearing` de plataforma y `wallet` de usuario: el contrato dual que
// comparten cobro, crédito, liquidación de movilidad y reintegros.
export async function clearingAccount(client) {
  return (
    await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
  VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT (owner_type,currency,account_type) WHERE owner_id IS NULL DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`)
  ).rows[0].id;
}

export async function userAccount(client, userId) {
  return (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
  VALUES('user',$1,'ARS','wallet') ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`,
      [userId],
    )
  ).rows[0].id;
}
