import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

const offerId=()=>`OFR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

export async function createDispatchOffers(client,{jobId,mode,limit=3,ttlSeconds=45}){
  const candidates=await client.query(`SELECT d.id,d.user_id,j.public_id job_public_id,j.kind,j.metadata,
      ST_Distance(d.current_location,j.pickup_location) distance_m,
      d.rating*20 rating_points,
      LEAST(ST_Distance(d.current_location,j.pickup_location)/250,40) distance_penalty,
      active_jobs.count*15 load_penalty,
      CASE WHEN d.location_updated_at<now()-interval '5 minutes' THEN 25 ELSE 0 END freshness_penalty,
      (COALESCE(history.acceptance_rate,.5)-.5)*20 acceptance_points,
      GREATEST(-10,LEAST(10,(20-COALESCE(history.response_seconds,20))/2)) response_points,
      COALESCE(history.acceptance_rate,.5) acceptance_rate,
      COALESCE(history.response_seconds,20) average_response_seconds,
      (d.rating*20)-LEAST(ST_Distance(d.current_location,j.pickup_location)/250,40)-(active_jobs.count*15)
        -CASE WHEN d.location_updated_at<now()-interval '5 minutes' THEN 25 ELSE 0 END
        +(COALESCE(history.acceptance_rate,.5)-.5)*20
        +GREATEST(-10,LEAST(10,(20-COALESCE(history.response_seconds,20))/2)) score
    FROM jobs j JOIN drivers d ON d.online AND $2::job_kind=ANY(d.service_modes) AND d.current_location IS NOT NULL
    JOIN vehicles vehicle ON vehicle.driver_id=d.id AND vehicle.active AND vehicle.retired_at IS NULL AND vehicle.status='approved' AND $2::job_kind=ANY(vehicle.service_modes)
    CROSS JOIN LATERAL(SELECT count(*)::numeric count FROM jobs active WHERE active.driver_id=d.id AND active.status NOT IN('completed','cancelled')) active_jobs
    LEFT JOIN LATERAL(SELECT
      count(*) FILTER(WHERE prior.status='accepted')::numeric/NULLIF(count(*) FILTER(WHERE prior.status IN('accepted','rejected','expired')),0) acceptance_rate,
      avg(EXTRACT(epoch FROM(prior.responded_at-prior.created_at))) FILTER(WHERE prior.responded_at IS NOT NULL AND prior.status IN('accepted','rejected')) response_seconds
      FROM dispatch_offers prior JOIN jobs prior_job ON prior_job.id=prior.job_id
      WHERE prior.driver_id=d.id AND prior_job.kind=$2::job_kind AND prior.created_at>=now()-interval '30 days') history ON true
    WHERE j.id=$1 AND d.location_updated_at>=now()-interval '10 minutes' AND (d.location_accuracy_m IS NULL OR d.location_accuracy_m<=200)
      AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes') AND NOT EXISTS(SELECT 1 FROM dispatch_offers prior WHERE prior.job_id=j.id AND prior.driver_id=d.id)
      AND (($2::job_kind='ride' AND NOT EXISTS(SELECT 1 FROM jobs active WHERE active.driver_id=d.id AND active.kind='ride' AND active.status NOT IN('completed','cancelled')))
        OR ($2::job_kind='delivery' AND (SELECT count(*) FROM jobs active WHERE active.driver_id=d.id AND active.kind='delivery' AND active.status NOT IN('completed','cancelled'))<2))
    ORDER BY score DESC, distance_m ASC LIMIT $3`,[jobId,mode,limit]);
  const offers=[];
  for(const candidate of candidates.rows){const scoreBreakdown={rating:Number(candidate.rating_points),distancePenalty:Number(candidate.distance_penalty),loadPenalty:Number(candidate.load_penalty),freshnessPenalty:Number(candidate.freshness_penalty),acceptancePoints:Number(candidate.acceptance_points),responsePoints:Number(candidate.response_points),acceptanceRate:Number(candidate.acceptance_rate),averageResponseSeconds:Number(candidate.average_response_seconds)};const row=(await client.query(`INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,expires_at,score_breakdown)
      VALUES($1,$2,$3,$4,now()+($5*interval '1 second'),$6)
      ON CONFLICT(job_id,driver_id) DO NOTHING RETURNING public_id,expires_at`,
    [offerId(),jobId,candidate.id,candidate.score,ttlSeconds,scoreBreakdown])).rows[0];if(row){offers.push(row.public_id);await enqueueNotificationForInternalUser(client,{userId:candidate.user_id,template:"dispatch_offer",payload:{offerId:row.public_id,jobId:candidate.job_public_id,kind:candidate.kind,subtype:candidate.metadata?.subtype||null,expiresAt:row.expires_at,score:Number(candidate.score),scoreBreakdown},deduplicationKey:`dispatch_offer:${row.public_id}`});}}
  return offers;
}

export async function processPostgresDispatchBatch({limit=20,offerLimit=3,ttlSeconds=45}={}){
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const expired=(await client.query("UPDATE dispatch_offers SET status='expired',responded_at=now() WHERE status='pending' AND expires_at<=now() RETURNING id")).rowCount;
    const jobs=(await client.query(`SELECT j.id,j.public_id,j.kind,COALESCE((j.metadata->>'dispatchRound')::int,0) dispatch_round
      FROM jobs j WHERE j.driver_id IS NULL AND j.status NOT IN('completed','cancelled') AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes')
        AND NOT EXISTS(SELECT 1 FROM dispatch_offers o WHERE o.job_id=j.id AND o.status='pending' AND o.expires_at>now())
        AND COALESCE((j.metadata->>'dispatchNextAttemptAt')::timestamptz,'epoch')<=now()
      ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT $1`,[limit])).rows;
    let offered=0,exhausted=0;for(const job of jobs){const offers=await createDispatchOffers(client,{jobId:job.id,mode:job.kind,limit:offerLimit,ttlSeconds});offered+=offers.length;if(!offers.length)exhausted+=1;
      const nextAttempt=new Date(Date.now()+(offers.length?ttlSeconds*1000+1000:300000)).toISOString();
      await client.query(`UPDATE jobs SET metadata=jsonb_set(jsonb_set(metadata,'{dispatchRound}',to_jsonb($2::int),true),'{dispatchNextAttemptAt}',to_jsonb($3::text),true),updated_at=now() WHERE id=$1`,[job.id,job.dispatch_round+1,nextAttempt]);}
    await client.query("COMMIT");return{claimed:jobs.length,expired,offered,exhausted};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function getPostgresDispatchOffers(driverPublicId){
  await postgresPool.query("UPDATE dispatch_offers SET status='expired',responded_at=now() WHERE status='pending' AND expires_at<=now()");
  const result=await postgresPool.query(`SELECT o.public_id,j.public_id job_id,j.kind,j.service_level,j.pickup_address,j.dropoff_address,
      j.quoted_amount_cents,j.distance_m,j.estimated_duration_s,j.metadata,o.score,o.score_breakdown,o.expires_at,o.status
    FROM dispatch_offers o JOIN drivers d ON d.id=o.driver_id JOIN jobs j ON j.id=o.job_id
    WHERE d.public_id=$1 AND o.status='pending' AND o.expires_at>now() AND j.driver_id IS NULL AND j.status NOT IN('completed','cancelled') AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes')
    ORDER BY o.score DESC,o.expires_at LIMIT 50`,[driverPublicId]);
  return result.rows.map(row=>({id:row.public_id,jobId:row.job_id,kind:row.kind,serviceLevel:row.service_level,pickup:row.pickup_address,destination:row.dropoff_address,
    fare:Number(row.quoted_amount_cents)/100,distanceKm:Number((row.distance_m/1000).toFixed(1)),durationMin:Math.ceil(row.estimated_duration_s/60),score:Number(row.score),scoreBreakdown:row.score_breakdown||{},expiresAt:new Date(row.expires_at).toISOString(),status:row.status,subtype:row.metadata?.subtype||null}));
}

export async function rejectPostgresDispatchOffer({driverPublicId,offerPublicId}){
  const result=await postgresPool.query(`UPDATE dispatch_offers o SET status='rejected',responded_at=now() FROM drivers d
    WHERE o.driver_id=d.id AND d.public_id=$1 AND o.public_id=$2 AND o.status='pending' AND o.expires_at>now() RETURNING o.public_id`,[driverPublicId,offerPublicId]);
  if(!result.rows[0])throw Object.assign(new Error("La oferta no existe o ya venció"),{status:409});
  return result.rows[0].public_id;
}

export async function acceptDispatchOffer(client,{jobPublicId,driverPublicId,actorUserId,status="driver_assigned"}){
  const offer=(await client.query(`SELECT o.id,o.job_id,o.driver_id,j.kind FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id JOIN drivers d ON d.id=o.driver_id
    WHERE j.public_id=$1 AND d.public_id=$2 AND o.status='pending' AND o.expires_at>now() AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes') FOR UPDATE OF o`,[jobPublicId,driverPublicId])).rows[0];
  if(!offer)throw Object.assign(new Error("La oferta no existe o venció"),{status:409});
  await client.query("SELECT id FROM drivers WHERE id=$1 FOR UPDATE",[offer.driver_id]);const active=Number((await client.query("SELECT count(*)::int count FROM jobs WHERE driver_id=$1 AND kind=$2 AND status NOT IN('completed','cancelled')",[offer.driver_id,offer.kind])).rows[0].count);if((offer.kind==="ride"&&active>0)||(offer.kind==="delivery"&&active>=2))throw Object.assign(new Error("El conductor alcanzó su capacidad activa"),{status:409});
  const changed=(await client.query(`UPDATE jobs SET driver_id=$1,status=$2,version=version+1,updated_at=now()
    WHERE id=$3 AND driver_id IS NULL AND status NOT IN('completed','cancelled') RETURNING id,customer_id`,[offer.driver_id,status,offer.job_id])).rows[0];
  if(!changed)throw Object.assign(new Error("El servicio ya fue tomado"),{status:409});
  await client.query("UPDATE dispatch_offers SET status='accepted',responded_at=now() WHERE id=$1",[offer.id]);
  await client.query("UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE job_id=$1 AND id<>$2 AND status='pending'",[offer.job_id,offer.id]);
  await client.query("INSERT INTO job_events(job_id,actor_id,status,payload) VALUES($1,$2,$3,$4)",[offer.job_id,actorUserId,status,{offerId:offer.id}]);
  return changed;
}
