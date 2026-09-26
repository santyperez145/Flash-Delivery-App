import { createPool } from "./db-client.mjs";
const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool();
let ticketId = null;
const requestIds = [],
  supportKey = `support-sla-${Date.now()}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function login(email) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo123", deviceName: "support-sla-smoke" }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message);
  return body.token;
}
async function request(path, token, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  return { status: response.status, body: await response.json() };
}
try {
  const customer = await login("cliente@flash.app"),
    admin = await login("ops@flash.app"),
    driver = await login("conductor@flash.app");
  const supportPayload = JSON.stringify({
      category: "safety",
      priority: "urgent",
      subject: "Prueba SLA urgente",
      body: "Necesito asistencia inmediata",
    }),
    created = await request("/support/tickets", customer, {
      method: "POST",
      headers: { "Idempotency-Key": supportKey },
      body: supportPayload,
    });
  ticketId = created.body.ticket?.id;
  requestIds.push(created.body.requestId);
  const firstDue = new Date(created.body.ticket?.firstResponseDueAt).getTime(),
    resolutionDue = new Date(created.body.ticket?.resolutionDueAt).getTime(),
    createdAt = new Date(created.body.ticket?.createdAt).getTime();
  assert(
    created.status === 201 &&
      ticketId &&
      created.body.ticket.slaStatus === "on_track" &&
      Math.abs(firstDue - createdAt - 15 * 60000) < 5000 &&
      Math.abs(resolutionDue - createdAt - 240 * 60000) < 5000,
    "urgent ticket receives persisted 15-minute response and 4-hour resolution SLA",
  );
  const replay = await request("/support/tickets", customer, {
      method: "POST",
      headers: { "Idempotency-Key": supportKey },
      body: supportPayload,
    }),
    sideEffects = (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM support_tickets WHERE public_id=$1) tickets,
          (SELECT count(*)::int FROM audit_events
            WHERE entity_type='support_ticket' AND entity_id=$1 AND action='support.created'
          ) audits`,
        [ticketId],
      )
    ).rows[0];
  assert(
    replay.status === 201 &&
      replay.body.ticket.id === ticketId &&
      sideEffects.tickets === 1 &&
      sideEffects.audits === 1,
    "same support request replays without duplicate ticket or audit side effects",
  );
  const foreign = await request(`/support/tickets/${ticketId}/messages`, driver, {
    method: "POST",
    headers: { "Idempotency-Key": `support-foreign-${Date.now()}` },
    body: JSON.stringify({ body: "No autorizado", internal: false }),
  });
  assert(foreign.status === 403, "unrelated user cannot join another support conversation");
  const messageKey = `support-message-${Date.now()}`,
    messagePayload = JSON.stringify({ body: "Aporto más contexto", internal: false }),
    customerReply = await request(`/support/tickets/${ticketId}/messages`, customer, {
      method: "POST",
      headers: { "Idempotency-Key": messageKey },
      body: messagePayload,
    });
  requestIds.push(customerReply.body.requestId);
  assert(
    customerReply.status === 200 &&
      !customerReply.body.ticket.firstRespondedAt &&
      customerReply.body.ticket.status === "waiting_operations",
    "customer follow-up does not fake the first staff response",
  );
  const messageReplay = await request(`/support/tickets/${ticketId}/messages`, customer, {
      method: "POST",
      headers: { "Idempotency-Key": messageKey },
      body: messagePayload,
    }),
    messageEffects = (
      await pool.query(
        `SELECT (
            SELECT count(*)::int FROM support_messages m
            JOIN support_tickets t ON t.id=m.ticket_id
            WHERE t.public_id=$1 AND m.body='Aporto más contexto'
          ) messages,
          (SELECT count(*)::int FROM audit_events
            WHERE entity_type='support_ticket' AND entity_id=$1
              AND action='support.message_created'
          ) audits`,
        [ticketId],
      )
    ).rows[0];
  assert(
    messageReplay.status === 200 && messageEffects.messages === 1 && messageEffects.audits === 1,
    "support message replay avoids duplicate message and audit side effects",
  );
  const staffReply = await request(`/support/tickets/${ticketId}/messages`, admin, {
    method: "POST",
    headers: { "Idempotency-Key": `support-staff-${Date.now()}` },
    body: JSON.stringify({ body: "Operaciones tomó el caso", internal: false }),
  });
  requestIds.push(staffReply.body.requestId);
  assert(
    staffReply.status === 200 &&
      staffReply.body.ticket.firstRespondedAt &&
      staffReply.body.ticket.status === "waiting_customer",
    "first staff reply is timestamped and returns the case to the customer",
  );
  const reprioritized = await request(`/support/tickets/${ticketId}`, admin, {
    method: "PATCH",
    body: JSON.stringify({ priority: "high" }),
  });
  requestIds.push(reprioritized.body.requestId);
  const highDue = new Date(reprioritized.body.ticket.firstResponseDueAt).getTime();
  assert(
    reprioritized.status === 200 &&
      reprioritized.body.ticket.priority === "high" &&
      Math.abs(highDue - createdAt - 60 * 60000) < 5000,
    "staff reprioritization recalculates SLA from the immutable creation time",
  );
  await pool.query(
    "UPDATE support_tickets SET resolution_due_at=now()-interval '1 minute',first_responded_at=NULL,first_response_due_at=now()-interval '1 minute' WHERE public_id=$1",
    [ticketId],
  );
  const queue = await request("/support/tickets", customer);
  const breached = queue.body.tickets?.find((entry) => entry.id === ticketId);
  assert(
    breached?.slaStatus === "first_response_breached",
    "breached response deadline is derived from persisted timestamps",
  );
} finally {
  if (ticketId) {
    await pool.query("DELETE FROM notifications WHERE payload->>'ticketId'=$1", [ticketId]);
    await pool.query(
      "DELETE FROM audit_events WHERE entity_type='support_ticket' AND entity_id=$1",
      [ticketId],
    );
    await pool.query("DELETE FROM support_tickets WHERE public_id=$1", [ticketId]);
  }
  await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [supportKey]);
  await pool.end();
}
