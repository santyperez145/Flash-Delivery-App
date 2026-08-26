const base = process.env.API_URL || "http://127.0.0.1:4000/api";
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function call(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
async function login(email) {
  const result = await call("/auth/login", {
    method: "POST",
    body: { email, password: "demo123", deviceName: "operations-resources-smoke" },
  });
  if (result.body.mfaRequired)
    throw new Error("operations smoke requires a stepped-up development admin session");
  return result.body.token;
}
const customer = await login("cliente@flash.app"),
  admin = await login("ops@flash.app");
assert(
  (await call("/operations/restaurants", { token: customer })).status === 403 &&
    (await call("/operations/drivers", { token: customer })).status === 403 &&
    (await call("/operations/users", { token: customer })).status === 403 &&
    (await call("/operations/support-tickets", { token: customer })).status === 403 &&
    (await call("/operations/audit-events", { token: customer })).status === 403,
  "customer cannot enumerate operational resources",
);
const bootstrap = await call("/bootstrap/operations", { token: admin });
assert(
  bootstrap.status === 200 &&
    [
      "restaurants",
      "drivers",
      "users",
      "supportTickets",
      "auditEvents",
      "zones",
      "promotions",
    ].every((key) => !Object.hasOwn(bootstrap.body.state, key)),
  "operations bootstrap excludes extracted operational aggregates",
);
for (const [path, key] of [
  ["restaurants", "restaurants"],
  ["drivers", "drivers"],
  ["users", "users"],
]) {
  const first = await call(`/operations/${path}?limit=1`, { token: admin });
  assert(
    first.status === 200 &&
      first.body[key].length === 1 &&
      first.headers.get("cache-control")?.includes("no-store"),
    `${path} operational resource enforces limit and private cache`,
  );
  if (path === "users")
    assert(
      first.body.users.every(
        (user) =>
          !Object.hasOwn(user, "password") &&
          !Object.hasOwn(user, "internalId") &&
          !Object.hasOwn(user, "loginLockedUntil"),
      ),
      "user resource excludes credential and internal authentication fields",
    );
  if (first.body.nextCursor) {
    const second = await call(
      `/operations/${path}?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      { token: admin },
    );
    assert(
      second.status === 200 && second.body[key][0]?.id !== first.body[key][0]?.id,
      `${path} cursor advances without duplicates`,
    );
  }
  assert(
    (await call(`/operations/${path}?cursor=invalid`, { token: admin })).status === 400,
    `${path} rejects malformed cursor`,
  );
}
const account = await call("/me", { token: admin });
assert(
  account.status === 200 &&
    !Object.hasOwn(account.body.account.user, "password") &&
    !Object.hasOwn(account.body.account.user, "internalId") &&
    !Object.hasOwn(account.body.account.user, "loginLockedUntil"),
  "private account cannot expose authentication internals",
);
const support = await call("/operations/support-tickets?limit=1", { token: admin });
assert(
  support.status === 200 &&
    support.body.tickets.length <= 1 &&
    support.headers.get("cache-control")?.includes("no-store"),
  "support operational resource is bounded and private",
);
if (support.body.nextCursor) {
  const next = await call(
    `/operations/support-tickets?limit=1&cursor=${encodeURIComponent(support.body.nextCursor)}`,
    { token: admin },
  );
  assert(
    next.status === 200 && next.body.tickets[0]?.id !== support.body.tickets[0]?.id,
    "support cursor advances without duplicates",
  );
}
assert(
  (await call("/operations/support-tickets?cursor=invalid", { token: admin })).status === 400,
  "support rejects malformed cursor",
);
const audit = await call("/operations/audit-events?limit=1", { token: admin });
assert(
  audit.status === 200 &&
    audit.body.events.length === 1 &&
    audit.headers.get("cache-control")?.includes("no-store"),
  "audit resource is bounded and private",
);
if (audit.body.nextCursor) {
  const next = await call(
    `/operations/audit-events?limit=1&cursor=${encodeURIComponent(audit.body.nextCursor)}`,
    { token: admin },
  );
  assert(
    next.status === 200 && next.body.events[0]?.id !== audit.body.events[0]?.id,
    "audit cursor advances without duplicates",
  );
}
assert(
  (await call("/operations/audit-events?cursor=invalid", { token: admin })).status === 400,
  "audit rejects malformed cursor",
);
for (const path of ["zones", "promotions"]) {
  const resource = await call(`/${path}`);
  assert(
    resource.status === 200 && resource.headers.get("cache-control")?.includes("max-age=30"),
    `${path} configuration is independently cacheable`,
  );
}
