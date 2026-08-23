import assert from "node:assert/strict";
import { chromium } from "playwright";

const desktopUrl = process.env.FLASH_DESKTOP_URL ?? "http://127.0.0.1:5173";
const mobileUrl = process.env.FLASH_MOBILE_URL ?? "http://127.0.0.1:8081";
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
    readyText: "Comidas",
    tabs: ["Inicio", "Buscar", "Actividad", "Cuenta"],
  },
  driver: {
    email: "conductor@flash.app",
    readyText: "FLASH DRIVER",
    tabs: ["Mapa", "Ganancias", "Inbox", "Cuenta"],
  },
  merchant: {
    email: "comercio@flash.app",
    readyText: "Flash Negocios",
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
    documentWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    ),
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
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Contraseña").fill("demo123");
  await page.getByText(submitLabel, { exact: true }).click();
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
  await page.getByText(audience.readyText, { exact: true }).first().waitFor({ timeout: 15_000 });

  if (mobileVariant === "customer") {
    await page.setViewportSize(compactViewports[0]);
    const offerAction = page.getByText("ENTENDIDO", { exact: true });
    if (await offerAction.isVisible().catch(() => false)) {
      await assertNoPageOverflow(page, "customer offer sheet at 320px");
      await assertLocatorInsideViewport(
        page,
        offerAction,
        "customer offer action at 320px",
      );
      await offerAction.click();
    }
  }

  for (const viewport of compactViewports) {
    await page.setViewportSize(viewport);
    await withAuditScreenshot(
      page,
      `${mobileVariant}-${viewport.width}`,
      async () => {
        for (const tab of audience.tabs) {
          const tabLocator =
            mobileVariant === "customer"
              ? page.getByText(tab, { exact: true }).last()
              : page.getByRole("tab", { name: new RegExp(tab, "i") });
          await tabLocator.click();
          await page.waitForTimeout(120);
          await assertNoPageOverflow(
            page,
            `${mobileVariant} ${tab} at ${viewport.width}px`,
          );
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
            await assertNoPageOverflow(
              page,
              `customer ${service} at ${viewport.width}px`,
            );
          }
        }
      },
    );
    ok(`${mobileVariant} navigation fits ${viewport.width}x${viewport.height}`);
  }

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
  const sidebarSelector = isMerchant
    ? ".merchant-desktop-sidebar"
    : ".admin-sidebar";
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
        const navTargets = await page.locator(".admin-nav button:visible").evaluateAll((buttons) =>
          buttons.map((button) => button.getBoundingClientRect().height),
        );
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

if (!skipDesktop) await assertReachable(`${desktopUrl}/`, "desktop web");
await assertReachable(`${mobileUrl}/`, `${mobileVariant} mobile web`);

const browser = await chromium.launch({ headless: true });
try {
  await auditMobile(browser);
  if (!skipDesktop) {
    await auditDesktopRole(browser, "merchant");
    await auditDesktopRole(browser, "operations");
  }
} finally {
  await browser.close();
}

ok(`responsive browser matrix completed for ${mobileVariant}`);
