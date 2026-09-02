# Recursos segmentados por audiencia

Web y mobile ya no consumen `GET /api/state`. El bootstrap inicial se solicita en `/api/bootstrap/customer`, `/merchant`, `/driver`, `/operations` o `/support`; el backend valida que el JWT posea exactamente la audiencia solicitada y responde con `Cache-Control: no-store`.

`GET /api/me/activity` es el primer agregado extraído del bootstrap. Lee la participación directamente desde PostgreSQL (`customer_id`, propietario del comercio o usuario del driver), admite `limit` 1–50 y cursor opaco estable por `(created_at,id)`. Devuelve únicamente pedidos, viajes y envíos autorizados con `nextCursor`; un cursor manipulado se rechaza. El bootstrap ya no contiene `orders`, `rides`, `shipments` ni `tips`; los clientes compatibilizan sus vistas componiendo el contexto y la página autorizada.

La app móvil usa este recurso para Actividad y permite cargar páginas anteriores. `/api/state` fue retirado después de migrar web, mobile y todas las suites; responde `410 Gone` y no realiza lecturas agregadas.

`GET /api/catalog/restaurants` pagina comercios activos con cursor de precisión de microsegundos y búsqueda server-side. Su serializer público elimina `ownerId`, apertura manual, inventario, horarios y excepciones internas; sólo conserva información necesaria para discovery, sucursales visibles y menú. Customer y Driver lo componen fuera del bootstrap; Merchant conserva el agregado privado de su consola.

`GET /api/driver/me` reemplaza la colección global de conductores en la audiencia Driver. El backend deriva el perfil desde `req.auth.userId`, no acepta un `driverId` controlado por el cliente y responde `no-store`; Customer y Merchant reciben `403`. La app Driver compone este único perfil con su actividad autorizada, por lo que una cuenta de conductor ya no puede enumerar la flota desde el bootstrap.

`GET /api/merchant/me` hace lo equivalente para la consola de Negocios: obtiene desde PostgreSQL sólo los comercios cuyo `owner_id` corresponde a la identidad autenticada. El bootstrap Merchant ya no transporta restaurantes; la cocina compone este recurso privado con `/api/me/activity`.

`GET /api/me/assigned-drivers` entrega a Customer y Merchant únicamente conductores que participaron en trabajos propios activos o recientes. Es una proyección pública mínima para tracking: nombre, rating, vehículo, patente y última posición; excluye `userId`, disponibilidad, modos de servicio y ganancias. Ningún bootstrap de producto transporta ya la colección `drivers`.

Operaciones obtiene flota, comercios y usuarios desde `GET /api/operations/drivers`, `/restaurants` y `/users`. Requieren sesión administrativa con segundo factor cuando corresponde, usan límite 1–100, búsqueda y cursor estable `(created_at,id)`, y responden `no-store`. El recurso de usuarios excluye hash de contraseña, UUID interno y estado interno de bloqueo; esa sanitización también se aplica a la compatibilidad antigua. El bootstrap `operations` ya no incluye esos agregados.

La mesa de ayuda administrativa usa `GET /api/operations/support-tickets`, ordenada por `(updated_at,id)` descendente y paginada con cursor opaco. Conserva mensajes, asignaciones, escalaciones y estado SLA necesarios para operar, pero queda fuera del bootstrap. Un agente con rol `support` lee esa cola y el bootstrap `support`; no enumera usuarios ni el dashboard de administración, y sólo puede editar su propio perfil de agente. El endpoint previo `/api/support/tickets` continúa como recurso propietario del cliente y compatibilidad de las acciones existentes.

Auditoría se consulta en `GET /api/operations/audit-events`, con búsqueda y cursor descendente `(occurred_at,id)`. Zonas y promociones se reutilizan desde `/api/zones` y `/api/promotions` con caché pública acotada de 30 segundos. El escritorio compone esos tres contratos y el bootstrap ya no transporta configuración ni eventos históricos.

El contexto privado de cuenta vive en `GET /api/me`: usuario sanitizado, direcciones, medios de pago tokenizados, movimientos de wallet, tickets propios, ratings, favoritos y propinas propias. Incluso para roles staff, “me” nunca amplía soporte a toda la organización. Web y mobile componen estos datos fuera del bootstrap, que ya no transporta ninguno de esos agregados.
