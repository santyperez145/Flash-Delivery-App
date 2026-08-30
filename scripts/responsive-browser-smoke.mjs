import assert from "node:assert/strict";
import { chromium } from "playwright";

const desktopUrl = process.env.FLASH_DESKTOP_URL ?? "http://127.0.0.1:5173";
const mobileUrl = process.env.FLASH_MOBILE_URL ?? "http://127.0.0.1:8081";
const apiUrl = process.env.FLASH_API_URL ?? "http://127.0.0.1:4000/api";
const mobileVariant = process.env.FLASH_MOBILE_VARIANT ?? "customer";
const skipDesktop = process.env.FLASH_SKIP_DESKTOP === "1";

const compactViewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];
const desktopViewports = [
  ...compactViewports,
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

const mobileAudiences = {
  customer: {
    email: "cliente@flash.app",
    // "Comidas" NO sirve: es también el rótulo de un chip de la pantalla de
    // login, así que `getByText` lo encontraba sin haber entrado y las cinco
    // afirmaciones de viewport se medían sobre el login. La auditoría de cliente
    // pasó así hasta el 27 de agosto de 2026. El marcador tiene que existir sólo
    // después de autenticarse.
    readyText: "Buscar platos, tiendas o restaurantes",
    tabs: ["Inicio", "Buscar", "Actividad", "Cuenta"],
  },
  driver: {
    email: "conductor@flash.app",
    // Texto visible del encabezado en la vista por omisión. El intento previo,
    // "Abrir guía operativa del conductor", era un `accessibilityLabel`: nunca es
    // contenido de texto, así que `getByText` no podía encontrarlo jamás.
    readyText: "Tu jornada",
    tabs: ["Mapa", "Ganancias", "Inbox", "Cuenta"],
  },
  merchant: {
    email: "comercio@flash.app",
    // "Abierto y recibiendo" servía menos: depende del estado del local y la hoja
    // de estilos lo muestra en mayúsculas. Se elige un título que siempre se dibuja.
    readyText: "Pulso de cocina",
    tabs: ["Hoy", "Pedidos", "Catálogo", "Cuenta"],
  },
};

function ok(label) {
  console.log(`ok - ${label}`);
}

async function assertReachable(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  assert.ok(response.ok, `${label} returned ${response.status}`);
  ok(`${label} is reachable`);
}

async function assertNoPageOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
  }));
  assert.ok(
    metrics.documentWidth <= metrics.viewportWidth + 1,
    `${label} overflows horizontally (${metrics.documentWidth}px > ${metrics.viewportWidth}px)`,
  );
}

async function assertLocatorInsideViewport(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport, `${label} has no visible bounding box`);
  assert.ok(box.x >= -1, `${label} starts outside the viewport`);
  assert.ok(box.x + box.width <= viewport.width + 1, `${label} ends outside the viewport`);
  assert.ok(box.y >= -1, `${label} starts above the viewport`);
  assert.ok(box.y + box.height <= viewport.height + 1, `${label} ends below the viewport`);
}

async function screenshotFailure(page, label) {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await page
    .screenshot({ path: `qa-responsive-${safeLabel}.png`, fullPage: false })
    .catch(() => undefined);
}

async function withAuditScreenshot(page, label, action) {
  try {
    await action();
  } catch (error) {
    await screenshotFailure(page, label);
    throw error;
  }
}

async function login(page, url, email, submitLabel) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await assertNoPageOverflow(page, `${email} login`);
  if (submitLabel === "Continuar") {
    await page.getByPlaceholder("nombre@ejemplo.com").fill(email);
    await page.getByText("Continuar", { exact: true }).click();
    await page.getByPlaceholder("Tu contraseña").fill("demo123");
    await page.getByText("Ingresar", { exact: true }).click();
  } else {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill("demo123");
    await page.getByText(submitLabel, { exact: true }).click();
  }
}

async function ensureActiveTestShipment() {
  const loginResponse = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "cliente@flash.app",
      password: "demo123",
      deviceName: "responsive-browser-shipment",
    }),
  });
  assert.equal(loginResponse.status, 200, "test customer must authenticate to provision shipment");
  const session = await loginResponse.json();
  assert.ok(session.refreshToken, "test fixture session must expose a revocable refresh token");
  const headers = {
    authorization: `Bearer ${session.token}`,
    "content-type": "application/json",
  };
  try {
    const activityResponse = await fetch(`${apiUrl}/me/activity?limit=50`, { headers });
    assert.equal(activityResponse.status, 200, "test customer activity must be available");
    const activity = await activityResponse.json();
    const hasActiveShipment = activity.items?.some(
      (item) =>
        item.kind === "shipment" && !["delivered", "cancelled"].includes(item.resource?.status),
    );
    if (hasActiveShipment) return;

    // La puerta crea el fixture por los mismos contratos públicos que usa el
    // producto. No inserta SQL ni intercepta requests: cotización firmada,
    // ownership, riesgo e idempotencia siguen bajo prueba.
    const shipment = {
      customerId: "usr_customer",
      pickup: "Defensa 982, San Telmo",
      destination: "Plaza Italia, Buenos Aires",
      pickupCoords: { lat: -34.6177, lng: -58.3621 },
      destinationCoords: { lat: -34.5814, lng: -58.4208 },
      recipientName: "Control responsive",
      recipientPhone: "+5491100000000",
      packageSize: "small",
      description: "Documentación de prueba",
      weightKg: 0.5,
      deliveryNotes: "Recepción",
      paymentMethod: "Efectivo",
      termsAccepted: true,
    };
    const quoteResponse = await fetch(`${apiUrl}/shipments/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify(shipment),
    });
    assert.equal(quoteResponse.status, 200, "real shipment quote must be available");
    const quote = await quoteResponse.json();
    assert.ok(quote.quote?.quoteToken, "real shipment quote must return a signed lock");
    const createResponse = await fetch(`${apiUrl}/shipments`, {
      method: "POST",
      headers: {
        ...headers,
        "Idempotency-Key": `responsive-browser-shipment-${globalThis.crypto.randomUUID()}`,
      },
      body: JSON.stringify({ ...shipment, quoteToken: quote.quote.quoteToken }),
    });
    assert.equal(createResponse.status, 200, "real shipment must be created for browser tracking");
  } finally {
    const logoutResponse = await fetch(`${apiUrl}/auth/logout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    assert.equal(logoutResponse.status, 200, "shipment fixture session must be revoked");
  }
}

async function auditCustomerTrackingSheets(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Actividad", { exact: true }).last().click();
  const cases = [
    {
      service: "food",
      openName: /Abrir seguimiento del pedido/,
      closeName: "Cerrar seguimiento del pedido",
      accent: "rgb(255, 106, 33)",
    },
    {
      service: "ride",
      openName: /Abrir seguimiento del viaje/,
      closeName: "Cerrar seguimiento del viaje",
      accent: "rgb(124, 60, 255)",
    },
  ];

  for (const trackingCase of cases) {
    const open = page.getByRole("button", { name: trackingCase.openName }).first();
    await open.waitFor({ timeout: 10_000 });
    await open.press("Enter");

    const close = page.getByRole("button", { name: trackingCase.closeName });
    await close.waitFor({ timeout: 10_000 });
    await assertNoPageOverflow(page, `customer ${trackingCase.service} tracking sheet`);
    await assertLocatorInsideViewport(
      page,
      close,
      `customer ${trackingCase.service} tracking close action`,
    );

    const currentStage = page.locator('[aria-label$=", actual"]').first();
    await currentStage.waitFor();
    const currentAccent = await currentStage.evaluate((element) => {
      const marker = element.firstElementChild;
      return marker ? getComputedStyle(marker).backgroundColor : "";
    });
    assert.equal(
      currentAccent,
      trackingCase.accent,
      `${trackingCase.service} tracking must use its vertical accent`,
    );

    await close.click();
    await close.waitFor({ state: "hidden" });
    ok(`customer ${trackingCase.service} tracking stays inside the viewport`);
  }
}

async function auditMobile(browser) {
  const audience = mobileAudiences[mobileVariant];
  assert.ok(audience, `unknown FLASH_MOBILE_VARIANT=${mobileVariant}`);
  const context = await browser.newContext({
    viewport: compactViewports[0],
    hasTouch: true,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  await login(page, mobileUrl, audience.email, "Continuar");

  // Se comprueba que el login haya entrado antes de esperar la pantalla. Sin
  // esto, un rechazo del servidor se manifestaba como un timeout de 15 segundos
  // sobre un texto, sin decir que la sesión nunca se abrió.
  const errorDeLogin = page.getByText(/rechazada|no permitido|inválid/i).first();
  if (await errorDeLogin.isVisible().catch(() => false)) {
    throw new Error(`login de ${audience.email} rechazado: ${await errorDeLogin.innerText()}`);
  }
  await page.getByText(audience.readyText, { exact: true }).first().waitFor({ timeout: 15_000 });

  if (mobileVariant === "customer") {
    await page.setViewportSize(compactViewports[0]);
    const offerAction = page.getByText("ENTENDIDO", { exact: true });
    if (await offerAction.isVisible().catch(() => false)) {
      await assertNoPageOverflow(page, "customer offer sheet at 320px");
      await assertLocatorInsideViewport(page, offerAction, "customer offer action at 320px");
      await offerAction.click();
    }
  }

  for (const viewport of compactViewports) {
    await page.setViewportSize(viewport);
    await withAuditScreenshot(page, `${mobileVariant}-${viewport.width}`, async () => {
      for (const tab of audience.tabs) {
        const tabLocator =
          mobileVariant === "customer"
            ? page.getByText(tab, { exact: true }).last()
            : page.getByRole("tab", { name: new RegExp(tab, "i") });
        await tabLocator.click();
        await page.waitForTimeout(120);
        await assertNoPageOverflow(page, `${mobileVariant} ${tab} at ${viewport.width}px`);
        await assertLocatorInsideViewport(
          page,
          tabLocator,
          `${mobileVariant} ${tab} navigation at ${viewport.width}px`,
        );
      }

      if (mobileVariant === "customer") {
        for (const service of ["Comidas", "Viajes", "Envios"]) {
          await page.getByText(service, { exact: true }).first().click();
          await page.waitForTimeout(120);
          await assertNoPageOverflow(page, `customer ${service} at ${viewport.width}px`);
        }
      }
    });
    ok(`${mobileVariant} navigation fits ${viewport.width}x${viewport.height}`);
  }

  if (mobileVariant === "customer") await auditCustomerTrackingSheets(page);

  if (mobileVariant === "customer") {
    await page.getByText("Cuenta", { exact: true }).last().click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
  } else if (mobileVariant === "driver") {
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
  } else {
    await page.getByText("Salir", { exact: true }).click();
  }
  await context.close();
}

async function auditDesktopRole(browser, role) {
  const isMerchant = role === "merchant";
  const shellSelector = isMerchant ? ".merchant-desktop-shell" : ".admin-shell";
  const sidebarSelector = isMerchant ? ".merchant-desktop-sidebar" : ".admin-sidebar";
  const email = isMerchant ? "comercio@flash.app" : "ops@flash.app";
  const context = await browser.newContext({
    viewport: desktopViewports.at(-1),
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  await login(page, desktopUrl, email, "Ingresar");
  await page.locator(shellSelector).waitFor({ timeout: 15_000 });

  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await withAuditScreenshot(page, `${role}-${viewport.width}`, async () => {
      await assertNoPageOverflow(page, `${role} at ${viewport.width}px`);
      if (viewport.width < 620) {
        await page.locator(".workspace").waitFor();
        await page.locator(".app-mode-bar:visible").first().waitFor();
        assert.equal(
          await page.locator(shellSelector).count(),
          0,
          `${role} compact mode should use the touch workspace`,
        );
        return;
      }

      await page.locator(shellSelector).waitFor();
      const composition = await page.locator(shellSelector).evaluate((shell) => ({
        display: getComputedStyle(shell).display,
      }));
      const sidebar = await page.locator(sidebarSelector).evaluate((element) => ({
        position: getComputedStyle(element).position,
        width: element.getBoundingClientRect().width,
      }));

      if (viewport.width <= 900) {
        assert.equal(composition.display, "block", `${role} compact shell must stack`);
        assert.equal(sidebar.position, "sticky", `${role} compact nav must stay sticky`);
        assert.ok(sidebar.width <= viewport.width + 1, `${role} compact nav exceeds viewport`);
        const navTargets = await page
          .locator(".admin-nav button:visible")
          .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
        assert.ok(navTargets.length > 0, `${role} compact nav has no visible targets`);
        assert.ok(
          navTargets.every((height) => height >= 43),
          `${role} compact nav contains a target below 44px`,
        );
      } else {
        assert.equal(composition.display, "grid", `${role} expanded shell must use grid`);
      }
    });
    ok(`${role} desktop fits ${viewport.width}x${viewport.height}`);
  }

  if (isMerchant) {
    await page.setViewportSize(desktopViewports.at(-1));
    await page.locator(shellSelector).waitFor();
    await page.getByRole("button", { name: "Catalogo y stock" }).click();
    await assertNoPageOverflow(page, "merchant catalog after navigation");
  }
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await context.close();
}

async function auditDesktopAccessGate(browser) {
  const context = await browser.newContext({
    viewport: desktopViewports.at(-1),
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  await login(page, desktopUrl, "cliente@flash.app", "Ingresar");
  await page.locator(".role-gate-shell").waitFor({ timeout: 15_000 });

  for (const viewport of desktopViewports.filter(({ width }) => width >= 620)) {
    await page.setViewportSize(viewport);
    await withAuditScreenshot(page, `customer-access-gate-${viewport.width}`, async () => {
      const gate = page.locator(".role-gate-card");
      await gate.waitFor();
      await assertNoPageOverflow(page, `customer access gate at ${viewport.width}px`);
      await assertLocatorInsideViewport(
        page,
        page.getByRole("button", { name: "Cambiar de cuenta" }),
        `customer access gate action at ${viewport.width}px`,
      );
      const cardWidth = await gate.evaluate((element) => element.getBoundingClientRect().width);
      assert.ok(cardWidth <= 520, `customer access gate card exceeds its readable width`);
    });
    ok(`customer access gate fits ${viewport.width}x${viewport.height}`);
  }

  await page.getByRole("button", { name: "Cambiar de cuenta" }).click();
  await context.close();
}

async function auditCompactCustomerSurfaces(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  await ensureActiveTestShipment();
  await login(page, desktopUrl, "cliente@flash.app", "Ingresar");
  await page.getByRole("button", { name: "Envíos", exact: true }).click();
  await page.getByRole("heading", { name: "Mandá un paquete hoy", exact: true }).waitFor();
  const quoteShipment = page.getByRole("button", { name: "Cotizar envío", exact: true });
  await assertNoPageOverflow(page, "compact customer shipment quote");
  await assertLocatorInsideViewport(page, quoteShipment, "compact customer shipment quote action");
  ok("compact customer shipment keeps the real quote flow inside the viewport");

  await page.getByRole("button", { name: "Comida", exact: true }).click();
  await page.locator(".restaurant-card").first().click();
  await page.locator(".detail-screen").waitFor();
  await assertNoPageOverflow(page, "compact customer restaurant");
  const firstAvailableItem = page.locator(".food-row:not(.disabled)").first();
  await firstAvailableItem.click();
  await page.locator(".item-sheet").waitFor();
  const addItem = page.locator(".item-sheet .primary-button");
  await assertNoPageOverflow(page, "compact customer item customization");
  await assertLocatorInsideViewport(page, addItem, "compact customer item add action");
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "Volver", exact: true }).click();
  ok("compact customer restaurant and item customization stay inside the viewport");

  await page.getByRole("button", { name: "Carrito", exact: true }).click();
  await page.getByRole("heading", { name: "Carrito", exact: true }).waitFor();
  const closeCart = page.getByRole("button", { name: "Volver", exact: true });
  await assertNoPageOverflow(page, "compact customer food cart");
  await assertLocatorInsideViewport(page, closeCart, "compact customer food cart back action");
  await closeCart.click();
  ok("compact customer food cart stays inside the viewport");

  const walletTab = page.getByRole("button", { name: "Wallet", exact: true });
  await walletTab.waitFor({ timeout: 15_000 });
  await walletTab.click();

  const amount = page.getByLabel("Monto a cargar", { exact: true });
  const topUp = page.getByRole("button", { name: "Cargar saldo", exact: true });
  await page.getByText("Actividad financiera", { exact: true }).waitFor();
  await assertNoPageOverflow(page, "compact customer wallet");
  await assertLocatorInsideViewport(page, topUp, "compact customer wallet top-up");

  await amount.fill("999");
  assert.equal(await topUp.isDisabled(), true, "wallet must reject amounts below the floor");
  await amount.fill("200001");
  assert.equal(await topUp.isDisabled(), true, "wallet must reject amounts above the ceiling");
  await amount.fill("10000");
  assert.equal(await topUp.isEnabled(), true, "wallet must accept an amount inside the range");

  ok("compact customer wallet renders real activity and enforces money limits");

  await page.getByRole("button", { name: "Perfil", exact: true }).click();
  await page.getByRole("heading", { name: "Mis direcciones", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Mi alimentación", exact: true }).waitFor();
  await assertNoPageOverflow(page, "compact customer account");
  await assertLocatorInsideViewport(
    page,
    page.getByRole("button", { name: "Guardar cambios", exact: true }),
    "compact customer account save action",
  );

  ok("compact customer account renders saved places and dietary preferences");

  await page.getByRole("button", { name: "Actividad", exact: true }).click();
  const trackingCases = [
    { action: "Seguir pedido", marker: /Pedido / },
    { action: "Seguir viaje", marker: "Centro de seguridad" },
    { action: "Seguir envío", marker: "Prueba de entrega" },
  ];
  for (const trackingCase of trackingCases) {
    await page.getByRole("button", { name: trackingCase.action, exact: true }).first().click();
    await page.getByText(trackingCase.marker, { exact: false }).first().waitFor();
    const close = page.getByRole("button", { name: "Cerrar seguimiento", exact: true });
    await assertNoPageOverflow(page, `compact customer ${trackingCase.action}`);
    await assertLocatorInsideViewport(page, close, `${trackingCase.action} close action`);
    await close.click();
  }
  ok("compact customer opens food, ride and shipment tracking without overflow");
  await context.close();
}

if (!skipDesktop) await assertReachable(`${desktopUrl}/`, "desktop web");
await assertReachable(`${mobileUrl}/`, `${mobileVariant} mobile web`);

const browser = await chromium.launch({ headless: true });
try {
  await auditMobile(browser);
  if (!skipDesktop) {
    await auditCompactCustomerSurfaces(browser);
    await auditDesktopAccessGate(browser);
    await auditDesktopRole(browser, "merchant");
    await auditDesktopRole(browser, "operations");
  }
} finally {
  await browser.close();
}

ok(`responsive browser matrix completed for ${mobileVariant}`);
