# Feature flags operativos

Los flags viven en PostgreSQL y se evalúan en servidor por identidad autenticada, roles, ciudad, ventana temporal y porcentaje. El bucket usa HMAC estable con `FEATURE_FLAG_SALT`; un mismo usuario no cambia aleatoriamente entre cohortes. El cliente recibe únicamente `{active, variant}` y nunca reglas, porcentajes ni segmentos internos.

Operaciones administra rollout y variantes mediante `/api/operations/feature-flags`; cada modificación produce auditoría antes/después. Una falla de evaluación devuelve un conjunto vacío marcado degradado: la conducta segura es mantener la capacidad apagada.

`public_rides` comienza apagado y no se habilita hasta completar seguros, regulación y safety. `delivery_beta` y `shipment_beta` están limitados a Buenos Aires y roles aplicables. Antes de usar rollout multirréplica debe fijarse el mismo secreto en todas las instancias y ejecutarse `test:feature-flags`.
