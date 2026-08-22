import { createPool } from "./db-client.mjs";

const pool=createPool();
const assert=(condition,label,detail="")=>{if(!condition)throw new Error(`${label}: ${detail}`);console.log(`ok - ${label}`);};
try{
  const forbiddenColumns=await pool.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND lower(column_name)=ANY($1)`,[["pan","cvv","cvc","card_number","security_code","otp","refresh_token"]]);
  assert(forbiddenColumns.rowCount===0,"schema has no raw PAN, CVV, OTP or refresh-token columns",JSON.stringify(forbiddenColumns.rows));
  const devices=(await pool.query("SELECT count(*) FILTER(WHERE push_token IS NOT NULL)::int plaintext,count(*) FILTER(WHERE push_token_ciphertext IS NOT NULL AND push_token_hash IS NOT NULL)::int protected FROM user_devices")).rows[0];
  assert(devices.plaintext===0,"device push tokens are not stored as plaintext",JSON.stringify(devices));
  const weakSecrets=(await pool.query(`SELECT
    count(*) FILTER(WHERE password_hash NOT LIKE '$2%')::int weak_passwords,
    (SELECT count(*)::int FROM refresh_sessions WHERE token_hash !~ '^[0-9a-f]{64}$') weak_sessions,
    (SELECT count(*)::int FROM jobs WHERE metadata->>'subtype'='shipment' AND metadata ? 'deliveryPin') plaintext_job_pins,
    (SELECT count(*)::int FROM shipment_details WHERE delivery_pin_hash NOT LIKE '$2%') weak_pin_hashes
    FROM users`)).rows[0];
  assert(Object.values(weakSecrets).every(value=>Number(value)===0),"passwords, sessions and delivery PINs use one-way hashes",JSON.stringify(weakSecrets));
  const unsafeJson=(await pool.query(`SELECT
    (SELECT count(*)::int FROM audit_events WHERE after_data::text ~* '"(password|cvv|cvc|cardNumber|pan|otp|pushToken|refreshToken|deliveryPin)"') audit,
    (SELECT count(*)::int FROM notifications WHERE payload::text ~* '"(password|cvv|cvc|cardNumber|pan|otp|pushToken|refreshToken|deliveryPin)"') notifications,
    (SELECT count(*)::int FROM payment_intents WHERE provider_payload::text ~* '"(password|cvv|cvc|cardNumber|pan|otp|pushToken|refreshToken|deliveryPin)"') payments,
    (SELECT count(*)::int FROM idempotency_keys WHERE response_body::text ~* '"(password|cvv|cvc|cardNumber|pan|otp|pushToken|refreshToken|deliveryPin)"') idempotency,
    (SELECT count(*)::int FROM service_receipts WHERE (line_items||payment_summary||metadata)::text ~* '"(password|cvv|cvc|cardNumber|pan|otp|pushToken|refreshToken|deliveryPin)"') receipts`)).rows[0];
  assert(Object.values(unsafeJson).every(value=>Number(value)===0),"audit, notification, payment, idempotency and receipt JSON contain no sensitive credential keys",JSON.stringify(unsafeJson));
  const preciseLocationAudit=Number((await pool.query(`SELECT count(*)::int count FROM audit_events WHERE action='driver.location_updated' AND (COALESCE(before_data,'{}')?|ARRAY['lat','lng'] OR COALESCE(after_data,'{}')?|ARRAY['lat','lng'])`)).rows[0].count);
  assert(preciseLocationAudit===0,"append-only audit contains no historical precise driver coordinates");
}finally{await pool.end();}
