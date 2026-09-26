// Agentes de soporte, asignación y cola SLA (ARC-001).
//
// Tickets CRUD → `support-repository.js`.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";

const notificationId = () => `NTF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

export async function assignTicketToBestAgent(
  client,
  { ticketId, category, reason, assignedBy = null },
) {
  const candidate = (
    await client.query(
      `SELECT p.user_id, u.public_id, load.active_count
       FROM support_agent_profiles p
       JOIN users u ON u.id = p.user_id
       CROSS JOIN LATERAL (
         SELECT count(*)::int active_count
         FROM support_tickets open_ticket
         WHERE open_ticket.assigned_to = p.user_id
           AND open_ticket.status NOT IN ('resolved', 'closed')
       ) load
       WHERE u.status = 'active'
         AND p.availability <> 'offline'
         AND ('all' = ANY(p.skills) OR $1 = ANY(p.skills))
         AND load.active_count < p.max_active_tickets
         AND EXISTS (
           SELECT 1 FROM user_roles ur
           WHERE ur.user_id = u.id AND ur.role IN ('admin', 'support')
         )
       ORDER BY load.active_count::numeric / p.max_active_tickets,
         p.availability = 'busy', p.last_assigned_at NULLS FIRST, u.public_id
       LIMIT 1
       FOR UPDATE OF p SKIP LOCKED`,
      [category],
    )
  ).rows[0];
  if (!candidate) return null;
  await client.query("UPDATE support_tickets SET assigned_to=$2,updated_at=now() WHERE id=$1", [
    ticketId,
    candidate.user_id,
  ]);
  await client.query(
    "UPDATE support_agent_profiles SET last_assigned_at=now(),updated_at=now() WHERE user_id=$1",
    [candidate.user_id],
  );
  await client.query(
    "INSERT INTO support_ticket_assignments(ticket_id,assigned_to,assigned_by,reason) VALUES($1,$2,$3,$4)",
    [ticketId, candidate.user_id, assignedBy, reason],
  );
  return candidate;
}

const mapAgent = (row) => ({
  userId: row.public_id,
  name: row.name,
  availability: row.availability,
  maxActiveTickets: row.max_active_tickets,
  skills: row.skills,
  activeTickets: Number(row.active_tickets),
  lastAssignedAt: row.last_assigned_at ? new Date(row.last_assigned_at).toISOString() : null,
  updatedAt: new Date(row.updated_at).toISOString(),
});
export async function getSupportAgents() {
  const rows = (
    await postgresPool.query(
      `SELECT u.public_id, u.name, p.*,
        count(t.id) FILTER (WHERE t.status NOT IN ('resolved', 'closed'))::int active_tickets
       FROM support_agent_profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN support_tickets t ON t.assigned_to = p.user_id
       GROUP BY u.id, p.user_id
       ORDER BY p.availability = 'offline', active_tickets, u.name`,
    )
  ).rows;
  return rows.map(mapAgent);
}
export async function updateSupportAgent({ userPublicId, availability, maxActiveTickets, skills }) {
  const result = await postgresPool.query(
    `UPDATE support_agent_profiles p SET
      availability = COALESCE($2, p.availability),
      max_active_tickets = COALESCE($3, p.max_active_tickets),
      skills = COALESCE($4, p.skills),
      updated_at = now()
     FROM users u
     WHERE p.user_id = u.id AND u.public_id = $1
     RETURNING u.public_id, u.name, p.*,
       (SELECT count(*)::int FROM support_tickets t
        WHERE t.assigned_to = p.user_id AND t.status NOT IN ('resolved', 'closed')) active_tickets`,
    [userPublicId, availability || null, maxActiveTickets || null, skills || null],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Perfil de soporte no encontrado"), {
      status: 404,
    });
  return mapAgent(result.rows[0]);
}

export async function processSupportQueue({ limit = 50 } = {}) {
  const client = await postgresPool.connect();
  const assigned = [],
    escalated = [];
  try {
    await client.query("BEGIN");
    const unassigned = (
      await client.query(
        `SELECT id, public_id, category
         FROM support_tickets
         WHERE assigned_to IS NULL AND status NOT IN ('resolved', 'closed')
         ORDER BY CASE priority
           WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
           created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [limit],
      )
    ).rows;
    for (const ticket of unassigned) {
      const agent = await assignTicketToBestAgent(client, {
        ticketId: ticket.id,
        category: ticket.category,
        reason: "auto_queue",
      });
      if (agent) assigned.push({ ticketId: ticket.public_id, agentId: agent.public_id });
    }
    const candidates = (
      await client.query(
        `SELECT id, public_id, category, assigned_to,
          CASE
            WHEN first_responded_at IS NULL AND first_response_due_at < now() THEN 1
            WHEN resolution_due_at < now() THEN 2
            ELSE 0
          END target_level
         FROM support_tickets
         WHERE status NOT IN ('resolved', 'closed')
           AND (
             (first_responded_at IS NULL AND first_response_due_at < now()
              AND escalation_level < 1)
             OR (resolution_due_at < now() AND escalation_level < 2)
           )
         ORDER BY resolution_due_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [limit],
      )
    ).rows;
    for (const ticket of candidates) {
      let assignedTo = ticket.assigned_to;
      if (!assignedTo) {
        const agent = await assignTicketToBestAgent(client, {
          ticketId: ticket.id,
          category: ticket.category,
          reason: "escalation",
        });
        assignedTo = agent?.user_id || null;
      }
      const kind = ticket.target_level === 1 ? "first_response" : "resolution",
        event = (
          await client.query(
            "INSERT INTO support_escalation_events(ticket_id,level,breach_kind,assigned_to) VALUES($1,$2,$3,$4) ON CONFLICT(ticket_id,level) DO NOTHING RETURNING id",
            [ticket.id, ticket.target_level, kind, assignedTo],
          )
        ).rows[0];
      if (!event) continue;
      await client.query(
        "UPDATE support_tickets SET escalation_level=$2,last_escalated_at=now(),updated_at=now() WHERE id=$1",
        [ticket.id, ticket.target_level],
      );
      await client.query(
        "INSERT INTO support_messages(ticket_id,sender_id,body,internal) VALUES($1,NULL,$2,true)",
        [
          ticket.id,
          `Escalamiento automático nivel ${ticket.target_level}: SLA de ${kind === "first_response" ? "primera respuesta" : "resolución"} vencido.`,
        ],
      );
      const recipients = assignedTo
        ? [assignedTo]
        : (
            await client.query(
              `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE u.status='active' AND ur.role IN('admin','support')`,
            )
          ).rows.map((row) => row.id);
      for (const userId of recipients)
        await client.query(
          `INSERT INTO notifications(
            public_id, user_id, channel, template, payload, deduplication_key, status
          ) VALUES ($1, $2, 'in_app', 'support_escalated', $3, $4, 'sent')
          ON CONFLICT (user_id, channel, deduplication_key) DO NOTHING`,
          [
            notificationId(),
            userId,
            {
              ticketId: ticket.public_id,
              level: ticket.target_level,
              breachKind: kind,
            },
            `support-escalation-${ticket.public_id}-${ticket.target_level}`,
          ],
        );
      escalated.push({
        ticketId: ticket.public_id,
        level: ticket.target_level,
        breachKind: kind,
      });
    }
    await client.query("COMMIT");
    return { assigned, escalated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
