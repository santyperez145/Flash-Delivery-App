import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { config } from "./config.js";

const bucketFor = (key, userId) => Number.parseInt(crypto.createHmac("sha256", config.featureFlagSalt).update(`${key}:${userId}`).digest("hex").slice(0, 8), 16) % 100;
const rolesOf=(value)=>Array.isArray(value)?value:String(value||"").replace(/^\{|\}$/g,"").split(",").filter(Boolean);
const mapFlag = (row) => ({ id: row.public_id, key: row.key, description: row.description, enabled: row.enabled, rolloutPercentage: row.rollout_percentage, allowedRoles: rolesOf(row.allowed_roles), city: row.city_slug || null, startsAt: row.starts_at?.toISOString?.() || null, endsAt: row.ends_at?.toISOString?.() || null, variant: row.variant || {}, updatedAt: row.updated_at.toISOString() });

export async function evaluateFeatureFlags({ userId, roles }) {
  const result = await postgresPool.query(`SELECT f.*,c.slug city_slug,u.city_id user_city_id FROM feature_flags f
    LEFT JOIN cities c ON c.id=f.city_id CROSS JOIN users u WHERE u.public_id=$1 ORDER BY f.key`,[userId]);
  const now = Date.now();
  return Object.fromEntries(result.rows.map((row) => {
    const allowedRoles=rolesOf(row.allowed_roles);
    const roleMatch = !allowedRoles.length || allowedRoles.some((role) => roles.includes(role));
    const cityMatch = !row.city_id || row.city_id === row.user_city_id;
    const timeMatch = (!row.starts_at || row.starts_at.getTime() <= now) && (!row.ends_at || row.ends_at.getTime() > now);
    const active = Boolean(row.enabled && roleMatch && cityMatch && timeMatch && bucketFor(row.key,userId) < row.rollout_percentage);
    return [row.key,{ active, variant: active ? row.variant || {} : {} }];
  }));
}

export async function getFeatureFlags() {
  const result = await postgresPool.query(`SELECT f.*,c.slug city_slug FROM feature_flags f LEFT JOIN cities c ON c.id=f.city_id ORDER BY f.key`);
  return result.rows.map(mapFlag);
}

export async function updateFeatureFlag({ publicId, changes }) {
  const row=(await postgresPool.query(`UPDATE feature_flags SET enabled=COALESCE($2,enabled),rollout_percentage=COALESCE($3,rollout_percentage),
    allowed_roles=COALESCE($4::user_role[],allowed_roles),starts_at=CASE WHEN $5::boolean THEN $6::timestamptz ELSE starts_at END,
    ends_at=CASE WHEN $7::boolean THEN $8::timestamptz ELSE ends_at END,variant=COALESCE($9::jsonb,variant),updated_at=now()
    WHERE public_id=$1 RETURNING id`,[publicId,changes.enabled??null,changes.rolloutPercentage??null,changes.allowedRoles??null,Object.hasOwn(changes,"startsAt"),changes.startsAt??null,Object.hasOwn(changes,"endsAt"),changes.endsAt??null,changes.variant===undefined?null:JSON.stringify(changes.variant)])).rows[0];
  if(!row)throw Object.assign(new Error("Feature flag no encontrado"),{status:404});
  return (await getFeatureFlags()).find((flag)=>flag.id===publicId);
}
