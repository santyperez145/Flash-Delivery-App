import { postgresPool } from "./postgres.js";
import { decryptPaymentOAuthToken, encryptPaymentOAuthToken } from "./secret-envelope.js";
import { refreshMercadoPagoCredential } from "./payment-marketplace-provider.js";

export async function refreshDueMerchantPaymentConnections({ limit = 20 } = {}) {
  const claimed = (
    await postgresPool.query(
      `WITH due AS (
         SELECT id FROM merchant_payment_connections
         WHERE provider='mercadopago' AND revoked_at IS NULL
           AND refresh_token_ciphertext IS NOT NULL
           AND (token_expires_at IS NULL OR token_expires_at<now()+interval '30 days')
           AND refresh_failures<5
           AND (refresh_started_at IS NULL OR refresh_started_at<now()-interval '10 minutes')
         ORDER BY token_expires_at NULLS FIRST
         FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE merchant_payment_connections c
       SET refresh_started_at=now(), refresh_last_error=NULL
       FROM due WHERE c.id=due.id
       RETURNING c.*`,
      [limit],
    )
  ).rows;
  let refreshed = 0,
    failed = 0,
    attention = 0;
  for (const connection of claimed) {
    try {
      const credential = await refreshMercadoPagoCredential(
        decryptPaymentOAuthToken(connection.refresh_token_ciphertext),
      );
      if (credential.externalAccountId !== connection.external_account_id)
        throw new Error("oauth_seller_identity_mismatch");
      const expiresAt = credential.expiresIn
        ? new Date(Date.now() + credential.expiresIn * 1000)
        : null;
      await postgresPool.query(
        `UPDATE merchant_payment_connections SET
          access_token_ciphertext=$2, refresh_token_ciphertext=$3, token_expires_at=$4,
          scope=$5, live_mode=$6, refresh_started_at=NULL, refresh_last_at=now(),
          refresh_failures=0, refresh_last_error=NULL, updated_at=now()
         WHERE id=$1`,
        [
          connection.id,
          encryptPaymentOAuthToken(credential.accessToken),
          encryptPaymentOAuthToken(credential.refreshToken),
          expiresAt,
          credential.scope,
          credential.liveMode,
        ],
      );
      refreshed += 1;
    } catch (error) {
      const failures = Number(connection.refresh_failures) + 1;
      await postgresPool.query(
        "UPDATE merchant_payment_connections SET refresh_started_at=NULL,refresh_failures=$2,refresh_last_error=$3,updated_at=now() WHERE id=$1",
        [
          connection.id,
          failures,
          String(error.providerCode || error.message || "oauth_refresh_failed").slice(0, 160),
        ],
      );
      failed += 1;
      if (failures >= 5) attention += 1;
    }
  }
  return { claimed: claimed.length, refreshed, failed, attention };
}
