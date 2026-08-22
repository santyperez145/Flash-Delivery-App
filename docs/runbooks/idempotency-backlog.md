# Backlog de idempotencia vencida

La alerta indica que `flash_idempotency_keys{status="expired"}` superó 10.000
durante 30 minutos. No elimina datos manualmente como primera respuesta: confirma
que el job `npm run idempotency:prune` está programado, revisa sus logs
`idempotency_pruned` y la salud del pool PostgreSQL.

Ejecuta una corrida controlada y verifica que `deleted` sea mayor que cero. Si
alcanza `maxBatches` con `drained=false`, aumenta temporalmente
`IDEMPOTENCY_PRUNE_MAX_BATCHES` sin superar 100 y observa locks, CPU e I/O. Si
`deleted=0` pero la métrica sigue alta, escala como inconsistencia de reloj o
consulta. No borres claves activas: preservan la semántica de retry de pagos y
creación de servicios.

La alerta se cierra sólo cuando la serie `expired` vuelve bajo el umbral y dos
corridas consecutivas informan `drained=true`.
