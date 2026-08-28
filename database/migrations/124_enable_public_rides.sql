-- La movilidad publica queda habilitada (ticket ARC-001, cableado de flags).
--
-- `public_rides` estaba en `enabled=false` con rollout 0 desde la migracion 093,
-- descrito como «movilidad publica sujeta a habilitacion y safety». La app
-- mostraba la pestana de Taxi igual, porque **ningun cliente leia los flags**.
--
-- Al cablear `GET /api/features` el 28 de agosto la contradiccion quedo a la
-- vista: o el flag estaba desactualizado, o el producto ofrecia una superficie
-- que su propio control de release decia que no estaba habilitada. El dueno
-- confirmo lo primero: la movilidad opera.
--
-- Se enciende por migracion y no editando la 093, que es el registro de como
-- nacio el flag. Las migraciones son de solo agregar: reescribir la anterior
-- dejaria un esquema que no se puede reconstruir desde cero y borraria la
-- evidencia de que el flag estuvo apagado.
--
-- A partir de acá la pestana la gobierna el flag: apagarla vuelve a ser una
-- decision de operaciones desde el panel, sin tocar codigo ni desplegar.
UPDATE feature_flags
SET enabled = true,
    rollout_percentage = 100,
    description = 'Movilidad publica habilitada; el apagado vuelve a ser una decision de operaciones',
    updated_at = now()
WHERE key = 'public_rides';
