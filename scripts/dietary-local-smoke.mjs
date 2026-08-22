const base = process.env.FLASH_API_ORIGIN || "http://127.0.0.1:4000/api";

async function call(path, { token, ...options } = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  return { status: response.status, body: await response.json() };
}

async function login(email) {
  const response = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "demo123", deviceName: "dietary-local-smoke" }),
  });
  if (!response.body.token) throw new Error(`login failed for ${email}`);
  return response.body.token;
}

const customerToken = await login("cliente@flash.app");
const initial = await call("/dietary-preferences", { token: customerToken });
if (initial.status !== 200 || !Array.isArray(initial.body.preferences?.dietaryLabels))
  throw new Error("local dietary preferences did not return the production contract");

const updated = await call("/dietary-preferences", {
  method: "PUT",
  token: customerToken,
  body: JSON.stringify({
    dietaryLabels: ["vegetarian"],
    avoidedAllergens: ["peanuts"],
    hideIncompatible: true,
  }),
});
if (updated.status !== 200 || !updated.body.preferences.hideIncompatible)
  throw new Error("local dietary preferences did not persist the update");

const reread = await call("/dietary-preferences", { token: customerToken });
if (
  reread.status !== 200 ||
  reread.body.preferences.dietaryLabels.join() !== "vegetarian" ||
  reread.body.preferences.avoidedAllergens.join() !== "peanuts"
)
  throw new Error("local dietary preferences are not durable");

await call("/dietary-preferences", {
  method: "PUT",
  token: customerToken,
  body: JSON.stringify({ dietaryLabels: [], avoidedAllergens: [], hideIncompatible: false }),
});

console.log("local dietary preference smoke passed");
