import { config } from "./config.js";

export function mercadoPagoAuthorizationUrl(state) {
  if (config.paymentMarketplace.provider !== "mercadopago" || !config.paymentMarketplace.clientId) throw Object.assign(new Error("Mercado Pago Marketplace no está configurado"),{status:503});
  const url=new URL("https://auth.mercadopago.com.ar/authorization");
  url.search=new URLSearchParams({client_id:config.paymentMarketplace.clientId,response_type:"code",platform_id:"mp",redirect_uri:config.paymentMarketplace.redirectUri,state}).toString();
  return url.toString();
}

export async function exchangeMercadoPagoCode(code) {
  if(config.paymentMarketplace.provider!=="mercadopago"||!config.paymentMarketplace.clientId||!config.paymentMarketplace.clientSecret)throw Object.assign(new Error("Mercado Pago Marketplace no está configurado"),{status:503});
  const response=await fetch("https://api.mercadopago.com/oauth/token",{method:"POST",headers:{accept:"application/json","content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.paymentMarketplace.clientId,client_secret:config.paymentMarketplace.clientSecret,grant_type:"authorization_code",code,redirect_uri:config.paymentMarketplace.redirectUri}),signal:AbortSignal.timeout(5000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.access_token||!body.user_id)throw Object.assign(new Error("Mercado Pago no pudo completar la vinculación"),{status:response.status===429?429:502,providerCode:body.error||body.status});
  return{accessToken:String(body.access_token),refreshToken:body.refresh_token?String(body.refresh_token):null,externalAccountId:String(body.user_id),expiresIn:Number(body.expires_in)||null,scope:body.scope?String(body.scope):null,liveMode:Boolean(body.live_mode)};
}
