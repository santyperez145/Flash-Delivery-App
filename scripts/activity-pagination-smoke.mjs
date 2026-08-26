const base = process.env.API_URL || "http://127.0.0.1:4000/api";
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function request(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function login(email) {
  return (
    await request("/auth/login", {
      method: "POST",
      body: { email, password: "demo123", deviceName: "activity-pagination-smoke" },
    })
  ).body.token;
}
for (const [email, expectedKinds] of [
  ["cliente@flash.app", ["order", "ride", "shipment"]],
  ["comercio@flash.app", ["order"]],
  ["conductor@flash.app", ["order", "ride", "shipment"]],
]) {
  const token = await login(email),
    first = await request("/me/activity?limit=1", { token });
  assert(
    first.status === 200 && first.body.items?.length <= 1,
    "activity page enforces requested page size",
  );
  if (first.body.nextCursor) {
    const second = await request(
      `/me/activity?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      { token },
    );
    assert(
      second.status === 200 && second.body.items?.[0]?.id !== first.body.items?.[0]?.id,
      "opaque cursor advances without duplicating the previous job",
    );
  }
  const page = await request("/me/activity?limit=50", { token });
  assert(
    page.body.items.every((item) => expectedKinds.includes(item.kind)),
    `${email} receives only participant service kinds`,
  );
  assert(
    page.body.items.every(
      (item) => item.resource?.id === item.id && !Object.hasOwn(item, "customerEmail"),
    ),
    "activity serializer exposes the scoped resource without foreign identity fields",
  );
  assert(
    (await request("/me/activity?cursor=not-a-cursor", { token })).status === 400,
    "malformed cursor is rejected",
  );
}
