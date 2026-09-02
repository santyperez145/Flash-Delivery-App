// Viajes, envíos y conductor mobile (ARC-001).
import type {
  DeliveryEvidence,
  DispatchOffer,
  Driver,
  GeoPoint,
  Ride,
  RideQuote,
  RideService,
  ServiceMode,
  Shipment,
  ShipmentQuote,
} from "../types";
import { request } from "./http";

export const mobilityApi = {
  async getDriverOffers() {
    return request<{ offers: DispatchOffer[] }>("/driver/offers");
  },
  async getDriverDemand() {
    return request<{ demand: import("../types").DriverDemand }>("/driver/demand-zones");
  },
  async getDriverEarnings() {
    return request<{ earnings: import("../types").DriverEarnings }>("/driver/earnings");
  },
  async getDriverPreferences() {
    return request<{ preferences: import("../types").DriverPreferences }>("/driver/preferences");
  },
  async updateDriverPreferences(
    navigationProvider: import("../types").DriverPreferences["navigationProvider"],
  ) {
    return request<{ preferences: import("../types").DriverPreferences }>("/driver/preferences", {
      method: "PATCH",
      body: JSON.stringify({ navigationProvider }),
    });
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
  async createRideTrackingLink(rideId: string, ttlMinutes = 180) {
    return request<{ link: { id: string; trackingUrl: string; expiresAt: string } }>(
      `/rides/${rideId}/tracking-links`,
      { method: "POST", body: JSON.stringify({ ttlMinutes }) },
    );
  },
  async revokeRideTrackingLink(rideId: string, linkId: string) {
    return request<{ revoked: boolean }>(`/rides/${rideId}/tracking-links/${linkId}`, {
      method: "DELETE",
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
    }>(`/rides/${rideId}/safety-incidents`, { method: "POST", body: JSON.stringify(input) });
  },
  async getDriverCompliance(driverId: string) {
    return request<{ compliance: import("../types").DriverCompliance }>(
      `/drivers/${driverId}/compliance`,
    );
  },
  async submitDriverDocument(
    driverId: string,
    input: {
      type: import("../types").DriverDocument["type"];
      mimeType: "image/jpeg" | "image/png" | "application/pdf";
      contentBase64: string;
      expiresAt?: string | null;
    },
  ) {
    return request<{ document: import("../types").DriverDocument }>(
      `/drivers/${driverId}/documents`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  async getDriverVehicles(driverId: string) {
    return request<{ vehicles: import("../types").DriverVehicle[] }>(
      `/drivers/${driverId}/vehicles`,
    );
  },
  async createDriverVehicle(
    driverId: string,
    input: {
      kind: import("../types").DriverVehicle["kind"];
      model: string;
      plate: string;
      color?: string | null;
      seats?: number | null;
      serviceModes: ServiceMode[];
    },
  ) {
    return request<{ vehicle: import("../types").DriverVehicle }>(`/drivers/${driverId}/vehicles`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async activateDriverVehicle(vehicleId: string) {
    return request<{ vehicle: import("../types").DriverVehicle }>(
      `/driver-vehicles/${vehicleId}/activate`,
      { method: "POST", body: "{}" },
    );
  },
  async retireDriverVehicle(vehicleId: string) {
    return request<{ vehicle: import("../types").DriverVehicle }>(`/driver-vehicles/${vehicleId}`, {
      method: "DELETE",
    });
  },
  // Mover el horario de un servicio reservado (GTM-001). Vale para pedidos y
  // viajes: los dos son trabajos con horario, y la ruta es la misma.,
  async quoteRide(payload: {
    pickup: string;
    destination: string;
    service: RideService;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
  }) {
    return request<{ quote: RideQuote }>("/rides/quote", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async getRideDestinations() {
    return request<{ destinations: import("../types").RideDestination[] }>("/ride-destinations");
  },
  async recordRideDestination(payload: {
    label: string;
    address: string;
    lat: number;
    lng: number;
  }) {
    return request<{
      destination: import("../types").RideDestination;
      destinations: import("../types").RideDestination[];
    }>("/ride-destinations", { method: "POST", body: JSON.stringify(payload) });
  },
  async deleteRideDestination(destinationId: string) {
    return request<{ deleted: boolean; destinations: import("../types").RideDestination[] }>(
      `/ride-destinations/${destinationId}`,
      { method: "DELETE" },
    );
  },
  async getRideTrustedContacts() {
    return request<{ contacts: import("../types").RideTrustedContact[] }>("/ride-trusted-contacts");
  },
  async createRideTrustedContact(payload: {
    name: string;
    relationship: import("../types").RideTrustedContact["relationship"];
    phone: string;
  }) {
    return request<{
      contact: import("../types").RideTrustedContact;
      contacts: import("../types").RideTrustedContact[];
    }>("/ride-trusted-contacts", { method: "POST", body: JSON.stringify(payload) });
  },
  async deleteRideTrustedContact(contactId: string) {
    return request<{ deleted: boolean; contacts: import("../types").RideTrustedContact[] }>(
      `/ride-trusted-contacts/${contactId}`,
      { method: "DELETE" },
    );
  },
  async getRidePickupCode(rideId: string) {
    return request<{ pickupCode: string }>(`/rides/${rideId}/pickup-code`);
  },
  async verifyRidePickup(rideId: string, pin: string) {
    return request<{ verification: { verified: true; verifiedAt: string } }>(
      `/rides/${rideId}/verify-pickup`,
      { method: "POST", body: JSON.stringify({ pin }) },
    );
  },
  async getServiceMessages(jobId: string) {
    return request<{ messages: import("../types").ServiceMessage[]; unreadCount: number }>(
      `/jobs/${jobId}/messages`,
    );
  },
  async markServiceMessagesRead(jobId: string) {
    return request<{ receipt: { readCount: number; readAt: string } }>(
      `/jobs/${jobId}/messages/read`,
      { method: "POST", body: "{}" },
    );
  },
  async sendServiceMessage(
    jobId: string,
    body: string,
    attachment?: {
      fileName: string;
      mimeType: "image/jpeg" | "image/png" | "application/pdf";
      contentBase64: string;
    },
  ) {
    return request<{ message: import("../types").ServiceMessage }>(`/jobs/${jobId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, attachment }),
    });
  },
  async getServiceAttachmentContent(attachmentId: string) {
    return request<{ attachment: import("../types").ServiceAttachment; contentBase64: string }>(
      `/service-message-attachments/${attachmentId}/content`,
    );
  },
  async getServiceQuickReplies(jobId: string, locale = "es-AR") {
    return request<{
      quickReplies: import("../types").ServiceQuickReply[];
      context: { serviceScope: string; audience: string; locale: string };
    }>(`/jobs/${jobId}/quick-replies?locale=${encodeURIComponent(locale)}`);
  },
  async quoteRideOptions(payload: {
    pickup: string;
    destination: string;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
  }) {
    return request<{ options: RideQuote[] }>("/rides/options", {
      method: "POST",
      body: JSON.stringify({ ...payload, service: "economy" }),
    });
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
  async route(from: GeoPoint, to: GeoPoint) {
    const params = new URLSearchParams({
      fromLat: String(from.lat),
      fromLng: String(from.lng),
      toLat: String(to.lat),
      toLng: String(to.lng),
    });
    return request<{
      route: {
        distanceKm: number;
        durationMin: number;
        coordinates: GeoPoint[];
        steps: Array<{
          type: string;
          modifier: string;
          street: string;
          distanceM: number;
          durationSec: number;
          location: GeoPoint;
        }>;
      };
      provider: string;
    }>(`/maps/route?${params.toString()}`);
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
      headers: {
        "Idempotency-Key": `mobile-ride-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(payload),
    });
  },
  async quoteShipment(payload: {
    pickup: string;
    destination: string;
    packageSize: Shipment["packageSize"];
    weightKg: number;
    declaredValue?: number;
    protection?: "none" | "standard";
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
  async getShipmentOptions() {
    return request<import("../types").ShipmentOptions>("/shipment-options");
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
    protection?: "none" | "standard";
    signatureRequired?: boolean;
    itemCategory?: Shipment["itemCategory"];
    serviceLevel?: Shipment["serviceLevel"];
    deliveryNotes: string;
    paymentMethod: string;
    termsAccepted: true;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
    quoteToken?: string;
  }) {
    return request<{ shipment: Shipment }>("/shipments", {
      method: "POST",
      headers: {
        "Idempotency-Key": `mobile-shipment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(payload),
    });
  },
  async getShipmentReturns() {
    return request<{ returns: import("../types").ShipmentReturn[] }>("/shipment-returns");
  },
  async requestShipmentReturn(shipmentId: string, reason: string) {
    return request<{ return: import("../types").ShipmentReturn }>(
      `/shipments/${shipmentId}/returns`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  },
  async getShipmentClaims() {
    return request<{ claims: import("../types").ShipmentClaim[] }>("/shipment-claims");
  },
  async createShipmentClaim(
    shipmentId: string,
    input: {
      claimType: "lost" | "damaged" | "stolen";
      description: string;
      requestedAmount: number;
    },
  ) {
    return request<{ claim: import("../types").ShipmentClaim }>(`/shipments/${shipmentId}/claims`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async addShipmentClaimEvidence(
    claimId: string,
    input: {
      fileName: string;
      mimeType: "image/jpeg" | "image/png" | "application/pdf";
      contentBase64: string;
    },
  ) {
    return request<{ evidence: import("../types").ShipmentClaimEvidence }>(
      `/shipment-claims/${claimId}/evidence`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  async getShipmentClaimEvidenceContent(evidenceId: string) {
    return request<{ evidence: import("../types").ShipmentClaimEvidence; contentBase64: string }>(
      `/shipment-claim-evidence/${evidenceId}/content`,
    );
  },
  async setShipmentStatus(shipmentId: string, status: "cancelled", reason = "changed_mind") {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  },
  async setRideStatus(rideId: string, status: Ride["status"], reason = "changed_mind") {
    return request<{ ride: Ride }>(`/rides/${rideId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...(status === "cancelled" ? { reason } : {}) }),
    });
  },
  async updateDriver(driverId: string, payload: { online?: boolean; activeService?: ServiceMode }) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/availability`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async updateDriverLocation(
    driverId: string,
    payload: GeoPoint & {
      label?: string;
      source?: "foreground" | "background";
      accuracyM?: number;
    },
  ) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/location`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async acceptRide(rideId: string, driverId: string) {
    return request<{ ride: Ride }>(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId }),
    });
  },
  async advanceRide(rideId: string) {
    return request<{ ride: Ride }>(`/rides/${rideId}/advance`, { method: "POST" });
  },
  async acceptShipment(shipmentId: string, driverId: string) {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId }),
    });
  },
  async advanceShipment(shipmentId: string) {
    return request<{ shipment: Shipment }>(`/shipments/${shipmentId}/advance`, { method: "POST" });
  },
  async getShipmentDeliveryCode(shipmentId: string) {
    return request<{ deliveryCode: string }>(`/shipments/${shipmentId}/delivery-code`);
  },
  async addShipmentDeliveryEvidence(
    shipmentId: string,
    input: {
      type: "photo" | "signature";
      mimeType: "image/jpeg" | "image/png" | "image/webp";
      contentBase64: string;
      capturedAt?: string;
      location?: GeoPoint;
      signerName?: string;
      signerRelationship?: "recipient" | "authorized_person";
      consentVersion?: "shipment-receipt-v1";
    },
  ) {
    return request<{ evidence: DeliveryEvidence }>(`/shipments/${shipmentId}/delivery-evidence`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async getShipmentDeliveryEvidence(shipmentId: string) {
    return request<{ evidence: DeliveryEvidence[] }>(`/shipments/${shipmentId}/delivery-evidence`);
  },
  async getShipmentDeliveryEvidenceContent(evidenceId: string) {
    return request<{ evidence: DeliveryEvidence; contentBase64: string }>(
      `/shipment-delivery-evidence/${evidenceId}/content`,
    );
  },
  async verifyShipmentDelivery(shipmentId: string, pin: string) {
    return request<{
      shipment: Shipment;
      proof: { type: "pin+photo" | "pin+photo+signature"; verified: true };
    }>(`/shipments/${shipmentId}/verify-delivery`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
  },
};
