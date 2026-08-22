import pg from "pg";

const base=process.env.API_URL||"http://127.0.0.1:4000/api";
const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL,ssl:false});
const assert=(value,label)=>{if(!value)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
const call=async(path,{token,...options}={})=>{const response=await fetch(`${base}${path}`,{...options,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})}});let body={};try{body=await response.json();}catch{}return{status:response.status,body,headers:response.headers};};
const login=async(email)=>(await call("/auth/login",{method:"POST",body:JSON.stringify({email,password:"demo123",deviceName:"driver-earnings-smoke"})})).body.token;

try{
  const driverToken=await login("conductor@flash.app"),customerToken=await login("cliente@flash.app");
  assert(Boolean(driverToken&&customerToken),"fixtures can authenticate");
  assert((await call("/driver/earnings")).status===401,"anonymous cannot read driver earnings");
  assert((await call("/driver/earnings",{token:customerToken})).status===403,"customer cannot read driver earnings");
  const response=await call("/driver/earnings",{token:driverToken}),earnings=response.body.earnings;
  assert(response.status===200&&response.headers.get("cache-control")?.includes("no-store")&&earnings?.source==="postgres-ledger","driver receives private PostgreSQL ledger report");
  const expected=(await pool.query(`WITH identity AS(
      SELECT u.id,u.timezone FROM users u JOIN drivers d ON d.user_id=u.id WHERE u.public_id='usr_driver'
    ),scoped AS(
      SELECT t.kind,t.created_at,e.reference_id,CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END signed_cents,i.timezone
      FROM identity i JOIN ledger_accounts a ON a.owner_type='user' AND a.owner_id=i.id AND a.account_type='wallet' AND a.currency='ARS'
      JOIN ledger_entries e ON e.account_id=a.id JOIN ledger_transactions t ON t.id=e.transaction_id WHERE t.status='posted'
    ) SELECT
      COALESCE(sum(signed_cents),0)::bigint wallet_balance,
      COALESCE(sum(signed_cents) FILTER(WHERE kind IN('driver_earning','merchant_settlement','tip','tip_adjustment') AND created_at >= (date_trunc('day',now() AT TIME ZONE timezone) AT TIME ZONE timezone)),0)::bigint today_amount,
      COALESCE(sum(signed_cents) FILTER(WHERE kind IN('driver_earning','merchant_settlement','tip','tip_adjustment') AND created_at >= (date_trunc('week',now() AT TIME ZONE timezone) AT TIME ZONE timezone)),0)::bigint week_amount,
      COALESCE(sum(signed_cents) FILTER(WHERE kind='tip' AND created_at >= (date_trunc('day',now() AT TIME ZONE timezone) AT TIME ZONE timezone)),0)::bigint today_tips,
      COALESCE(sum(signed_cents) FILTER(WHERE kind='tip_adjustment' AND created_at >= (date_trunc('day',now() AT TIME ZONE timezone) AT TIME ZONE timezone)),0)::bigint today_adjustments
    FROM scoped`)).rows[0];
  assert(earnings.walletBalance===Number(expected.wallet_balance)/100&&earnings.today.amount===Number(expected.today_amount)/100&&earnings.week.amount===Number(expected.week_amount)/100,"wallet, day and week equal authoritative ledger sums");
  assert(earnings.today.tips===Number(expected.today_tips)/100&&earnings.today.adjustments===Number(expected.today_adjustments)/100,"tips and reviewed corrections preserve their signed ledger value");
  assert(earnings.timeTracking.status==="available"&&earnings.timeTracking.source==="postgres-operational-sessions"&&Number.isInteger(earnings.today.onlineSeconds)&&Number.isInteger(earnings.today.activeSeconds),"operational time comes from PostgreSQL sessions and never seeded metadata");
  assert(earnings.days.length>=1&&earnings.days.length<=7&&earnings.days.every((day,index)=>/^\d{4}-\d{2}-\d{2}$/.test(day.date)&&(!index||day.date>earnings.days[index-1].date)),"daily series is bounded, ordered and keyed in the driver timezone");
  assert(Math.abs(earnings.days.reduce((sum,day)=>sum+day.amount,0)-earnings.week.amount)<0.001,"daily ledger values reconcile exactly to the weekly total");
  assert(earnings.recent.length<=100&&earnings.recent.every(entry=>["food","ride","shipment","tip","adjustment"].includes(entry.category)&&Number.isFinite(entry.amount)),"recent detail is bounded and classified without fabricated rows");
  assert(earnings.cashout.status==="not_configured"&&earnings.cashout.reason==="external_payout_provider_required","cashout stays honestly gated until an external provider exists");
  const profile=await call("/driver/me",{token:driverToken});
  assert(profile.status===200&&profile.body.driver.earningsToday===earnings.today.amount,"driver home projection uses the same ledger total instead of seeded metadata");
}finally{await pool.end();}
