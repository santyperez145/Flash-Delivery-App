import assert from "node:assert/strict";

process.env.PAYMENT_MARKETPLACE_PROVIDER="mercadopago";
const {createMercadoPagoPayment,refundMercadoPagoPayment,mercadoPagoFulfillmentDecision}=await import("../server/payment-marketplace-provider.js");

let request;
const result=await createMercadoPagoPayment({accessToken:"APP_USR-secret",idempotencyKey:"payment-order-12345678",cardToken:"card-token_12345678",transactionAmount:12500.25,applicationFee:1250.03,paymentMethodId:"visa",installments:1,payerEmail:"Buyer@Example.com",externalReference:"ORDER-12345678",description:"Pedido ORDER-12345678",notificationUrl:"https://api.flash.example/webhooks/mercadopago",fetchImpl:async(url,options)=>{request={url,options};return{ok:true,status:201,json:async()=>({id:987654,status:"approved",status_detail:"accredited",transaction_amount:12500.25,currency_id:"ARS",application_fee:1250.03,collector_id:42,date_approved:"2026-08-22T12:00:00Z",external_reference:"ORDER-12345678",payer:{email:"must-not-leak@example.com"},card:{last_four_digits:"1234"}})}}});
assert.equal(request.url,"https://api.mercadopago.com/v1/payments");
assert.equal(request.options.headers.authorization,"Bearer APP_USR-secret");
assert.equal(request.options.headers["x-idempotency-key"],"payment-order-12345678");
const sent=JSON.parse(request.options.body);
assert.equal(sent.token,"card-token_12345678");
assert.equal(sent.application_fee,1250.03);
assert.equal(sent.payer.email,"buyer@example.com");
assert.deepEqual(result,{id:"987654",status:"approved",statusDetail:"accredited",externalReference:"ORDER-12345678",transactionAmount:12500.25,currency:"ARS",applicationFee:1250.03,collectorId:"42",dateApproved:"2026-08-22T12:00:00Z"});
assert.equal(JSON.stringify(result).includes("must-not-leak"),false);
assert.deepEqual(mercadoPagoFulfillmentDecision("approved"),{intentStatus:"captured",fulfill:true,terminal:true});
assert.deepEqual(mercadoPagoFulfillmentDecision("pending"),{intentStatus:"requires_confirmation",fulfill:false,terminal:false});
assert.deepEqual(mercadoPagoFulfillmentDecision("authorized"),{intentStatus:"requires_confirmation",fulfill:false,terminal:false});
assert.deepEqual(mercadoPagoFulfillmentDecision("rejected"),{intentStatus:"failed",fulfill:false,terminal:true});
assert.deepEqual(mercadoPagoFulfillmentDecision("refunded"),{intentStatus:"failed",fulfill:false,terminal:true});

await assert.rejects(()=>createMercadoPagoPayment({accessToken:"secret",idempotencyKey:"payment-order-12345678",cardToken:"4111111111111111",transactionAmount:100,applicationFee:10,paymentMethodId:"visa",payerEmail:"buyer@example.com",externalReference:"ORDER-1",description:"test",fetchImpl:async()=>{throw new Error("must not call")}}),/Token de pago inválido/);
await assert.rejects(()=>createMercadoPagoPayment({accessToken:"secret",idempotencyKey:"payment-order-12345678",cardToken:"card-token_12345678",transactionAmount:100,applicationFee:100,paymentMethodId:"visa",payerEmail:"buyer@example.com",externalReference:"ORDER-1",description:"test",fetchImpl:async()=>{throw new Error("must not call")}}),/Importes de pago inválidos/);

let refundRequest;
const refund=await refundMercadoPagoPayment({accessToken:"APP_USR-secret",paymentId:"987654",idempotencyKey:"refund-order-12345678",amount:125.5,fetchImpl:async(url,options)=>{refundRequest={url,options};return{ok:true,status:201,json:async()=>({id:777,payment_id:987654,amount:125.5,status:"approved",date_created:"2026-08-22T13:00:00Z",metadata:{mustNotLeak:true}})}}});
assert.equal(refundRequest.url,"https://api.mercadopago.com/v1/payments/987654/refunds");
assert.equal(refundRequest.options.headers["x-idempotency-key"],"refund-order-12345678");
assert.deepEqual(JSON.parse(refundRequest.options.body),{amount:125.5});
assert.deepEqual(refund,{id:"777",paymentId:"987654",amount:125.5,status:"approved",dateCreated:"2026-08-22T13:00:00Z"});
await assert.rejects(()=>refundMercadoPagoPayment({accessToken:"secret",paymentId:"987654",idempotencyKey:"refund-order-12345678",amount:-1,fetchImpl:async()=>{throw new Error("must not call")}}),/Importe de reembolso inválido/);

console.log("mercadopago payment smoke passed");
