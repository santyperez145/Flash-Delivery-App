// Viajes, envíos y conductor web (ARC-001).
import type {
  DeliveryEvidence,
  DispatchOffer,
  Driver,
  DriverCompliance,
  GeoPoint,
  PublicRideTracking,
  Ride,
  RideForm,
  RideQuote,
  RoadRoute,
  Shipment,
  ShipmentQuote,
} from "../types";
import { request } from "./http";

export const mobilityApi = {
  async getDriverOffers() {
    return request<{ offers: DispatchOffer[] }>("/driver/offers");
  },
  async rejectDriverOffer(offerId: string) {
    return request<{ rejected: boolean }>(`/driver/offers/${offerId}/reject`, {
      method: "POST",
      body: "{}",
    });
  },
  async getCurrentDriver() {
    return request<{ driver: Driver }>("/driver/me");
  },
  async getAssignedDrivers() {
    return request<{ drivers: Driver[] }>("/me/assigned-drivers");
  },
  async route(from: GeoPoint, to: GeoPoint) {
    const params = new URLSearchParams({
      fromLat: String(from.lat),
      fromLng: String(from.lng),
      toLat: String(to.lat),
      toLng: String(to.lng),
    });
    return request<{ route: RoadRoute; provider: string }>(`/maps/route?${params.toString()}`);
  },
  async geocode(query: string) {
    return request<{
      results: Array<{
        label: string;
        point: GeoPoint;
        type: string;
        placeId: string | null;
        validationToken: string;
      }>;
      provider: string;
    }>(`/maps/geocode?q=${encodeURIComponent(query)}`);
  },
  async quoteRide(
    payload: Pick<
      RideForm,
      "pickup" | "destination" | "service" | "pickupCoords" | "destinationCoords"
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
  async setShipmentStatus(shipmentId: string, status: "cancelled", reason = "changed_mind") {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  },
  async getShipmentDeliveryCode(shipmentId: string) {
    return request<{ deliveryCode: string }>(`/shipments/${shipmentId}/delivery-code`);
  },
  async getShipmentDeliveryEvidence(shipmentId: string) {
    return request<{ evidence: DeliveryEvidence[] }>(`/shipments/${shipmentId}/delivery-evidence`);
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
  async updateDriver(driverId: string, payload: Partial<Pick<Driver, "online" | "activeService">>) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/availability`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async updateDriverLocation(driverId: string, payload: GeoPoint & { label?: string }) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/location`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async getDriverCompliance(driverId: string) {
    return request<{ compliance: DriverCompliance }>(`/drivers/${driverId}/compliance`);
  },
  async getDriverVehicles(driverId: string, includeRetired = false) {
    return request<{ vehicles: import("../types").DriverVehicle[] }>(
      `/drivers/${driverId}/vehicles${includeRetired ? "?includeRetired=true" : ""}`,
    );
  },
  async reviewDriverVehicle(
    vehicleId: string,
    status: "approved" | "rejected",
    rejectionReason?: string,
  ) {
    return request<{ vehicle: import("../types").DriverVehicle }>(
      `/admin/driver-vehicles/${vehicleId}/review`,
      {
        method: "PATCH",
        body: JSON.stringify({ status, rejectionReason: rejectionReason || null }),
      },
    );
  },
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
  async getDriverDocumentContent(documentId: string) {
    return request<{
      document: { mimeType: string; sizeBytes: number };
      contentBase64: string;
    }>(`/driver-documents/${documentId}/content`);
  },
  async getShipmentOptions() {
    return request<import("../types").ShipmentOptions>("/shipment-options");
  },
  async getAdminShipmentOptions() {
    return request<import("../types").ShipmentOptions>("/admin/shipment-options");
  },
  async getShipmentReturns() {
    return request<{ returns: import("../types").ShipmentReturn[] }>("/shipment-returns");
  },
  async updateShipmentReturn(
    returnId: string,
    patch: { status: import("../types").ShipmentReturn["status"]; resolutionNote?: string },
  ) {
    return request<{ return: import("../types").ShipmentReturn }>(`/shipment-returns/${returnId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  // El contenido del documento llega en base64, igual que la evidencia de un
  // siniestro: una URL firmada que se pueda compartir deja de estar protegida.,
  async getShipmentClaims() {
    return request<{ claims: import("../types").ShipmentClaim[] }>("/shipment-claims");
  },
  async updateShipmentClaim(
    id: string,
    input: {
      status: import("../types").ShipmentClaim["status"];
      resolutionNote: string;
      approvedAmount?: number;
    },
  ) {
    return request<{ claim: import("../types").ShipmentClaim }>(`/shipment-claims/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  async getShipmentClaimEvidenceContent(evidenceId: string) {
    return request<{
      evidence: import("../types").ShipmentClaimEvidence;
      contentBase64: string;
    }>(`/shipment-claim-evidence/${evidenceId}/content`);
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
      category: import("../types").ShipmentOptions["categories"][number];
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
      serviceLevel: import("../types").ShipmentOptions["serviceLevels"][number];
    }>(`/admin/shipment-service-levels/${code}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  // Suscripción de Flash (GTM-001). El catálogo es público porque el precio
  // tiene que poder verse antes de crear la cuenta; el resto pide sesión y
  // siempre opera sobre la propia, nunca sobre la de otro.
  // Tablero de colas de trabajo (OPS-001). Lo lee `admin` y `support`: quien
  // atiende la cola tiene que poder ver si se está acumulando.
  // Las dos intervenciones de OPS-001. El motivo es obligatorio del lado del
  // servidor; el cliente lo exige antes para no ofrecer un botón que da 400.,
};
