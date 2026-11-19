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
    contains(
      repositorio,
      'await tarjetaParaCanjear(client, "code_hash", hashGiftCardCode(codigo))',
    ),
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
// El reintento de una compra hecha se responde ANTES del segundo factor: trae el mismo
// código, ya usado, y pedirlo de nuevo dejaba a la persona sin su tarjeta.
assert.ok(
  compra.indexOf(squeeze("if (previa) return ok(res, { card: previa });")) > 0 &&
    compra.indexOf(squeeze("if (previa) return ok(res, { card: previa });")) <
      compra.indexOf(squeeze("await stepUpMfa(req, parsed.data.mfaCode);")) &&
    contains(repositorio, "WHERE t.idempotency_key=$1 AND g.purchaser_id=$2`,"),
  "un reintento de la propia compra se responde antes de pedir otra vez el código",
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
  // En la transacción de la compra, antes de confirmarla: el aviso no pide otra
  // conexión (con el pool lleno se perdía) y existe si y sólo si la compra existe.
  repo.indexOf(
    squeeze(
      'await enqueueSecurityAlert(client, { userId: user.id, event: "gift_card_purchased" });',
    ),
  ) > 0 &&
    repo.indexOf(
      squeeze(
        'await enqueueSecurityAlert(client, { userId: user.id, event: "gift_card_purchased" });',
      ),
    ) <
      repo.indexOf(
        squeeze(
          'await client.query("COMMIT"); return { card: vistaComprada(card), replayed: false };',
        ),
      ) &&
    !contains(repositorio, "notifyMfaChange") &&
    contains(avisosPush, "gift_card_purchased: {") &&
    contains(avisosEmail, "gift_card_purchased: {") &&
    contains(avisosEmail, 'template.startsWith("gift_card_") ||'),
  "quien compra recibe aviso por push y email, y los avisos van a la categoría Wallet",
);
// La cuenta se bloquea (`FOR SHARE`) para toda la operación: choca con el
// `FOR UPDATE` del borrado, y un canje en paralelo no acredita una cuenta borrada.
assert.ok(
  contains(
    repositorio,
    `"SELECT id,name,email FROM users WHERE public_id=$1 AND status='active' FOR SHARE",`,
  ),
  "la cuenta queda bloqueada contra el borrado mientras se mueve la plata",
);
// El destinatario también: si se está borrando, la compra espera y su trigger ve la tarjeta.
assert.ok(
  contains(
    repositorio,
    "WHERE lower(u.email)=$1 AND u.status='active' AND u.id<>$2 LIMIT 1 FOR SHARE OF u`,",
  ),
  "la cuenta a la que se dirige la tarjeta queda bloqueada contra su borrado",
);
// Canjear bloquea la cuenta de quien compró antes que la tarjeta: el orden del borrado.
// En el orden inverso, canje y borrado se esperaban mutuamente.
const canje = squeeze(repositorio);
const bloqueoComprador = canje.indexOf(
  squeeze(
    'await client.query("SELECT 1 FROM users WHERE id=$1 FOR KEY SHARE", [comprador.purchaser_id]);',
  ),
);
assert.ok(
  bloqueoComprador > 0 &&
    bloqueoComprador <
      canje.indexOf(
        squeeze(
          "await client.query(`SELECT * FROM gift_cards WHERE ${columna}=$1 FOR UPDATE`, [valor])",
        ),
      ) &&
    contains(
      repositorio,
      'const card = await tarjetaParaCanjear(client, "public_id", giftCardPublicId);',
    ),
  "canjear bloquea la cuenta de quien compró antes que la tarjeta",
);
// Saldo y destinatario antes del segundo factor; la misma clave con otros datos, 409.
const rutaCompra = squeeze(rutas);
assert.ok(
  rutaCompra.indexOf(squeeze("await assertGiftCardPurchasable(pedido);")) > 0 &&
    rutaCompra.indexOf(squeeze("await assertGiftCardPurchasable(pedido);")) <
      rutaCompra.indexOf(squeeze("await stepUpMfa(req, parsed.data.mfaCode);")) &&
    contains(repositorio, "exigirMismaCompra(repetida, datos);") &&
    contains(
      repositorio,
      "exigirMismaCompra(row, datosCompra({ amount, recipientEmail, message }));",
    ),
  "saldo y destinatario se controlan antes de gastar el código, y una clave repetida con otros datos es 409",
);
// Todas las vigentes en la lista: tienen un código útil y plata que se recupera.
assert.ok(
  contains(repositorio, "WHERE u.public_id=$1 AND (g.status='active' OR g.id IN (") &&
    contains(repositorio, "x.status<>'active' ORDER BY x.created_at DESC LIMIT 50))") &&
    !contains(repositorio, "ORDER BY g.created_at DESC LIMIT 50"),
  "la lista trae todas las vigentes; el tope de 50 es sólo para las cerradas",
);
ok("comprar: segundo factor, reintento, idempotencia, saldo y cuenta bloqueados, y aviso");

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
      // Se relee antes de comprar y después de un error: la verificación se puede
      // activar en la misma pantalla, y sin el campo no hay cómo mandar el código.
      contains(
        panel,
        'if (conMfa !== true && (await releerMfa()) === true) throw new Error("Escribí el código de tu app autenticadora para comprar");',
      ) &&
      contains(panel, "void releerMfa();") &&
      contains(panel, "...(conCodigo ? { mfaCode: codigoMfa } : {}),") &&
      // Sin saber el estado, el campo se ofrece pero no se exige.
      contains(panel, ".catch(() => null)") &&
      contains(panel, "(conMfa === true && !codigoMfa)") &&
      // Un código enviado en una compra fallida pudo usarse: se pide uno nuevo.
      contains(panel, 'if (conCodigo) { setCodigoMfa("");') &&
      // Otros datos, otra compra: otra clave.
      contains(panel, "useEffect(() => { clave.current = nuevaClave(); }, [monto, email,") &&
      // Tras un error, la lista se relee: la compra pudo haberse hecho.
      contains(
        panel,
        "// Una compra cuya respuesta se perdió pudo haberse hecho: la lista lo muestra. void cargar();",
      ) &&
      // Tras comprar, la clave cambia aunque el formulario quede igual.
      contains(panel, "clave.current = nuevaClave(); setRecien(card);"),
    `${donde}: una clave por compra y el código del segundo factor cuando está activo`,
  );
}
ok("web y teléfono: compra con clave estable, canje y anulación al lado del saldo");
