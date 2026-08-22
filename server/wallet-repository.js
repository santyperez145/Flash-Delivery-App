import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

const clearingAccount = async client => (await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
  VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT (owner_type,currency,account_type) WHERE owner_id IS NULL DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`)).rows[0].id;
const userAccount = async (client,userId) => (await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
  VALUES('user',$1,'ARS','wallet') ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`,[userId])).rows[0].id;

export async function captureWalletPayment(client,{jobId,customerId,amountCents,idempotencyKey,description,metadata={}}){
  const wallet=await userAccount(client,customerId);
  await client.query("SELECT id FROM ledger_accounts WHERE id=$1 FOR UPDATE",[wallet]);
  const balance=Number((await client.query(`SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint balance FROM ledger_entries WHERE account_id=$1`,[wallet])).rows[0].balance);
  if(balance<amountCents)throw Object.assign(new Error("Saldo insuficiente en Flash Wallet"),{status:402});
  const clearing=await clearingAccount(client);
  const transaction=(await client.query(`INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata)
    VALUES($1,'payment',$2,$3,$4) RETURNING id`,[`payment-${idempotencyKey}`,customerId,description,metadata])).rows[0];
  await client.query(`INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
    ($1,$2,'debit',$4,'payment',$3,$5),($1,$6,'credit',$4,'payment',$3,$5)`,[transaction.id,wallet,jobId,amountCents,metadata,clearing]);
  await client.query(`INSERT INTO payment_intents(job_id,customer_id,provider,status,amount_cents,captured_amount_cents,currency,idempotency_key,provider_payload)
    VALUES($1,$2,'flash_wallet','captured',$3,$3,'ARS',$4,$5)`,[jobId,customerId,amountCents,`wallet-${idempotencyKey}`,metadata]);
}

export async function getWallet(publicUserId){
  const user=(await postgresPool.query("SELECT id FROM users WHERE public_id=$1",[publicUserId])).rows[0];if(!user)return null;
  const account=(await postgresPool.query("SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND currency='ARS' AND account_type='wallet'",[user.id])).rows[0];
  if(!account)return {balance:0,transactions:[]};
  const balance=await postgresPool.query(`SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint balance FROM ledger_entries WHERE account_id=$1`,[account.id]);
  const history=await postgresPool.query(`SELECT t.id,t.kind,t.description,t.created_at,e.direction,e.amount_cents,t.metadata FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE e.account_id=$1 AND t.status='posted' ORDER BY t.created_at DESC LIMIT 100`,[account.id]);
  return {balance:Number(balance.rows[0].balance)/100,transactions:history.rows.map(row=>({id:row.id,userId:publicUserId,kind:row.direction,amount:Number(row.amount_cents)/100,description:row.description,createdAt:new Date(row.created_at).toISOString(),metadata:row.metadata}))};
}

export async function getWalletBalances(){const result=await postgresPool.query(`SELECT u.public_id,COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance
  FROM users u LEFT JOIN ledger_accounts a ON a.owner_type='user' AND a.owner_id=u.id AND a.account_type='wallet' LEFT JOIN ledger_entries e ON e.account_id=a.id GROUP BY u.public_id`);
  return new Map(result.rows.map(row=>[row.public_id,Number(row.balance)/100]));}

export async function getPostgresWalletTransactions({userPublicId,includeAll=false}){const result=await postgresPool.query(`SELECT t.id::text,u.public_id user_id,t.kind,t.description,t.created_at,e.direction,e.amount_cents,t.metadata FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id JOIN ledger_accounts a ON a.id=e.account_id JOIN users u ON u.id=a.owner_id WHERE a.owner_type='user' AND a.account_type='wallet' AND ($2::boolean OR u.public_id=$1) AND t.status='posted' ORDER BY t.created_at DESC LIMIT 500`,[userPublicId,includeAll]);return result.rows.map(row=>({id:row.id,userId:row.user_id,kind:row.direction,transactionKind:row.kind,amount:Number(row.amount_cents)/100,description:row.description,createdAt:new Date(row.created_at).toISOString(),metadata:row.metadata}));}

export async function creditWallet({publicUserId,amount,idempotencyKey,kind,description,metadata={}}){const client=await postgresPool.connect();try{await client.query("BEGIN");
  const user=(await client.query("SELECT id FROM users WHERE public_id=$1",[publicUserId])).rows[0];if(!user)throw Object.assign(new Error("Usuario no encontrado"),{status:404});
  const transaction=await client.query(`INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,[idempotencyKey,kind,user.id,description,metadata]);
  if(!transaction.rows[0]){await client.query("ROLLBACK");return getWallet(publicUserId);}
  const wallet=await userAccount(client,user.id),clearing=await clearingAccount(client),amountCents=Math.round(amount*100);
  await client.query(`INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
    ($1,$2,'credit',$4,$5,$3,$6),($1,$7,'debit',$4,$5,$3,$6)`,[transaction.rows[0].id,wallet,user.id,amountCents,kind,metadata,clearing]);
  await client.query("COMMIT");return getWallet(publicUserId);
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function settleMobilityWalletPayment({publicId,driverPublicId,driverAmount,reference}){const client=await postgresPool.connect();try{await client.query("BEGIN");
  const job=(await client.query("SELECT j.id,j.kind,j.driver_id,d.user_id driver_user_id FROM jobs j JOIN drivers d ON d.id=j.driver_id WHERE j.public_id=$1 AND d.public_id=$2 AND j.status='completed' FOR UPDATE OF j",[publicId,driverPublicId])).rows[0];if(!job)throw Object.assign(new Error("Servicio completado no encontrado para liquidar"),{status:409});
  const payment=(await client.query("SELECT id,captured_amount_cents FROM payment_intents WHERE job_id=$1 AND provider='flash_wallet' AND status='captured' FOR UPDATE",[job.id])).rows[0];if(!payment){await client.query("ROLLBACK");return{settled:false,reason:"payment_not_captured"};}
  const total=Number(payment.captured_amount_cents),driverCents=Math.min(total,Math.max(0,Math.round(driverAmount*100))),platformCents=total-driverCents;
  const transaction=(await client.query(`INSERT INTO ledger_transactions(idempotency_key,kind,description,metadata) VALUES($1,'driver_earning',$2,$3) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,[`driver-earning-${reference}`,`Liquidación ${publicId}`,{publicId,driverCents,platformCents}])).rows[0];if(!transaction){await client.query("ROLLBACK");return{settled:true,duplicate:true,driverAmount:driverCents/100,platformAmount:platformCents/100};}
  const driverWallet=await userAccount(client,job.driver_user_id),clearing=await clearingAccount(client),revenue=(await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('platform',NULL,'ARS','revenue') ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL DO UPDATE SET owner_type=excluded.owner_type RETURNING id`)).rows[0].id;
  await client.query("SELECT id FROM ledger_accounts WHERE id=ANY($1) ORDER BY id FOR UPDATE",[[driverWallet,clearing,revenue]]);
  await client.query(`INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'debit',$3,'mobility_settlement',$4,$5),($1,$6,'credit',$7,'mobility_settlement',$4,$5),($1,$8,'credit',$9,'mobility_settlement',$4,$5)`,[transaction.id,clearing,total,job.id,{publicId,driverCents,platformCents},driverWallet,driverCents,revenue,platformCents]);
  await client.query("COMMIT");return{settled:true,driverAmount:driverCents/100,platformAmount:platformCents/100};
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function cancelOrderAndRefundWallet({orderPublicId,actorPublicId,reason="changed_mind",reasonDetail=null}){const client=await postgresPool.connect();try{await client.query("BEGIN");
  const actor=(await client.query("SELECT id FROM users WHERE public_id=$1",[actorPublicId])).rows[0];
  const job=(await client.query(`UPDATE jobs SET status='cancelled',version=version+1,updated_at=now() WHERE public_id=$1 AND kind='delivery' AND metadata->>'subtype'='food_order' AND status NOT IN('completed','cancelled') RETURNING id,customer_id`,[orderPublicId])).rows[0];
  if(!job)throw Object.assign(new Error("El pedido no puede cancelarse"),{status:409});
  await client.query("INSERT INTO job_events(job_id,actor_id,status,payload) VALUES($1,$2,'cancelled',$3)",[job.id,actor?.id||null,{reason}]);
  await client.query("UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE job_id=$1 AND status='pending'",[job.id]);
  const payment=(await client.query("SELECT * FROM payment_intents WHERE job_id=$1 AND provider='flash_wallet' AND status='captured' FOR UPDATE",[job.id])).rows[0];
  if(payment){const wallet=(await client.query("SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND account_type='wallet' FOR UPDATE",[job.customer_id])).rows[0];
    const clearing=(await client.query("SELECT id FROM ledger_accounts WHERE owner_type='platform' AND owner_id IS NULL AND account_type='cash_clearing' FOR UPDATE")).rows[0];
    const transaction=(await client.query(`INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'refund',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,[`refund-${orderPublicId}`,actor?.id||null,`Reintegro pedido ${orderPublicId}`,{orderPublicId,reason}])).rows[0];
    if(transaction){await client.query(`INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
      ($1,$2,'credit',$4,'refund',$3,$5),($1,$6,'debit',$4,'refund',$3,$5)`,[transaction.id,wallet.id,payment.id,payment.captured_amount_cents,{orderPublicId,reason},clearing.id]);
      await client.query(`INSERT INTO refunds(payment_intent_id,requested_by,amount_cents,reason,status,resolved_at) VALUES($1,$2,$3,$4,'succeeded',now())`,[payment.id,actor?.id||null,payment.captured_amount_cents,reason]);}
    await client.query("UPDATE payment_intents SET status='refunded',captured_amount_cents=0,updated_at=now() WHERE id=$1",[payment.id]);}
  const refundAmount=Number(payment?.captured_amount_cents||0);const cancellation=(await client.query(`INSERT INTO job_cancellations(public_id,job_id,actor_id,reason_code,reason_detail,refund_amount_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING public_id`,[`CAN-${crypto.randomUUID()}`,job.id,actor?.id||null,reason,reasonDetail,refundAmount])).rows[0];
  await enqueueNotificationForInternalUser(client,{userId:job.customer_id,template:"order_status",payload:{kind:"food_order",jobId:orderPublicId,status:"cancelled",refunded:Boolean(payment)},deduplicationKey:`food_order:${orderPublicId}:cancelled`});
  await client.query("COMMIT");return {id:cancellation.public_id,refunded:Boolean(payment),refundAmount:refundAmount/100,reason};
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function cancelMobilityJobAndRefundWallet({publicId,kind,actorPublicId,reason="changed_mind",reasonDetail=null}){const client=await postgresPool.connect();try{await client.query("BEGIN");
  const actor=(await client.query("SELECT id FROM users WHERE public_id=$1",[actorPublicId])).rows[0];
  const job=(await client.query(`UPDATE jobs SET status='cancelled',version=version+1,updated_at=now()
    WHERE public_id=$1 AND kind=$2 AND status NOT IN('completed','cancelled') RETURNING id,customer_id`,[publicId,kind])).rows[0];
  if(!job)throw Object.assign(new Error("El servicio no puede cancelarse"),{status:409});
  await client.query("INSERT INTO job_events(job_id,actor_id,status,payload) VALUES($1,$2,'cancelled',$3)",[job.id,actor?.id||null,{reason}]);
  await client.query("UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE job_id=$1 AND status='pending'",[job.id]);
  const payment=(await client.query("SELECT * FROM payment_intents WHERE job_id=$1 AND provider='flash_wallet' AND status='captured' FOR UPDATE",[job.id])).rows[0];
  if(payment){const wallet=(await client.query("SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND account_type='wallet' FOR UPDATE",[job.customer_id])).rows[0];
    const clearing=(await client.query("SELECT id FROM ledger_accounts WHERE owner_type='platform' AND owner_id IS NULL AND account_type='cash_clearing' FOR UPDATE")).rows[0];
    const transaction=(await client.query(`INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'refund',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,[`refund-${publicId}`,actor?.id||null,`Reintegro servicio ${publicId}`,{publicId,kind,reason}])).rows[0];
    if(transaction){await client.query(`INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
      ($1,$2,'credit',$4,'refund',$3,$5),($1,$6,'debit',$4,'refund',$3,$5)`,[transaction.id,wallet.id,payment.id,payment.captured_amount_cents,{publicId,kind,reason},clearing.id]);
      await client.query(`INSERT INTO refunds(payment_intent_id,requested_by,amount_cents,reason,status,resolved_at) VALUES($1,$2,$3,$4,'succeeded',now())`,[payment.id,actor?.id||null,payment.captured_amount_cents,reason]);}
    await client.query("UPDATE payment_intents SET status='refunded',captured_amount_cents=0,updated_at=now() WHERE id=$1",[payment.id]);}
  const refundAmount=Number(payment?.captured_amount_cents||0);const cancellation=(await client.query(`INSERT INTO job_cancellations(public_id,job_id,actor_id,reason_code,reason_detail,refund_amount_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING public_id`,[`CAN-${crypto.randomUUID()}`,job.id,actor?.id||null,reason,reasonDetail,refundAmount])).rows[0];
  const subtype=kind==="ride"?"ride":"shipment";
  await enqueueNotificationForInternalUser(client,{userId:job.customer_id,template:`${subtype}_status`,payload:{kind:subtype,jobId:publicId,status:"cancelled",refunded:Boolean(payment)},deduplicationKey:`${subtype}:${publicId}:cancelled`});
  await client.query("COMMIT");return {id:cancellation.public_id,refunded:Boolean(payment),refundAmount:refundAmount/100,reason};
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
