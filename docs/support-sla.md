# Soporte conversacional con SLA

La migración `045_support_sla.sql` convierte los tickets en casos medibles. Cada prioridad tiene una política PostgreSQL activa y cada ticket copia plazos absolutos al crearse:

| Prioridad | Primera respuesta | Resolución |
| --------- | ----------------: | ---------: |
| Urgente   |            15 min |        4 h |
| Alta      |               1 h |       12 h |
| Normal    |               4 h |       48 h |
| Baja      |              12 h |     5 días |

El cliente crea casos desde mobile, consulta toda la conversación no interna y responde mientras estén abiertos. Seguridad se clasifica automáticamente como urgente en la UI. Operaciones puede responder, priorizar, asignar y resolver desde las rutas existentes; la primera respuesta del staff se registra una sola vez.

`slaStatus` se deriva de los timestamps persistidos como `on_track`, `first_response_breached`, `resolution_breached` o `met`. Cambiar prioridad recalcula los vencimientos desde la fecha original para no reiniciar artificialmente el reloj.

La migración `046_support_sla_trigger.sql` aplica la política también a escrituras directas y futuros workers. El SLA es una invariante de base de datos, no una convención exclusiva de la API.

Ownership y RLS impiden que otro usuario se una a la conversación. Las notas internas continúan reservadas a soporte/administración y los mensajes privados no se copian a auditoría.

`npm run test:support-sla` verifica plazos, acceso cruzado, primera respuesta, repriorización y breach; elimina todos los fixtures al terminar.

## Routing multiagente y escalamiento

La migración `084_support_assignment_escalation.sql` agrega perfiles operativos
con disponibilidad, capacidad máxima y especialidades. Al crear un caso, el
router selecciona un agente activo con skill compatible y cupo libre, ordenado
por proporción de carga y última asignación. La selección usa
`FOR UPDATE SKIP LOCKED`: varios workers pueden consumir la cola sin adjudicar
dos veces el mismo ticket. Si no hay capacidad, el caso permanece explícitamente
sin asignar.

`support_ticket_assignments` conserva cada cambio de ownership con responsable,
autor, causa y hora. Una reasignación manual sólo acepta perfiles activos y no
offline. Flash Admin permite tomar, reasignar, priorizar y resolver casos, además
de administrar disponibilidad y capacidad del equipo.

`npm run worker:support` procesa pendientes y vencimientos. La primera respuesta
vencida crea escalamiento nivel 1; la resolución vencida, nivel 2. Cada nivel
tiene unicidad en PostgreSQL y genera exactamente una nota interna y una alerta
al responsable. El endpoint operativo permite ejecutar el mismo proceso bajo
demanda sin perder idempotencia.

`npm run test:support-routing` verifica aislamiento, skills, cupos, trabajo
excedente, asignación posterior, workers concurrentes, evidencia persistida y
rechazo de agentes offline.
