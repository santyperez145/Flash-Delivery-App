const base = process.env.FLASH_API_ORIGIN || "http://127.0.0.1:4000/api";

async function call(path, { token, ...options } = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { status: response.status, body: await response.json() };
}

async function login(email) {
  const response = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "demo123", deviceName: "notification-local-smoke" })
  });
  if (!response.body.token) throw new Error(`login failed for ${email}`);
  return response.body.token;
}

const customerToken = await login("cliente@flash.app");
const merchantToken = await login("comercio@flash.app");
const inbox = await call("/notifications", { token: customerToken });
if (inbox.status !== 200 || inbox.body.notifications.length < 2)
  throw new Error("local notification inbox is not durable");

const preferences = await call("/notification-preferences", { token: customerToken });
if (preferences.status !== 200 || preferences.body.preferences.length !== 5)
  throw new Error("local notification preferences are incomplete");

const originalPromotions = preferences.body.preferences.find((entry) => entry.category === "promotions");
const updated = await call("/notification-preferences/promotions", {
  method: "PATCH",
  token: customerToken,
  body: JSON.stringify({ pushEnabled: !originalPromotions.pushEnabled, emailEnabled: originalPromotions.emailEnabled })
});
if (updated.status !== 200) throw new Error("local notification preference did not persist");
await call("/notification-preferences/promotions", {
  method: "PATCH",
  token: customerToken,
  body: JSON.stringify({ pushEnabled: originalPromotions.pushEnabled, emailEnabled: originalPromotions.emailEnabled })
});

const notificationId = inbox.body.notifications[0].id;
const foreignRead = await call(`/notifications/${notificationId}/read`, {
  method: "PATCH",
  token: merchantToken,
  body: "{}"
});
if (foreignRead.status !== 404) throw new Error("notification ownership is not enforced");

const ownerRead = await call(`/notifications/${notificationId}/read`, {
  method: "PATCH",
  token: customerToken,
  body: "{}"
});
if (ownerRead.status !== 200 || !ownerRead.body.notifications.some((entry) => entry.id === notificationId && entry.readAt))
  throw new Error("notification owner could not mark notification as read");

console.log("local notification smoke passed");
