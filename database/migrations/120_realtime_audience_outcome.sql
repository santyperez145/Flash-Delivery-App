-- El desenlace de la audiencia se guarda con el evento (ticket SEC-001).
--
-- `resolveAudience` clasifica cada evento en uno de cinco desenlaces, y hasta
-- acá ese dato vivia unicamente en un contador en memoria de
-- `observability.js`. Eso alcanza para una alerta —«esta pasando algo»— y no
-- alcanza para nada mas: el contador es **por replica** y **se borra al
-- reiniciar**, asi que no puede responder cuales eventos quedaron sin
-- clasificar, ni cuando, ni si la cosa empeora.
--
-- Para un ticket de default-deny esa es la pregunta importante. Un evento sin
-- clasificar es un defecto de clasificacion, no un estado normal: hay que poder
-- ir a buscarlo despues, con su `entity_type` y su hora.
--
-- La columna admite NULL a proposito. Las filas escritas antes de esta migracion
-- no tienen desenlace registrado y no hay forma honesta de inventarselo:
-- `unclassified` y `orphan` producen la misma audiencia guardada, asi que
-- deducirlo del arreglo seria adivinar. NULL dice «no se registro», que es la
-- verdad.
ALTER TABLE realtime_events ADD COLUMN audience_outcome text;

ALTER TABLE realtime_events ADD CONSTRAINT realtime_events_audience_outcome_check
  CHECK(audience_outcome IS NULL OR audience_outcome IN(
    'global','unclassified','resolved','actor_fallback','orphan'
  ));

-- El panel de operaciones agrupa por desenlace sobre una ventana de tiempo, y
-- la retencion del log es de siete dias, asi que el indice cubre exactamente la
-- consulta que se va a hacer.
CREATE INDEX realtime_events_outcome_idx
  ON realtime_events(audience_outcome, occurred_at DESC)
  WHERE audience_outcome IS NOT NULL;
