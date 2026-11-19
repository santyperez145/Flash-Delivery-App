// Tarjetas de regalo (PAG-04): el cableado, sin base.
//
// `test:gift-cards` recorre compra, canje y anulación contra PostgreSQL. Esto
// vigila lo que esa prueba no ve: que el código nunca se guarde ni se audite en
// claro, que comprar pida el segundo factor y una clave de idempotencia, que canjear
// tenga límite, que la Wallet se bloquee antes de mirar el saldo, que los datos
// personales se borren con la cuenta, y que las dos apps lo muestren donde está el
// saldo.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [
  migracion,
  repositorio,
  rutas,
  limites,
  servidor,
  openapi,
  avisosPush,
  avisosEmail,
  clasificacion,
  webWallet,
  webSuperficie,
  webPanel,
  webEstilos,
  movilCuenta,
  movilCliente,
  movilPanel,
] = await Promise.all(
  [
    "database/migrations/146_gift_cards.sql",
    "server/gift-card-repository.js",
    "server/http/gift-card-router.js",
    "server/http/rate-limits.js",
    "server/index.js",
    "server/openapi-paths.js",
    "server/mfa-repository.js",
    "server/notification-repository.js",
    "database/rls-classification.json",
    "src/customer/WalletScreen.tsx",
    "src/customer/CustomerSurface.tsx",
    "src/customer/GiftCards.tsx",
    "src/main.tsx",
    "apps/mobile/src/screens/CustomerAccountScreen.tsx",
    "apps/mobile/src/screens/CustomerScreen.tsx",
    "apps/mobile/src/GiftCards.tsx",
  ].map(leer),
);
const ok = (mensaje) => console.log(`ok - ${mensaje}`);

// El código se busca por HMAC y se guarda cifrado; el insert nunca lleva el código crudo.
assert.ok(
  contains(migracion, "code_hash text NOT NULL UNIQUE,") &&
    contains(migracion, "CHECK (status = 'active' OR code_ciphertext IS NULL)") &&
    contains(
      repositorio,
      "hashGiftCardCode(codigo), encryptGiftCardCode(codigo), codigo.slice(-4),",
    ) &&
    contains(repositorio, "code_ciphertext=NULL WHERE id=$1`, [card.id, user.id],") &&
    contains(repositorio, "SELECT * FROM gift_cards WHERE code_hash=$1 FOR UPDATE"),
  "el código no se guarda en claro y se borra al dejar de estar vigente",
);
ok("el código se guarda cifrado, se busca por HMAC y se borra al usarse");

// La auditoría no ve el código, su HMAC, el email ni el mensaje.
const auditoria = squeeze(migracion).match(/GRANTSELECT\(([^)]*)\)ONgift_cardsTOflash_rls_audit/);
assert.ok(
  auditoria && !/code_hash|code_ciphertext|recipient_email|message/.test(auditoria[1]),
  "la auditoría no lee el código, el email escrito ni el mensaje",
);
assert.ok(
  contains(migracion, "ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;") &&
    JSON.parse(clasificacion).tablas.gift_cards?.clase === "por-usuario",
  "gift_cards tiene RLS y está clasificada por usuario",
);
assert.ok(
  contains(migracion, "SET recipient_email = NULL, message = NULL") &&
    contains(migracion, "BEFORE UPDATE OF status ON users"),
  "el email escrito y el mensaje se borran con la cuenta",
);
ok("RLS, auditoría sin secretos y datos personales que se van con la cuenta");

// Comprar: segundo factor, idempotencia y la Wallet bloqueada antes de mirar el saldo.
const compra = squeeze(rutas);
assert.ok(
  compra.indexOf(squeeze("await stepUpMfa(req, parsed.data.mfaCode);")) > 0 &&
    compra.indexOf(squeeze("await stepUpMfa(req, parsed.data.mfaCode);")) <
      compra.indexOf(squeeze("await purchaseGiftCard({")) &&
    contains(rutas, 'return fail(res, 400, "Idempotency-Key válido es obligatorio");') &&
    contains(rutas, "return failFromStepUp(res, error,"),
  "comprar pide el segundo factor antes de cobrar y exige Idempotency-Key",
);
const repo = squeeze(repositorio);
assert.ok(
  repo.indexOf(
    squeeze(
      'await client.query("SELECT id FROM ledger_accounts WHERE id=$1 FOR UPDATE", [walletId]);',
    ),
  ) > 0 &&
    repo.indexOf(
      squeeze(
        'await client.query("SELECT id FROM ledger_accounts WHERE id=$1 FOR UPDATE", [walletId]);',
      ),
    ) < repo.indexOf(squeeze("if ((await saldo(client, walletId)) < amountCents)")),
  "la Wallet se bloquea antes de controlar el saldo: dos compras no gastan lo mismo",
);
assert.ok(
  contains(repositorio, 'await notifyMfaChange(userPublicId, "gift_card_purchased");') &&
    contains(avisosPush, "gift_card_purchased: {") &&
    contains(avisosEmail, "gift_card_purchased: {") &&
    contains(avisosEmail, 'template.startsWith("gift_card_") ||'),
  "quien compra recibe aviso por push y email, y los avisos van a la categoría Wallet",
);
ok("comprar: segundo factor, idempotencia, saldo bloqueado y aviso");

// Canjear tiene límite; un código mal escrito responde como uno inexistente.
for (const ruta of [
  '"/api/gift-cards",',
  '"/api/gift-cards/redeem",',
  '"/api/gift-cards/:giftCardId/claim",',
  '"/api/gift-cards/:giftCardId/cancel",',
])
  assert.ok(
    squeeze(rutas).includes(
      squeeze(`${ruta} giftCardLimiter, requireAuth, requireAnyRole("customer"),`),
    ),
    `${ruta} con límite, sesión y rol de cliente`,
  );
assert.ok(
  contains(limites, "export const giftCardLimiter = createLimiter({") &&
    contains(
      repositorio,
      'if (!card) throw error("Ese código no es de una tarjeta de regalo", 404);',
    ) &&
    contains(
      repositorio,
      'if (!card || card.recipient_id !== user.id) throw error("Tarjeta no encontrada", 404);',
    ),
  "canjear tiene límite y no distingue un código mal escrito de uno inexistente",
);
assert.ok(
  contains(rutas, 'res.set("Cache-Control", "no-store, private");') &&
    contains(servidor, "app.use(giftCardRouter);") &&
    contains(openapi, "...giftCardPaths(helpers),"),
  "rutas montadas, documentadas y sin caché",
);
ok("canjear con límite, rutas montadas y documentadas");

// Las dos apps lo muestran al lado del saldo y releen la cuenta después.
assert.ok(
  contains(
    webWallet,
    "<GiftCards wallet={user?.wallet || 0} onWalletChanged={onWalletChanged} />",
  ) &&
    contains(
      webSuperficie,
      "onWalletChanged={(aviso) => runAction(() => Promise.resolve(), aviso)}",
    ) &&
    contains(webEstilos, 'import "./styles/gift-cards.css";') &&
    contains(movilCuenta, "<GiftCards wallet={user.wallet} onWalletChanged={onWalletChanged} />") &&
    contains(movilCliente, "onWalletChanged={() => void refresh()}"),
  "web en la Wallet y teléfono en Cuenta, al lado del saldo",
);
for (const [panel, donde] of [
  [webPanel, "web"],
  [movilPanel, "teléfono"],
]) {
  assert.ok(
    contains(panel, "clave.current,") &&
      contains(panel, "clave.current = nuevaClave();") &&
      contains(panel, "getMfaStatus()") &&
      contains(panel, "...(conMfa && codigoMfa ? { mfaCode: codigoMfa } : {}),"),
    `${donde}: una clave por compra y el código del segundo factor cuando está activo`,
  );
}
ok("web y teléfono: compra con clave estable, canje y anulación al lado del saldo");
