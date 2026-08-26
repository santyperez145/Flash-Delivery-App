import { postgresPool } from "./postgres.js";

export async function searchPostgresCatalog({ userPublicId, query, limit = 20, offset = 0 }) {
  const q = query.trim().toLowerCase();
  const result = await postgresPool.query(
    `WITH viewer AS(SELECT u.id,COALESCE(p.hide_incompatible,false) hide_incompatible FROM users u LEFT JOIN user_dietary_profiles p ON p.user_id=u.id WHERE u.public_id=$2),ranked AS(SELECT m.public_id restaurant_id,m.name restaurant_name,COALESCE(m.metadata->>'cuisine','Comercio') cuisine,COALESCE(m.metadata->>'image','') image,COALESCE(m.metadata->>'cover',m.metadata->>'image','') cover,COALESCE(b.eta_min,m.eta_min) eta_min,m.delivery_fee_cents,ci.public_id item_id,ci.name item_name,ci.category,GREATEST(similarity(lower(m.name),$1),similarity(lower(ci.name||' '||ci.description||' '||ci.category),$1))+CASE WHEN lower(ci.name) LIKE $1||'%' THEN 1 ELSE 0 END+CASE WHEN lower(m.name) LIKE $1||'%' THEN .75 ELSE 0 END score FROM viewer v CROSS JOIN merchants m LEFT JOIN LATERAL(SELECT * FROM merchant_branches x WHERE x.merchant_id=m.id AND x.is_primary LIMIT 1)b ON true JOIN catalog_items ci ON ci.merchant_id=m.id LEFT JOIN catalog_branch_inventory inventory ON inventory.branch_id=b.id AND inventory.catalog_item_id=ci.id WHERE m.status='active' AND (CASE WHEN b.id IS NULL THEN m.open ELSE b.open AND b.status='active' AND app.branch_is_scheduled_open(b.id,now()) END) AND ci.available AND COALESCE(inventory.available,true) AND COALESCE(inventory.stock_quantity,1)>0 AND ($1='' OR lower(m.name||' '||COALESCE(m.metadata->>'cuisine','')||' '||ci.name||' '||ci.description||' '||ci.category) LIKE '%'||$1||'%' OR lower(m.name) % $1 OR lower(ci.name||' '||ci.description||' '||ci.category) % $1) AND (NOT v.hide_incompatible OR (NOT EXISTS(SELECT 1 FROM user_dietary_preferences pref WHERE pref.user_id=v.id AND NOT EXISTS(SELECT 1 FROM catalog_item_dietary_labels item_pref WHERE item_pref.catalog_item_id=ci.id AND item_pref.dietary_code=pref.dietary_code)) AND NOT EXISTS(SELECT 1 FROM user_avoided_allergens avoided JOIN catalog_item_allergens declared ON declared.catalog_item_id=ci.id AND declared.allergen_code=avoided.allergen_code WHERE avoided.user_id=v.id)))) SELECT restaurant_id,"restaurantName",cuisine,image,cover,"etaMin","deliveryFee",matched_items,"matchCount",score,count(*) OVER()::int total FROM(SELECT restaurant_id,restaurant_name "restaurantName",cuisine,image,cover,eta_min "etaMin",delivery_fee_cents/100.0 "deliveryFee",jsonb_agg(jsonb_build_object('id',item_id,'name',item_name,'category',category) ORDER BY score DESC,item_name) matched_items,count(*)::int "matchCount",max(score) score FROM ranked GROUP BY restaurant_id,restaurant_name,cuisine,image,cover,eta_min,delivery_fee_cents) grouped ORDER BY score DESC,"restaurantName" LIMIT $3 OFFSET $4`,
    [q, userPublicId, limit, offset],
  );
  const total = Number(result.rows[0]?.total || 0);
  return {
    results: result.rows.map(({ total: _total, matched_items, restaurant_id, ...row }) => ({
      ...row,
      restaurantId: restaurant_id,
      matchedItems: matched_items,
      score: Number(row.score),
    })),
    total,
    limit,
    offset,
    nextOffset: offset + result.rows.length < total ? offset + result.rows.length : null,
  };
}
