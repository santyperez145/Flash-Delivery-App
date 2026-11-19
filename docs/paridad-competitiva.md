# Paridad competitiva — registro de huecos

**Vigente desde el 17 de noviembre de 2026.** Reemplaza al congelamiento de Fase 0 como cola
de trabajo. Objetivo, decidido por el dueño: **paridad completa y competitiva con Uber,
Uber Eats y PedidosYa**, superficie por superficie.

## Cómo se usa

Cada entrega nombra la fila que cierra y cuál de los tres competidores ya la tiene. Una
entrega que no se puede ubicar acá es una entrega que nadie pidió.

El estado de Flash de cada fila está **verificado contra el repositorio**, no supuesto. Esa
distinción no es burocracia: el 28 de agosto `docs/investigacion-competitiva.md` listaba
como faltantes cosas que ya existían —refresh tokens, observabilidad, conciliación—, y el
hallazgo H-10 del propio documento es que **una nota escrita con cautela se lee después como
un hecho**. Al armar este registro pasó dos veces más:

- Supuse que Flash no tenía categorías de viaje. Las tiene:
  `server/http/ride-router.js` valida `service: economy | comfort | moto | xl`.
- Supuse que no se podía reordenar. Se puede: `POST /api/orders/:orderId/reorder`.

Las dos suposiciones habrían generado trabajo duplicado. Por eso cada fila dice **dónde se
verificó**.

## Lo que falta y se puede construir ya

Ordenado por valor sobre esfuerzo, no por facilidad.

| # | Hueco | Quién lo tiene | Estado real en Flash (verificado) |
| --- | --- | --- | --- |
| P-03 | **Lotes de reparto** (dos pedidos cercanos a un repartidor) | Uber Eats, DoorDash | **No existe.** `processPostgresDispatchBatch` es el lote del barrido del despacho, no la agrupación de pedidos en un viaje. Es la palanca más directa sobre el costo por entrega. |
| P-04 | **Programa de lealtad por pedido** | PedidosYa | Hay referidos con premio real (`referral_campaigns`, acreditado al ledger). **No hay puntos ni beneficios acumulables por pedido.** |
| P-05 | **Publicidad y posicionamiento de comercios** | Uber Eats, PedidosYa (es su segunda línea de ingreso) | **No existe.** Hay promociones financiadas por el comercio, no inventario publicitario ni posicionamiento pago. |
| P-06 | **Cuentas corporativas** | Uber for Business, PedidosYa Empresas | **No existe.** Hay suscripción individual (Flash Más) y pedidos grupales, no facturación a una empresa con centros de costo. |
| P-07 | **Paradas múltiples en un viaje** | Uber | El proveedor de rutas ya acepta waypoints intermedios (`server/maps-provider.js`), el alta de viaje no los expone. |
| P-09 | **Pasillos y departamentos en el súper** | PedidosYa Market, Uber Eats grocery | La tienda de un súper usa la misma página que un restaurante: sus categorías hacen de pasillos, pero no hay navegación por departamento, ni recompra rápida de la canasta habitual. |
| P-10 | **Medicamentos de venta libre y bajo receta** | PedidosYa (farmacias habilitadas) | **Bloqueo externo, no de producto.** Exige farmacia habilitada con farmacéutico responsable y, bajo receta, receta electrónica. El rubro farmacia existe; sin habilitación, un comercio de ese rubro sólo puede vender perfumería y cuidado personal. Dueño: alianza con farmacias habilitadas. |
| P-08 | **Integración POS del comercio** | Uber Eats, PedidosYa | Ticket INT-001 abierto con cinco criterios: sincronización de catálogo, pedidos hacia el POS, stock en dos sentidos, idempotencia de webhooks y portal de errores del partner. Nada de eso depende de un tercero para construirse. |

## Estructura de las apps

La comparación de **estructura** (cómo se entra, cómo se navega, qué hay en el inicio) vive en
[`reestructuracion-competitiva.md`](reestructuracion-competitiva.md), con sus fases RES-01 a
RES-05.

## Lo que ya está a la par

No se vuelve a construir. Cada fila dice dónde está, para que no se dupliquen por
suposición.

| Capacidad | Dónde está |
| --- | --- |
| Preferencias de entrega: en mano o en la puerta, indicaciones y cubiertos (era P-02) | `server/delivery-preferences.js`, checkout web y móvil, etiquetas para cocina y reparto · el comercio ve sólo los cubiertos y el repartidor sin asignar sólo banderas · `test:delivery-preferences`, `test:authorization`, `test:postgres` |
| Foto obligatoria al dejar en la puerta (era P-02b) | `server/order-delivery-photo-repository.js`, guarda en `POST /api/orders/:orderId/advance`, foto en la app del repartidor y del cliente · `test:postgres` |
| Control del viaje: parada larga, señal perdida, desvío y final lejos del destino (SEG-01, Uber RideCheck) | Migración 141, `server/ride-trip-check-repository.js`, aviso en web y móvil · `test:ride-trip-checks` |
| Código de entrega en pedidos de valor alto o con reclamo previo (SEG-03, Uber Eats) | Migración 142, `server/order-delivery-code-repository.js`, web y móvil · `test:order-delivery-code` |
| Viajes en efectivo, con la comisión descontada del saldo del conductor (PAG-01, Uber en Argentina) | Migración 143, `settleMobilityWalletPayment`, tope en `dispatch-repository.js`, web y móvil · `test:cash-rides` |
| Dividir la tarifa de un viaje (PAG-02, Uber) | Migración 144, `server/ride-fare-split-repository.js`, web y móvil · `test:fare-splits` |
| Verificación en dos pasos para toda cuenta (SEG-08, Uber) | Migración 145, `server/mfa-repository.js`, `server/http/mfa-step-up.js`, web y móvil · `test:account-mfa`, `test:account-mfa-contract` |
| Tarjetas de regalo, por código o dirigidas a una cuenta, anulables (PAG-04, Uber) | Migración 146, `server/gift-card-repository.js`, web y móvil · `test:gift-cards`, `test:gift-cards-contract` |
| Efectivo en pedidos de comida, por sucursal, con vuelto y rendición de efectivo (PAG-01, PedidosYa, Rappi, DiDi Food) | Migración 148, `settleCapturedFoodOrder` con cobro en mano, tope proyectado en `dispatch-repository.js`, `registerCashDeposit`, web y móvil · `test:cash-food-orders`, `test:cash-food-orders-contract` |
| Perfil familiar: la Wallet de quien organiza paga viajes, envíos y pedidos, con tope por miembro (PAG-05, Uber) | Migración 147, `server/family-profile-repository.js`, reintegros a quien pagó, web y móvil · `test:family-profiles`, `test:family-profiles-contract` |
| Rubros de comercio: restaurantes, súper, farmacia, kiosco y tiendas (era P-01) | `merchants.vertical` proyectado, `GET /api/catalog/verticals`, filtro `?vertical=` en la base, `VerticalRail` en web y móvil · `test:catalog-verticals` |
| Retiro en el local, en web y en la app móvil (el móvil era P-11) | Migración 137, `getPostgresFoodPickupQuote`, `FoodFulfillmentPicker.tsx`, `FulfillmentToggle.tsx`, `MerchantPickupSwitch.tsx` · `test:mobile-food-design` |
| Reordenar un pedido | `POST /api/orders/:orderId/reorder` |
| Categorías de viaje (economy, comfort, moto, xl) | `rideQuoteSchema` en `server/http/ride-router.js` |
| Pedido programado, y reprogramarlo | `scheduled_for`, `SchedulePicker.tsx`, `api.rescheduleJob` |
| Propina en el checkout y después de entregar | `server/tip-repository.js`, `TipSelector.tsx` |
| Pedido grupal con tope de gasto | Migraciones 128-129, web y móvil |
| Suscripción con envío cubierto | Flash Más, `splitOrderDiscounts` |
| Sustituciones y faltantes | `OrderSubstitution` en el dominio compartido |
| Seguimiento en vivo, chat y calificaciones | SSE por audiencia, `ratings`, soporte con SLA |
| Seguridad del viaje (SOS, compartir viaje, PIN) | `server/ride-safety-repository.js` |
| Niveles de servicio en envíos | `shipment_service_levels`, migración 065 |

## Lo que está construido hasta el borde de un tercero

No son prohibiciones: son credenciales, habilitaciones o dispositivos que tiene el dueño. El
código llega hasta ese borde con degradación explícita, y el bloqueo se nombra.

| Capacidad | Qué falta | Dueño |
| --- | --- | --- |
| Cobro recurrente de la suscripción y movimiento real de dinero | Credenciales productivas de Mercado Pago | Dueño |
| Push a un teléfono real | Dispositivo Android/iPhone y credenciales EAS — ticket NOT-001 | Dueño |
| ETA vial en precio y despacho | API key comercial de rutas — tickets GEO-001, DSP-001 | Dueño |
| Observabilidad de errores en producción | Cuenta de Sentry | Dueño |
| Ambiente desplegado y staging | Cuenta cloud (decisión tomada: GCP `southamerica-east1`) | Dueño |
| Segundo revisor de PRs | Una segunda persona con acceso al repositorio | Dueño |

## Lo que no se hace, y por qué no es una prohibición de alcance

- **Copiar identidad ajena**: marca, textos, activos o código de los competidores. Es
  comparar flujos y estándares, no clonar.
- **Presentar como productivo** un mock, un sandbox o una integración incompleta. La matriz
  de madurez existe para eso.

Nada más está vedado.
