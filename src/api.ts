import type {
  AdminDashboard,
  AppState,
  CartLine,
  Driver,
  DriverCompliance,
  DispatchOffer,
  MerchantFinance,
  GeoPoint,
  PublicRideTracking,
  RealtimeEvent,
  Restaurant,
  RoadRoute,
  Ride,
  RideQuote,
  RideForm,
  ShipmentQuote,
  Shipment,
  DeliveryEvidence,
  User,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:4000/api";
const TOKEN_KEY = "flash_platform_token";
const REFRESH_KEY = "flash_platform_refresh";
const EVENT_CURSOR_KEY = "flash_platform_event_cursor";

let authToken = "";
let activeAudience: "customer" | "merchant" | "driver" | "operations" = "customer";
let refreshToken =
  typeof window === "undefined"
    ? ""
    : window.localStorage.getItem(REFRESH_KEY) || "";

type ApiEnvelope<T> = T & {
  ok: boolean;
  message?: string;
};

export function setAuthToken(token: string) {
  authToken = token;
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
}

export function clearAuthToken() {
  authToken = "";
  refreshToken = "";
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.sessionStorage.removeItem(EVENT_CURSOR_KEY);
  }
}

function persistRefreshToken(token: string) {
  refreshToken = token;
  if (typeof window !== "undefined") window.localStorage.removeItem(REFRESH_KEY);
}

async function refreshAccessToken() {
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Flash-Client": "web" },
    body: JSON.stringify({ ...(refreshToken ? { refreshToken } : {}), deviceName: "Flash Web" }),
  });
  if (!response.ok) {
    clearAuthToken();
    return false;
  }
  const session = (await response.json()) as {
    token: string;
    refreshToken?: string;
  };
  if (!session.token) {
    clearAuthToken();
    return false;
  }
  setAuthToken(session.token);
  persistRefreshToken(session.refreshToken || "");
  return true;
}

export function subscribeToEvents(
  onEvent: (event: RealtimeEvent) => void,
  onStatus: (
    status: "connecting" | "live" | "reconnecting" | "offline",
  ) => void,
) {
  const controller = new AbortController();
  let stopped = false;
  let retryTimer: number | undefined;
  let retryAttempt = 0;
  let lastEventId =
    typeof window === "undefined"
      ? 0
      : Number(window.sessionStorage.getItem(EVENT_CURSOR_KEY) || 0);
  if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) lastEventId = 0;

  const connect = async () => {
    if (stopped || !authToken) return;
    onStatus("connecting");
    try {
      const response = await fetch(`${API_BASE}/events`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          ...(lastEventId ? { "Last-Event-ID": String(lastEventId) } : {}),
        },
        signal: controller.signal,
      });
      if (response.status === 401 && (await refreshAccessToken())) {
        retryAttempt = 0;
        return connect();
      }
      if (!response.ok || !response.body)
        throw new Error("Realtime no disponible");
      retryAttempt = 0;
      onStatus("live");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) throw new Error("Realtime desconectado");
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        chunks.forEach((chunk) => {
          const eventLine = chunk
            .split("\n")
            .find((line) => line.startsWith("event: "));
          const eventType = eventLine?.slice(7) || "message";
          const idLine = chunk
            .split("\n")
            .find((line) => line.startsWith("id: "));
          const cursor = idLine ? Number(idLine.slice(4)) : 0;
          if (
            eventType === "state.updated" &&
            Number.isSafeInteger(cursor) &&
            cursor > 0 &&
            cursor <= lastEventId
          )
            return;
          const dataLine = chunk
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) return;
          try {
            onEvent(JSON.parse(dataLine.slice(6)) as RealtimeEvent);
            if (
              eventType === "state.updated" &&
              Number.isSafeInteger(cursor) &&
              cursor > lastEventId
            ) {
              lastEventId = cursor;
              window.sessionStorage.setItem(EVENT_CURSOR_KEY, String(cursor));
            }
          } catch (_error) {
            // Ignore malformed event frames and keep the stream alive.
          }
        });
      }
    } catch (_error) {
      if (stopped || controller.signal.aborted) return;
      onStatus("reconnecting");
      const delay =
        Math.min(30000, 1000 * 2 ** Math.min(retryAttempt, 5)) +
        Math.floor(Math.random() * 500);
      retryAttempt += 1;
      retryTimer = window.setTimeout(connect, delay);
    }
  };

  void connect();
  return () => {
    stopped = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    controller.abort();
    onStatus("offline");
  };
}

async function request<T>(
  path: string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const { headers, ...requestInit } = init || {};
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  requestHeaders.set("X-Flash-Client", "web");
  if (authToken && !requestHeaders.has("Authorization")) {
    requestHeaders.set("Authorization", `Bearer ${authToken}`);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...requestInit,
    credentials: "include",
    headers: requestHeaders,
  });
  if (
    response.status === 401 &&
    retry &&
    path !== "/auth/login" &&
    (await refreshAccessToken())
  ) {
    return request<T>(path, init, false);
  }
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "No se pudo completar la accion");
  }
  return payload as T;
}

export const api = {
  async getDriverOffers() {
    return request<{ offers: DispatchOffer[] }>("/driver/offers");
  },
  async rejectDriverOffer(offerId: string) {
    return request<{ rejected: boolean }>(`/driver/offers/${offerId}/reject`, {
      method: "POST",
      body: "{}",
    });
  },
  async state() {
    const[bootstrap,activity,catalog,driverContext,merchantContext,assignedDrivers,operationsRestaurants,operationsDrivers,operationsUsers,operationsSupport,configuration,operationsAudit,accountContext]=await Promise.all([request<{state:Omit<AppState,"orders"|"rides"|"shipments">&{restaurants?:Restaurant[];drivers?:Driver[];users?:User[];supportTickets?:import("./types").SupportTicket[];zones?:AppState["zones"];promotions?:AppState["promotions"];auditEvents?:AppState["auditEvents"]};audience:string}>(`/bootstrap/${activeAudience}`),this.getActivity(undefined,50),["customer","driver"].includes(activeAudience)?this.getCatalog(undefined,50):Promise.resolve(null),activeAudience==="driver"?this.getCurrentDriver():Promise.resolve(null),activeAudience==="merchant"?this.getCurrentMerchant():Promise.resolve(null),["customer","merchant"].includes(activeAudience)?this.getAssignedDrivers():Promise.resolve(null),activeAudience==="operations"?this.getOperationsRestaurants(undefined,100):Promise.resolve(null),activeAudience==="operations"?this.getOperationsDrivers(undefined,100):Promise.resolve(null),activeAudience==="operations"?this.getOperationsUsers(undefined,100):Promise.resolve(null),activeAudience==="operations"?this.getOperationsSupportTickets(undefined,100):Promise.resolve(null),this.getRuntimeConfiguration(),activeAudience==="operations"?this.getOperationsAuditEvents(undefined,100):Promise.resolve(null),this.getAccountContext()]);
    const account=accountContext.account;
    return{...bootstrap,state:{...bootstrap.state,addresses:account.addresses,paymentMethods:account.paymentMethods,walletTransactions:account.walletTransactions,ratings:account.ratings,favoriteRestaurantIds:account.favoriteRestaurantIds||[],tips:account.tips||[],zones:configuration.zones,promotions:configuration.promotions,auditEvents:operationsAudit?.events||bootstrap.state.auditEvents||[],users:operationsUsers?.users||bootstrap.state.users||[],supportTickets:operationsSupport?.tickets||account.supportTickets||[],restaurants:operationsRestaurants?.restaurants||merchantContext?.restaurants||catalog?.restaurants||bootstrap.state.restaurants||[],drivers:operationsDrivers?.drivers||(driverContext?[driverContext.driver]:(assignedDrivers?.drivers||bootstrap.state.drivers||[])),orders:activity.items.filter(item=>item.kind==="order").map(item=>item.resource) as AppState["orders"],rides:activity.items.filter(item=>item.kind==="ride").map(item=>item.resource) as AppState["rides"],shipments:activity.items.filter(item=>item.kind==="shipment").map(item=>item.resource) as AppState["shipments"]} as AppState};
  },
  async getCurrentDriver(){return request<{driver:Driver}>("/driver/me");},
  async getCurrentMerchant(){return request<{restaurants:Restaurant[]}>("/merchant/me");},
  async getAssignedDrivers(){return request<{drivers:Driver[]}>("/me/assigned-drivers");},
  async getOperationsRestaurants(cursor?:string,limit=50,query=""){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{}),...(query?{q:query}:{})});return request<{restaurants:Restaurant[];nextCursor:string|null}>(`/operations/restaurants?${params}`);},
  async getOperationsDrivers(cursor?:string,limit=50,query=""){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{}),...(query?{q:query}:{})});return request<{drivers:Driver[];nextCursor:string|null}>(`/operations/drivers?${params}`);},
  async getOperationsUsers(cursor?:string,limit=50,query=""){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{}),...(query?{q:query}:{})});return request<{users:User[];nextCursor:string|null}>(`/operations/users?${params}`);},
  async getOperationsSupportTickets(cursor?:string,limit=50,query=""){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{}),...(query?{q:query}:{})});return request<{tickets:import("./types").SupportTicket[];nextCursor:string|null}>(`/operations/support-tickets?${params}`);},
  async getOperationsAuditEvents(cursor?:string,limit=50,query=""){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{}),...(query?{q:query}:{})});return request<{events:AppState["auditEvents"];nextCursor:string|null}>(`/operations/audit-events?${params}`);},
  async getRuntimeConfiguration(){const[zones,promotions]=await Promise.all([request<{zones:AppState["zones"]}>("/zones"),request<{promotions:AppState["promotions"]}>("/promotions")]);return{zones:zones.zones,promotions:promotions.promotions};},
  async getPaymentClientConfiguration(merchantId?:string){return request<{provider:"mercadopago"|"disabled";publicKey:string|null;merchantReady:boolean;cardDataHandling:"provider_tokenization_only"}>(`/payment-provider/client-configuration${merchantId?`?merchantId=${encodeURIComponent(merchantId)}`:""}`);},
  async getAccountContext(){return request<{account:{user:User;addresses:AppState["addresses"];paymentMethods:AppState["paymentMethods"];walletTransactions:AppState["walletTransactions"];supportTickets:AppState["supportTickets"];ratings:AppState["ratings"];favoriteRestaurantIds:string[];tips:NonNullable<AppState["tips"]>}}>("/me");},
  async getActivity(cursor?:string,limit=20){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{})});return request<{items:Array<{id:string;kind:"order"|"ride"|"shipment";createdAt:string;resource:unknown}>;nextCursor:string|null}>(`/me/activity?${params}`);},
  async getCatalog(cursor?:string,limit=20,query=""){const params=new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{}),...(query?{q:query}:{})});return request<{restaurants:Restaurant[];nextCursor:string|null}>(`/catalog/restaurants?${params}`);},
  async route(from: GeoPoint, to: GeoPoint) {
    const params = new URLSearchParams({
      fromLat: String(from.lat),
      fromLng: String(from.lng),
      toLat: String(to.lat),
      toLng: String(to.lng),
    });
    return request<{ route: RoadRoute; provider: string }>(
      `/maps/route?${params.toString()}`,
    );
  },

  async geocode(query: string) {
    return request<{
      results: Array<{ label: string; point: GeoPoint; type: string }>;
      provider: string;
    }>(`/maps/geocode?q=${encodeURIComponent(query)}`);
  },

  async updateProfile(payload: {
    name: string;
    phone: string;
    defaultAddress: string;
  }) {
    return request<{ account: { user: User } }>("/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async topUpWallet(amount: number) {
    return request<{ account: { user: User } }>("/wallet/topup", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ amount }),
    });
  },

  async adminDashboard() {
    return request<{ dashboard: AdminDashboard }>("/admin/dashboard");
  },

  async login(email: string, password: string) {
    const session = await request<{
      user: User;
      token?: string;
      refreshToken?: string;
      mfaRequired?: boolean;
      mfaChallenge?: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (session.token) {
      setAuthToken(session.token);
      persistRefreshToken(session.refreshToken || "");
    }
    return session;
  },
  async createAddress(payload: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    isDefault: boolean;
  }) {
    return request<{
      address: AppState["addresses"][number];
      addresses: AppState["addresses"];
    }>("/addresses", { method: "POST", body: JSON.stringify(payload) });
  },
  async updateAddress(
    addressId: string,
    payload: {
      label: string;
      address: string;
      lat: number;
      lng: number;
      isDefault: boolean;
    },
  ) {
    return request<{
      address: AppState["addresses"][number];
      addresses: AppState["addresses"];
    }>(`/addresses/${addressId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  async setDefaultAddress(addressId: string) {
    return request<{
      address: AppState["addresses"][number];
      addresses: AppState["addresses"];
    }>(`/addresses/${addressId}/default`, { method: "PATCH", body: "{}" });
  },
  async deleteAddress(addressId: string) {
    return request<{ deleted: boolean; addresses: AppState["addresses"] }>(
      `/addresses/${addressId}`,
      { method: "DELETE" },
    );
  },
  async completeMfa(challenge: string, code: string) {
    const session = await request<{
      user: User;
      token: string;
      refreshToken?: string;
    }>("/auth/mfa/complete", {
      method: "POST",
      body: JSON.stringify({ challenge, code, deviceName: "Flash Web" }),
    });
    setAuthToken(session.token);
    activeAudience=session.user.roles.includes("admin")?"operations":session.user.roles.includes("merchant")?"merchant":session.user.roles.includes("driver")?"driver":"customer";
    persistRefreshToken(session.refreshToken || "");
    return session;
  },
  async getMfaStatus() {
    return request<{
      mfa: {
        enabled: boolean;
        method: string;
        confirmedAt: string | null;
        lockedUntil: string | null;
        recoveryCodesRemaining: number;
      };
    }>("/auth/mfa/status");
  },
  async enrollMfa() {
    return request<{
      enrollment: {
        secret: string;
        otpauthUri: string;
        recoveryCodes: string[];
      };
    }>("/auth/mfa/enroll", { method: "POST", body: "{}" });
  },
  async confirmMfa(code: string) {
    const session = await request<{
      mfa: {
        enabled: boolean;
        method: string;
        confirmedAt: string | null;
        lockedUntil: string | null;
        recoveryCodesRemaining: number;
      };
      token: string;
      refreshToken?: string;
    }>("/auth/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code, deviceName: "Flash Web" }),
    });
    setAuthToken(session.token);
    persistRefreshToken(session.refreshToken || "");
    return session;
  },
  async getMerchantFinance(merchantId: string) {
    return request<{ finance: MerchantFinance }>(
      `/merchant/finance?merchantId=${encodeURIComponent(merchantId)}`,
    );
  },
  async getMerchantPaymentConnection(merchantId:string){return request<{connection:import("./types").MerchantPaymentConnection|null;configured:boolean}>(`/merchant/payment-provider?merchantId=${encodeURIComponent(merchantId)}`);},
  async beginMerchantPaymentConnection(merchantId:string){return request<{authorizationUrl:string;expiresAt:string}>("/merchant/payment-provider/connect",{method:"POST",body:JSON.stringify({merchantId})});},
  async disconnectMerchantPaymentConnection(merchantId:string,password:string){return request<{connection:import("./types").MerchantPaymentConnection}>("/merchant/payment-provider/disconnect",{method:"POST",body:JSON.stringify({merchantId,password})});},
  async authorizeMerchantPayout(merchantId: string, amount: number, password: string) {
    return request<{ authorizationToken:string;expiresAt:string;merchantId:string;amount:number }>("/merchant/payouts/authorize", {
      method:"POST",
      body:JSON.stringify({merchantId,amount,password}),
    });
  },
  async requestMerchantPayout(merchantId: string, amount: number, authorizationToken:string) {
    return request<{ finance: MerchantFinance }>("/merchant/payouts", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ merchantId, amount, authorizationToken }),
    });
  },
  async getAdminPayouts() {
    return request<{ payouts: import("./types").PayoutReview[] }>(
      "/admin/payouts",
    );
  },
  async reviewPayout(
    id: string,
    decision: "approved" | "rejected",
    note: string,
  ) {
    return request<{ payout: import("./types").PayoutReview }>(
      `/admin/payouts/${id}/review`,
      { method: "PATCH", body: JSON.stringify({ decision, note }) },
    );
  },
  async getTipAdjustments() {
    return request<{ adjustments: import("./types").TipAdjustment[] }>(
      "/admin/tip-adjustments",
    );
  },
  async requestTipAdjustment(tipId: string, amount: number, reason: string) {
    return request<{ adjustment: import("./types").TipAdjustment }>(
      "/admin/tip-adjustments",
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ tipId, amount, reason }),
      },
    );
  },
  async reviewTipAdjustment(
    id: string,
    decision: "approved" | "rejected",
    note: string,
  ) {
    return request<{ adjustment: import("./types").TipAdjustment }>(
      `/admin/tip-adjustments/${id}/review`,
      { method: "PATCH", body: JSON.stringify({ decision, note }) },
    );
  },
  async getSupportAgents() {
    return request<{ agents: import("./types").SupportAgent[] }>(
      "/admin/support/agents",
    );
  },
  async updateSupportAgent(
    userId: string,
    payload: {
      availability?: import("./types").SupportAgent["availability"];
      maxActiveTickets?: number;
      skills?: string[];
    },
  ) {
    return request<{ agent: import("./types").SupportAgent }>(
      `/admin/support/agents/${userId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },
  async processSupportQueue(limit = 50) {
    return request<{
      result: {
        assigned: Array<{ ticketId: string; agentId: string }>;
        escalated: Array<{
          ticketId: string;
          level: number;
          breachKind: string;
        }>;
      };
    }>("/admin/support/process", {
      method: "POST",
      body: JSON.stringify({ limit }),
    });
  },
  async updateSupportTicket(
    ticketId: string,
    payload: {
      status?: import("./types").SupportTicket["status"];
      priority?: "low" | "normal" | "high" | "urgent";
      assignedTo?: string;
    },
  ) {
    return request<{ ticket: import("./types").SupportTicket }>(
      `/support/tickets/${ticketId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },
  async getNotificationDeadLetters() {
    return request<{ deadLetters: import("./types").NotificationDeadLetter[] }>(
      "/admin/notifications/dead-letters",
    );
  },
  async processNotifications(limit = 100) {
    return request<{
      result: { claimed: number; outcomes: Array<Record<string, unknown>> };
    }>("/admin/notifications/process", {
      method: "POST",
      body: JSON.stringify({ limit }),
    });
  },
  async replayNotificationDeadLetter(id: string) {
    return request<{ deadLetter: import("./types").NotificationDeadLetter }>(
      `/admin/notifications/dead-letters/${id}/replay`,
      { method: "POST", body: "{}" },
    );
  },

  async setFavorite(restaurantId: string, favorite: boolean) {
    return request<{ restaurantIds: string[] }>(`/favorites/${restaurantId}`, {
      method: "PUT",
      body: JSON.stringify({ favorite }),
    });
  },

  async createRating(
    jobId: string,
    subjectType: "driver" | "merchant" | "customer",
    score: number,
    comment = "",
  ) {
    return request<{ rating: AppState["ratings"][number] }>("/ratings", {
      method: "POST",
      body: JSON.stringify({ jobId, subjectType, score, tags: [], comment }),
    });
  },
  async createOrderIssue(
    orderId: string,
    payload: {
      category:
        | "missing_item"
        | "wrong_item"
        | "damaged_item"
        | "quality"
        | "late"
        | "other";
      description: string;
      requestedRefund: number;
    },
  ) {
    return request<{ issue: import("./types").OrderIssue }>(
      `/orders/${orderId}/issues`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async getOrderIssues(orderId: string) {
    return request<{ issues: import("./types").OrderIssue[] }>(
      `/orders/${orderId}/issues`,
    );
  },
  async resolveOrderIssue(
    issueId: string,
    payload: {
      status: "approved" | "rejected";
      approvedRefund: number;
      resolutionNote: string;
    },
  ) {
    return request<{ issue: import("./types").OrderIssue }>(
      `/order-issues/${issueId}/resolve`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },
  async proposeOrderSubstitution(
    orderId: string,
    payload: {
      originalMenuItemId: string;
      replacementMenuItemId: string;
      reason: string;
    },
  ) {
    return request<{ substitution: import("./types").OrderSubstitution }>(
      `/orders/${orderId}/substitutions`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async getOrderSubstitutions(orderId: string) {
    return request<{ substitutions: import("./types").OrderSubstitution[] }>(
      `/orders/${orderId}/substitutions`,
    );
  },
  async decideOrderSubstitution(
    substitutionId: string,
    decision: "accepted" | "rejected",
  ) {
    return request<{ substitution: import("./types").OrderSubstitution }>(
      `/order-substitutions/${substitutionId}`,
      { method: "PATCH", body: JSON.stringify({ decision }) },
    );
  },

  async restoreSession() {
    if (!authToken && !(await refreshAccessToken())) return null;
    try {
      const account = await request<{ account: { user: User } }>("/me");
      activeAudience=account.account.user.roles.includes("admin")?"operations":account.account.user.roles.includes("merchant")?"merchant":account.account.user.roles.includes("driver")?"driver":"customer";
      return account.account.user;
    } catch (_error) {
      clearAuthToken();
      return null;
    }
  },

  async logout() {
    const legacyToken = refreshToken;
    clearAuthToken();
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Flash-Client": "web" },
      body: JSON.stringify(legacyToken ? { refreshToken: legacyToken } : {}),
    });
  },

  async createOrder(payload: {
    customerId: string;
    restaurantId: string;
    deliveryAddressId?: string;
    branchId?: string;
    deliveryAddress: string;
    paymentMethod: string;
    paymentMethodId?:string;
    providerPayment?:{cardToken:string;paymentMethodId:string;installments:number};
    promotionCode?: string;
    items: Array<
      Pick<CartLine, "quantity" | "extras" | "note"> & { menuItemId: string }
    >;
  }) {
    if (!payload.deliveryAddressId)
      throw new Error("Selecciona una dirección guardada antes de confirmar");
    const { quote } = await request<{ quote: { quoteToken: string } }>(
      "/orders/quote",
      {
        method: "POST",
        body: JSON.stringify({
          customerId: payload.customerId,
          restaurantId: payload.restaurantId,
          deliveryAddressId: payload.deliveryAddressId,
          branchId: payload.branchId,
          paymentMethod:payload.paymentMethod,
          paymentMethodId:payload.paymentMethodId,
          promotionCode:payload.promotionCode,
          items:payload.items,
        }),
      },
    );
    return request<{ order: AppState["orders"][number]; label: string }>(
      "/orders",
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...payload, quoteToken: quote.quoteToken }),
      },
    );
  },

  async cart() {
    return request<{ cart: CartLine[] }>("/cart");
  },

  async saveCart(restaurantId: string, cart: CartLine[]) {
    return request<{ cart: CartLine[] }>("/cart", {
      method: "PUT",
      body: JSON.stringify({
        restaurantId,
        items: cart.map((line) => ({
          menuItemId: line.item.id,
          quantity: line.quantity,
          extras: line.extras,
          note: line.note,
        })),
      }),
    });
  },

  async advanceOrder(orderId: string) {
    return request<{ order: AppState["orders"][number]; label: string }>(
      `/orders/${orderId}/advance`,
      {
        method: "POST",
      },
    );
  },

  async acceptDelivery(orderId: string, driverId: string) {
    return request<{ order: AppState["orders"][number]; label: string }>(
      `/orders/${orderId}/accept-delivery`,
      {
        method: "POST",
        body: JSON.stringify({ driverId }),
      },
    );
  },

  async setOrderStatus(
    orderId: string,
    status: string,
    reason = "changed_mind",
  ) {
    return request<{ order: AppState["orders"][number]; label: string }>(
      `/orders/${orderId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(status === "cancelled" ? { reason } : {}),
        }),
      },
    );
  },

  async quoteRide(
    payload: Pick<
      RideForm,
      | "pickup"
      | "destination"
      | "service"
      | "pickupCoords"
      | "destinationCoords"
    >,
  ) {
    const response = await request<{ options: RideQuote[] }>("/rides/options", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const quote = response.options.find((option) => option.service === payload.service);
    if (!quote?.quoteToken) throw new Error("No hay una cotización vigente para esa categoría");
    return { quote };
  },

  async quoteShipment(payload: {
    pickup: string;
    destination: string;
    packageSize: Shipment["packageSize"];
    weightKg: number;
    declaredValue?: number;
    protection?: Shipment["protection"];
    signatureRequired?: boolean;
    itemCategory?: Shipment["itemCategory"];
    serviceLevel?: Shipment["serviceLevel"];
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
  }) {
    return request<{ quote: ShipmentQuote }>("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async createShipment(payload: {
    customerId: string;
    pickup: string;
    destination: string;
    recipientName: string;
    recipientPhone: string;
    packageSize: Shipment["packageSize"];
    description: string;
    weightKg: number;
    declaredValue?: number;
    protection?: Shipment["protection"];
    signatureRequired?: boolean;
    itemCategory?: Shipment["itemCategory"];
    serviceLevel?: Shipment["serviceLevel"];
    deliveryNotes: string;
    paymentMethod: string;
    termsAccepted: true;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
    quoteToken: string;
  }) {
    return request<{ shipment: Shipment }>("/shipments", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
  },

  async createRide(payload: {
    customerId: string;
    pickup: string;
    destination: string;
    service: Ride["service"];
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
    paymentMethod: string;
    quoteToken: string;
  }) {
    return request<{ ride: Ride; label: string }>("/rides", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
  },

  async acceptRide(rideId: string, driverId: string) {
    return request<{ ride: Ride; label: string }>(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId }),
    });
  },

  async acceptShipment(shipmentId: string, driverId: string) {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId }),
    });
  },

  async setShipmentStatus(
    shipmentId: string,
    status: "cancelled",
    reason = "changed_mind",
  ) {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  },

  async getShipmentDeliveryCode(shipmentId: string) {
    return request<{ deliveryCode: string }>(
      `/shipments/${shipmentId}/delivery-code`,
    );
  },

  async getShipmentDeliveryEvidence(shipmentId: string) {
    return request<{ evidence: DeliveryEvidence[] }>(
      `/shipments/${shipmentId}/delivery-evidence`,
    );
  },

  async advanceRide(rideId: string) {
    return request<{ ride: Ride; label: string }>(`/rides/${rideId}/advance`, {
      method: "POST",
    });
  },

  async setRideStatus(rideId: string, status: string, reason = "changed_mind") {
    return request<{ ride: Ride; label: string }>(`/rides/${rideId}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        ...(status === "cancelled" ? { reason } : {}),
      }),
    });
  },

  async createRideTrackingLink(rideId: string, ttlMinutes = 180) {
    return request<{
      link: { id: string; trackingUrl: string; expiresAt: string };
    }>(`/rides/${rideId}/tracking-links`, {
      method: "POST",
      body: JSON.stringify({ ttlMinutes }),
    });
  },

  async createRideSafetyIncident(
    rideId: string,
    input: {
      type: "sos" | "unsafe_driving" | "medical" | "harassment" | "crash" | "other";
      details?: string;
      location?: GeoPoint;
    },
  ) {
    return request<{
      incident: { id: string; rideId: string; type: string; status: string; createdAt: string };
    }>(`/rides/${rideId}/safety-incidents`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async getRidePickupCode(rideId: string) {
    return request<{ pickupCode: string }>(`/rides/${rideId}/pickup-code`);
  },

  async getPublicRideTracking(token: string) {
    return request<{ tracking: PublicRideTracking }>(
      `/public/rides/track/${encodeURIComponent(token)}`,
    );
  },

  async updateDriver(
    driverId: string,
    payload: Partial<Pick<Driver, "online" | "activeService">>,
  ) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/availability`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async updateDriverLocation(
    driverId: string,
    payload: GeoPoint & { label?: string },
  ) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/location`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async updateRestaurant(
    restaurantId: string,
    payload: Partial<Pick<Restaurant, "open" | "etaMin">>,
  ) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async updateMenuStock(restaurantId: string, itemId: string, stock: boolean) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/menu/${itemId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ stock }),
      },
    );
  },

  async addMenuItem(
    restaurantId: string,
    payload: {
      name: string;
      description: string;
      category: string;
      price: number;
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/menu`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  async replaceItemModifiers(
    restaurantId: string,
    itemId: string,
    groups: NonNullable<Restaurant["menu"][number]["modifierGroups"]>,
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/menu/${itemId}/modifiers`,
      {
        method: "PUT",
        body: JSON.stringify({
          groups: groups.map((group) => ({ ...group, active: true })),
        }),
      },
    );
  },
  async replaceItemDietary(
    restaurantId: string,
    itemId: string,
    payload: {
      dietaryLabels: string[];
      allergens: Array<{ code: string; presence: "contains" | "may_contain" }>;
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/menu/${itemId}/dietary`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  async getDietaryPreferences(){return request<{preferences:import("./types").DietaryPreferences}>("/dietary-preferences");},
  async updateDietaryPreferences(input:{dietaryLabels:string[];avoidedAllergens:string[];hideIncompatible:boolean}){return request<{preferences:import("./types").DietaryPreferences}>("/dietary-preferences",{method:"PUT",body:JSON.stringify(input)});},
  async getDriverCompliance(driverId: string) {
    return request<{ compliance: DriverCompliance }>(
      `/drivers/${driverId}/compliance`,
    );
  },
  async getDriverVehicles(driverId:string,includeRetired=false){return request<{vehicles:import("./types").DriverVehicle[]}>(`/drivers/${driverId}/vehicles${includeRetired?"?includeRetired=true":""}`);},
  async reviewDriverVehicle(vehicleId:string,status:"approved"|"rejected",rejectionReason?:string){return request<{vehicle:import("./types").DriverVehicle}>(`/admin/driver-vehicles/${vehicleId}/review`,{method:"PATCH",body:JSON.stringify({status,rejectionReason:rejectionReason||null})});},
  async reviewDriverDocument(
    documentId: string,
    status: "approved" | "rejected",
    rejectionReason?: string,
  ) {
    return request<{ compliance: DriverCompliance }>(
      `/admin/driver-documents/${documentId}/review`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status,
          rejectionReason: rejectionReason || null,
        }),
      },
    );
  },
  async updateBranch(
    restaurantId: string,
    branchId: string,
    payload: {
      open?: boolean;
      etaMin?: number;
      status?: "active" | "paused" | "closed";
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },
  async replaceBranchSchedule(
    restaurantId: string,
    branchId: string,
    payload: {
      timezone: string;
      hours: Array<{
        weekday: number;
        opensAt: string;
        closesAt: string;
        enabled: boolean;
      }>;
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}/schedule`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  async upsertBranchScheduleException(
    restaurantId: string,
    branchId: string,
    payload: {
      date: string;
      isOpen: boolean;
      opensAt?: string;
      closesAt?: string;
      reason?: string;
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}/schedule-exceptions`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  async updateBranchInventory(
    restaurantId: string,
    branchId: string,
    itemId: string,
    payload: { available: boolean; stockQuantity?: number | null },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}/inventory/${itemId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },

  async updateUserStatus(
    userId: string,
    status: "active" | "suspended",
    reason: string,
  ) {
    return request<{
      moderation: {
        id: string;
        status: string;
        revokedSessions: number;
        withdrawnOffers: number;
      };
    }>(`/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  },
  async getShipmentOptions() {
    return request<import("./types").ShipmentOptions>("/shipment-options");
  },
  async getAdminShipmentOptions() {
    return request<import("./types").ShipmentOptions>(
      "/admin/shipment-options",
    );
  },
  async getAdminServiceQuickReplies() {
    return request<{ quickReplies: import("./types").ServiceQuickReply[] }>(
      "/admin/service-chat/quick-replies",
    );
  },
  async createServiceQuickReply(
    input: Omit<import("./types").ServiceQuickReply, "id" | "updatedAt">,
  ) {
    return request<{ quickReply: import("./types").ServiceQuickReply }>(
      "/admin/service-chat/quick-replies",
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  async updateServiceQuickReply(
    id: string,
    input: Partial<
      Omit<import("./types").ServiceQuickReply, "id" | "updatedAt">
    >,
  ) {
    return request<{ quickReply: import("./types").ServiceQuickReply }>(
      `/admin/service-chat/quick-replies/${id}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  async getShipmentClaims() {
    return request<{ claims: import("./types").ShipmentClaim[] }>(
      "/shipment-claims",
    );
  },
  async updateShipmentClaim(
    id: string,
    input: {
      status: import("./types").ShipmentClaim["status"];
      resolutionNote: string;
      approvedAmount?: number;
    },
  ) {
    return request<{ claim: import("./types").ShipmentClaim }>(
      `/shipment-claims/${id}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  async getShipmentClaimEvidenceContent(evidenceId: string) {
    return request<{
      evidence: import("./types").ShipmentClaimEvidence;
      contentBase64: string;
    }>(`/shipment-claim-evidence/${evidenceId}/content`);
  },
  async getPaymentReconciliation() {
    return request<import("./types").PaymentReconciliation>(
      "/admin/payment-reconciliation",
    );
  },
  async scanPaymentReconciliation() {
    return request<import("./types").PaymentReconciliation>(
      "/admin/payment-reconciliation/scan",
      { method: "POST" },
    );
  },
  async resolvePaymentReconciliationCase(
    id: string,
    status: "resolved" | "ignored",
    resolutionNote: string,
  ) {
    return request<{ case: import("./types").PaymentReconciliationCase }>(
      `/admin/payment-reconciliation/${id}`,
      { method: "PATCH", body: JSON.stringify({ status, resolutionNote }) },
    );
  },
  async getTransactionRisks() {
    return request<{
      assessments: import("./types").TransactionRiskAssessment[];
    }>("/admin/transaction-risks");
  },
  async reviewTransactionRisk(
    id: string,
    reviewStatus: "confirmed_fraud" | "false_positive" | "cleared",
    reviewNote: string,
  ) {
    return request<{ assessment: import("./types").TransactionRiskAssessment }>(
      `/admin/transaction-risks/${id}`,
      { method: "PATCH", body: JSON.stringify({ reviewStatus, reviewNote }) },
    );
  },
  async getPricingPlans() {
    return request<{ plans: import("./types").PricingPlan[] }>("/pricing");
  },
  async getPricingChanges() {
    return request<{ requests: import("./types").PricingChangeRequest[] }>(
      "/admin/pricing-changes",
    );
  },
  async requestPricingChange(
    service: import("./types").PricingService,
    payload: {
      version: string;
      config: Record<string, unknown>;
      effectiveAt: string;
    },
  ) {
    return request<{ changeRequest: import("./types").PricingChangeRequest }>(
      `/admin/pricing/${service}`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async requestPricingRollback(
    service: import("./types").PricingService,
    payload: { targetVersion: string; version: string; effectiveAt: string },
  ) {
    return request<{ changeRequest: import("./types").PricingChangeRequest }>(
      `/admin/pricing/${service}/rollback`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async reviewPricingChange(
    requestId: string,
    decision: "approved" | "rejected",
    note: string,
  ) {
    return request<{ changeRequest: import("./types").PricingChangeRequest }>(
      `/admin/pricing-changes/${requestId}/review`,
      { method: "PATCH", body: JSON.stringify({ decision, note }) },
    );
  },
  async updateShipmentItemCategory(
    code: string,
    payload: {
      name?: string;
      handlingInstructions?: string;
      surcharge?: number;
      maximumWeightKg?: number;
      active?: boolean;
    },
  ) {
    return request<{
      category: import("./types").ShipmentOptions["categories"][number];
    }>(`/admin/shipment-item-categories/${code}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async updateShipmentServiceLevel(
    code: string,
    payload: {
      name?: string;
      transportMultiplier?: number;
      etaMultiplier?: number;
      maximumDistanceKm?: number | null;
      active?: boolean;
    },
  ) {
    return request<{
      serviceLevel: import("./types").ShipmentOptions["serviceLevels"][number];
    }>(`/admin/shipment-service-levels/${code}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async reset() {
    return request<{ state: AppState }>("/reset", {
      method: "POST",
    });
  },
};
