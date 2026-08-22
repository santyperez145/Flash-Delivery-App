# Operación en vivo de Flash Negocios

Fecha de contraste: 22 de agosto de 2026.

## Referencias oficiales

- [DoorDash Business Manager App](https://help.doordash.com/en-us/merchants/article/business-manager-app): separa pedidos en vivo, preparación, stock, reembolsos y cortes de información hoy/ayer/7/30 días.
- [DoorDash: Manage Store on Tablet](https://help.doordash.com/en-us/merchants/article/manage-store-on-tablet): distingue operación normal, ocupada y pausada; el modo ocupado modifica capacidad/tiempos en lugar de inventar demanda.
- [DoorDash Tablet Order Manager](https://help.doordash.com/en-us/merchants/article/tablet-order-manager-overview): prioriza pedidos entrantes, acción requerida, preparación y listo para retirar.
- [Uber Eats Manager: customer and order data](https://help.uber.com/en/merchants-and-restaurants/article/understanding-customer-and-order-data-in-uber-eats-manager-?nodeId=49fc4e14-cd2e-4224-99e5-3b922cf78dc8): separa ventas, cantidad/ticket y señales operativas como cancelaciones, pedidos perdidos y downtime.
- [Uber Eats Manager: performance data](https://help.uber.com/en/merchants-and-restaurants/article/how-can-i-view-my-performance-data-in-uber-eats-manager?nodeId=980a4325-3a80-42d5-83ae-2876982a5994): la vista de tiendas usa día local desde medianoche y refresco frecuente; ventas se agregan al completar.
- [Uber Eats: what happens when an order comes in](https://help.uber.com/en/merchants-and-restaurants/article/what-happens-when-an-order-comes-in-/?nodeId=e8c42cb6-37e4-4617-925f-e3ed015abbf7): el pedido pagado entra a preparación y conserva un horario esperado de retiro derivado del tiempo informado.
- [Uber Eats Orders user guide](https://help.uber.com/en-GB/merchants-and-restaurants/article/uber-eats-orders-user-guide?nodeId=cf66954d-a1c7-4148-a011-3c2bee00a6ad): concentra detalle, preparación, entrega y contacto con el cliente dentro del pedido activo.
- [Uber Eats: producto agotado](https://help.uber.com/en/merchants-and-restaurants/article/what-if-an-item-is-out-of-stock?nodeId=91f22776-9698-490f-b32c-ea1c08c5c8f9): hace visible el faltante durante la gestión del pedido en lugar de ocultarlo como un cambio de catálogo sin contexto.
- [DoorDash Business Manager App](https://merchants.doordash.com/en-us/learning-center/business-manager-app): mantiene pedidos en vivo, menú y operación del local dentro de una superficie de negocio diferenciada.

## Decisión Flash

`GET /api/merchant/dashboard` deriva el conjunto autorizado de la sesión, acepta una selección explícita dentro de ese ownership —obligatoria para administración— y consulta PostgreSQL. El contrato separa:

- cola operativa: acción requerida, preparando, listo para retirar y flujo del courier;
- riesgo operativo: plazos vencidos, pedido activo más antiguo y productos no disponibles en la sucursal principal;
- resultado del día local: completados, cancelados, venta bruta y ticket promedio;
- procedencia: instante de observación, zona horaria, sucursal y fuente PostgreSQL.

En cuentas con más de un comercio, desktop y Merchant App envían una selección explícita que el servidor cruza nuevamente con el propietario autenticado. Nunca se confía en el identificador aislado del cliente. Las superficies actualizan cada 30 segundos y ante cambios de workflow; si el refresco falla, conservan la última lectura sólo bajo una etiqueta visible de dato retenido.

El home adopta la jerarquía observada en las referencias: estado operativo y vigencia, KPIs de hoy, pulso por etapa, alertas SLA y luego comandas/capacidad. No reproduce identidad visual ni textos de terceros. La acción global de apertura y ETA modifica comercio y sucursal principal dentro de una misma transacción, de modo que discovery, cotización y tablero no observen valores intermedios distintos.

La cola visible usa `GET /api/merchant/orders/active`, no `/api/me/activity`: PostgreSQL selecciona únicamente trabajos activos del comercio propio y prioriza aceptar, preparar, listo y etapas del courier. El límite de 100 se comunica con `hasMore`; nunca se convierte un truncamiento en un falso “todo al día”. Desktop y Merchant App ocultan acciones cuando la etapa pertenece al conductor.

Merchant App separa Hoy, Pedidos, Catálogo y Cuenta mediante navegación inferior fija. Hoy concentra estado/KPIs/capacidad; Pedidos conserva la cola y el chat; Catálogo mantiene stock/altas; Cuenta muestra sucursales y procedencia. Es una segmentación funcional sobre datos compartidos, no cuatro copias del mismo home.

La comanda activa de desktop y Merchant App abre un detalle operativo común: estado, hora, sucursal, total, plazo, courier, destino, renglones, extras y notas reales del cliente. Desde ese contexto se puede abrir el chat o gestionar un faltante. La cola expone `branchId`; por eso marcar agotado modifica exclusivamente `catalog_branch_inventory` de la sucursal que recibió el pedido y no despublica el producto en toda la cadena.

Una sustitución exige que el original esté agotado en esa sucursal y que el reemplazo sea distinto, esté disponible allí, tenga stock suficiente para la cantidad pedida y no supere el precio unitario original. El servidor vuelve a comprobar estas reglas bajo bloqueo transaccional: la interfaz no constituye autoridad. La propuesta queda pendiente y bloquea el avance del pedido hasta que el cliente la acepte o rechace; Flash no presume consentimiento por inactividad. Al aceptar un reemplazo más barato, el reintegro exacto se acredita mediante el ledger Wallet balanceado.

Cada pedido nuevo conserva `merchant_prep_minutes` como snapshot inmutable de la sucursal. `merchant_ready_due_at` empieza cuando el pago se acepta, para que una espera del PSP no consuma preparación antes de que el comercio reciba la orden. Los pedidos heredados no se rellenan: `untrackedPrepOrders` comunica la brecha.

La venta diaria exige estado terminal y un evento `completed` dentro del día local. No se usa `created_at` ni se suma el historial descargado en el frontend. Un pedido pendiente de pago tampoco entra en la cola accionable.

La máquina actual mantiene una frontera segura y verificable: el comercio es el único actor que avanza `accepted → preparing → ready_for_pickup`; recién al quedar listo entra en dispatch y el conductor puede aceptar y avanzar retiro/entrega. Esto evita que el estado logístico pise la preparación. El pre-dispatch competitivo antes de “listo” queda bloqueado hasta separar ambas máquinas de estado y medir llegada versus preparación.

## Límites honestos

- La preparación es un SLA persistido, no una predicción. Aún no existe modelo de prep-time por producto, carga o franja.
- No se habilitan recomendaciones automáticas, forecast de demanda ni modo ocupado adaptativo hasta disponer de datos, evaluación y operación real.
- No se habilita sustitución automática ni aceptación por timeout: cambiar ese límite requiere política informada al cliente, medición y reglas explícitas por vertical.
- No se presenta asignación anticipada de courier: requiere estados paralelos de cocina/logística, ETA vial y monitoreo de espera antes de habilitarla.
- SQLite conserva sólo compatibilidad de demo y debe identificarse como `sqlite-test-fallback`; producción requiere PostgreSQL.
- La alerta sirve para priorizar la cocina. No prueba por sí sola causalidad, calidad o cumplimiento contractual.

## Verificación

`npm run test:merchant-dashboard` cubre autenticación, roles, ownership, respuesta privada, selección explícita, corte de día local, venta por evento terminal, pedido vencido, ausencia de snapshots históricos y mutación atómica de apertura/ETA. `npm run test:merchant-operations-ui` evita que desktop o mobile vuelvan a sumar actividad parcial, exige estados loading/error/retained, comanda detallada y gestión por sucursal, y restringe los CTA de cocina a transiciones propias. `npm run test:openapi-contract` bloquea la desaparición del contrato y de los recursos de sustitución. `npm run test:postgres` verifica además faltante, stock del reemplazo, consentimiento, bloqueo de avance y reintegro contable exacto. La composición desktop amplia y mobile/web fue inspeccionada en navegador con datos PostgreSQL; la prueba nativa física continúa pendiente.
