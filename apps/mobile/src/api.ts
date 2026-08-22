import type { AppState, DeliveryEvidence, DispatchOffer, Driver, FoodCheckoutQuote, GeoPoint, Order, Restaurant, Ride, RideQuote, RideService, ServiceMode, Shipment, ShipmentQuote, UserAddress } from "./types";
import { loadMobileSession,mobileSessionStorage,saveMobileSession } from "./session-storage";
import Constants from "expo-constants";

declare const process: { env?: { EXPO_PUBLIC_API_URL?: string } };

const API_BASE = process.env?.EXPO_PUBLIC_API_URL || "http://127.0.0.1:4000/api";

let token = "";
let refreshToken = "";
let sessionDriverId:string|null=null;
let activeAudience:"customer"|"merchant"|"driver"="customer";
const appVariant=String(Constants.expoConfig?.extra?.appVariant||"customer") as "customer"|"merchant"|"driver";
const allowsVariant=(user:import("./types").User)=>user.roles.includes(appVariant);

type Envelope<T> = T & { ok: boolean; message?: string };

async function persistSession() {
  return saveMobileSession(refreshToken?{accessToken:token,refreshToken,driverId:sessionDriverId}:null);
}

async function refreshAccessToken() {
  const stored=await loadMobileSession();
  if(stored?.refreshToken&&stored.refreshToken!==refreshToken){token=stored.accessToken;refreshToken=stored.refreshToken;sessionDriverId=stored.driverId;}
  if (!refreshToken) return false;
  const attemptedRefreshToken=refreshToken;
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken, deviceName: "Flash Mobile" })
  });
  if (!response.ok) {
    const concurrent=await loadMobileSession();
    if(concurrent?.refreshToken&&concurrent.refreshToken!==attemptedRefreshToken){token=concurrent.accessToken;refreshToken=concurrent.refreshToken;sessionDriverId=concurrent.driverId;return Boolean(token);}
    token = "";
    refreshToken = "";
    await persistSession();
    return false;
  }
  const session = await response.json() as { token: string; refreshToken: string };
  token = session.token;
  refreshToken = session.refreshToken;
  await persistSession();
  return true;
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {})
    }
  });
  if (response.status === 401 && retry && path !== "/auth/login" && await refreshAccessToken()) {
    return request<T>(path, init, false);
  }
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "No se pudo completar la accion");
  }
  return payload as T;
}

export const api = {
  async getDriverOffers() { return request<{offers:DispatchOffer[]}>("/driver/offers"); },
  async rejectDriverOffer(offerId:string) { return request<{rejected:boolean}>(`/driver/offers/${offerId}/reject`,{method:"POST",body:"{}"}); },
  async login(email: string, password: string) {
    const session = await request<{ token: string; refreshToken: string; user: import("./types").User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, deviceName: "Flash Mobile" })
    });
    if(!allowsVariant(session.user))throw new Error(`Esta cuenta no pertenece a ${appVariant==="driver"?"Flash Driver":appVariant==="merchant"?"Flash Negocios":"Flash"}`);
    token = session.token;
    refreshToken = session.refreshToken;
    sessionDriverId=session.user.driverId||null;
    activeAudience=session.user.roles.includes("merchant")?"merchant":session.user.roles.includes("driver")?"driver":"customer";
    await persistSession();
    return session.user;
  },
  async register(input: { name: string; email: string; password: string; phone?: string }) {
    return request<{user:import("./types").User;verificationRequired:true;developmentCode?:string;expiresAt?:string}>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...input, deviceName: "Flash Mobile" })
    });
  },
  async resendEmailVerification(email:string){return request<{message:string;developmentCode?:string;expiresAt?:string}>("/auth/email-verification/resend",{method:"POST",body:JSON.stringify({email})});},
  async confirmEmailVerification(email:string,code:string){return request<{verified:boolean;user:import("./types").User}>("/auth/email-verification/confirm",{method:"POST",body:JSON.stringify({email,code})});},
  async requestPhoneVerification(){return request<{expiresAt:string;retryAfterSeconds:number;developmentCode?:string}>("/me/phone-verification/request",{method:"POST",body:"{}"});},
  async confirmPhoneVerification(code:string){return request<{verified:true;phone:string}>("/me/phone-verification/confirm",{method:"POST",body:JSON.stringify({code})});},
  async requestPasswordRecovery(email:string){return request<{message:string;developmentToken?:string;expiresAt?:string}>("/auth/password-recovery/request",{method:"POST",body:JSON.stringify({email})});},
  async confirmPasswordRecovery(token:string,password:string){return request<{passwordChanged:boolean;revokedSessions:number}>("/auth/password-recovery/confirm",{method:"POST",body:JSON.stringify({token,password})});},
  async restoreSession() {
    const stored = await loadMobileSession();
    if (!stored) return null;
    try {
      token=stored.accessToken;refreshToken=stored.refreshToken;sessionDriverId=stored.driverId;
      if (!await refreshAccessToken()) return null;
      const account = await request<{ account: { user: import("./types").User } }>("/me");
      if(!allowsVariant(account.account.user)){token="";refreshToken="";sessionDriverId=null;await persistSession();return null;}
      sessionDriverId=account.account.user.driverId||null;await persistSession();
      activeAudience=account.account.user.roles.includes("merchant")?"merchant":account.account.user.roles.includes("driver")?"driver":"customer";
      return account.account.user;
    } catch (_error) {
      token = "";
      refreshToken = "";
      sessionDriverId=null;
      await persistSession();
      return null;
    }
  },
  async logout() {
    const currentRefreshToken = refreshToken;
    token = "";
    refreshToken = "";
    sessionDriverId=null;
    await persistSession();
    if (currentRefreshToken) {
      await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: currentRefreshToken }) });
    }
  },
  sessionStorage:mobileSessionStorage,
  async state() {
    const[bootstrap,activity,catalog,driverContext,merchantContext,assignedDrivers,accountContext]=await Promise.all([request<{state:Omit<AppState,"orders"|"rides"|"shipments">&{restaurants?:Restaurant[];drivers?:Driver[]};audience:string}>(`/bootstrap/${activeAudience}`),this.getActivity(undefined,50),activeAudience==="merchant"?Promise.resolve(null):this.getCatalog(undefined,50),activeAudience==="driver"?this.getCurrentDriver():Promise.resolve(null),activeAudience==="merchant"?this.getCurrentMerchant():Promise.resolve(null),["customer","merchant"].includes(activeAudience)?this.getAssignedDrivers():Promise.resolve(null),this.getAccountContext()]);
    const account=accountContext.account;
    return{...bootstrap,state:{...bootstrap.state,addresses:account.addresses,paymentMethods:account.paymentMethods,supportTickets:account.supportTickets,tips:account.tips||[],restaurants:merchantContext?.restaurants||catalog?.restaurants||bootstrap.state.restaurants||[],drivers:driverContext?[driverContext.driver]:(assignedDrivers?.drivers||bootstrap.state.drivers||[]),orders:activity.items.filter(item=>item.kind==="order").map(item=>item.resource as Order),rides:activity.items.filter(item=>item.kind==="ride").map(item=>item.resource as Ride),shipments:activity.items.filter(item=>item.kind==="shipment").map(item=>item.resource as Shipment)} as AppState};
  },
  async getCurrentDriver(){return request<{driver:Driver}>("/driver/me");},
  async getCurrentMerchant(){return request<{restaurants:Restaurant[]}>("/merchant/me");},
  async getAssignedDrivers(){return request<{drivers:Driver[]}>("/me/assigned-drivers");},
  async getAccountContext(){return request<{account:{user:import("./types").User;addresses:import("./types").UserAddress[];paymentMethods:import("./types").PaymentMethod[];supportTickets:import("./types").SupportTicket[];tips:import("./types").ServiceTip[]}}>("/me");},
  async getPaymentClientConfiguration(){return request<{provider:"mercadopago"|"disabled";publicKey:string|null;cardDataHandling:"provider_tokenization_only"}>("/payment-provider/client-configuration");},
  async getActivity(cursor?:string,limit=20){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{})});return request<{items:Array<{id:string;kind:"order"|"ride"|"shipment";createdAt:string;resource:Order|Ride|Shipment}>;nextCursor:string|null}>(`/me/activity?${params}`);},
  async getCatalog(cursor?:string,limit=20,query=""){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{}),...(query?{q:query}:{})});return request<{restaurants:Restaurant[];nextCursor:string|null}>(`/catalog/restaurants?${params}`);},
  async createSandboxPaymentMethod(input:{providerToken:string;brand:"visa"|"mastercard"|"amex"|"cabal";last4:string;expiryMonth:number;expiryYear:number;isDefault?:boolean}){return request<{paymentMethod:import("./types").PaymentMethod}>("/payment-methods/sandbox",{method:"POST",body:JSON.stringify(input)});},
  async setDefaultPaymentMethod(paymentMethodId:string){return request<{paymentMethod:import("./types").PaymentMethod}>(`/payment-methods/${paymentMethodId}/default`,{method:"PATCH",body:"{}"});},
  async deletePaymentMethod(paymentMethodId:string){return request<{paymentMethods:import("./types").PaymentMethod[]}>(`/payment-methods/${paymentMethodId}`,{method:"DELETE"});},
  async getNotifications(){return request<{notifications:import("./types").AppNotification[]}>("/notifications");},
  async getAccountSessions(){return request<{sessions:import("./types").AccountSession[]}>("/me/sessions");},
  async revokeAccountSession(sessionId:string){return request<{revoked:true;id:string}>(`/me/sessions/${sessionId}`,{method:"DELETE"});},
  async revokeOtherAccountSessions(){if(!refreshToken)throw new Error("La sesión actual no tiene credencial de renovación");return request<{revokedSessions:number}>("/me/sessions/revoke-others",{method:"POST",body:JSON.stringify({refreshToken})});},
  async markNotificationRead(notificationId:string){return request<{notifications:import("./types").AppNotification[]}>(`/notifications/${notificationId}/read`,{method:"PATCH",body:"{}"});},
  async getNotificationPreferences(){return request<{preferences:import("./types").NotificationPreference[]}>("/notification-preferences");},
  async updateNotificationPreference(category:import("./types").NotificationPreference["category"],input:{pushEnabled:boolean;emailEnabled:boolean}){return request<{preferences:import("./types").NotificationPreference[]}>(`/notification-preferences/${category}`,{method:"PATCH",body:JSON.stringify(input)});},
  async getDietaryPreferences(){return request<{preferences:import("./types").DietaryPreferences}>("/dietary-preferences");},
  async updateDietaryPreferences(input:{dietaryLabels:string[];avoidedAllergens:string[];hideIncompatible:boolean}){return request<{preferences:import("./types").DietaryPreferences}>("/dietary-preferences",{method:"PUT",body:JSON.stringify(input)});},
  async getReferralSummary(){return request<{referral:import("./types").ReferralSummary}>("/referrals/me");},
  async claimReferral(code:string){return request<{referral:import("./types").ReferralSummary}>("/referrals/claim",{method:"POST",body:JSON.stringify({code})});},
  async searchCatalog(query:string,offset=0,limit=20){return request<{results:Array<{restaurantId:string;restaurantName:string;cuisine:string;image:string;cover:string;etaMin:number;deliveryFee:number;matchedItems:Array<{id:string;name:string;category:string}>;matchCount:number;score:number}>;total:number;limit:number;offset:number;nextOffset:number|null}>(`/catalog/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`);},
  async createSupportTicket(input:{category:"food"|"ride"|"shipment"|"payment"|"account"|"safety"|"other";priority:"low"|"normal"|"high"|"urgent";subject:string;body:string;jobId?:string}){return request<{ticket:import("./types").SupportTicket}>("/support/tickets",{method:"POST",body:JSON.stringify(input)});},
  async createRideTrackingLink(rideId:string,ttlMinutes=180){return request<{link:{id:string;trackingUrl:string;expiresAt:string}}>(`/rides/${rideId}/tracking-links`,{method:"POST",body:JSON.stringify({ttlMinutes})});},
  async revokeRideTrackingLink(rideId:string,linkId:string){return request<{revoked:boolean}>(`/rides/${rideId}/tracking-links/${linkId}`,{method:"DELETE"});},
  async createRideSafetyIncident(rideId:string,input:{type:"sos"|"unsafe_driving"|"medical"|"harassment"|"crash"|"other";details?:string;location?:GeoPoint}){return request<{incident:{id:string;rideId:string;type:string;status:string;createdAt:string}}>(`/rides/${rideId}/safety-incidents`,{method:"POST",body:JSON.stringify(input)});},
  async sendSupportMessage(ticketId:string,body:string){return request<{ticket:import("./types").SupportTicket}>(`/support/tickets/${ticketId}/messages`,{method:"POST",body:JSON.stringify({body,internal:false})});},
  async getDriverCompliance(driverId:string){return request<{compliance:import("./types").DriverCompliance}>(`/drivers/${driverId}/compliance`);},
  async submitDriverDocument(driverId:string,input:{type:import("./types").DriverDocument["type"];mimeType:"image/jpeg"|"image/png"|"application/pdf";contentBase64:string;expiresAt?:string|null}){return request<{document:import("./types").DriverDocument}>(`/drivers/${driverId}/documents`,{method:"POST",body:JSON.stringify(input)});},
  async getDriverVehicles(driverId:string){return request<{vehicles:import("./types").DriverVehicle[]}>(`/drivers/${driverId}/vehicles`);},
  async createDriverVehicle(driverId:string,input:{kind:import("./types").DriverVehicle["kind"];model:string;plate:string;color?:string|null;seats?:number|null;serviceModes:ServiceMode[]}){return request<{vehicle:import("./types").DriverVehicle}>(`/drivers/${driverId}/vehicles`,{method:"POST",body:JSON.stringify(input)});},
  async activateDriverVehicle(vehicleId:string){return request<{vehicle:import("./types").DriverVehicle}>(`/driver-vehicles/${vehicleId}/activate`,{method:"POST",body:"{}"});},
  async retireDriverVehicle(vehicleId:string){return request<{vehicle:import("./types").DriverVehicle}>(`/driver-vehicles/${vehicleId}`,{method:"DELETE"});},
  async createOrder(payload: {
    customerId: string;
    restaurantId: string;
    deliveryAddressId?: string;
    branchId?: string;
    deliveryAddress: string;
    paymentMethod: string;
    paymentMethodId?:string;
    promotionCode?:string;
    quoteToken:string;
    items: Array<{ menuItemId: string; quantity: number; extras: string[]; note: string }>;
  }) {
    if (!payload.deliveryAddressId) throw new Error("Selecciona una dirección guardada antes de confirmar");
    return request<{ order: Order }>("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: JSON.stringify(payload)
    });
  },
  async reorder(orderId:string){return request<{sourceOrderId:string;restaurantId:string;cart:import("./types").CartLine[]}>(`/orders/${orderId}/reorder`,{method:"POST",body:"{}"});},
  async quoteFoodCheckout(payload:{customerId:string;restaurantId:string;deliveryAddressId:string;branchId?:string;paymentMethod:string;paymentMethodId:string;promotionCode?:string;items:Array<{menuItemId:string;quantity:number;extras:string[];note:string}>}){return request<{quote:FoodCheckoutQuote}>("/orders/quote",{method:"POST",body:JSON.stringify(payload)});},
  async setOrderStatus(orderId: string, status: Order["status"], reason="changed_mind") {
    return request<{ order: Order }>(`/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...(status==="cancelled"?{reason}:{}) })
    });
  },
  async quoteRide(payload: {
    pickup: string;
    destination: string;
    service: RideService;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
  }) {
    return request<{ quote: RideQuote }>("/rides/quote", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  async createOrderIssue(orderId:string,payload:{category:"missing_item"|"wrong_item"|"damaged_item"|"quality"|"late"|"other";description:string;requestedRefund:number}){return request<{issue:import("./types").OrderIssue}>(`/orders/${orderId}/issues`,{method:"POST",body:JSON.stringify(payload)});},
  async getOrderIssues(orderId:string){return request<{issues:import("./types").OrderIssue[]}>(`/orders/${orderId}/issues`);},
  async getOrderSubstitutions(orderId:string){return request<{substitutions:import("./types").OrderSubstitution[]}>(`/orders/${orderId}/substitutions`);},
  async decideOrderSubstitution(substitutionId:string,decision:"accepted"|"rejected"){return request<{substitution:import("./types").OrderSubstitution}>(`/order-substitutions/${substitutionId}`,{method:"PATCH",body:JSON.stringify({decision})});},
  async createAddress(payload:{label:string;address:string;lat:number;lng:number;isDefault:boolean}){return request<{address:UserAddress;addresses:UserAddress[]}>("/addresses",{method:"POST",body:JSON.stringify(payload)});},
  async setDefaultAddress(addressId:string){return request<{address:UserAddress;addresses:UserAddress[]}>(`/addresses/${addressId}/default`,{method:"PATCH",body:"{}"});},
  async deleteAddress(addressId:string){return request<{deleted:boolean;addresses:UserAddress[]}>(`/addresses/${addressId}`,{method:"DELETE"});},
  async getRideDestinations(){return request<{destinations:import("./types").RideDestination[]}>("/ride-destinations");},
  async recordRideDestination(payload:{label:string;address:string;lat:number;lng:number}){return request<{destination:import("./types").RideDestination;destinations:import("./types").RideDestination[]}>("/ride-destinations",{method:"POST",body:JSON.stringify(payload)});},
  async deleteRideDestination(destinationId:string){return request<{deleted:boolean;destinations:import("./types").RideDestination[]}>(`/ride-destinations/${destinationId}`,{method:"DELETE"});},
  async getRideTrustedContacts(){return request<{contacts:import("./types").RideTrustedContact[]}>("/ride-trusted-contacts");},
  async createRideTrustedContact(payload:{name:string;relationship:import("./types").RideTrustedContact["relationship"];phone:string}){return request<{contact:import("./types").RideTrustedContact;contacts:import("./types").RideTrustedContact[]}>("/ride-trusted-contacts",{method:"POST",body:JSON.stringify(payload)});},
  async deleteRideTrustedContact(contactId:string){return request<{deleted:boolean;contacts:import("./types").RideTrustedContact[]}>(`/ride-trusted-contacts/${contactId}`,{method:"DELETE"});},
  async getRidePickupCode(rideId:string){return request<{pickupCode:string}>(`/rides/${rideId}/pickup-code`);},
  async verifyRidePickup(rideId:string,pin:string){return request<{verification:{verified:true;verifiedAt:string}}>(`/rides/${rideId}/verify-pickup`,{method:"POST",body:JSON.stringify({pin})});},
  async getServiceMessages(jobId:string){return request<{messages:import("./types").ServiceMessage[];unreadCount:number}>(`/jobs/${jobId}/messages`);},
  async markServiceMessagesRead(jobId:string){return request<{receipt:{readCount:number;readAt:string}}>(`/jobs/${jobId}/messages/read`,{method:"POST",body:"{}"});},
  async sendServiceMessage(jobId:string,body:string,attachment?:{fileName:string;mimeType:"image/jpeg"|"image/png"|"application/pdf";contentBase64:string}){return request<{message:import("./types").ServiceMessage}>(`/jobs/${jobId}/messages`,{method:"POST",body:JSON.stringify({body,attachment})});},
  async getServiceAttachmentContent(attachmentId:string){return request<{attachment:import("./types").ServiceAttachment;contentBase64:string}>(`/service-message-attachments/${attachmentId}/content`);},
  async getServiceQuickReplies(jobId:string,locale="es-AR"){return request<{quickReplies:import("./types").ServiceQuickReply[];context:{serviceScope:string;audience:string;locale:string}}>(`/jobs/${jobId}/quick-replies?locale=${encodeURIComponent(locale)}`);},
  async cart() {
    return request<{ cart: import("./types").CartLine[] }>("/cart");
  },
  async saveCart(restaurantId: string, cart: import("./types").CartLine[]) {
    return request<{ cart: import("./types").CartLine[] }>("/cart", {
      method: "PUT",
      body: JSON.stringify({ restaurantId, items: cart.map((line) => ({
        menuItemId: line.item.id, quantity: line.quantity, extras: line.extras, note: line.note
      })) })
    });
  },
  async saveMobileCart(restaurantId:string|undefined,items:Array<{menuItemId:string;quantity:number;extras:string[];note:string}>){return request<{cart:import("./types").CartLine[]}>("/cart",{method:"PUT",body:JSON.stringify({restaurantId,items})});},
  async quoteRideOptions(payload: {
    pickup: string;
    destination: string;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
  }) {
    return request<{ options: RideQuote[] }>("/rides/options", {
      method: "POST",
      body: JSON.stringify({ ...payload, service: "economy" })
    });
  },
  async geocode(query: string) {
    return request<{ results: Array<{ label: string; point: GeoPoint; type: string }>; provider: string }>(`/maps/geocode?q=${encodeURIComponent(query)}`);
  },
  async route(from: GeoPoint, to: GeoPoint) {
    const params = new URLSearchParams({ fromLat: String(from.lat), fromLng: String(from.lng), toLat: String(to.lat), toLng: String(to.lng) });
    return request<{ route: { distanceKm: number; durationMin: number; coordinates: GeoPoint[]; steps: Array<{ type: string; modifier: string; street: string; distanceM: number; durationSec: number; location: GeoPoint }> }; provider: string }>(`/maps/route?${params.toString()}`);
  },
  async createRide(payload: {
    customerId: string;
    pickup: string;
    destination: string;
    service: RideService;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
    paymentMethod: string;
    promotionCode?: string;
    quoteToken: string;
    scheduledFor?: string;
  }) {
    return request<{ ride: Ride }>("/rides", {
      method: "POST",
      headers: { "Idempotency-Key": `mobile-ride-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: JSON.stringify(payload)
    });
  },
  async quoteShipment(payload: {
    pickup: string;
    destination: string;
    packageSize: Shipment["packageSize"];
    weightKg: number;
    declaredValue?:number;
    protection?:"none"|"standard";
    signatureRequired?:boolean;
    itemCategory?:Shipment["itemCategory"];
    serviceLevel?:Shipment["serviceLevel"];
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
  }) {
    return request<{ quote: ShipmentQuote }>("/shipments/quote", { method: "POST", body: JSON.stringify(payload) });
  },
  async getShipmentOptions(){return request<import("./types").ShipmentOptions>("/shipment-options");},
  async createShipment(payload: {
    customerId: string;
    pickup: string;
    destination: string;
    recipientName: string;
    recipientPhone: string;
    packageSize: Shipment["packageSize"];
    description: string;
    weightKg: number;
    declaredValue?:number;
    protection?:"none"|"standard";
    signatureRequired?:boolean;
    itemCategory?:Shipment["itemCategory"];
    serviceLevel?:Shipment["serviceLevel"];
    deliveryNotes: string;
    paymentMethod: string;
    termsAccepted: true;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
    quoteToken?: string;
  }) {
    return request<{ shipment: Shipment }>("/shipments", { method: "POST", headers: { "Idempotency-Key": `mobile-shipment-${Date.now()}-${Math.random().toString(36).slice(2)}` }, body: JSON.stringify(payload) });
  },
  async getShipmentReturns(){return request<{returns:import("./types").ShipmentReturn[]}>("/shipment-returns");},
  async requestShipmentReturn(shipmentId:string,reason:string){return request<{return:import("./types").ShipmentReturn}>(`/shipments/${shipmentId}/returns`,{method:"POST",body:JSON.stringify({reason})});},
  async getShipmentClaims(){return request<{claims:import("./types").ShipmentClaim[]}>("/shipment-claims");},
  async createShipmentClaim(shipmentId:string,input:{claimType:"lost"|"damaged"|"stolen";description:string;requestedAmount:number}){return request<{claim:import("./types").ShipmentClaim}>(`/shipments/${shipmentId}/claims`,{method:"POST",body:JSON.stringify(input)});},
  async addShipmentClaimEvidence(claimId:string,input:{fileName:string;mimeType:"image/jpeg"|"image/png"|"application/pdf";contentBase64:string}){return request<{evidence:import("./types").ShipmentClaimEvidence}>(`/shipment-claims/${claimId}/evidence`,{method:"POST",body:JSON.stringify(input)});},
  async getShipmentClaimEvidenceContent(evidenceId:string){return request<{evidence:import("./types").ShipmentClaimEvidence;contentBase64:string}>(`/shipment-claim-evidence/${evidenceId}/content`);},
  async setShipmentStatus(shipmentId: string, status: "cancelled", reason="changed_mind") {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/status`, { method: "PATCH", body: JSON.stringify({ status,reason }) });
  },
  async setRideStatus(rideId: string, status: Ride["status"], reason="changed_mind") {
    return request<{ ride: Ride }>(`/rides/${rideId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...(status==="cancelled"?{reason}:{}) })
    });
  },
  async updateRestaurant(restaurantId: string, payload: { open?: boolean; etaMin?: number }) {
    return request(`/restaurants/${restaurantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  async updateMenuStock(restaurantId: string, itemId: string, stock: boolean) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}/menu/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ stock })
    });
  },
  async addMenuItem(
    restaurantId: string,
    payload: { name: string; description: string; category: string; price: number }
  ) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}/menu`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  async updateDriver(driverId: string, payload: { online?: boolean; activeService?: ServiceMode }) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/availability`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  async updateDriverLocation(driverId: string, payload: GeoPoint & { label?: string;source?:"foreground"|"background";accuracyM?:number }) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/location`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  async acceptDelivery(orderId: string, driverId: string) {
    return request<{ order: Order }>(`/orders/${orderId}/accept-delivery`, {
      method: "POST",
      body: JSON.stringify({ driverId })
    });
  },
  async advanceOrder(orderId: string) {
    return request<{ order: Order }>(`/orders/${orderId}/advance`, { method: "POST" });
  },
  async acceptRide(rideId: string, driverId: string) {
    return request<{ ride: Ride }>(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId })
    });
  },
  async advanceRide(rideId: string) {
    return request<{ ride: Ride }>(`/rides/${rideId}/advance`, { method: "POST" });
  },
  async acceptShipment(shipmentId: string, driverId: string) {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/accept`, { method: "POST", body: JSON.stringify({ driverId }) });
  },
  async advanceShipment(shipmentId: string) {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/advance`, { method: "POST" });
  },
  async getShipmentDeliveryCode(shipmentId:string){return request<{deliveryCode:string}>(`/shipments/${shipmentId}/delivery-code`);},
  async addShipmentDeliveryEvidence(shipmentId:string,input:{type:"photo"|"signature";mimeType:"image/jpeg"|"image/png"|"image/webp";contentBase64:string;capturedAt?:string;location?:GeoPoint;signerName?:string;signerRelationship?:"recipient"|"authorized_person";consentVersion?:"shipment-receipt-v1"}){return request<{evidence:DeliveryEvidence}>(`/shipments/${shipmentId}/delivery-evidence`,{method:"POST",body:JSON.stringify(input)});},
  async getShipmentDeliveryEvidence(shipmentId:string){return request<{evidence:DeliveryEvidence[]}>(`/shipments/${shipmentId}/delivery-evidence`);},
  async getShipmentDeliveryEvidenceContent(evidenceId:string){return request<{evidence:DeliveryEvidence;contentBase64:string}>(`/shipment-delivery-evidence/${evidenceId}/content`);},
  async verifyShipmentDelivery(shipmentId:string,pin:string){return request<{shipment:Shipment;proof:{type:"pin+photo"|"pin+photo+signature";verified:true}}>(`/shipments/${shipmentId}/verify-delivery`,{method:"POST",body:JSON.stringify({pin})});
  },
  async createTip(jobId:string,amount:number){return request<{tip:import("./types").ServiceTip}>(`/jobs/${jobId}/tips`,{method:"POST",headers:{"Idempotency-Key":`mobile-tip-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`},body:JSON.stringify({amount})});
  },
  async getReceipt(jobId:string){return request<{receipt:import("./types").ServiceReceipt}>(`/jobs/${jobId}/receipt`);
  }
};
