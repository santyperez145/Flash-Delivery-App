// Mi cuenta y mi saldo (ticket ARC-001, paso 2).
//
// Ocho rutas alrededor de una sola entidad: la cuenta de quien pregunta. El
// perfil, su actividad, la verificación del teléfono, el código de referidos y
// la carga de saldo.
//
// No es un router de audiencia como los que este ticket viene desarmando.
// `/api/me` no describe quién mira sino **qué mira**: siempre la propia cuenta,
// nunca la de otro. Por eso ninguna de las ocho recibe un identificador de
// usuario por parámetro: el sujeto sale del token y no del pedido, que es lo
// que hace imposible pedir la cuenta ajena.
//
// Referidos y carga de saldo viajan con el perfil porque las tres devuelven la
// misma foto de la cuenta después de tocarla. Compartir `accountSnapshot` no es
// casualidad de implementación: son el mismo objeto en tres momentos.
//
// `/api/me/activity` pagina por cursor y no por offset, igual que los listados
// de backoffice: con offset, un pedido nuevo corre a todos los demás y quien
// mira su historial ve un registro dos veces o ninguna.
import { Router } from "express";
import { z } from "zod";

import { decodeActivityCursor, getActivityPage } from "../activity-repository.js";
import { getPostgresAddresses } from "../address-repository.js";
import {
  findAuthUserByPublicId,
  updatePostgresAuthProfile,
  usesPostgresAuth,
} from "../auth-repository.js";
import { getPostgresPaymentMethods } from "../payment-method-repository.js";
import { requireAuth } from "./authentication.js";
import { config } from "../config.js";
import { accountSnapshot, audit, readDb, scopeStateForRequest } from "../fallback-runtime.js";
import { getPostgresFavoriteMerchantIds, getPostgresRatings } from "../feedback-repository.js";
import { getPostgresSupportTickets } from "../support-repository.js";
import { recordPostgresAudit } from "../audit-repository.js";
import {
  confirmPhoneVerification,
  requestPhoneVerification,
} from "../phone-verification-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { publishRealtimeEvent } from "./realtime.js";
import { claimReferral, getReferralSummary } from "../referral-repository.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import { createId, getPublicState, getTimestamp, writeDb } from "../store.js";
import { getPostgresTips } from "../tip-repository.js";
import { sanitizeUser } from "../user-view.js";
import { creditWallet, getWallet } from "../wallet-repository.js";

const phoneVerificationConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Código inválido"),
});
const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Usa formato internacional, por ejemplo +5491112345678"),
  defaultAddress: z.string().trim().min(3).max(240),
});

const walletTopUpSchema = z.object({
  amount: z.coerce.number().int().min(1000).max(200000),
});
const referralClaimSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^FLASH[A-Z0-9]{8}$/),
});

export const accountRouter = Router();
const router = accountRouter;

router.get("/api/me/activity", requireAuth, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const cursor = decodeActivityCursor(String(req.query.cursor || ""));
  if (req.query.cursor && !cursor) return fail(res, 400, "Cursor de actividad inválido");
  if (!usesPostgresCommerce()) {
    const scoped = scopeStateForRequest(getPublicState(), req),
      items = [
        ...scoped.orders.map((resource) => ({
          id: resource.id,
          kind: "order",
          createdAt: resource.createdAt,
          resource,
        })),
        ...scoped.rides.map((resource) => ({
          id: resource.id,
          kind: "ride",
          createdAt: resource.createdAt,
          resource,
        })),
        ...(scoped.shipments || []).map((resource) => ({
          id: resource.id,
          kind: "shipment",
          createdAt: resource.createdAt,
          resource,
        })),
      ]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit);
    res.set("Cache-Control", "no-store, private");
    return ok(res, { items, nextCursor: null });
  }
  try {
    res.set("Cache-Control", "no-store, private");
    return ok(
      res,
      await getActivityPage({
        userPublicId: req.auth.userId,
        roles: req.auth.roles,
        limit,
        cursor,
      }),
    );
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar la actividad");
  }
});

router.get("/api/me", requireAuth, async (req, res) => {
  const db = usesPostgresAuth() ? null : readDb();
  const account = usesPostgresAuth()
    ? {
        user: null,
        addresses: [],
        paymentMethods: [],
        walletTransactions: [],
        supportTickets: [],
        ratings: [],
      }
    : accountSnapshot(db, req.auth.userId);
  if (usesPostgresAuth()) {
    account.user = sanitizeUser(await findAuthUserByPublicId(req.auth.userId));
    const [wallet, addresses, paymentMethods, supportTickets, ratings] = await Promise.all([
      getWallet(req.auth.userId),
      getPostgresAddresses(req.auth.userId),
      getPostgresPaymentMethods(),
      getPostgresSupportTickets({
        userPublicId: req.auth.userId,
        roles: [],
      }),
      getPostgresRatings({ userPublicId: req.auth.userId }),
    ]);
    account.user.wallet = wallet.balance;
    account.walletTransactions = wallet.transactions;
    account.addresses = addresses;
    account.paymentMethods = paymentMethods.filter((entry) => entry.userId === req.auth.userId);
    account.supportTickets = supportTickets;
    account.ratings = ratings;
    account.favoriteRestaurantIds = await getPostgresFavoriteMerchantIds(req.auth.userId);
    account.tips = await getPostgresTips({ userPublicId: req.auth.userId, roles: [] });
  }
  res.set("Cache-Control", "no-store, private");
  return ok(res, { account });
});

router.post("/api/me/phone-verification/request", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "La verificación telefónica requiere PostgreSQL");
  try {
    return ok(res, await requestPhoneVerification(req.auth.userId));
  } catch (error) {
    if (error.retryAfter) res.set("Retry-After", String(error.retryAfter));
    return failFrom(res, error, "No se pudo enviar el código");
  }
});

router.post("/api/me/phone-verification/confirm", requireAuth, async (req, res) => {
  const parsed = parseOrFail(phoneVerificationConfirmSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) return fail(res, 503, "La verificación telefónica requiere PostgreSQL");
  try {
    return ok(
      res,
      await confirmPhoneVerification({ userPublicId: req.auth.userId, code: parsed.data.code }),
    );
  } catch (error) {
    return failFrom(res, error, "No se pudo verificar el teléfono");
  }
});

router.patch("/api/me", requireAuth, async (req, res) => {
  const parsed = parseOrFail(profileSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const db = usesPostgresAuth() ? null : readDb();
  const user = usesPostgresAuth()
    ? await findAuthUserByPublicId(req.auth.userId)
    : db.users.find((entry) => entry.id === req.auth.userId);
  if (!user) return fail(res, 404, "Usuario no encontrado");
  const { name, phone, defaultAddress } = parsed.data;
  user.name = name;
  user.phone = phone || "";
  user.defaultAddress = defaultAddress;
  if (usesPostgresAuth()) await updatePostgresAuthProfile(user.id, { name, phone, defaultAddress });
  if (!usesPostgresAuth()) {
    const existingAddress = (db.addresses || []).find(
      (entry) => entry.userId === user.id && entry.isDefault,
    );
    (db.addresses || []).forEach((entry) => {
      if (entry.userId === user.id) entry.isDefault = false;
    });
    if (existingAddress) {
      existingAddress.address = defaultAddress;
      existingAddress.isDefault = true;
    } else {
      db.addresses = [
        ...(db.addresses || []),
        {
          id: createId("ADDR"),
          userId: user.id,
          label: "Principal",
          address: defaultAddress,
          lat: null,
          lng: null,
          isDefault: true,
        },
      ];
    }
  }
  if (usesPostgresAuth())
    await recordPostgresAudit({
      actorPublicId: user.id,
      roles: req.auth.roles,
      action: "user.profile_updated",
      entityType: "user",
      entityId: user.id,
      requestId: req.requestId,
      afterData: { fields: ["name", "phone", "defaultAddress"] },
    });
  else {
    audit(db, req, "user", user.id, "user.profile_updated", {
      fields: ["name", "phone", "defaultAddress"],
    });
    writeDb(db);
  }
  await publishRealtimeEvent({
    req,
    type: "user.updated",
    entityType: "user",
    entityId: user.id,
    action: "user.profile_updated",
  });
  const account = usesPostgresAuth()
    ? {
        user: null,
        addresses: [],
        paymentMethods: [],
        walletTransactions: [],
        supportTickets: [],
        ratings: [],
      }
    : accountSnapshot(readDb(), user.id);
  if (usesPostgresAuth()) {
    account.user = sanitizeUser(await findAuthUserByPublicId(user.id));
    const [wallet, addresses, paymentMethods, supportTickets, ratings] = await Promise.all([
      getWallet(user.id),
      getPostgresAddresses(user.id),
      getPostgresPaymentMethods(),
      getPostgresSupportTickets({
        userPublicId: user.id,
        roles: req.auth.roles,
      }),
      getPostgresRatings({ userPublicId: user.id }),
    ]);
    account.user.wallet = wallet.balance;
    account.walletTransactions = wallet.transactions;
    account.addresses = addresses;
    account.paymentMethods = paymentMethods.filter((entry) => entry.userId === user.id);
    account.supportTickets = supportTickets;
    account.ratings = ratings;
  }
  return ok(res, { account });
});

router.get("/api/referrals/me", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "Referidos requiere PostgreSQL");
  try {
    return ok(res, { referral: await getReferralSummary(req.auth.userId) });
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar referidos");
  }
});

router.post("/api/referrals/claim", requireAuth, async (req, res) => {
  const parsed = parseOrFail(referralClaimSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) return fail(res, 503, "Referidos requiere PostgreSQL");
  try {
    const referral = await claimReferral({ publicUserId: req.auth.userId, code: parsed.data.code });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "referral.claimed",
      entityType: "user",
      entityId: req.auth.userId,
      requestId: req.requestId,
      afterData: { code: parsed.data.code },
    });
    return ok(res, { referral });
  } catch (error) {
    return failFrom(res, error, "No se pudo aplicar el referido");
  }
});

router.post("/api/wallet/topup", requireAuth, async (req, res) => {
  const parsed = parseOrFail(walletTopUpSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const db = usesPostgresAuth() ? null : readDb();
  const user = usesPostgresAuth()
    ? await findAuthUserByPublicId(req.auth.userId)
    : db.users.find((entry) => entry.id === req.auth.userId);
  if (!user) return fail(res, 404, "Usuario no encontrado");
  const amount = parsed.data.amount;
  if (usesPostgresAuth()) {
    if (!config.allowSandboxTopups)
      return fail(
        res,
        503,
        "Las cargas directas están deshabilitadas; se requiere un payment intent confirmado",
      );
    const idempotencyKey = req.get("idempotency-key");
    if (!idempotencyKey || !/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
      return fail(res, 400, "Idempotency-Key válido es obligatorio");
    const wallet = await creditWallet({
      publicUserId: user.id,
      amount,
      idempotencyKey,
      kind: "sandbox_topup",
      description: "Carga sandbox",
      metadata: { requestId: req.requestId },
    });
    const pgUser = sanitizeUser(await findAuthUserByPublicId(user.id));
    pgUser.wallet = wallet.balance;
    await publishRealtimeEvent({
      req,
      type: "wallet.updated",
      entityType: "user",
      entityId: user.id,
      action: "wallet.topped_up",
    });
    const [addresses, paymentMethods, supportTickets] = await Promise.all([
      getPostgresAddresses(user.id),
      getPostgresPaymentMethods(),
      getPostgresSupportTickets({
        userPublicId: user.id,
        roles: req.auth.roles,
      }),
    ]);
    return ok(res, {
      account: {
        user: pgUser,
        addresses,
        paymentMethods: paymentMethods.filter((entry) => entry.userId === user.id),
        supportTickets,
        walletTransactions: wallet.transactions,
        ratings: [],
      },
    });
  }
  user.wallet += amount;
  db.walletTransactions = [
    {
      id: createId("WAL"),
      userId: user.id,
      kind: "credit",
      amount,
      description: "Carga de saldo sandbox",
      createdAt: getTimestamp(),
    },
    ...(db.walletTransactions || []),
  ];
  const walletMethod = (db.paymentMethods || []).find(
    (entry) => entry.userId === user.id && entry.type === "wallet",
  );
  if (walletMethod) walletMethod.balance = user.wallet;
  audit(db, req, "wallet", user.id, "wallet.topped_up", {
    amount,
    balance: user.wallet,
  });
  writeDb(db);
  await publishRealtimeEvent({
    req,
    type: "wallet.updated",
    entityType: "user",
    entityId: user.id,
    action: "wallet.topped_up",
  });
  return ok(res, { account: accountSnapshot(readDb(), user.id) });
});
