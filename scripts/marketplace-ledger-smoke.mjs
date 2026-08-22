import assert from "node:assert/strict";
import {calculateFoodSettlement} from "../server/merchant-finance-repository.js";

const marketplace=calculateFoodSettlement({provider:"mercadopago",total:120000,subtotal:100000,discount:0,commissionBps:1800,deliveryFee:10000,applicationFee:30000,hasDriver:true});
assert.deepEqual(marketplace,{merchantNet:90000,driverNet:10000,platformNet:20000,commission:18000});
assert.equal(marketplace.merchantNet+marketplace.driverNet+marketplace.platformNet,120000);

const wallet=calculateFoodSettlement({provider:"flash_wallet",total:120000,subtotal:100000,discount:0,commissionBps:1800,deliveryFee:10000,hasDriver:true});
assert.deepEqual(wallet,{merchantNet:82000,driverNet:10000,platformNet:28000,commission:18000});
assert.throws(()=>calculateFoodSettlement({provider:"mercadopago",total:10000,subtotal:10000,discount:0,commissionBps:1800,deliveryFee:0,applicationFee:11000,hasDriver:false}),/no balancea/);

console.log("marketplace ledger smoke passed");
