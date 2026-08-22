import crypto from "node:crypto";
import {postgresPool} from "./postgres.js";

export const createMapCacheKey=value=>crypto.createHash("sha256").update(value).digest("hex");

export async function getCachedMapResponse({kind,key}){
  if(!postgresPool)return null;
  const result=await postgresPool.query(`UPDATE map_provider_cache SET hit_count=hit_count+1,updated_at=now()
    WHERE cache_key=$1 AND kind=$2 AND expires_at>now() RETURNING provider,payload,expires_at`,[key,kind]);
  const row=result.rows[0];
  return row?{provider:row.provider,payload:row.payload,expiresAt:new Date(row.expires_at).toISOString()}:null;
}

export async function putCachedMapResponse({kind,key,provider,payload,ttlSeconds}){
  if(!postgresPool)return;
  await postgresPool.query(`INSERT INTO map_provider_cache(cache_key,kind,provider,payload,expires_at)
    VALUES($1,$2,$3,$4,now()+$5*interval '1 second')
    ON CONFLICT(cache_key) DO UPDATE SET kind=excluded.kind,provider=excluded.provider,payload=excluded.payload,
      expires_at=excluded.expires_at,hit_count=0,updated_at=now()`,[key,kind,provider,payload,ttlSeconds]);
}
