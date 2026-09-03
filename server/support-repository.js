// Tickets de soporte (ARC-001).
//
// Agentes, asignación y cola SLA → `support-agent-repository.js`.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { assignTicketToBestAgent } from "./support-agent-repository.js";

const ticketId = () => `TCK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const notificationId = () => `NTF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const isStaff = (roles) => roles.includes("admin") || roles.includes("support");
const apiPriority = (value) => (value === "normal" ? "medium" : value);

const mapTicket = (row) => ({
  id: row.public_id,
  userId: row.user_public_id,
  jobId: row.job_public_id || null,
  service: row.category,
  status: row.status,
  title: row.subject,
  priority: apiPriority(row.priority),
  assignedTo: row.assigned_public_id || null,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  firstResponseDueAt: new Date(row.first_response_due_at).toISOString(),
  resolutionDueAt: new Date(row.resolution_due_at).toISOString(),
  firstRespondedAt: row.first_responded_at ? new Date(row.first_responded_at).toISOString() : null,
  escalationLevel: Number(row.escalation_level || 0),
  lastEscalatedAt: row.last_escalated_at ? new Date(row.last_escalated_at).toISOString() : null,
  assignmentHistory: (row.assignment_history || []).map((entry) => ({
    ...entry,
    createdAt: new Date(entry.createdAt).toISOString(),
  })),
  escalations: (row.escalations || []).map((entry) => ({
    ...entry,
    createdAt: new Date(entry.createdAt).toISOString(),
  })),
  slaStatus:
    row.status === "resolved" || row.status === "closed"
      ? "met"
      : !row.first_responded_at && new Date(row.first_response_due_at) < new Date()
        ? "first_response_breached"
        : new Date(row.resolution_due_at) < new Date()
          ? "resolution_breached"
          : "on_track",
  messages: (row.messages || []).map((message) => ({
    ...message,
    createdAt: new Date(message.createdAt).toISOString(),
  })),
});

export async function getPostgresSupportTickets({ userPublicId, roles }) {
  const staff = isStaff(roles);
  const result = await postgresPool.query(
    `SELECT t.*, u.public_id user_public_id, j.public_id job_public_id,
      a.public_id assigned_public_id,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', m.id, 'senderId', s.public_id, 'body', m.body,
          'attachments', m.attachments, 'internal', m.internal, 'createdAt', m.created_at
        ) ORDER BY m.created_at)
        FROM support_messages m
        LEFT JOIN users s ON s.id = m.sender_id
        WHERE m.ticket_id = t.id AND ($2::boolean OR NOT m.internal)
      ), '[]') messages,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'assignedTo', assignee.public_id, 'assignedBy', assigner.public_id,
          'reason', h.reason, 'createdAt', h.created_at
        ) ORDER BY h.created_at)
        FROM support_ticket_assignments h
        JOIN users assignee ON assignee.id = h.assigned_to
        LEFT JOIN users assigner ON assigner.id = h.assigned_by
        WHERE h.ticket_id = t.id
      ), '[]') assignment_history,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'level', e.level, 'breachKind', e.breach_kind,
          'assignedTo', ea.public_id, 'createdAt', e.created_at
        ) ORDER BY e.created_at)
        FROM support_escalation_events e
        LEFT JOIN users ea ON ea.id = e.assigned_to
        WHERE e.ticket_id = t.id
      ), '[]') escalations
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN jobs j ON j.id = t.job_id
    LEFT JOIN users a ON a.id = t.assigned_to
    WHERE ($2::boolean OR u.public_id = $1)
    ORDER BY CASE t.priority
      WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      t.updated_at DESC`,
    [userPublicId, staff],
  );
  return result.rows.map(mapTicket);
}

export async function getPostgresOperationsSupportTicketPage({
  limit = 50,
  cursor = null,
  query = "",
} = {}) {
  const result = await postgresPool.query(
    `SELECT t.*, u.public_id user_public_id, j.public_id job_public_id,
      a.public_id assigned_public_id,
      to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_updated_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', m.id, 'senderId', s.public_id, 'body', m.body,
          'attachments', m.attachments, 'internal', m.internal, 'createdAt', m.created_at
        ) ORDER BY m.created_at)
        FROM support_messages m
        LEFT JOIN users s ON s.id = m.sender_id
        WHERE m.ticket_id = t.id
      ), '[]') messages,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'assignedTo', assignee.public_id, 'assignedBy', assigner.public_id,
          'reason', h.reason, 'createdAt', h.created_at
        ) ORDER BY h.created_at)
        FROM support_ticket_assignments h
        JOIN users assignee ON assignee.id = h.assigned_to
        LEFT JOIN users assigner ON assigner.id = h.assigned_by
        WHERE h.ticket_id = t.id
      ), '[]') assignment_history,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'level', e.level, 'breachKind', e.breach_kind,
          'assignedTo', ea.public_id, 'createdAt', e.created_at
        ) ORDER BY e.created_at)
        FROM support_escalation_events e
        LEFT JOIN users ea ON ea.id = e.assigned_to
        WHERE e.ticket_id = t.id
      ), '[]') escalations
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN jobs j ON j.id = t.job_id
    LEFT JOIN users a ON a.id = t.assigned_to
    WHERE ($1 = '' OR t.public_id ILIKE '%' || $1 || '%'
      OR t.subject ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
      AND ($2::timestamptz IS NULL OR (t.updated_at, t.id) < ($2::timestamptz, $3::uuid))
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT $4`,
    [query.trim(), cursor?.updatedAt || null, cursor?.id || null, limit + 1],
  );
  const hasMore = result.rows.length > limit,
    rows = result.rows.slice(0, limit),
    last = rows.at(-1);
  return {
    tickets: rows.map(mapTicket),
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify({ updatedAt: last.cursor_updated_at, id: last.id })).toString(
            "base64url",
          )
        : null,
  };
}

export async function createPostgresSupportTicket({
  userPublicId,
  category,
  priority,
  subject,
  body,
  jobPublicId = null,
  idempotencyKey,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query("SELECT id FROM users WHERE public_id=$1", [userPublicId]))
      .rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ userPublicId, category, priority, subject, body, jobPublicId }))
      .digest("hex");
    const claim = (
      await client.query(
        "INSERT INTO idempotency_keys(key,user_id,request_hash,expires_at) VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING key",
        [idempotencyKey, user.id, requestHash],
      )
    ).rows[0];
    if (!claim) {
      const existing = (
        await client.query(
          "SELECT user_id,request_hash,response_body FROM idempotency_keys WHERE key=$1",
          [idempotencyKey],
        )
      ).rows[0];
      if (String(existing?.user_id) !== String(user.id) || existing?.request_hash !== requestHash)
        throw Object.assign(new Error("Clave de idempotencia reutilizada con otra solicitud"), {
          status: 409,
        });
      if (existing?.response_body?.ticketId) {
        await client.query("ROLLBACK");
        return {
          ticket: (await getPostgresSupportTickets({ userPublicId, roles: [] })).find(
            (entry) => entry.id === existing.response_body.ticketId,
          ),
          replayed: true,
        };
      }
      throw Object.assign(new Error("Solicitud de soporte en proceso"), { status: 409 });
    }
    let jobId = null;
    if (jobPublicId) {
      const job = (
        await client.query("SELECT id,customer_id FROM jobs WHERE public_id=$1", [jobPublicId])
      ).rows[0];
      if (!job)
        throw Object.assign(new Error("Servicio no encontrado"), {
          status: 404,
        });
      if (job.customer_id !== user.id)
        throw Object.assign(new Error("No puedes abrir soporte sobre otro servicio"), {
          status: 403,
        });
      jobId = job.id;
    }
    const publicId = ticketId();
    const ticket = (
      await client.query(
        `INSERT INTO support_tickets(
          public_id, user_id, job_id, category, priority, subject,
          first_response_due_at, resolution_due_at
        )
        SELECT $1, $2, $3, $4, $5, $6,
          now() + (p.first_response_minutes * interval '1 minute'),
          now() + (p.resolution_minutes * interval '1 minute')
        FROM support_sla_policies p
        WHERE p.priority = $5 AND p.active
        RETURNING id`,
        [publicId, user.id, jobId, category, priority, subject],
      )
    ).rows[0];
    if (!ticket)
      throw Object.assign(new Error("No existe una política SLA activa para la prioridad"), {
        status: 503,
      });
    await assignTicketToBestAgent(client, {
      ticketId: ticket.id,
      category,
      reason: "auto_create",
    });
    await client.query("INSERT INTO support_messages(ticket_id,sender_id,body) VALUES($1,$2,$3)", [
      ticket.id,
      user.id,
      body,
    ]);
    await client.query(
      `INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status)
      VALUES($1,$2,'in_app','support_ticket_created',$3,$4,'sent')`,
      [notificationId(), user.id, { ticketId: publicId, subject }, `support-created-${publicId}`],
    );
    await client.query(
      "UPDATE idempotency_keys SET response_status=201,response_body=$2 WHERE key=$1",
      [idempotencyKey, { ticketId: publicId }],
    );
    await client.query("COMMIT");
    return {
      ticket: (await getPostgresSupportTickets({ userPublicId, roles: [] })).find(
        (entry) => entry.id === publicId,
      ),
      replayed: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addPostgresSupportMessage({
  ticketPublicId,
  senderPublicId,
  roles,
  body,
  internal = false,
  idempotencyKey,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const sender = (await client.query("SELECT id FROM users WHERE public_id=$1", [senderPublicId]))
      .rows[0];
    if (!sender) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    const ticket = (
      await client.query(
        `SELECT t.id,t.user_id,u.public_id user_public_id FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.public_id=$1 FOR UPDATE`,
        [ticketPublicId],
      )
    ).rows[0];
    if (!ticket) throw Object.assign(new Error("Ticket no encontrado"), { status: 404 });
    const staff = isStaff(roles);
    if (!staff && ticket.user_public_id !== senderPublicId)
      throw Object.assign(new Error("No puedes responder este ticket"), {
        status: 403,
      });
    if (internal && !staff)
      throw Object.assign(new Error("Las notas internas requieren rol de soporte"), {
        status: 403,
      });
    const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify({ ticketPublicId, senderPublicId, body, internal }))
        .digest("hex"),
      claim = (
        await client.query(
          "INSERT INTO idempotency_keys(key,user_id,request_hash,expires_at) VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING key",
          [idempotencyKey, sender.id, requestHash],
        )
      ).rows[0];
    if (!claim) {
      const existing = (
        await client.query(
          "SELECT user_id,request_hash,response_body FROM idempotency_keys WHERE key=$1",
          [idempotencyKey],
        )
      ).rows[0];
      if (String(existing?.user_id) !== String(sender.id) || existing?.request_hash !== requestHash)
        throw Object.assign(new Error("Clave de idempotencia reutilizada con otro mensaje"), {
          status: 409,
        });
      if (existing?.response_body?.ticketId) {
        await client.query("ROLLBACK");
        return {
          ticket: (await getPostgresSupportTickets({ userPublicId: senderPublicId, roles })).find(
            (entry) => entry.id === ticketPublicId,
          ),
          replayed: true,
        };
      }
      throw Object.assign(new Error("Mensaje de soporte en proceso"), { status: 409 });
    }
    await client.query(
      "INSERT INTO support_messages(ticket_id,sender_id,body,internal) VALUES($1,$2,$3,$4)",
      [ticket.id, sender?.id || null, body, internal],
    );
    await client.query(
      "UPDATE support_tickets SET status=$2,first_responded_at=CASE WHEN $3 AND first_responded_at IS NULL THEN now() ELSE first_responded_at END,updated_at=now() WHERE id=$1",
      [ticket.id, staff ? "waiting_customer" : "waiting_operations", staff],
    );
    if (!internal)
      await client.query(
        `INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status)
      VALUES($1,$2,'in_app','support_reply',$3,$4,'sent') ON CONFLICT(user_id,channel,deduplication_key) DO NOTHING`,
        [
          notificationId(),
          ticket.user_id,
          { ticketId: ticketPublicId },
          `support-reply-${ticketPublicId}-${crypto.randomUUID()}`,
        ],
      );
    await client.query(
      "UPDATE idempotency_keys SET response_status=200,response_body=$2 WHERE key=$1",
      [idempotencyKey, { ticketId: ticketPublicId }],
    );
    await client.query("COMMIT");
    return {
      ticket: (await getPostgresSupportTickets({ userPublicId: senderPublicId, roles })).find(
        (entry) => entry.id === ticketPublicId,
      ),
      replayed: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePostgresSupportTicket({
  ticketPublicId,
  actorPublicId,
  roles,
  status,
  priority,
  assignedTo,
}) {
  if (!isStaff(roles))
    throw Object.assign(new Error("Se requiere rol de soporte"), {
      status: 403,
    });
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    const current = (
      await client.query(
        "SELECT id,assigned_to FROM support_tickets WHERE public_id=$1 FOR UPDATE",
        [ticketPublicId],
      )
    ).rows[0];
    if (!current) throw Object.assign(new Error("Ticket no encontrado"), { status: 404 });
    let assignedId = current.assigned_to;
    if (assignedTo) {
      const target = (
        await client.query(
          `SELECT u.id
           FROM users u
           JOIN support_agent_profiles p ON p.user_id = u.id
           WHERE u.public_id = $1 AND u.status = 'active'
             AND p.availability <> 'offline'
             AND EXISTS (
               SELECT 1 FROM user_roles ur
               WHERE ur.user_id = u.id AND ur.role IN ('admin', 'support')
             )`,
          [assignedTo],
        )
      ).rows[0];
      if (!target)
        throw Object.assign(new Error("Agente no disponible o sin perfil de soporte"), {
          status: 409,
        });
      assignedId = target.id;
    } else if (!assignedId) assignedId = actor?.id || null;
    await client.query(
      `UPDATE support_tickets t SET
        status = COALESCE($2, t.status),
        priority = COALESCE($3, t.priority),
        assigned_to = $4,
        resolved_at = CASE
          WHEN $2 IN ('resolved', 'closed') THEN now()
          WHEN $2 IS NOT NULL THEN NULL
          ELSE t.resolved_at
        END,
        updated_at = now()
      FROM support_sla_policies p
      WHERE t.id = $1 AND p.priority = COALESCE($3, t.priority)`,
      [current.id, status || null, priority || null, assignedId],
    );
    if (assignedId && String(assignedId) !== String(current.assigned_to)) {
      await client.query(
        "INSERT INTO support_ticket_assignments(ticket_id,assigned_to,assigned_by,reason) VALUES($1,$2,$3,'manual')",
        [current.id, assignedId, actor?.id || null],
      );
      await client.query(
        "UPDATE support_agent_profiles SET last_assigned_at=now(),updated_at=now() WHERE user_id=$1",
        [assignedId],
      );
    }
    await client.query("COMMIT");
    return (await getPostgresSupportTickets({ userPublicId: actorPublicId, roles })).find(
      (entry) => entry.id === ticketPublicId,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
