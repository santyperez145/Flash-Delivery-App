import fs from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";

process.env.NODE_ENV = "test";

const {
  canActAsCustomer,
  canActAsDriver,
  canAdvanceOrder,
  canAdvanceRide,
  canManageRestaurant,
  canManageSupportAgent,
  canMutateOrderStatus,
  canMutateRideStatus,
  hasRole,
  isAdmin,
  requireAnyRole,
} = await import("../../server/http/authorization.js");
const { config } = await import("../../server/config.js");

const originalRequireAdminMfa = config.requireAdminMfa;

afterEach(() => {
  config.requireAdminMfa = originalRequireAdminMfa;
});

const asUser = ({
  userId = "USR-1",
  roles = [],
  driverId = null,
  mfa = null,
  mfaVerified = false,
}) => ({
  auth: {
    userId,
    roles,
    user: { id: userId, driverId },
    mfa: mfa ?? { enabled: false },
    mfaVerified,
  },
});

const anonymous = {};
const customer = asUser({ userId: "USR-CUSTOMER", roles: ["customer"] });
const otherCustomer = asUser({ userId: "USR-OTHER", roles: ["customer"] });
const driver = asUser({ userId: "USR-DRIVER", roles: ["driver"], driverId: "DRV-1" });
const otherDriver = asUser({
  userId: "USR-DRIVER-2",
  roles: ["driver"],
  driverId: "DRV-2",
});
const merchant = asUser({ userId: "USR-MERCHANT", roles: ["merchant"] });
const otherMerchant = asUser({ userId: "USR-MERCHANT-2", roles: ["merchant"] });
const adminWithoutMfa = asUser({
  userId: "USR-ADMIN",
  roles: ["admin"],
  mfa: { enabled: true },
});
const adminWithMfa = asUser({
  userId: "USR-ADMIN",
  roles: ["admin"],
  mfa: { enabled: true },
  mfaVerified: true,
});
const adminWithoutOwnMfa = asUser({ userId: "USR-ADMIN-2", roles: ["admin"] });
const restaurant = { id: "RES-1", ownerId: "USR-MERCHANT" };
const order = {
  id: "ORD-1",
  customerId: "USR-CUSTOMER",
  restaurantId: "RES-1",
  courierId: "DRV-1",
};
const ride = { id: "RID-1", customerId: "USR-CUSTOMER", driverId: "DRV-1" };

function captureResponse() {
  const response = { locals: { requestId: "REQ-1" }, statusCode: null, body: null };
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  return response;
}

function runMiddleware(middleware, request) {
  const response = captureResponse();
  let continued = false;
  middleware(request, response, () => {
    continued = true;
  });
  return { response, continued };
}

describe("HTTP authorization", () => {
  test("resolves roles and enforces administrative MFA", () => {
    expect(hasRole(anonymous, "customer")).toBe(false);
    expect(hasRole(customer, "customer")).toBe(true);
    expect(hasRole(customer, "admin")).toBe(false);
    expect(isAdmin(adminWithMfa)).toBe(true);
    expect(isAdmin(adminWithoutMfa)).toBe(false);

    config.requireAdminMfa = true;
    expect(isAdmin(adminWithoutOwnMfa)).toBe(false);
    config.requireAdminMfa = false;
    expect(isAdmin(adminWithoutOwnMfa)).toBe(true);
  });

  test("distinguishes missing authentication, missing role and incomplete MFA", () => {
    const missingToken = runMiddleware(requireAnyRole("customer"), anonymous);
    expect(missingToken.continued).toBe(false);
    expect(missingToken.response.statusCode).toBe(401);

    const missingRole = runMiddleware(requireAnyRole("merchant"), customer);
    expect(missingRole.continued).toBe(false);
    expect(missingRole.response.statusCode).toBe(403);
    expect(missingRole.response.body).toEqual({
      ok: false,
      message: "No tienes permisos para esta accion",
      requestId: "REQ-1",
    });

    const acceptedRole = runMiddleware(requireAnyRole("customer", "merchant"), customer);
    expect(acceptedRole.continued).toBe(true);

    const incompleteAdmin = runMiddleware(requireAnyRole("admin"), adminWithoutMfa);
    expect(incompleteAdmin.continued).toBe(false);
    expect(incompleteAdmin.response.statusCode).toBe(403);
    expect(incompleteAdmin.response.body.message).toMatch(/segundo factor/);
  });

  test("limits customer, driver and merchant ownership", () => {
    expect(canActAsCustomer(customer, "USR-CUSTOMER")).toBe(true);
    expect(canActAsCustomer(otherCustomer, "USR-CUSTOMER")).toBe(false);
    expect(canActAsCustomer(adminWithMfa, "USR-CUSTOMER")).toBe(true);
    expect(canActAsCustomer(adminWithoutMfa, "USR-CUSTOMER")).toBe(false);

    expect(canActAsDriver(driver, "DRV-1")).toBe(true);
    expect(canActAsDriver(driver, "USR-DRIVER")).toBe(false);
    expect(canActAsDriver(otherDriver, "DRV-1")).toBe(false);

    expect(canManageRestaurant(merchant, restaurant)).toBe(true);
    expect(canManageRestaurant(otherMerchant, restaurant)).toBe(false);
    expect(canManageRestaurant(customer, restaurant)).toBe(false);

    const support = asUser({ userId: "USR-SUPPORT", roles: ["support"] });
    const otherSupport = asUser({ userId: "USR-SUPPORT-2", roles: ["support"] });
    expect(canManageSupportAgent(support, "USR-SUPPORT")).toBe(true);
    expect(canManageSupportAgent(otherSupport, "USR-SUPPORT")).toBe(false);
    expect(canManageSupportAgent(customer, "USR-SUPPORT")).toBe(false);
    expect(canManageSupportAgent(adminWithMfa, "USR-SUPPORT")).toBe(true);
  });

  test("separates merchant preparation from driver delivery", () => {
    const canAdvance = (request, nextStatus, currentRestaurant = restaurant) =>
      canAdvanceOrder(request, { order, restaurant: currentRestaurant, nextStatus });

    expect(canAdvance(merchant, "preparing")).toBe(true);
    expect(canAdvance(merchant, "ready_for_pickup")).toBe(true);
    expect(canAdvance(merchant, "picked_up")).toBe(false);
    expect(canAdvance(merchant, "delivered")).toBe(false);

    expect(canAdvance(driver, "picked_up")).toBe(true);
    expect(canAdvance(driver, "delivering")).toBe(true);
    expect(canAdvance(driver, "delivered")).toBe(true);
    expect(canAdvance(driver, "preparing")).toBe(false);
    expect(canAdvance(otherDriver, "picked_up")).toBe(false);
    expect(canAdvance(customer, "delivered")).toBe(false);

    expect(canAdvance(merchant, "preparing", null)).toBe(false);
    expect(canAdvance(adminWithMfa, "preparing", null)).toBe(true);
    expect(
      canAdvanceOrder(driver, {
        order: { ...order, courierId: null },
        restaurant,
        nextStatus: "picked_up",
      }),
    ).toBe(false);
    expect(canAdvance(merchant, "cancelled")).toBe(false);
    expect(canAdvance(driver, "invented")).toBe(false);
  });

  test("only lets involved parties cancel orders outside normal progression", () => {
    const canCancel = (request, status, currentRestaurant = restaurant) =>
      canMutateOrderStatus(request, { order, restaurant: currentRestaurant, status });

    expect(canCancel(customer, "cancelled")).toBe(true);
    expect(canCancel(merchant, "cancelled")).toBe(true);
    expect(canCancel(driver, "cancelled")).toBe(true);
    expect(canCancel(otherCustomer, "cancelled")).toBe(false);
    expect(canCancel(customer, "delivered")).toBe(false);
    expect(canCancel(merchant, "preparing")).toBe(false);
    expect(canCancel(adminWithMfa, "delivered")).toBe(true);
  });

  test("limits ride progression and cancellation to assigned parties", () => {
    expect(canAdvanceRide(driver, ride)).toBe(true);
    expect(canAdvanceRide(otherDriver, ride)).toBe(false);
    expect(canAdvanceRide(customer, ride)).toBe(false);
    expect(canAdvanceRide(adminWithMfa, ride)).toBe(true);
    expect(canAdvanceRide(driver, { ...ride, driverId: null })).toBe(false);

    expect(canMutateRideStatus(customer, ride, "cancelled")).toBe(true);
    expect(canMutateRideStatus(driver, ride, "cancelled")).toBe(true);
    expect(canMutateRideStatus(otherCustomer, ride, "cancelled")).toBe(false);
    expect(canMutateRideStatus(customer, ride, "completed")).toBe(false);
  });

  test("keeps authorization rules synchronous and independent from storage", async () => {
    const source = await fs.readFile("server/http/authorization.js", "utf8");
    for (const forbidden of ["readDb", "postgresPool", "db.orders", "db.restaurants", "await "])
      expect(source, `found forbidden storage dependency: ${forbidden}`).not.toContain(forbidden);
  });
});
