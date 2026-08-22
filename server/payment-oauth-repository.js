import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { config } from "./config.js";
import { encryptPaymentOAuthToken } from "./secret-envelope.js";
import { exchangeMercadoPagoCode, mercadoPagoAuthorizationUrl } from "./payment-marketplace-provider.js";

const stateHash=value=>crypto.createHash("sha256").update(String(value)).digest("hex");
const publicConnection=row=>row?{provider:row.provider,externalAccountId:row.external_account_id,liveMode:row.live_mode,scope:row.scope||null,connectedAt:new Date(row.connected_at).toISOString(),tokenExpiresAt:row.token_expires_at?new Date(row.token_expires_at).toISOString():null,status:row.revoked_at?"revoked":"connected"}:null;

export async function beginMerchantPaymentOAuth({merchantPublicId,userPublicId}){
  if(config.paymentMarketplace.provider!=="mercadopago")throw Object.assign(new Error("Proveedor marketplace no configurado"),{status:503});
  const state=crypto.randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+10*60*1000);
  const result=await postgresPool.query(`INSERT INTO merchant_payment_oauth_states(state_hash,merchant_id,user_id,expires_at) SELECT $1,m.id,u.id,$4 FROM merchants m JOIN users u ON u.id=m.owner_id WHERE m.public_id=$2 AND u.public_id=$3 AND u.status='active' RETURNING id`,[stateHash(state),merchantPublicId,userPublicId,expiresAt]);
  if(!result.rows[0])throw Object.assign(new Error("Comercio no autorizado"),{status:403});
  return{authorizationUrl:mercadoPagoAuthorizationUrl(state),expiresAt:expiresAt.toISOString()};
}

export async function completeMerchantPaymentOAuth({state,code}){
  const consumed=(await postgresPool.query(`UPDATE merchant_payment_oauth_states s SET consumed_at=now() WHERE s.state_hash=$1 AND s.consumed_at IS NULL AND s.expires_at>now() RETURNING s.merchant_id,s.user_id`,[stateHash(state)])).rows[0];
  if(!consumed)throw Object.assign(new Error("Estado OAuth inválido, vencido o ya utilizado"),{status:400});
  const credential=await exchangeMercadoPagoCode(code),expiresAt=credential.expiresIn?new Date(Date.now()+credential.expiresIn*1000):null;
  const row=(await postgresPool.query(`INSERT INTO merchant_payment_connections(merchant_id,provider,external_account_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,scope,live_mode,revoked_at) VALUES($1,'mercadopago',$2,$3,$4,$5,$6,$7,NULL) ON CONFLICT(merchant_id,provider) DO UPDATE SET external_account_id=excluded.external_account_id,access_token_ciphertext=excluded.access_token_ciphertext,refresh_token_ciphertext=excluded.refresh_token_ciphertext,token_expires_at=excluded.token_expires_at,scope=excluded.scope,live_mode=excluded.live_mode,revoked_at=NULL,connected_at=now(),updated_at=now() RETURNING *`,[consumed.merchant_id,credential.externalAccountId,encryptPaymentOAuthToken(credential.accessToken),credential.refreshToken?encryptPaymentOAuthToken(credential.refreshToken):null,expiresAt,credential.scope,credential.liveMode])).rows[0];
  await postgresPool.query(`INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,after_data) SELECT $1,ARRAY['merchant']::user_role[],'merchant.payment_provider_connected','merchant',m.public_id,$2 FROM merchants m WHERE m.id=$3`,[consumed.user_id,{provider:"mercadopago",externalAccountId:credential.externalAccountId,liveMode:credential.liveMode},consumed.merchant_id]);
  return publicConnection(row);
}

export async function getMerchantPaymentConnection({merchantPublicId,userPublicId}){const row=(await postgresPool.query(`SELECT c.* FROM merchant_payment_connections c JOIN merchants m ON m.id=c.merchant_id JOIN users u ON u.id=m.owner_id WHERE m.public_id=$1 AND u.public_id=$2`,[merchantPublicId,userPublicId])).rows[0];return publicConnection(row);}
