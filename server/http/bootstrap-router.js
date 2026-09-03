// Bootstrap por audiencia (ARC-001).
//
// Sustituye el estado global: cada cliente pide sólo la rebanada de su rol.
// Vivía en `index.js` junto al cableado del servidor; no es dominio de un
// vertical, pero tampoco es arranque — es el contrato de sesión inicial.
import { Router } from "express";

import { loadRuntimeState, metrics } from "../runtime-snapshot.js";
import { scopeStateForRequest } from "../fallback-runtime.js";
import { requireAuth } from "./authentication.js";
import { fail, ok } from "./responses.js";

const bootstrapAudienceRoles = {
  customer: "customer",
  merchant: "merchant",
  driver: "driver",
  operations: "admin",
  support: "support",
};

export const bootstrapRouter = Router();

bootstrapRouter.get("/api/bootstrap/:audience", requireAuth, async (req, res) => {
  const requiredRole = bootstrapAudienceRoles[req.params.audience];
  if (!requiredRole) return fail(res, 404, "Audiencia inexistente");
  if (!req.auth.roles.includes(requiredRole))
    return fail(res, 403, "La audiencia no pertenece a esta sesión");
  const state = await loadRuntimeState(req);
  const scopedState = scopeStateForRequest(state, req);
  const {
    orders: _orders,
    rides: _rides,
    shipments: _shipments,
    tips: _tips,
    ...withoutActivity
  } = scopedState;
  const excludedBootstrapKeys = [
    "customer",
    "merchant",
    "driver",
    "operations",
    "support",
  ].includes(req.params.audience)
    ? [
        "restaurants",
        "drivers",
        "zones",
        "promotions",
        "addresses",
        "paymentMethods",
        "walletTransactions",
        "supportTickets",
        "ratings",
        "favoriteRestaurantIds",
        "tips",
        ...(["operations", "support"].includes(req.params.audience)
          ? ["users", "auditEvents"]
          : []),
      ]
    : [];
  const bootstrapState = Object.fromEntries(
    Object.entries(withoutActivity).filter(([key]) => !excludedBootstrapKeys.includes(key)),
  );
  res.set("Cache-Control", "no-store, private");
  ok(res, {
    audience: req.params.audience,
    state: {
      ...bootstrapState,
      metrics: metrics(scopedState),
    },
  });
});
