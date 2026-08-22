import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { getPostgresPricingPlan } from "./configuration-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { acceptDispatchOffer, createDispatchOffers } from "./dispatch-repository.js";
import {settleCapturedFoodOrder} from "./merchant-finance-repository.js";

const pesos = (cents) => Number(cents || 0) / 100;

export function usesPostgresCommerce() {
  return Boolean(postgresPool);
}

function mapCatalogItem(row) {
  const metadata = row.item_metadata || row.metadata || {};
  return {
    id: row.item_public_id || row.public_id,
    name: row.item_name || row.name,
    description: row.description || "",
    category: row.category,
    price: pesos(row.unit_price_cents),
    rating: Number(metadata.rating || 0),
    timeMin: Number(metadata.timeMin || 0),
    kcal: Number(metadata.kcal || 0),
    stock: Boolean(row.available),
    image: metadata.image || "",
    tags: metadata.tags || [],
    modifierGroups:row.modifier_groups||[],
    dietaryLabels:row.dietary_labels||[],
    allergens:row.allergens||[]
  };
}

async function resolveModifierSelection(client,{catalogItemId,selectedIds=[]}){
  const unique=[...new Set(selectedIds)];if(unique.length!==selectedIds.length)throw Object.assign(new Error("No puedes repetir un agregado"),{status:409});
  const groups=(await client.query(`SELECT g.id,g.public_id,g.name,g.minimum_selections,g.maximum_selections,COALESCE(jsonb_agg(jsonb_build_object('id',m.public_id,'name',m.name,'priceCents',m.price_cents,'available',m.available) ORDER BY m.sort_order,m.created_at) FILTER(WHERE m.id IS NOT NULL),'[]') modifiers FROM catalog_modifier_groups g LEFT JOIN catalog_modifiers m ON m.group_id=g.id WHERE g.catalog_item_id=$1 AND g.active GROUP BY g.id ORDER BY g.sort_order,g.created_at`,[catalogItemId])).rows;
  const known=new Map();for(const group of groups)for(const modifier of group.modifiers)known.set(modifier.id,{...modifier,groupId:group.public_id,groupName:group.name});for(const id of unique){const modifier=known.get(id);if(!modifier||!modifier.available)throw Object.assign(new Error("Un agregado no está disponible para este producto"),{status:409});}
  for(const group of groups){const count=unique.filter(id=>known.get(id)?.groupId===group.public_id).length;if(count<group.minimum_selections||count>group.maximum_selections)throw Object.assign(new Error(`${group.name}: elegí entre ${group.minimum_selections} y ${group.maximum_selections}`),{status:409});}
  const modifiers=unique.map(id=>known.get(id));return{priceCents:modifiers.reduce((sum,modifier)=>sum+Number(modifier.priceCents),0),modifiers:modifiers.map(modifier=>({id:modifier.id,name:modifier.name,price:pesos(modifier.priceCents),groupId:modifier.groupId,groupName:modifier.groupName}))};
}

export async function getPostgresRestaurants({publicIds=null,ownerPublicId=null}={}) {
  const result = await postgresPool.query(`
    SELECT m.id, m.public_id, m.owner_id, owner.public_id AS owner_public_id,
      m.name, COALESCE(branch.address,m.address) address, CASE WHEN branch.id IS NULL THEN m.open ELSE branch.open AND branch.status='active' AND app.branch_is_scheduled_open(branch.id,now()) END open, COALESCE(branch.open,m.open) manual_open, COALESCE(branch.eta_min,m.eta_min) eta_min, m.delivery_fee_cents, m.metadata,
      (SELECT round(avg(r.score),2) FROM ratings r WHERE r.subject_type='merchant' AND r.subject_id=m.id) AS merchant_rating,
      ST_Y(COALESCE(branch.location,m.location)::geometry) AS lat, ST_X(COALESCE(branch.location,m.location)::geometry) AS lng,
      ci.public_id AS item_public_id, ci.name AS item_name, ci.description,
       ci.category, ci.unit_price_cents, COALESCE(inventory.available,ci.available) available, ci.metadata AS item_metadata,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',g.public_id,'name',g.name,'min',g.minimum_selections,'max',g.maximum_selections,'required',g.minimum_selections>0,'modifiers',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',mo.public_id,'name',mo.name,'price',mo.price_cents/100.0,'available',mo.available) ORDER BY mo.sort_order,mo.created_at),'[]') FROM catalog_modifiers mo WHERE mo.group_id=g.id)) ORDER BY g.sort_order,g.created_at),'[]') FROM catalog_modifier_groups g WHERE g.catalog_item_id=ci.id AND g.active) modifier_groups,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('code',d.code,'name',d.name) ORDER BY d.name),'[]') FROM catalog_item_dietary_labels x JOIN dietary_labels d ON d.code=x.dietary_code WHERE x.catalog_item_id=ci.id AND d.active) dietary_labels,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('code',a.code,'name',a.name,'presence',x.presence) ORDER BY a.name),'[]') FROM catalog_item_allergens x JOIN allergens a ON a.code=x.allergen_code WHERE x.catalog_item_id=ci.id AND a.active) allergens,
      (SELECT jsonb_agg(jsonb_build_object('id',b.public_id,'name',b.name,'address',b.address,'lat',ST_Y(b.location::geometry),'lng',ST_X(b.location::geometry),'open',b.open AND b.status='active' AND app.branch_is_scheduled_open(b.id,now()),'manualOpen',b.open,'status',b.status,'etaMin',b.eta_min,'isPrimary',b.is_primary,'timezone',b.timezone,'weeklyHours',(SELECT COALESCE(jsonb_agg(jsonb_build_object('weekday',h.weekday,'opensAt',to_char(h.opens_at,'HH24:MI'),'closesAt',to_char(h.closes_at,'HH24:MI'),'enabled',h.enabled) ORDER BY h.weekday),'[]') FROM branch_operating_hours h WHERE h.branch_id=b.id),'scheduleExceptions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('date',e.local_date,'isOpen',e.is_open,'opensAt',CASE WHEN e.opens_at IS NULL THEN NULL ELSE to_char(e.opens_at,'HH24:MI') END,'closesAt',CASE WHEN e.closes_at IS NULL THEN NULL ELSE to_char(e.closes_at,'HH24:MI') END,'reason',e.reason) ORDER BY e.local_date),'[]') FROM branch_schedule_exceptions e WHERE e.branch_id=b.id AND e.local_date>=((now() AT TIME ZONE b.timezone)::date-interval '1 day') AND e.local_date<=((now() AT TIME ZONE b.timezone)::date+interval '60 days')),'inventory',(SELECT COALESCE(jsonb_object_agg(c.public_id,jsonb_build_object('available',i.available,'stockQuantity',i.stock_quantity,'version',i.version)),'{}') FROM catalog_branch_inventory i JOIN catalog_items c ON c.id=i.catalog_item_id WHERE i.branch_id=b.id)) ORDER BY b.is_primary DESC,b.created_at) FROM merchant_branches b WHERE b.merchant_id=m.id AND b.status<>'closed') branches
    FROM merchants m
    JOIN users owner ON owner.id = m.owner_id
    LEFT JOIN LATERAL(SELECT * FROM merchant_branches b WHERE b.merchant_id=m.id AND b.is_primary LIMIT 1) branch ON true
    LEFT JOIN catalog_items ci ON ci.merchant_id = m.id
    LEFT JOIN catalog_branch_inventory inventory ON inventory.branch_id=branch.id AND inventory.catalog_item_id=ci.id
    WHERE m.status = 'active' AND ($1::text[] IS NULL OR m.public_id=ANY($1::text[]))
      AND ($2::text IS NULL OR owner.public_id=$2)
    ORDER BY m.created_at, ci.created_at
  `,[publicIds,ownerPublicId]);
  const restaurants = new Map();
  for (const row of result.rows) {
    if (!restaurants.has(row.public_id)) {
      const metadata = row.metadata || {};
      restaurants.set(row.public_id, {
        id: row.public_id,
        ownerId: row.owner_public_id,
        name: row.name,
        cuisine: metadata.cuisine || "Comercio",
        rating: Number(row.merchant_rating??metadata.rating??0),
        distanceKm: Number(metadata.distanceKm || 0),
        etaMin: row.eta_min,
        deliveryFee: pesos(row.delivery_fee_cents),
         open: row.open,
        manualOpen: row.manual_open,
        image: metadata.image || "",
        cover: metadata.cover || metadata.image || "",
        badge: metadata.badge || "",
        address: row.address,
        lat: Number(row.lat),
        lng: Number(row.lng),
        menu: [],
        extras: metadata.extras || [],
        branches: row.branches || []
      });
    }
    if (row.item_public_id) restaurants.get(row.public_id).menu.push(mapCatalogItem(row));
  }
  return [...restaurants.values()];
}

const publicRestaurant=restaurant=>({id:restaurant.id,name:restaurant.name,cuisine:restaurant.cuisine,rating:restaurant.rating,distanceKm:restaurant.distanceKm,etaMin:restaurant.etaMin,deliveryFee:restaurant.deliveryFee,open:restaurant.open,image:restaurant.image,cover:restaurant.cover,badge:restaurant.badge,address:restaurant.address,lat:restaurant.lat,lng:restaurant.lng,menu:restaurant.menu,extras:restaurant.extras,branches:(restaurant.branches||[]).map(branch=>({id:branch.id,name:branch.name,address:branch.address,lat:branch.lat,lng:branch.lng,open:branch.open,status:branch.status,etaMin:branch.etaMin,isPrimary:branch.isPrimary}))});
export async function getPostgresRestaurantPage({limit=20,cursor=null,query=""}={}){const page=await postgresPool.query(`SELECT id,public_id,created_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at FROM merchants WHERE status='active' AND ($1='' OR name ILIKE '%'||$1||'%' OR metadata->>'cuisine' ILIKE '%'||$1||'%') AND ($2::timestamptz IS NULL OR (created_at,id)>($2::timestamptz,$3::uuid)) ORDER BY created_at,id LIMIT $4`,[query.trim(),cursor?.createdAt||null,cursor?.id||null,limit+1]),hasMore=page.rows.length>limit,rows=page.rows.slice(0,limit),restaurants=await getPostgresRestaurants({publicIds:rows.map(row=>row.public_id)}),byId=new Map(restaurants.map(item=>[item.id,publicRestaurant(item)])),last=rows.at(-1);return{restaurants:rows.map(row=>byId.get(row.public_id)).filter(Boolean),nextCursor:hasMore&&last?Buffer.from(JSON.stringify({createdAt:last.cursor_created_at,id:last.id})).toString("base64url"):null};}

export async function getPostgresOperationsRestaurantPage({limit=50,cursor=null,query=""}={}){
  const page=await postgresPool.query(`SELECT id,public_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at FROM merchants WHERE ($1='' OR name ILIKE '%'||$1||'%' OR public_id ILIKE '%'||$1||'%') AND ($2::timestamptz IS NULL OR (created_at,id)>($2::timestamptz,$3::uuid)) ORDER BY created_at,id LIMIT $4`,[query.trim(),cursor?.createdAt||null,cursor?.id||null,limit+1]);
  const hasMore=page.rows.length>limit,rows=page.rows.slice(0,limit),restaurants=await getPostgresRestaurants({publicIds:rows.map(row=>row.public_id)}),byId=new Map(restaurants.map(item=>[item.id,item])),last=rows.at(-1);
  return{restaurants:rows.map(row=>byId.get(row.public_id)).filter(Boolean),nextCursor:hasMore&&last?Buffer.from(JSON.stringify({createdAt:last.cursor_created_at,id:last.id})).toString("base64url"):null};
}

export async function updatePostgresRestaurant(publicId, changes) {
  const fields = [];
  const values = [];
  if (typeof changes.open === "boolean") {
    values.push(changes.open); fields.push(`open = $${values.length}`);
  }
  if (typeof changes.etaMin === "number") {
    values.push(Math.max(5, Math.round(changes.etaMin))); fields.push(`eta_min = $${values.length}`);
  }
  if (fields.length) {
    values.push(publicId);
    await postgresPool.query(`UPDATE merchants SET ${fields.join(", ")} WHERE public_id = $${values.length}`, values);
    const branchFields=[];const branchValues=[];if(typeof changes.open==="boolean"){branchValues.push(changes.open);branchFields.push(`open=$${branchValues.length}`);}if(typeof changes.etaMin==="number"){branchValues.push(Math.max(5,Math.round(changes.etaMin)));branchFields.push(`eta_min=$${branchValues.length}`);}branchValues.push(publicId);if(branchFields.length)await postgresPool.query(`UPDATE merchant_branches b SET ${branchFields.join(",")},updated_at=now() FROM merchants m WHERE b.merchant_id=m.id AND b.is_primary AND m.public_id=$${branchValues.length}`,branchValues);
  }
  return (await getPostgresRestaurants()).find((restaurant) => restaurant.id === publicId) || null;
}

export async function createPostgresMenuItem(merchantPublicId, item) {
  const merchant = await postgresPool.query("SELECT id, eta_min, metadata FROM merchants WHERE public_id = $1", [merchantPublicId]);
  if (!merchant.rows[0]) return null;
  await postgresPool.query(
    `INSERT INTO catalog_items(public_id, merchant_id, sku, name, description, category, unit_price_cents, available, metadata)
     VALUES ($1, $2, $1, $3, $4, $5, $6, true, $7)`,
    [item.id, merchant.rows[0].id, item.name, item.description, item.category, Math.round(item.price * 100), {
      rating: item.rating, timeMin: item.timeMin, kcal: item.kcal, image: item.image, tags: item.tags
    }]
  );
  await postgresPool.query(`INSERT INTO catalog_branch_inventory(branch_id,catalog_item_id,available) SELECT b.id,c.id,true FROM merchant_branches b JOIN catalog_items c ON c.merchant_id=b.merchant_id WHERE b.merchant_id=$1 AND c.public_id=$2 ON CONFLICT DO NOTHING`,[merchant.rows[0].id,item.id]);
  return (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) || null;
}

export async function updatePostgresMenuItem(merchantPublicId, itemPublicId, changes) {
  const fields = [];
  const values = [];
  if (typeof changes.stock === "boolean") {
    values.push(changes.stock); fields.push(`available = $${values.length}`);
  }
  if (typeof changes.price === "number") {
    values.push(Math.round(Math.max(100, changes.price) * 100)); fields.push(`unit_price_cents = $${values.length}`);
  }
  if (!fields.length) return (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) || null;
  values.push(itemPublicId, merchantPublicId);
  await postgresPool.query(
    `UPDATE catalog_items ci SET ${fields.join(", ")}
     FROM merchants m WHERE ci.merchant_id = m.id AND ci.public_id = $${values.length - 1} AND m.public_id = $${values.length}`,
    values
  );
  if(typeof changes.stock==="boolean")await postgresPool.query(`UPDATE catalog_branch_inventory i SET available=$3,version=version+1,updated_at=now() FROM merchant_branches b JOIN merchants m ON m.id=b.merchant_id JOIN catalog_items c ON c.merchant_id=m.id WHERE i.branch_id=b.id AND i.catalog_item_id=c.id AND m.public_id=$1 AND c.public_id=$2`,[merchantPublicId,itemPublicId,changes.stock]);
  return (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) || null;
}

export async function replacePostgresItemModifiers({merchantPublicId,itemPublicId,actorPublicId,admin=false,groups}){const client=await postgresPool.connect();try{await client.query("BEGIN");const item=(await client.query(`SELECT c.id FROM catalog_items c JOIN merchants m ON m.id=c.merchant_id JOIN users u ON u.id=m.owner_id WHERE m.public_id=$1 AND c.public_id=$2 AND ($4::boolean OR u.public_id=$3) FOR UPDATE OF c`,[merchantPublicId,itemPublicId,actorPublicId,admin])).rows[0];if(!item)throw Object.assign(new Error("Producto no encontrado o no autorizado"),{status:404});await client.query("DELETE FROM catalog_modifier_groups WHERE catalog_item_id=$1",[item.id]);for(let groupIndex=0;groupIndex<groups.length;groupIndex++){const group=groups[groupIndex],inserted=(await client.query(`INSERT INTO catalog_modifier_groups(public_id,catalog_item_id,name,minimum_selections,maximum_selections,sort_order,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[group.id,item.id,group.name,group.min,group.max,groupIndex,group.active])).rows[0];for(let modifierIndex=0;modifierIndex<group.modifiers.length;modifierIndex++){const modifier=group.modifiers[modifierIndex];await client.query(`INSERT INTO catalog_modifiers(public_id,group_id,name,price_cents,available,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,[modifier.id,inserted.id,modifier.name,Math.round(modifier.price*100),modifier.available,modifierIndex]);}}await client.query("COMMIT");return(await getPostgresRestaurants()).find(restaurant=>restaurant.id===merchantPublicId);}catch(error){await client.query("ROLLBACK");if(error.code==="23505")throw Object.assign(new Error("Los identificadores de grupos y agregados no pueden repetirse"),{status:409});throw error;}finally{client.release();}}

export async function replacePostgresItemDietary({merchantPublicId,itemPublicId,actorPublicId,admin=false,dietaryLabels,allergens}){const client=await postgresPool.connect();try{await client.query("BEGIN");const item=(await client.query(`SELECT c.id FROM catalog_items c JOIN merchants m ON m.id=c.merchant_id JOIN users u ON u.id=m.owner_id WHERE m.public_id=$1 AND c.public_id=$2 AND ($4::boolean OR u.public_id=$3) FOR UPDATE OF c`,[merchantPublicId,itemPublicId,actorPublicId,admin])).rows[0];if(!item)throw Object.assign(new Error("Producto no encontrado o no autorizado"),{status:404});const validDietary=(await client.query("SELECT code FROM dietary_labels WHERE active AND code=ANY($1::text[])",[dietaryLabels])).rows.map(row=>row.code),validAllergens=(await client.query("SELECT code FROM allergens WHERE active AND code=ANY($1::text[])",[allergens.map(entry=>entry.code)])).rows.map(row=>row.code);if(validDietary.length!==dietaryLabels.length||validAllergens.length!==allergens.length)throw Object.assign(new Error("Existe una dieta o alérgeno no reconocido"),{status:400});await client.query("DELETE FROM catalog_item_dietary_labels WHERE catalog_item_id=$1",[item.id]);await client.query("DELETE FROM catalog_item_allergens WHERE catalog_item_id=$1",[item.id]);for(const code of dietaryLabels)await client.query("INSERT INTO catalog_item_dietary_labels(catalog_item_id,dietary_code) VALUES($1,$2)",[item.id,code]);for(const allergen of allergens)await client.query("INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence) VALUES($1,$2,$3)",[item.id,allergen.code,allergen.presence]);await client.query("COMMIT");return(await getPostgresRestaurants()).find(restaurant=>restaurant.id===merchantPublicId);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function updatePostgresBranch({merchantPublicId,branchPublicId,actorPublicId,admin=false,changes}){const fields=[],values=[];for(const [key,column]of [["open","open"],["etaMin","eta_min"],["status","status"]])if(changes[key]!==undefined){values.push(changes[key]);fields.push(`${column}=$${values.length}`);}if(!fields.length)throw Object.assign(new Error("No hay cambios"),{status:400});values.push(merchantPublicId,branchPublicId,actorPublicId,admin);const result=await postgresPool.query(`UPDATE merchant_branches b SET ${fields.join(",")},updated_at=now() FROM merchants m JOIN users u ON u.id=m.owner_id WHERE b.merchant_id=m.id AND m.public_id=$${values.length-3} AND b.public_id=$${values.length-2} AND ($${values.length}::boolean OR u.public_id=$${values.length-1}) RETURNING b.public_id`,values);if(!result.rowCount)throw Object.assign(new Error("Sucursal no encontrada o no autorizada"),{status:404});return(await getPostgresRestaurants()).find(r=>r.id===merchantPublicId);}
export async function updatePostgresBranchInventory({merchantPublicId,branchPublicId,itemPublicId,actorPublicId,admin=false,available,stockQuantity}){const result=await postgresPool.query(`UPDATE catalog_branch_inventory i SET available=$6,stock_quantity=$7,version=version+1,updated_at=now() FROM merchant_branches b JOIN merchants m ON m.id=b.merchant_id JOIN users u ON u.id=m.owner_id JOIN catalog_items c ON c.merchant_id=m.id WHERE i.branch_id=b.id AND i.catalog_item_id=c.id AND m.public_id=$1 AND b.public_id=$2 AND c.public_id=$3 AND ($5::boolean OR u.public_id=$4) RETURNING i.version`,[merchantPublicId,branchPublicId,itemPublicId,actorPublicId,admin,available,stockQuantity??null]);if(!result.rowCount)throw Object.assign(new Error("Inventario de sucursal no encontrado o no autorizado"),{status:404});return(await getPostgresRestaurants()).find(r=>r.id===merchantPublicId);}

async function lockOwnedBranch(client,{merchantPublicId,branchPublicId,actorPublicId,admin}){const branch=(await client.query(`SELECT b.id FROM merchant_branches b JOIN merchants m ON m.id=b.merchant_id JOIN users u ON u.id=m.owner_id WHERE m.public_id=$1 AND b.public_id=$2 AND ($4::boolean OR u.public_id=$3) FOR UPDATE OF b`,[merchantPublicId,branchPublicId,actorPublicId,admin])).rows[0];if(!branch)throw Object.assign(new Error("Sucursal no encontrada o no autorizada"),{status:404});return branch;}

export async function replacePostgresBranchSchedule({merchantPublicId,branchPublicId,actorPublicId,admin=false,timezone,hours}){const client=await postgresPool.connect();try{await client.query("BEGIN");const branch=await lockOwnedBranch(client,{merchantPublicId,branchPublicId,actorPublicId,admin});const validZone=(await client.query("SELECT 1 FROM pg_timezone_names WHERE name=$1",[timezone])).rows[0];if(!validZone)throw Object.assign(new Error("Zona horaria inválida"),{status:400});await client.query("UPDATE merchant_branches SET timezone=$2,updated_at=now() WHERE id=$1",[branch.id,timezone]);await client.query("DELETE FROM branch_operating_hours WHERE branch_id=$1",[branch.id]);for(const hour of hours)await client.query("INSERT INTO branch_operating_hours(branch_id,weekday,opens_at,closes_at,enabled) VALUES($1,$2,$3,$4,$5)",[branch.id,hour.weekday,hour.opensAt,hour.closesAt,hour.enabled]);await client.query("COMMIT");return(await getPostgresRestaurants()).find(r=>r.id===merchantPublicId);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function upsertPostgresBranchScheduleException({merchantPublicId,branchPublicId,actorPublicId,admin=false,date,isOpen,opensAt,closesAt,reason}){const client=await postgresPool.connect();try{await client.query("BEGIN");const branch=await lockOwnedBranch(client,{merchantPublicId,branchPublicId,actorPublicId,admin});await client.query(`INSERT INTO branch_schedule_exceptions(branch_id,local_date,is_open,opens_at,closes_at,reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(branch_id,local_date) DO UPDATE SET is_open=excluded.is_open,opens_at=excluded.opens_at,closes_at=excluded.closes_at,reason=excluded.reason,updated_at=now()`,[branch.id,date,isOpen,isOpen?opensAt:null,isOpen?closesAt:null,reason||null]);await client.query("COMMIT");return(await getPostgresRestaurants()).find(r=>r.id===merchantPublicId);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

const apiStatus = (status) => ({ driver_assigned: "courier_assigned", completed: "delivered" }[status] || status);
const databaseStatus = (status) => ({ courier_assigned: "driver_assigned", delivered: "completed" }[status] || status);

function rowsToOrders(rows) {
  const orders = new Map();
  for (const row of rows) {
    if (!orders.has(row.public_id)) {
      const metadata = row.job_metadata || {};
      orders.set(row.public_id, {
        id: row.public_id,
        customerId: row.customer_public_id,
        restaurantId: row.merchant_public_id,
        courierId: row.driver_public_id || null,
        status: apiStatus(row.status),
        deliveryAddress: row.dropoff_address,
        pickupLocation:{lat:Number(row.pickup_lat),lng:Number(row.pickup_lng)},
        deliveryLocation:{lat:Number(row.dropoff_lat),lng:Number(row.dropoff_lng)},
        paymentMethod: row.payment_method_label || "",
        items: [],
        subtotal: Number(metadata.subtotal || 0),
        deliveryFee: Number(metadata.deliveryFee || 0),
        serviceFee: Number(metadata.serviceFee || 0),
        discount: Number(metadata.discount || 0),
        promotionCode: metadata.promotionCode || null,
        total: pesos(row.final_amount_cents ?? row.quoted_amount_cents),
        etaMin: Number(metadata.etaMin ?? Math.round(row.estimated_duration_s / 60)),
        createdAt: new Date(row.created_at).toISOString(),
        version: row.version,
        timeline: row.timeline || [],
        cancellation: row.cancellation || null
      });
    }
    if (row.item_id) {
      const metadata = row.item_metadata || {};
      orders.get(row.public_id).items.push({
        menuItemId: metadata.publicId || row.catalog_public_id || row.item_id,
        name: row.item_name,
        quantity: row.quantity,
        unitPrice: pesos(row.unit_price_cents),
        extras: metadata.extras || [],
        note: row.customer_note || ""
      });
    }
  }
  return [...orders.values()];
}

export async function getPostgresOrders() {
  const result = await postgresPool.query(`
    SELECT j.*, j.metadata AS job_metadata, customer.public_id AS customer_public_id,
      ST_Y(j.pickup_location::geometry) pickup_lat,ST_X(j.pickup_location::geometry) pickup_lng,
      ST_Y(j.dropoff_location::geometry) dropoff_lat,ST_X(j.dropoff_location::geometry) dropoff_lng,
      merchant.public_id AS merchant_public_id, driver.public_id AS driver_public_id,
      ji.id AS item_id, ji.name AS item_name, ji.quantity, ji.unit_price_cents,
      ji.customer_note, ji.metadata AS item_metadata, catalog.public_id AS catalog_public_id,
      (SELECT jsonb_build_object('id',c.public_id,'reason',c.reason_code,'refundAmount',c.refund_amount_cents/100.0,'fee',c.cancellation_fee_cents/100.0,'createdAt',c.created_at) FROM job_cancellations c WHERE c.job_id=j.id) cancellation,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status',
        CASE WHEN je.status = 'driver_assigned' THEN 'courier_assigned'
             WHEN je.status = 'completed' THEN 'delivered' ELSE je.status::text END,
        'at', je.occurred_at) ORDER BY je.occurred_at) FROM job_events je WHERE je.job_id = j.id), '[]') AS timeline
    FROM jobs j
    JOIN users customer ON customer.id = j.customer_id
    JOIN merchants merchant ON merchant.id = j.merchant_id
    LEFT JOIN drivers driver ON driver.id = j.driver_id
    LEFT JOIN job_items ji ON ji.job_id = j.id
    LEFT JOIN catalog_items catalog ON catalog.id = ji.catalog_item_id
    WHERE j.kind = 'delivery' AND j.metadata->>'subtype' = 'food_order'
    ORDER BY j.created_at DESC, ji.id
  `);
  return rowsToOrders(result.rows);
}

export async function getPostgresFoodDeliveryQuote({customerPublicId,merchantPublicId,deliveryAddressId,branchPublicId}){
  const [plan,result]=await Promise.all([getPostgresPricingPlan("food"),postgresPool.query(`SELECT a.id address_id,a.formatted_address,ST_Y(a.location::geometry) lat,ST_X(a.location::geometry) lng,
    m.public_id merchant_id,b.public_id branch_id,ST_Distance(b.location,a.location) air_distance_m,COALESCE(z.delivery_multiplier,1) zone_multiplier,z.public_id zone_id
    FROM users u JOIN addresses a ON a.user_id=u.id JOIN merchants m ON m.public_id=$2 AND m.status='active'
    JOIN merchant_branches b ON b.merchant_id=m.id AND b.status='active' AND b.open AND app.branch_is_scheduled_open(b.id,now()) AND (($4::text IS NULL AND b.is_primary) OR b.public_id=$4)
    LEFT JOIN LATERAL(SELECT public_id,delivery_multiplier FROM service_zones WHERE active AND ST_Covers(boundary::geometry,b.location::geometry) ORDER BY ST_Area(boundary) LIMIT 1) z ON true
    WHERE u.public_id=$1 AND u.status='active' AND a.id=$3`,[customerPublicId,merchantPublicId,deliveryAddressId,branchPublicId||null])]);
  const row=result.rows[0];if(!row)throw Object.assign(new Error("La dirección o el comercio no están disponibles para este cliente"),{status:404});const config=plan.config;
  const distanceKm=Number(row.air_distance_m)/1000*Number(config.roadFactor);if(distanceKm>Number(config.maximumDistanceKm))throw Object.assign(new Error("La dirección está fuera del radio máximo de entrega"),{status:409});
  const raw=Math.max(Number(config.minimumDeliveryFee),Number(config.baseDeliveryFee)+distanceKm*Number(config.distancePerKm));const deliveryFee=Math.round(Math.min(Number(config.maximumDeliveryFee),raw*Number(row.zone_multiplier)));
  return{customerId:customerPublicId,restaurantId:merchantPublicId,branchId:row.branch_id,deliveryAddressId:String(row.address_id),deliveryAddress:row.formatted_address,destinationCoords:{lat:Number(row.lat),lng:Number(row.lng)},distanceKm:Number(distanceKm.toFixed(2)),deliveryFee,serviceFee:Number(config.serviceFee),roadFactor:Number(config.roadFactor),zoneId:row.zone_id||null,zoneMultiplier:Number(row.zone_multiplier),pricingVersion:plan.version,currency:plan.currency};
}

export async function getPostgresFoodCheckoutQuote({customerPublicId,merchantPublicId,deliveryAddressId,branchPublicId,items,paymentMethod,paymentMethodId,promotionCode}){
  const delivery=await getPostgresFoodDeliveryQuote({customerPublicId,merchantPublicId,deliveryAddressId,branchPublicId});const client=await postgresPool.connect();try{
    const context=(await client.query(`SELECT u.id user_id,m.id merchant_id,b.id branch_id,b.eta_min FROM users u JOIN merchants m ON m.public_id=$2 JOIN merchant_branches b ON b.merchant_id=m.id AND b.public_id=$3 WHERE u.public_id=$1`,[customerPublicId,merchantPublicId,delivery.branchId])).rows[0];if(!context)throw Object.assign(new Error("No se pudo cotizar este comercio"),{status:404});
    if(paymentMethodId){const method=(await client.query(`SELECT pm.kind,pm.brand,pm.last4 FROM payment_methods pm WHERE pm.id=$1 AND pm.user_id=$2 AND pm.revoked_at IS NULL`,[paymentMethodId,context.user_id])).rows[0];if(!method)throw Object.assign(new Error("Método de pago no disponible"),{status:404});paymentMethod=method.kind==="wallet"?"Flash Wallet":`${method.brand||method.kind} •••• ${method.last4||""}`.trim();}
    let subtotalCents=0;const snapshot=[];for(const entry of items){const item=(await client.query(`SELECT c.id,c.public_id,c.name,c.unit_price_cents FROM catalog_items c JOIN catalog_branch_inventory i ON i.catalog_item_id=c.id AND i.branch_id=$3 WHERE c.public_id=$1 AND c.merchant_id=$2 AND c.available AND i.available AND COALESCE(i.stock_quantity,1)>0`,[entry.menuItemId,context.merchant_id,context.branch_id])).rows[0];if(!item)throw Object.assign(new Error("Un producto ya no está disponible"),{status:409});const selection=await resolveModifierSelection(client,{catalogItemId:item.id,selectedIds:entry.extras||[]}),unitPriceCents=Number(item.unit_price_cents)+selection.priceCents;subtotalCents+=unitPriceCents*entry.quantity;snapshot.push({menuItemId:item.public_id,name:item.name,quantity:entry.quantity,baseUnitPrice:pesos(item.unit_price_cents),unitPrice:pesos(unitPriceCents),modifiers:selection.modifiers,note:entry.note||""});}
    const deliveryFeeCents=Math.round(Number(delivery.deliveryFee)*100),serviceFeeCents=Math.round(Number(delivery.serviceFee)*100);let promotion=null,discountCents=0;
    if(promotionCode){promotion=(await client.query(`SELECT * FROM promotions WHERE code=$1 AND active AND now() BETWEEN starts_at AND ends_at`,[promotionCode.trim().toUpperCase()])).rows[0];if(!promotion)throw Object.assign(new Error("Promoción inválida o vencida"),{status:409});if(promotion.rules?.service&&promotion.rules.service!=="food")throw Object.assign(new Error("La promoción no aplica a comida"),{status:409});if(subtotalCents<Number(promotion.min_subtotal_cents))throw Object.assign(new Error("No alcanzas el subtotal mínimo de la promoción"),{status:409});if(promotion.rules?.paymentMethod==="flash_wallet"&&!String(paymentMethod).toLowerCase().includes("wallet"))throw Object.assign(new Error("La promoción requiere Flash Wallet"),{status:409});const usage=(await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE user_id=$2)::int user_total FROM promotion_redemptions WHERE promotion_id=$1`,[promotion.id,context.user_id])).rows[0];if(promotion.usage_limit!==null&&usage.total>=promotion.usage_limit)throw Object.assign(new Error("La promoción agotó su cupo"),{status:409});if(usage.user_total>=promotion.per_user_limit)throw Object.assign(new Error("Ya utilizaste esta promoción"),{status:409});if(promotion.kind==="percentage")discountCents=Math.round(subtotalCents*promotion.value/100);else if(promotion.kind==="fixed")discountCents=promotion.value;else if(promotion.kind==="free_delivery")discountCents=deliveryFeeCents;if(promotion.max_discount_cents!==null)discountCents=Math.min(discountCents,Number(promotion.max_discount_cents));discountCents=Math.min(discountCents,subtotalCents+deliveryFeeCents);}
    const totalCents=subtotalCents+deliveryFeeCents+serviceFeeCents-discountCents;return{...delivery,items:snapshot,subtotal:pesos(subtotalCents),discount:pesos(discountCents),promotionCode:promotion?.code||null,total:pesos(totalCents),etaMin:Number(context.eta_min)+Math.max(8,Math.ceil(Number(delivery.distanceKm)*1000/350)),paymentMethod,paymentMethodId:paymentMethodId||null};
  }finally{client.release();}
}

export async function createPostgresOrder({ publicId, customerPublicId, merchantPublicId, deliveryAddressId, deliveryAddress, paymentMethod,paymentMethodId, promotionCode, items, serviceFee, lockedQuote, idempotencyKey }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query("SELECT id FROM users WHERE public_id = $1 AND status = 'active'", [customerPublicId]);
    const merchant = await client.query(`SELECT m.*,b.id branch_id,b.public_id branch_public_id,b.address branch_address,b.location branch_location,b.eta_min branch_eta_min FROM merchants m JOIN merchant_branches b ON b.merchant_id=m.id AND b.public_id=$2 AND b.status='active' AND b.open AND app.branch_is_scheduled_open(b.id,now()) WHERE m.public_id=$1 AND m.status='active'`, [merchantPublicId,lockedQuote?.branchId]);
    if (!customer.rows[0]) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
    if (!merchant.rows[0]) throw Object.assign(new Error("Restaurante no disponible"), { status: 404 });
    if(paymentMethodId){const method=(await client.query("SELECT kind,brand,last4 FROM payment_methods WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",[paymentMethodId,customer.rows[0].id])).rows[0];if(!method)throw Object.assign(new Error("Método de pago no disponible"),{status:404});const authoritativeLabel=method.kind==="wallet"?"Flash Wallet":`${method.brand||method.kind} •••• ${method.last4||""}`.trim();if(authoritativeLabel!==paymentMethod||lockedQuote.paymentMethodId!==paymentMethodId)throw Object.assign(new Error("El método de pago no coincide con la cotización"),{status:409});}
    if(!deliveryAddressId)throw Object.assign(new Error("Selecciona una dirección guardada con coordenadas reales"),{status:400});
    const address=(await client.query(`SELECT a.id,a.formatted_address,a.location,ST_Distance(a.location,$3::geography) distance_m
      FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.id=$2`,[deliveryAddressId,customer.rows[0].id,merchant.rows[0].branch_location])).rows[0];
    if(!address)throw Object.assign(new Error("La dirección de entrega no existe o no pertenece al cliente"),{status:404});
    deliveryAddress=address.formatted_address;
    if(!lockedQuote||Math.abs(Number(address.distance_m)/1000*Number(lockedQuote.roadFactor)-Number(lockedQuote.distanceKm))>.1)throw Object.assign(new Error("La ruta cambió; actualiza la cotización"),{status:409});
    const requestHash = crypto.createHash("sha256").update(JSON.stringify({ customerPublicId, merchantPublicId, deliveryAddressId, deliveryAddress, paymentMethod,paymentMethodId:paymentMethodId||null, promotionCode:promotionCode||null, items,quoteId:lockedQuote.quoteId })).digest("hex");
    const claimed = await client.query(
      `INSERT INTO idempotency_keys(key, user_id, request_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '24 hours')
       ON CONFLICT (key) DO NOTHING RETURNING key`,
      [idempotencyKey, customer.rows[0].id, requestHash]
    );
    if (!claimed.rows[0]) {
      const existing = await client.query("SELECT request_hash, response_body FROM idempotency_keys WHERE key = $1", [idempotencyKey]);
      if (existing.rows[0]?.request_hash !== requestHash) {
        throw Object.assign(new Error("La clave de idempotencia ya fue usada con otra solicitud"), { status: 409 });
      }
      if (existing.rows[0]?.response_body?.order) {
        await client.query("ROLLBACK");
        return existing.rows[0].response_body.order;
      }
      throw Object.assign(new Error("La solicitud con esta clave todavía está procesándose"), { status: 409 });
    }
    const snapshots = [];
    for (const entry of items) {
      const item = await client.query(
        `SELECT c.* FROM catalog_items c JOIN catalog_branch_inventory i ON i.catalog_item_id=c.id AND i.branch_id=$3 WHERE c.public_id=$1 AND c.merchant_id=$2 AND c.available AND i.available AND COALESCE(i.stock_quantity,1)>0 FOR SHARE OF c,i`,
        [entry.menuItemId, merchant.rows[0].id,merchant.rows[0].branch_id]
      );
      if (!item.rows[0]) throw Object.assign(new Error("Producto no disponible"), { status: 409 });
       const selection=await resolveModifierSelection(client,{catalogItemId:item.rows[0].id,selectedIds:entry.extras||[]});snapshots.push({ entry, item: item.rows[0],selection,unitPriceCents:Number(item.rows[0].unit_price_cents)+selection.priceCents });
    }
    const subtotalCents = snapshots.reduce((sum, { entry, unitPriceCents }) => sum + unitPriceCents * entry.quantity, 0);
    const deliveryFeeCents = Math.round(Number(lockedQuote.deliveryFee)*100);
    const serviceFeeCents = Math.round(serviceFee * 100);
    let promotion=null,discountCents=0;
    if(promotionCode){promotion=(await client.query(`SELECT * FROM promotions WHERE code=$1 AND active AND now() BETWEEN starts_at AND ends_at FOR UPDATE`,[promotionCode])).rows[0];
      if(!promotion)throw Object.assign(new Error("Promoción inválida o vencida"),{status:409});
      if(promotion.rules?.service&&promotion.rules.service!=="food")throw Object.assign(new Error("La promoción no aplica a comida"),{status:409});
      if(subtotalCents<Number(promotion.min_subtotal_cents))throw Object.assign(new Error("No alcanzas el subtotal mínimo de la promoción"),{status:409});
      if(promotion.rules?.paymentMethod==="flash_wallet"&&!String(paymentMethod).toLowerCase().includes("wallet"))throw Object.assign(new Error("La promoción requiere Flash Wallet"),{status:409});
      const usage=(await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE user_id=$2)::int user_total FROM promotion_redemptions WHERE promotion_id=$1`,[promotion.id,customer.rows[0].id])).rows[0];
      if(promotion.usage_limit!==null&&usage.total>=promotion.usage_limit)throw Object.assign(new Error("La promoción agotó su cupo"),{status:409});
      if(usage.user_total>=promotion.per_user_limit)throw Object.assign(new Error("Ya utilizaste esta promoción"),{status:409});
      if(promotion.kind==="percentage")discountCents=Math.round(subtotalCents*promotion.value/100);
      else if(promotion.kind==="fixed")discountCents=promotion.value;
      else if(promotion.kind==="free_delivery")discountCents=deliveryFeeCents;
      else if(promotion.kind==="wallet_credit")discountCents=0;
      if(promotion.max_discount_cents!==null)discountCents=Math.min(discountCents,Number(promotion.max_discount_cents));
      discountCents=Math.min(discountCents,subtotalCents+deliveryFeeCents);
    }
    const totalCents = subtotalCents + deliveryFeeCents + serviceFeeCents-discountCents;
    if(lockedQuote.total!==undefined&&(Math.round(Number(lockedQuote.subtotal)*100)!==subtotalCents||Math.round(Number(lockedQuote.discount||0)*100)!==discountCents||Math.round(Number(lockedQuote.total)*100)!==totalCents||String(lockedQuote.paymentMethod)!==String(paymentMethod)||String(lockedQuote.promotionCode||"")!==String(promotion?.code||"")))throw Object.assign(new Error("El precio final cambió; revisa y acepta una nueva cotización"),{status:409});
    const travelMinutes=Math.max(8,Math.ceil(Number(address.distance_m)/350));
    const metadata = {
      subtype: "food_order", subtotal: pesos(subtotalCents), deliveryFee: pesos(deliveryFeeCents),
      serviceFee,discount:pesos(discountCents),promotionCode:promotion?.code||null, etaMin: merchant.rows[0].branch_eta_min + travelMinutes,
      locationEstimated: false,deliveryAddressId:String(address.id),quoteId:lockedQuote.quoteId,pricingVersion:lockedQuote.pricingVersion,
      quotedDistanceKm:lockedQuote.distanceKm,zoneId:lockedQuote.zoneId,zoneMultiplier:lockedQuote.zoneMultiplier
    };
    const job = await client.query(
      `INSERT INTO jobs(public_id, kind, customer_id, merchant_id, branch_id, status, pickup_address, pickup_location,
        dropoff_address, dropoff_location, service_level, quoted_amount_cents, final_amount_cents,
        distance_m, estimated_duration_s, payment_method_label, metadata)
       VALUES ($1, 'delivery', $2, $3, $4, 'accepted', $5, $6, $7, $8, 'food', $9, $9, $10, $11, $12, $13)
       RETURNING id,
         ST_Y(pickup_location::geometry) AS pickup_lat,
         ST_X(pickup_location::geometry) AS pickup_lng,
         ST_Y(dropoff_location::geometry) AS dropoff_lat,
         ST_X(dropoff_location::geometry) AS dropoff_lng`,
      [publicId, customer.rows[0].id, merchant.rows[0].id,merchant.rows[0].branch_id, merchant.rows[0].branch_address,
        merchant.rows[0].branch_location, deliveryAddress,address.location,totalCents,Math.round(Number(address.distance_m)),metadata.etaMin * 60,paymentMethod,metadata]
    );
    for (const { entry, item,selection,unitPriceCents } of snapshots) {
      await client.query(
        `INSERT INTO job_items(job_id, catalog_item_id, name, quantity, unit_price_cents, customer_note, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [job.rows[0].id, item.id, item.name, entry.quantity, unitPriceCents, entry.note || null,
          { publicId: item.public_id, extras: selection.modifiers.map(modifier=>modifier.name),modifiers:selection.modifiers,baseUnitPrice:pesos(item.unit_price_cents) }]
      );
    }
    if(promotion)await client.query(`INSERT INTO promotion_redemptions(promotion_id,user_id,job_id,discount_cents) VALUES($1,$2,$3,$4)`,[promotion.id,customer.rows[0].id,job.rows[0].id,discountCents]);
    let paymentStatus = "pending";
    if (String(paymentMethod).toLowerCase().includes("wallet")) {
      const walletAccount = await client.query(
        `SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND currency='ARS' AND account_type='wallet' FOR UPDATE`,
        [customer.rows[0].id]);
      const walletBalance = walletAccount.rows[0] ? await client.query(
        `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint AS balance FROM ledger_entries WHERE account_id=$1`,
        [walletAccount.rows[0].id]) : { rows: [] };
      if (!walletAccount.rows[0] || Number(walletBalance.rows[0]?.balance || 0) < totalCents) {
        throw Object.assign(new Error("Saldo insuficiente en Flash Wallet"), { status: 402 });
      }
      const clearing = await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
        VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL
        DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`);
      const paymentTransaction = await client.query(
        `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata)
         VALUES($1,'payment',$2,$3,$4) RETURNING id`,
        [`payment-${idempotencyKey}`, customer.rows[0].id, `Pago pedido ${publicId}`, { jobPublicId: publicId }]);
      await client.query(`INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
        ($1,$2,'debit',$4,'food_order',$3,$5),($1,$6,'credit',$4,'food_order',$3,$5)`,
        [paymentTransaction.rows[0].id, walletAccount.rows[0].id, job.rows[0].id, totalCents, { jobPublicId: publicId }, clearing.rows[0].id]);
      await client.query(`INSERT INTO payment_intents(job_id,customer_id,provider,status,amount_cents,captured_amount_cents,currency,idempotency_key,provider_payload)
        VALUES($1,$2,'flash_wallet','captured',$3,$3,'ARS',$4,$5)`,
        [job.rows[0].id, customer.rows[0].id, totalCents, `payment-${idempotencyKey}`, { ledgerTransactionId: paymentTransaction.rows[0].id }]);
      paymentStatus = "captured";
    }
    await client.query("INSERT INTO job_events(job_id, actor_id, status) VALUES ($1, $2, 'accepted')", [job.rows[0].id, customer.rows[0].id]);
    await createDispatchOffers(client,{jobId:job.rows[0].id,mode:"delivery"});
    await enqueueNotificationForInternalUser(client,{userId:customer.rows[0].id,template:"order_status",payload:{kind:"food_order",jobId:publicId,status:"accepted"},deduplicationKey:`food_order:${publicId}:accepted`});
    const responseOrder = {
      id: publicId, customerId: customerPublicId, restaurantId: merchantPublicId, courierId: null,
      status: "accepted", deliveryAddress, paymentMethod,
      pickupLocation: { lat: Number(job.rows[0].pickup_lat), lng: Number(job.rows[0].pickup_lng) },
      deliveryLocation: { lat: Number(job.rows[0].dropoff_lat), lng: Number(job.rows[0].dropoff_lng) },
       items: snapshots.map(({ entry, item,selection,unitPriceCents }) => ({ menuItemId: item.public_id, name: item.name,
         quantity: entry.quantity, unitPrice: pesos(unitPriceCents), extras: selection.modifiers.map(modifier=>modifier.name),modifiers:selection.modifiers,note: entry.note || "" })),
      subtotal: metadata.subtotal, deliveryFee: metadata.deliveryFee, serviceFee,
      discount:metadata.discount,promotionCode:metadata.promotionCode,total: pesos(totalCents), etaMin: metadata.etaMin, createdAt: new Date().toISOString(),
      timeline: [{ status: "accepted", at: new Date().toISOString() }], paymentStatus
    };
    await client.query("UPDATE idempotency_keys SET response_status = 200, response_body = $2 WHERE key = $1", [idempotencyKey, { order: responseOrder }]);
    await client.query("COMMIT");
    return responseOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function assignPostgresOrderDriver(orderPublicId, driverPublicId, actorPublicId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query("SELECT id FROM users WHERE public_id = $1", [actorPublicId]);
    const job=await acceptDispatchOffer(client,{jobPublicId:orderPublicId,driverPublicId,actorUserId:actor.rows[0]?.id||null});
    const customer={customer_id:job.customer_id};
    await enqueueNotificationForInternalUser(client,{userId:customer.customer_id,template:"order_status",payload:{kind:"food_order",jobId:orderPublicId,status:"driver_assigned"},deduplicationKey:`food_order:${orderPublicId}:driver_assigned`});
    await client.query("COMMIT");
    return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}

export async function setPostgresOrderStatus(orderPublicId, status, actorPublicId) {
  const client=await postgresPool.connect();
  try{await client.query("BEGIN");
  const actor = await client.query("SELECT id FROM users WHERE public_id = $1", [actorPublicId]);
  const result = await client.query(
    `WITH changed AS (
      UPDATE jobs SET status = $1, version = version + 1, updated_at = now(),
        metadata = CASE WHEN $1::job_status = 'completed' THEN jsonb_set(metadata, '{etaMin}', '0') ELSE metadata END
      WHERE public_id = $2 AND kind = 'delivery' AND status NOT IN ('completed','cancelled')
        AND NOT EXISTS(SELECT 1 FROM order_item_substitutions s WHERE s.job_id=jobs.id AND s.status='pending') RETURNING id,customer_id
    ) INSERT INTO job_events(job_id, actor_id, status) SELECT id, $3, $1 FROM changed RETURNING job_id`,
    [databaseStatus(status), orderPublicId, actor.rows[0]?.id || null]
  );
  if (!result.rows[0]) throw Object.assign(new Error("El pedido no puede cambiar de estado"), { status: 409 });
  const customer=(await client.query("SELECT customer_id FROM jobs WHERE public_id=$1",[orderPublicId])).rows[0];
  if(databaseStatus(status)==="completed")await settleCapturedFoodOrder(client,{jobId:result.rows[0].job_id,actorId:actor.rows[0]?.id||null});
  await enqueueNotificationForInternalUser(client,{userId:customer.customer_id,template:"order_status",payload:{kind:"food_order",jobId:orderPublicId,status},deduplicationKey:`food_order:${orderPublicId}:${status}`});
  await client.query("COMMIT");
  return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function getPostgresCart(customerPublicId) {
  const result = await postgresPool.query(`
    SELECT merchant.public_id AS restaurant_id, catalog.public_id AS item_public_id,
      catalog.name, catalog.description, catalog.category, catalog.unit_price_cents,
      catalog.available, catalog.metadata, item.quantity,item.unit_price_snapshot_cents selected_unit_price_cents, item.options, item.note
    FROM carts cart
    JOIN users customer ON customer.id = cart.customer_id
    JOIN merchants merchant ON merchant.id = cart.merchant_id
    JOIN cart_items item ON item.cart_id = cart.id
    JOIN catalog_items catalog ON catalog.id = item.catalog_item_id
    WHERE customer.public_id = $1 AND cart.status = 'active' AND cart.expires_at > now()
    ORDER BY item.id`, [customerPublicId]);
  return result.rows.map((row) => ({
    restaurantId: row.restaurant_id,
    item: {...mapCatalogItem(row),price:pesos(row.selected_unit_price_cents)},
    quantity: row.quantity,
    extras: Array.isArray(row.options) ? row.options : [],
    note: row.note || ""
  }));
}

export async function replacePostgresCart(customerPublicId, merchantPublicId, lines) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query("SELECT id FROM users WHERE public_id = $1", [customerPublicId]);
    if (!customer.rows[0]) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
    if (!lines.length) {
      await client.query("UPDATE carts SET status = 'abandoned', updated_at = now() WHERE customer_id = $1 AND status = 'active'", [customer.rows[0].id]);
      await client.query("COMMIT");
      return [];
    }
    const merchant = await client.query("SELECT id FROM merchants WHERE public_id = $1 AND status = 'active'", [merchantPublicId]);
    if (!merchant.rows[0]) throw Object.assign(new Error("Comercio no encontrado"), { status: 404 });
    await client.query("UPDATE carts SET status = 'abandoned', updated_at = now() WHERE customer_id = $1 AND status = 'active' AND merchant_id <> $2", [customer.rows[0].id, merchant.rows[0].id]);
    const cart = await client.query(
      `INSERT INTO carts(customer_id, merchant_id) VALUES ($1, $2)
       ON CONFLICT (customer_id, merchant_id) WHERE status = 'active'
       DO UPDATE SET version = carts.version + 1, expires_at = now() + interval '7 days', updated_at = now()
       RETURNING id`, [customer.rows[0].id, merchant.rows[0].id]);
    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cart.rows[0].id]);
    for (const line of lines) {
       const item = await client.query(`SELECT c.id,c.unit_price_cents FROM catalog_items c WHERE c.public_id=$1 AND c.merchant_id=$2 AND c.available AND EXISTS(SELECT 1 FROM merchant_branches b JOIN catalog_branch_inventory i ON i.branch_id=b.id AND i.catalog_item_id=c.id WHERE b.merchant_id=c.merchant_id AND b.is_primary AND b.status='active' AND b.open AND app.branch_is_scheduled_open(b.id,now()) AND i.available AND COALESCE(i.stock_quantity,1)>0)`, [line.menuItemId, merchant.rows[0].id]);
      if (!item.rows[0]) throw Object.assign(new Error("Uno de los productos ya no está disponible"), { status: 409 });
       const selection=await resolveModifierSelection(client,{catalogItemId:item.rows[0].id,selectedIds:line.extras||[]});await client.query(
        `INSERT INTO cart_items(cart_id, catalog_item_id, quantity, unit_price_snapshot_cents, options, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cart.rows[0].id, item.rows[0].id, line.quantity,Number(item.rows[0].unit_price_cents)+selection.priceCents, JSON.stringify(line.extras || []), line.note || null]
      );
    }
    await client.query("COMMIT");
    return getPostgresCart(customerPublicId);
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}

export async function reorderPostgresOrder({customerPublicId,orderPublicId}){const result=await postgresPool.query(`SELECT m.public_id restaurant_id,ji.quantity,ji.customer_note,COALESCE(ji.metadata->>'publicId',c.public_id) menu_item_id,COALESCE(ji.metadata->'modifiers','[]') modifiers FROM jobs j JOIN users u ON u.id=j.customer_id JOIN merchants m ON m.id=j.merchant_id JOIN job_items ji ON ji.job_id=j.id LEFT JOIN catalog_items c ON c.id=ji.catalog_item_id WHERE j.public_id=$1 AND u.public_id=$2 AND j.kind='delivery' AND j.metadata->>'subtype'='food_order' ORDER BY ji.id`,[orderPublicId,customerPublicId]);if(!result.rowCount)throw Object.assign(new Error("Pedido no encontrado"),{status:404});const restaurantId=result.rows[0].restaurant_id,lines=result.rows.map(row=>({menuItemId:row.menu_item_id,quantity:Number(row.quantity),extras:(Array.isArray(row.modifiers)?row.modifiers:[]).map(modifier=>modifier.id).filter(Boolean),note:row.customer_note||""}));const cart=await replacePostgresCart(customerPublicId,restaurantId,lines);return{sourceOrderId:orderPublicId,restaurantId,cart};}

export async function getPostgresDrivers({ userPublicId = null, publicIds = null } = {}) {
  const result = await postgresPool.query(`
    SELECT d.*, u.public_id AS user_public_id,(SELECT round(avg(r.score),2) FROM ratings r WHERE r.subject_type='driver' AND r.subject_id=d.id) AS feedback_rating,
      v.model vehicle_model,v.plate vehicle_plate,v.kind vehicle_kind,v.status vehicle_status,
      ST_Y(d.current_location::geometry) AS lat, ST_X(d.current_location::geometry) AS lng
    FROM drivers d JOIN users u ON u.id = d.user_id
    LEFT JOIN vehicles v ON v.driver_id=d.id AND v.active AND v.retired_at IS NULL
    WHERE ($1::text IS NULL OR u.public_id = $1)
      AND ($2::text[] IS NULL OR d.public_id=ANY($2::text[]))
    ORDER BY d.created_at
  `, [userPublicId,publicIds]);
  return result.rows.map((row) => {
    const serviceModes = Array.isArray(row.service_modes)
      ? row.service_modes
      : String(row.service_modes || "").replace(/^\{|\}$/g, "").split(",").filter(Boolean);
    return ({
    id: row.public_id,
    userId: row.user_public_id,
    name: row.metadata?.name || row.public_id,
    online: row.online,
    serviceModes: serviceModes.map((mode) => mode === "delivery" ? "delivery" : "ride"),
    activeService: row.active_mode === "ride" ? "ride" : "delivery",
    vehicle: row.vehicle_model || "Sin vehículo activo",
    plate: row.vehicle_plate || "",
    vehicleKind: row.vehicle_kind || null,
    vehicleStatus: row.vehicle_status || null,
    rating: Number(row.feedback_rating??row.rating),
    location: { lat: Number(row.lat), lng: Number(row.lng), label: row.metadata?.locationLabel || "GPS", updatedAt: row.location_updated_at, source:row.location_source||null, accuracyM:row.location_accuracy_m==null?null:Number(row.location_accuracy_m) },
    earningsToday: Number(row.metadata?.earningsToday || 0)
    });
  });
}

export async function getPostgresDriverForUser(userPublicId) {
  return (await getPostgresDrivers({ userPublicId }))[0] || null;
}

export async function getPostgresOperationsDriverPage({limit=50,cursor=null,query=""}={}){
  const page=await postgresPool.query(`SELECT d.id,d.public_id,to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at FROM drivers d WHERE ($1='' OR d.public_id ILIKE '%'||$1||'%' OR d.metadata->>'name' ILIKE '%'||$1||'%') AND ($2::timestamptz IS NULL OR (d.created_at,d.id)>($2::timestamptz,$3::uuid)) ORDER BY d.created_at,d.id LIMIT $4`,[query.trim(),cursor?.createdAt||null,cursor?.id||null,limit+1]);
  const hasMore=page.rows.length>limit,rows=page.rows.slice(0,limit),drivers=await getPostgresDrivers({publicIds:rows.map(row=>row.public_id)}),byId=new Map(drivers.map(item=>[item.id,item])),last=rows.at(-1);
  return{drivers:rows.map(row=>byId.get(row.public_id)).filter(Boolean),nextCursor:hasMore&&last?Buffer.from(JSON.stringify({createdAt:last.cursor_created_at,id:last.id})).toString("base64url"):null};
}

export async function updatePostgresDriver(publicId, changes) {
  const fields = [];
  const values = [];
  if (typeof changes.online === "boolean") { values.push(changes.online); fields.push(`online = $${values.length}`); }
  if (["delivery", "ride"].includes(changes.activeService)) {
    values.push(changes.activeService); fields.push(`active_mode = $${values.length}::job_kind`);
  }
  if (Number.isFinite(changes.lat) && Number.isFinite(changes.lng)) {
    values.push(changes.lng, changes.lat);
    fields.push(`current_location = ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}), 4326)::geography`, "location_updated_at = now()");
    if (changes.label) { values.push(changes.label); fields.push(`metadata = jsonb_set(metadata, '{locationLabel}', to_jsonb($${values.length}::text), true)`); }
    if (["foreground","background"].includes(changes.source)) { values.push(changes.source); fields.push(`location_source = $${values.length}`); }
    if (Number.isFinite(changes.accuracyM)) { values.push(changes.accuracyM); fields.push(`location_accuracy_m = $${values.length}`); }
  }
  if (fields.length) { values.push(publicId); await postgresPool.query(`UPDATE drivers SET ${fields.join(", ")} WHERE public_id = $${values.length}`, values); }
  return (await getPostgresDrivers()).find((driver) => driver.id === publicId) || null;
}
