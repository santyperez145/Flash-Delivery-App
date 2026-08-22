import { createPool } from "./db-client.mjs";

const fixtures=[
  {userId:"usr_customer",label:"Casa",address:"Defensa 982, San Telmo",lat:-34.6177,lng:-58.3621,isDefault:true}
];

const pool=createPool();
const client=await pool.connect();
try{
  await client.query("BEGIN");
  for(const fixture of fixtures){
    const user=(await client.query("SELECT id FROM users WHERE public_id=$1",[fixture.userId])).rows[0];
    if(!user)continue;
    const existing=(await client.query("SELECT id FROM addresses WHERE user_id=$1 AND formatted_address=$2",[user.id,fixture.address])).rows[0];
    if(fixture.isDefault)await client.query("UPDATE addresses SET is_default=false,updated_at=now() WHERE user_id=$1 AND is_default",[user.id]);
    if(existing)await client.query(`UPDATE addresses SET label=$2,location=ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,is_default=$5,updated_at=now() WHERE id=$1`,[existing.id,fixture.label,fixture.lat,fixture.lng,fixture.isDefault]);
    else await client.query(`INSERT INTO addresses(user_id,label,formatted_address,location,is_default) VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,$6)`,[user.id,fixture.label,fixture.address,fixture.lat,fixture.lng,fixture.isDefault]);
    if(fixture.isDefault)await client.query("UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE id=$1",[user.id,fixture.address]);
    await client.query(`UPDATE jobs j SET dropoff_address=a.formatted_address,dropoff_location=a.location,distance_m=round(ST_Distance(m.location,a.location)),
      estimated_duration_s=(m.eta_min+greatest(8,ceil(ST_Distance(m.location,a.location)/350)))::int*60,
      metadata=jsonb_set(jsonb_set(jsonb_set(j.metadata,'{locationEstimated}','false'::jsonb,true),'{deliveryAddressId}',to_jsonb(a.id::text),true),'{etaMin}',to_jsonb((m.eta_min+greatest(8,ceil(ST_Distance(m.location,a.location)/350)))::int),true),updated_at=now()
      FROM merchants m,addresses a WHERE j.customer_id=$1 AND j.merchant_id=m.id AND a.user_id=$1 AND a.is_default
        AND j.kind='delivery' AND j.metadata->>'subtype'='food_order'`,[user.id]);
  }
  await client.query("COMMIT");
  console.log(`seeded ${fixtures.length} geocoded address fixture(s)`);
}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();await pool.end();}
