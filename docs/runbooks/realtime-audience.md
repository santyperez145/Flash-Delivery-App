# Runbook — audiencia realtime sin clasificar

Alerta: `FlashRealtimeUnclassifiedAudience`.

## Qué significa

Un evento realtime se publicó con un `entityType` que `resolveAudience` no reconoce, o sin entidad y sin estar declarado como evento global. El evento **no se perdió**: quedó restringido a `admin`, que es el comportamiento seguro por defecto.

Lo que sí ocurrió es que **cliente, comercio o conductor no recibieron una actualización que probablemente les correspondía**. La consecuencia visible es una interfaz que no se refresca sola hasta el siguiente polling o reconexión.

## Por qué la alerta existe

Antes de SEC-001, el mismo caso hacía lo contrario: difundía el evento a **todos** los roles. Esa era la falla — un error de clasificación se convertía en una fuga de señal cross-tenant. El default se invirtió a *deny*, y esta alerta existe para que la clasificación faltante se note y se corrija, en lugar de quedar silenciosamente restringida.

## Diagnóstico

1. Identificar el `entity_type` afectado:

   ```promql
   sum by (entity_type) (increase(flash_realtime_audience_total{outcome="unclassified"}[1h]))
   ```

2. Si `entity_type="none"`, el evento se publicó sin entidad. Buscar el tipo de evento en `realtime_events`:

   ```sql
   SELECT type, action, count(*) FROM realtime_events
   WHERE entity_type IS NULL AND occurred_at > now() - interval '1 hour'
   GROUP BY type, action ORDER BY count DESC;
   ```

3. Localizar el punto de publicación en el código:

   ```bash
   grep -rn 'entityType: "<entity_type>"' server/
   ```

## Resolución

En `server/realtime-repository.js`, decidir cuál de los tres casos aplica:

| Caso | Acción |
| --- | --- |
| La entidad pertenece a un usuario o a participantes | Agregar su resolución en `resolveAudience`, con la consulta de propiedad correspondiente |
| La entidad vive en la tabla `jobs` | Agregar el tipo a `jobEntityTypes` |
| Es configuración de plataforma que todos deben ver | Agregar el tipo a `globalEntityTypes`, o el tipo de evento a `globalEventTypes` si no tiene entidad |

**Agregar una entrada a `globalEntityTypes` o `globalEventTypes` es una decisión de privacidad explícita.** Sólo corresponde cuando el evento no revela nada sobre un usuario, un comercio o un trabajo concreto. Ante la duda, resolver la propiedad; nunca abrir la audiencia para silenciar la alerta.

Todo tipo agregado necesita su caso en `scripts/realtime-audience-smoke.mjs`.

## Otros valores de `outcome`

| Valor | Significado | ¿Alerta? |
| --- | --- | --- |
| `resolved` | Audiencia resuelta a participantes concretos | No |
| `global` | Difusión a todos los roles, declarada explícitamente | No |
| `actor_fallback` | La entidad ya no existe (borrado); se usó el actor autenticado | No |
| `orphan` | Entidad inexistente y sin actor. El evento sólo llega a operaciones | Investigar si es sostenido |
| `unclassified` | Clasificación faltante | **Sí** |

Un `orphan` sostenido suele indicar un worker que publica eventos sin sesión sobre entidades ya borradas. No es una fuga, pero sí un evento que nadie consume.
