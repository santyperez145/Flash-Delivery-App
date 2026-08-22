const requests=new Map();
const providerCalls=new Map();
const latencyBucketsMs=[50,100,250,500,1000,2500,5000];
const normalizePath=value=>String(value||"/").split("?",1)[0].replace(/\/(ORD|RIDE|SHIP|TCK|ITEM|PROMO|RATE|NTF)-[A-Z0-9-]+/gi,"/:id").replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,"/:id");
const keyOf=(method,path,status)=>`${method}|${normalizePath(path)}|${status}`;
export function observeHttpRequest({method,path,status,durationMs}){const key=keyOf(method,path,status),current=requests.get(key)||{count:0,durationMs:0,buckets:latencyBucketsMs.map(()=>0)};current.count+=1;current.durationMs+=durationMs;latencyBucketsMs.forEach((limit,index)=>{if(durationMs<=limit)current.buckets[index]+=1;});requests.set(key,current);}
export function observeProviderCall({provider,operation,outcome}){const key=`${provider}|${operation}|${outcome}`;providerCalls.set(key,(providerCalls.get(key)||0)+1);}
const esc=value=>String(value).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n");
export function renderPrometheus({pool,business,startedAt,realtimeConnections=0}){const lines=[
  "# HELP flash_process_uptime_seconds API process uptime.","# TYPE flash_process_uptime_seconds gauge",`flash_process_uptime_seconds ${Math.max(0,(Date.now()-startedAt)/1000).toFixed(3)}`,
  "# HELP flash_http_requests_total HTTP requests by method, normalized route and status.","# TYPE flash_http_requests_total counter"];
  for(const [key,value]of requests){const[method,path,status]=key.split("|");lines.push(`flash_http_requests_total{method="${esc(method)}",route="${esc(path)}",status="${esc(status)}"} ${value.count}`);}
  lines.push("# HELP flash_http_request_duration_seconds HTTP request duration histogram.","# TYPE flash_http_request_duration_seconds histogram");
  for(const [key,value]of requests){const[method,path,status]=key.split("|"),labels=`method="${esc(method)}",route="${esc(path)}",status="${esc(status)}"`;latencyBucketsMs.forEach((limit,index)=>lines.push(`flash_http_request_duration_seconds_bucket{${labels},le="${limit/1000}"} ${value.buckets[index]}`));lines.push(`flash_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${value.count}`,`flash_http_request_duration_seconds_sum{${labels}} ${(value.durationMs/1000).toFixed(6)}`,`flash_http_request_duration_seconds_count{${labels}} ${value.count}`);}
  lines.push("# HELP flash_postgres_pool_connections PostgreSQL pool connections by state.","# TYPE flash_postgres_pool_connections gauge",`flash_postgres_pool_connections{state="total"} ${pool.totalCount||0}`,`flash_postgres_pool_connections{state="idle"} ${pool.idleCount||0}`,`flash_postgres_pool_connections{state="waiting"} ${pool.waitingCount||0}`,
    "# HELP flash_jobs_active Active jobs by vertical.","# TYPE flash_jobs_active gauge",`flash_jobs_active{vertical="food"} ${business.activeFood}`,`flash_jobs_active{vertical="ride"} ${business.activeRides}`,`flash_jobs_active{vertical="shipment"} ${business.activeShipments}`,
    "# HELP flash_support_tickets_open Open support tickets.","# TYPE flash_support_tickets_open gauge",`flash_support_tickets_open ${business.openTickets}`,
    "# HELP flash_payment_intents Payment intents by status.","# TYPE flash_payment_intents gauge");
  for(const row of business.payments)lines.push(`flash_payment_intents{status="${esc(row.status)}"} ${row.count}`);
  lines.push("# HELP flash_notifications Notifications by delivery status.","# TYPE flash_notifications gauge");
  for(const row of business.notifications)lines.push(`flash_notifications{status="${esc(row.status)}"} ${row.count}`);
  lines.push("# HELP flash_dispatch_offers Dispatch offers by status.","# TYPE flash_dispatch_offers gauge");
  for(const row of business.dispatchOffers)lines.push(`flash_dispatch_offers{status="${esc(row.status)}"} ${row.count}`);
  lines.push("# HELP flash_realtime_connections Open SSE connections in this API instance.","# TYPE flash_realtime_connections gauge",`flash_realtime_connections ${realtimeConnections}`,
    "# HELP flash_realtime_events_retained Durable realtime events retained in PostgreSQL.","# TYPE flash_realtime_events_retained gauge",`flash_realtime_events_retained ${business.realtimeEvents}`);
  lines.push("# HELP flash_payouts Merchant payouts by processing status.","# TYPE flash_payouts gauge");
  for(const row of business.payouts||[])lines.push(`flash_payouts{status="${esc(row.status)}"} ${row.count}`);
  lines.push("# HELP flash_merchant_payable_cents Net merchant funds available for payout.","# TYPE flash_merchant_payable_cents gauge",`flash_merchant_payable_cents ${business.merchantPayableCents||0}`);
  lines.push("# HELP flash_service_tips_total Retained completed service tips.","# TYPE flash_service_tips_total gauge",`flash_service_tips_total ${business.tipsCount||0}`,"# HELP flash_service_tips_cents Retained value transferred as tips.","# TYPE flash_service_tips_cents gauge",`flash_service_tips_cents ${business.tipsCents||0}`);
  lines.push("# HELP flash_merchant_payment_oauth_connections Seller payment connections by renewal health.","# TYPE flash_merchant_payment_oauth_connections gauge");
  for(const row of business.paymentOAuthConnections||[])lines.push(`flash_merchant_payment_oauth_connections{status="${esc(row.status)}"} ${row.count}`);
  lines.push("# HELP flash_idempotency_keys Retained idempotency keys by expiry state.","# TYPE flash_idempotency_keys gauge");
  for(const row of business.idempotencyKeys||[])lines.push(`flash_idempotency_keys{status="${esc(row.status)}"} ${row.count}`);
  lines.push("# HELP flash_provider_calls_total External provider calls and controlled degradations.","# TYPE flash_provider_calls_total counter");
  for(const[key,value]of providerCalls){const[provider,operation,outcome]=key.split("|");lines.push(`flash_provider_calls_total{provider="${esc(provider)}",operation="${esc(operation)}",outcome="${esc(outcome)}"} ${value}`);}
  return `${lines.join("\n")}\n`;
}
