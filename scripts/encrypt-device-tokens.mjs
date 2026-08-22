import { postgresPool, closePostgres } from "../server/postgres.js";
import { encryptDeviceToken, hashDeviceToken } from "../server/secret-envelope.js";

if(!postgresPool)throw new Error("DATABASE_URL is required");
const client=await postgresPool.connect();
try{
  await client.query("BEGIN");
  const legacy=await client.query("SELECT id,push_token FROM user_devices WHERE push_token IS NOT NULL FOR UPDATE");
  for(const row of legacy.rows)await client.query("UPDATE user_devices SET push_token_ciphertext=$2,push_token_hash=$3,push_token=NULL WHERE id=$1",[row.id,encryptDeviceToken(row.push_token),hashDeviceToken(row.push_token)]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ok:true,migrated:legacy.rowCount,plaintextRemaining:0}));
}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();await closePostgres();}
