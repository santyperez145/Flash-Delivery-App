import { createPool } from "./db-client.mjs";
import { readDb } from "../server/store.js";

const pool = createPool();
const state = readDb();
const client = await pool.connect();
const cents = (value) => Math.round(Number(value || 0) * 100);

try {
  await client.query("BEGIN");
  for (const ride of state.rides || []) {
    const customer = (await client.query("SELECT id FROM users WHERE public_id=$1", [ride.customerId])).rows[0];
    const driver = ride.driverId ? (await client.query("SELECT id FROM drivers WHERE public_id=$1", [ride.driverId])).rows[0] : null;
    if (!customer) continue;
    const pickup = ride.pickupLocation || { lat: -34.6177, lng: -58.3621 };
    const dropoff = ride.destinationLocation || { lat: -34.5596, lng: -58.4156 };
    const inserted = await client.query(
      `INSERT INTO jobs(public_id,kind,customer_id,driver_id,status,pickup_address,pickup_location,
       dropoff_address,dropoff_location,service_level,quoted_amount_cents,final_amount_cents,currency,
       distance_m,estimated_duration_s,payment_method_label,metadata,created_at)
       VALUES($1,'ride',$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,
       $8,ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,$11,$12,$12,'ARS',$13,$14,$15,$16,$17)
       ON CONFLICT(public_id) DO UPDATE SET driver_id=EXCLUDED.driver_id,status=EXCLUDED.status,
       final_amount_cents=EXCLUDED.final_amount_cents,metadata=EXCLUDED.metadata RETURNING id`,
      [ride.id,customer.id,driver?.id||null,ride.status,ride.pickup,pickup.lng,pickup.lat,ride.destination,
       dropoff.lng,dropoff.lat,ride.service,cents(ride.fare),Math.round(ride.distanceKm*1000),ride.durationMin*60,
       ride.paymentMethod,{etaMin:ride.etaMin,subtype:"passenger_ride"},ride.createdAt]
    );
    await client.query("DELETE FROM job_events WHERE job_id=$1",[inserted.rows[0].id]);
    for(const event of ride.timeline||[]) await client.query("INSERT INTO job_events(job_id,status,occurred_at) VALUES($1,$2,$3)",[inserted.rows[0].id,event.status,event.at]);
  }
  await client.query("COMMIT");
  console.log(`seeded ${(state.rides||[]).length} rides into PostgreSQL`);
} catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();await pool.end();}

