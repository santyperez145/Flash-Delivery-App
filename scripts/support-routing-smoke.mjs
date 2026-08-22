import crypto from "node:crypto";
import pg from "pg";
const pool = new pg.Pool({
    connectionString:
      process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    ssl: false,
  }),
  base = process.env.API_URL || "http://127.0.0.1:4000/api",
  stamp = Date.now(),
  supportId = `USR-SUPPORT-${stamp}`,
  supportEmail = `support-routing-${stamp}@flash.test`,
  ticketIds = [],
  requestIds = [];
let token = "",
  originalProfile = null;
const assert = (value, label) => {
  if (!value) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body = {};
  try {
    body = await response.json();
  } catch {}
  return { status: response.status, body };
};
const login = async (email) =>
  (
    await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: "demo123",
        deviceName: "support-routing-smoke",
      }),
    })
  ).body.token;
try {
  const admin = (
    await pool.query(
      "SELECT id,password_hash FROM users WHERE public_id='usr_admin'",
    )
  ).rows[0];
  originalProfile = (
    await pool.query(
      "SELECT availability,max_active_tickets,skills,last_assigned_at FROM support_agent_profiles WHERE user_id=$1",
      [admin.id],
    )
  ).rows[0];
  const support = (
    await pool.query(
      "INSERT INTO users(public_id,email,password_hash,name,email_verified_at) VALUES($1,$2,$3,'Agente Seguridad',now()) RETURNING id",
      [supportId, supportEmail, admin.password_hash],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO user_roles(user_id,role) VALUES($1,'support')",
    [support.id],
  );
  await pool.query(
    "INSERT INTO support_agent_profiles(user_id,availability,max_active_tickets,skills) VALUES($1,'available',1,ARRAY['safety'])",
    [support.id],
  );
  await pool.query(
    "UPDATE support_agent_profiles SET availability='offline' WHERE user_id=$1",
    [admin.id],
  );
  token = await login("cliente@flash.app");
  assert(
    (await call("/admin/support/agents")).status === 403,
    "customer cannot inspect support capacity",
  );
  const first = await call("/support/tickets", {
    method: "POST",
    body: JSON.stringify({
      category: "safety",
      priority: "urgent",
      subject: "Incidente de seguridad verificable",
      body: "Necesito asistencia operativa inmediata",
    }),
  });
  ticketIds.push(first.body.ticket?.id);
  requestIds.push(first.body.requestId);
  assert(
    first.status === 201 &&
      first.body.ticket?.assignedTo === supportId &&
      first.body.ticket.assignmentHistory?.[0]?.reason === "auto_create",
    "new safety case routes atomically to skilled available agent",
  );
  const second = await call("/support/tickets", {
    method: "POST",
    body: JSON.stringify({
      category: "safety",
      priority: "high",
      subject: "Segundo caso de seguridad",
      body: "La cola debe respetar capacidad configurada",
    }),
  });
  ticketIds.push(second.body.ticket?.id);
  requestIds.push(second.body.requestId);
  assert(
    second.status === 201 && !second.body.ticket?.assignedTo,
    "agent capacity leaves excess work visibly unassigned",
  );
  token = await login("ops@flash.app");
  const agents = await call("/admin/support/agents");
  assert(
    agents.body.agents?.some(
      (agent) =>
        agent.userId === supportId &&
        agent.activeTickets === 1 &&
        agent.maxActiveTickets === 1,
    ),
    "operations sees live workload and capacity",
  );
  const capacity = await call(`/admin/support/agents/${supportId}`, {
    method: "PATCH",
    body: JSON.stringify({ maxActiveTickets: 2 }),
  });
  requestIds.push(capacity.body.requestId);
  const routed = await call("/admin/support/process", {
    method: "POST",
    body: JSON.stringify({ limit: 20 }),
  });
  requestIds.push(routed.body.requestId);
  assert(
    capacity.status === 200 &&
      routed.body.result?.assigned?.some(
        (entry) =>
          entry.ticketId === ticketIds[1] && entry.agentId === supportId,
      ),
    "raising capacity lets queue worker assign waiting case",
  );
  await pool.query(
    "UPDATE support_tickets SET first_responded_at=NULL,first_response_due_at=now()-interval '1 minute',escalation_level=0,last_escalated_at=NULL WHERE public_id=$1",
    [ticketIds[0]],
  );
  const concurrent = await Promise.all([
    call("/admin/support/process", {
      method: "POST",
      body: JSON.stringify({ limit: 20 }),
    }),
    call("/admin/support/process", {
      method: "POST",
      body: JSON.stringify({ limit: 20 }),
    }),
  ]);
  concurrent.forEach((result) => requestIds.push(result.body.requestId));
  const evidence = await pool.query(
    `SELECT (SELECT count(*) FROM support_escalation_events e JOIN support_tickets t ON t.id=e.ticket_id WHERE t.public_id=$1 AND e.level=1)::int events,(SELECT count(*) FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE t.public_id=$1 AND m.internal AND m.body LIKE 'Escalamiento automático nivel 1:%')::int notes,(SELECT count(*) FROM notifications WHERE payload->>'ticketId'=$1 AND template='support_escalated')::int notifications`,
    [ticketIds[0]],
  );
  assert(
    concurrent.every((result) => result.status === 200) &&
      evidence.rows[0].events === 1 &&
      evidence.rows[0].notes === 1 &&
      evidence.rows[0].notifications === 1,
    "concurrent workers emit one idempotent SLA escalation, note and alert",
  );
  const queue = await call("/support/tickets"),
    escalated = queue.body.tickets?.find((entry) => entry.id === ticketIds[0]);
  assert(
    escalated?.escalationLevel === 1 &&
      escalated.escalations?.length === 1 &&
      escalated.assignmentHistory?.length === 1,
    "operations receives persisted ownership and escalation history",
  );
  const offline = await call(`/admin/support/agents/${supportId}`, {
    method: "PATCH",
    body: JSON.stringify({ availability: "offline" }),
  });
  requestIds.push(offline.body.requestId);
  const invalidAssignment = await call(`/support/tickets/${ticketIds[1]}`, {
    method: "PATCH",
    body: JSON.stringify({ assignedTo: supportId }),
  });
  assert(
    offline.status === 200 && invalidAssignment.status === 409,
    "manual routing rejects an offline agent",
  );
} finally {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if (requestIds.filter(Boolean).length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [
      requestIds.filter(Boolean),
    ]);
  if (ticketIds.filter(Boolean).length) {
    await pool.query(
      "DELETE FROM notifications WHERE payload->>'ticketId'=ANY($1)",
      [ticketIds.filter(Boolean)],
    );
    await pool.query("DELETE FROM realtime_events WHERE entity_id=ANY($1)", [
      ticketIds.filter(Boolean),
    ]);
    await pool.query("DELETE FROM support_tickets WHERE public_id=ANY($1)", [
      ticketIds.filter(Boolean),
    ]);
  }
  if (originalProfile)
    await pool.query(
      "UPDATE support_agent_profiles SET availability=$1,max_active_tickets=$2,skills=$3,last_assigned_at=$4,updated_at=now() WHERE user_id=(SELECT id FROM users WHERE public_id='usr_admin')",
      [
        originalProfile.availability,
        originalProfile.max_active_tickets,
        originalProfile.skills,
        originalProfile.last_assigned_at,
      ],
    );
  await pool.query(
    "DELETE FROM refresh_sessions WHERE user_id=(SELECT id FROM users WHERE public_id=$1)",
    [supportId],
  );
  await pool.query(
    "DELETE FROM user_roles WHERE user_id=(SELECT id FROM users WHERE public_id=$1)",
    [supportId],
  );
  await pool.query("DELETE FROM users WHERE public_id=$1", [supportId]);
  await pool.end();
}
