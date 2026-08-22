import { config } from "./config.js";
import { observeProviderCall } from "./observability.js";

const observeMercadoPago=(operation,outcome)=>observeProviderCall({provider:"mercadopago",operation,outcome});
async function mercadoPagoRequest(operation,url,options,fetchImpl=fetch){
  try{return await fetchImpl(url,options);}catch(error){const timeout=error?.name==="AbortError"||error?.name==="TimeoutError";observeMercadoPago(operation,timeout?"timeout":"network_error");throw Object.assign(new Error(timeout?"Mercado Pago excedió el tiempo de respuesta":"Mercado Pago no está disponible temporalmente"),{status:timeout?504:502,providerCode:timeout?"provider_timeout":"provider_network_error"});}
}

export function mercadoPagoAuthorizationUrl(state,codeChallenge) {
  if (config.paymentMarketplace.provider !== "mercadopago" || !config.paymentMarketplace.clientId) throw Object.assign(new Error("Mercado Pago Marketplace no está configurado"),{status:503});
  const url=new URL("https://auth.mercadopago.com.ar/authorization");
  url.search=new URLSearchParams({client_id:config.paymentMarketplace.clientId,response_type:"code",platform_id:"mp",redirect_uri:config.paymentMarketplace.redirectUri,state,code_challenge:codeChallenge,code_challenge_method:"S256"}).toString();
  return url.toString();
}

export async function exchangeMercadoPagoCode(code,codeVerifier) {
  if(config.paymentMarketplace.provider!=="mercadopago"||!config.paymentMarketplace.clientId||!config.paymentMarketplace.clientSecret)throw Object.assign(new Error("Mercado Pago Marketplace no está configurado"),{status:503});
  const response=await mercadoPagoRequest("oauth_exchange","https://api.mercadopago.com/oauth/token",{method:"POST",headers:{accept:"application/json","content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.paymentMarketplace.clientId,client_secret:config.paymentMarketplace.clientSecret,grant_type:"authorization_code",code,redirect_uri:config.paymentMarketplace.redirectUri,code_verifier:codeVerifier}),signal:AbortSignal.timeout(5000)});
  const body=await response.json().catch(()=>({}));
  const expiresIn=Number(body.expires_in);
  if(!response.ok||!body.access_token||!body.refresh_token||!body.user_id||!Number.isFinite(expiresIn)||expiresIn<=0){observeMercadoPago("oauth_exchange",response.status===429?"rate_limited":response.ok?"invalid_response":`http_${response.status}`);throw Object.assign(new Error("Mercado Pago no pudo completar la vinculación"),{status:response.status===429?429:502,providerCode:body.error||body.status||"incomplete_oauth_credential"});}
  observeMercadoPago("oauth_exchange","success");
  return{accessToken:String(body.access_token),refreshToken:String(body.refresh_token),externalAccountId:String(body.user_id),expiresIn,scope:body.scope?String(body.scope):null,liveMode:Boolean(body.live_mode)};
}

export async function refreshMercadoPagoCredential(refreshToken){
  if(config.paymentMarketplace.provider!=="mercadopago"||!config.paymentMarketplace.clientId||!config.paymentMarketplace.clientSecret)throw Object.assign(new Error("Mercado Pago Marketplace no está configurado"),{status:503});
  const response=await mercadoPagoRequest("oauth_refresh","https://api.mercadopago.com/oauth/token",{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify({client_id:config.paymentMarketplace.clientId,client_secret:config.paymentMarketplace.clientSecret,grant_type:"refresh_token",refresh_token:refreshToken}),signal:AbortSignal.timeout(5000)}),body=await response.json().catch(()=>({}));
  const expiresIn=Number(body.expires_in);
  if(!response.ok||!body.access_token||!body.refresh_token||!body.user_id||!Number.isFinite(expiresIn)||expiresIn<=0){observeMercadoPago("oauth_refresh",response.status===429?"rate_limited":response.ok?"invalid_response":`http_${response.status}`);throw Object.assign(new Error("Mercado Pago no pudo renovar la autorización"),{status:response.status===429?429:502,providerCode:body.error||body.status||"incomplete_oauth_credential"});}
  observeMercadoPago("oauth_refresh","success");
  return{accessToken:String(body.access_token),refreshToken:String(body.refresh_token),externalAccountId:String(body.user_id),expiresIn,scope:body.scope?String(body.scope):null,liveMode:Boolean(body.live_mode)};
}

const mercadoPagoPaymentStatus=new Set(["pending","approved","authorized","in_process","in_mediation","rejected","cancelled","refunded","charged_back"]);

export function mercadoPagoFulfillmentDecision(status){
  if(status==="approved")return{intentStatus:"captured",fulfill:true,terminal:true};
  if(["rejected","cancelled","refunded","charged_back"].includes(status))return{intentStatus:"failed",fulfill:false,terminal:true};
  return{intentStatus:"requires_confirmation",fulfill:false,terminal:false};
}

export async function createMercadoPagoPayment({accessToken,idempotencyKey,cardToken,transactionAmount,applicationFee,paymentMethodId,installments=1,payerEmail,externalReference,description,notificationUrl,fetchImpl=fetch}){
  if(config.paymentMarketplace.provider!=="mercadopago")throw Object.assign(new Error("Mercado Pago Marketplace no está habilitado"),{status:503});
  if(!/^[A-Za-z0-9._-]{8,256}$/.test(String(cardToken||""))||/^\d{13,19}$/.test(String(cardToken)))throw Object.assign(new Error("Token de pago inválido; tokeniza la tarjeta con Mercado Pago"),{status:400});
  if(!/^[A-Za-z0-9_-]{2,64}$/.test(String(paymentMethodId||"")))throw Object.assign(new Error("Medio de pago inválido"),{status:400});
  if(!/^[A-Za-z0-9._:-]{8,64}$/.test(String(idempotencyKey||"")))throw Object.assign(new Error("Clave de idempotencia inválida"),{status:400});
  if(!/^\S+@\S+\.\S+$/.test(String(payerEmail||""))||String(payerEmail).length>254)throw Object.assign(new Error("Email del pagador inválido"),{status:400});
  const amount=Number(transactionAmount),fee=Number(applicationFee);
  if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(fee)||fee<0||fee>=amount)throw Object.assign(new Error("Importes de pago inválidos"),{status:400});
  if(!Number.isInteger(installments)||installments<1||installments>48)throw Object.assign(new Error("Cantidad de cuotas inválida"),{status:400});
  const payload={transaction_amount:Number(amount.toFixed(2)),application_fee:Number(fee.toFixed(2)),token:String(cardToken),payment_method_id:String(paymentMethodId),installments,payer:{email:String(payerEmail).toLowerCase()},external_reference:String(externalReference).slice(0,64),description:String(description).slice(0,255)};
  if(notificationUrl)payload.notification_url=String(notificationUrl);
  const response=await mercadoPagoRequest("create_payment","https://api.mercadopago.com/v1/payments",{method:"POST",headers:{accept:"application/json","content-type":"application/json",authorization:`Bearer ${accessToken}`,"x-idempotency-key":String(idempotencyKey)},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)},fetchImpl);
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.id){observeMercadoPago("create_payment",response.status===429?"rate_limited":response.ok?"invalid_response":`http_${response.status}`);throw Object.assign(new Error(response.status===429?"Mercado Pago limitó temporalmente los cobros":"Mercado Pago no pudo crear el pago"),{status:response.status===429?429:502,providerStatus:response.status,providerCode:body.cause?.[0]?.code||body.code||null});}
  observeMercadoPago("create_payment","success");
  const status=mercadoPagoPaymentStatus.has(String(body.status))?String(body.status):"in_process";
  return{id:String(body.id),status,statusDetail:body.status_detail?String(body.status_detail):null,externalReference:body.external_reference?String(body.external_reference):String(externalReference),transactionAmount:Number(body.transaction_amount||amount),currency:String(body.currency_id||"ARS"),applicationFee:Number(body.application_fee??fee),collectorId:body.collector_id?String(body.collector_id):null,dateApproved:body.date_approved||null};
}

export async function refundMercadoPagoPayment({accessToken,paymentId,idempotencyKey,amount=null,fetchImpl=fetch}){
  if(config.paymentMarketplace.provider!=="mercadopago")throw Object.assign(new Error("Mercado Pago Marketplace no está habilitado"),{status:503});
  if(!/^\d{4,32}$/.test(String(paymentId||"")))throw Object.assign(new Error("Identificador de pago inválido"),{status:400});
  if(!/^[A-Za-z0-9._:-]{8,64}$/.test(String(idempotencyKey||"")))throw Object.assign(new Error("Clave de idempotencia inválida"),{status:400});
  if(amount!==null&&(!Number.isFinite(Number(amount))||Number(amount)<=0))throw Object.assign(new Error("Importe de reembolso inválido"),{status:400});
  const response=await mercadoPagoRequest("refund_payment",`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,{method:"POST",headers:{accept:"application/json","content-type":"application/json",authorization:`Bearer ${accessToken}`,"x-idempotency-key":String(idempotencyKey)},body:JSON.stringify(amount===null?{}:{amount:Number(Number(amount).toFixed(2))}),signal:AbortSignal.timeout(5000)},fetchImpl),body=await response.json().catch(()=>({}));
  if(!response.ok||!body.id){observeMercadoPago("refund_payment",response.status===429?"rate_limited":response.ok?"invalid_response":`http_${response.status}`);throw Object.assign(new Error(response.status===429?"Mercado Pago limitó temporalmente los reintegros":"Mercado Pago no pudo completar el reintegro"),{status:response.status===429?429:502,providerStatus:response.status,providerCode:body.cause?.[0]?.code||body.code||null});}
  const status=String(body.status||"processed");if(!["approved","processed","refunded"].includes(status)){observeMercadoPago("refund_payment","unconfirmed");throw Object.assign(new Error("Mercado Pago dejó el reintegro sin confirmar"),{status:502,providerCode:status});}
  observeMercadoPago("refund_payment","success");
  return{id:String(body.id),paymentId:String(body.payment_id||paymentId),amount:Number(body.amount||amount||0),status,dateCreated:body.date_created||null};
}

export async function fetchMercadoPagoResource({topic,resourceId,accessToken}){
  const resource=topic==="payment"?`payments/${encodeURIComponent(resourceId)}`:["order","orders"].includes(topic)?`orders/${encodeURIComponent(resourceId)}`:null;
  if(!resource)throw Object.assign(new Error("Tópico sin recurso conciliable"),{status:422});
  const response=await mercadoPagoRequest("fetch_resource",`https://api.mercadopago.com/v1/${resource}`,{headers:{accept:"application/json",authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(5000)}),body=await response.json().catch(()=>({}));
  if(!response.ok){observeMercadoPago("fetch_resource",response.status===429?"rate_limited":`http_${response.status}`);throw Object.assign(new Error("No se pudo recuperar el recurso del proveedor"),{status:response.status===429?429:502,providerStatus:response.status});}
  if(!body.id){observeMercadoPago("fetch_resource","invalid_response");throw Object.assign(new Error("El proveedor devolvió un recurso incompleto"),{status:502,providerCode:"invalid_provider_resource"});}
  observeMercadoPago("fetch_resource","success");
  return{id:String(body.id||resourceId),status:String(body.status||"unknown"),statusDetail:body.status_detail?String(body.status_detail):null,externalReference:body.external_reference?String(body.external_reference):null,transactionAmount:Number(body.transaction_amount||body.total_amount||0),currency:String(body.currency_id||body.currency||"ARS"),applicationFee:Number(body.application_fee||body.marketplace_fee||0),collectorId:body.collector_id?String(body.collector_id):body.collector?.id?String(body.collector.id):null,dateApproved:body.date_approved||null};
}
