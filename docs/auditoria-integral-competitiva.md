# Auditoría integral frente a Uber, Uber Eats y PedidosYa

**18 de noviembre de 2026.** Pedido del dueño: igualar y competir **en todos los aspectos**,
seguridad y pagos incluidos, «10 puntos». Este documento mide dónde está Flash, qué tienen
ellos que Flash no, y qué tiene Flash que ellos no. De ahí sale la cola de trabajo.

**Cómo se lee.** Cada fila dice **dónde se verificó** en el repositorio. Lo que se afirma de
la competencia tiene fuente al pie; lo que no se pudo confirmar se dice. La nota es
**contra el mejor de los tres en ese aspecto**: 10 es estar a la par del mejor, no ser
perfecto.

## Resumen

| Aspecto | Nota | Qué la baja |
| --- | --- | --- |
| Seguridad del viaje | 7 | Falta grabar audio, preferencias de seguridad y la opción conductora-pasajera (el control del viaje ya está, SEG-01) |
| Seguridad de la cuenta | 6 | El segundo factor existe sólo para administradores; no hay llaves de acceso (passkeys) |
| Identidad de conductores y repartidores | 6 | El legajo se valida al alta; no hay verificación periódica con selfie |
| Fraude y riesgo | 7 | Hay puntaje explicable por transacción; falta la señal de dispositivo |
| Prueba de entrega | 9 | Foto en la puerta, PIN en envíos y código en pedidos de valor alto o con reclamo previo (SEG-03) |
| Privacidad de contacto | 5 | Chat en la app, pero el teléfono no se enmascara |
| Pagos: medios | 5 | Efectivo en viajes (PAG-01); faltan efectivo en pedidos, dividir la tarifa, tarjeta de regalo y carga por Rapipago o Pago Fácil |
| Pagos: cobro real | 3 | Todo listo hasta el borde: faltan las credenciales productivas de Mercado Pago (dueño) |
| Reintegros y reclamos | 7 | Reintegros, faltantes y reclamos de envíos existen; falta el reintegro inmediato a la Wallet sin revisión en montos chicos |
| Comprobantes | 5 | Comprobante no fiscal; la factura electrónica necesita alta en ARCA (dueño) |
| Experiencia del cliente web | 8 | FE-01 la puso a la par en estructura; falta la misma separación en el móvil (FE-02) |
| Operación del comercio | 7 | Pausa con tiempo y motivo; faltan modo ocupado, pausa automática y la pausa en la web |
| Repartidor y conductor | 7 | Desglose de ganancias en viajes y envíos; falta en comida y los lotes de reparto |

## Seguridad

### Lo que ellos tienen y Flash no

| # | Qué | Quién | Estado en Flash (verificado) |
| --- | --- | --- | --- |
| SEG-01 | **Detección de anomalías en el viaje**: desvío de la ruta, parada larga o final antes de destino, con aviso al pasajero y a operaciones | Uber (RideCheck) | **Hecho.** Migración 141, `server/ride-trip-check-repository.js`, aviso en web y móvil · `test:ride-trip-checks`. Ver [`ride-safety.md`](ride-safety.md). |
| SEG-02 | **Preferencias de seguridad**: activar PIN, compartir viaje o el control de anomalías según horario, lugar o tipo de viaje | Uber (Safety preferences) | **Cubierto en lo que no depende de terceros.** En Flash el PIN de subida es obligatorio en todos los viajes y el control del viaje (SEG-01) está siempre encendido: más estricto que una preferencia. Falta compartir el viaje automáticamente con los contactos, que necesita un proveedor de SMS (dueño). |
| SEG-03 | **PIN de entrega en pedidos** de valor alto o con reclamos previos | Uber Eats | **Hecho.** Migración 142, `server/order-delivery-code-repository.js`, web y móvil · `test:order-delivery-code`. Ver [`order-delivery-code.md`](order-delivery-code.md). |
| SEG-04 | **Grabación de audio cifrada** durante el viaje, que sólo se entrega con un reporte | Uber | **No existe.** Necesita permisos de micrófono, cifrado de punta a punta y política de retención: es diseño y legal antes que código. |
| SEG-05 | **Conductoras con pasajeras** como opción | Uber (Women Rider Preference) | **No existe.** Depende de un dato de género declarado y de la densidad de conductoras: se decide con el piloto. |
| SEG-06 | **Verificación periódica de identidad del conductor** con selfie | Uber (Real-Time ID Check) | El legajo con identidad, licencia y antecedentes se valida al alta (`docs/driver-kyc.md`); **no hay verificación periódica**. La comparación facial necesita un proveedor (dueño). |
| SEG-07 | **Teléfono enmascarado** entre pasajero y conductor | Uber | Hay chat en la app (`docs/service-chat.md`); **llamar** exige un proveedor de telefonía (dueño). |
| SEG-08 | **Segundo factor y llaves de acceso para todos** | Uber (2FA para cuentas) | El TOTP existe **sólo para administradores** (`docs/admin-mfa.md`). Llevarlo a clientes y conductores no depende de terceros. |

### Lo que Flash tiene y conviene sostener

- **Riesgo explicable por transacción** (`database/migrations/081_transaction_risk.sql`):
  cada decisión guarda sus reglas, y las reglas están ocultas al rol de auditoría para que
  no se puedan estudiar. Es más de lo que la competencia publica.
- **Legajo cifrado** con AES-256-GCM, hash y auditoría de cada visualización
  (`docs/driver-kyc.md`).
- **Enlace de seguimiento que se guarda sólo como hash**, revocable y sin datos de pago
  (`docs/ride-safety.md`).

## Pagos

### Lo que ellos tienen y Flash no

| # | Qué | Quién | Estado en Flash (verificado) |
| --- | --- | --- | --- |
| PAG-01 | **Efectivo** en viajes (y en pedidos, donde el comercio acepta) | Uber en Argentina; PedidosYa | **Hecho en viajes.** Migración 143, liquidación con cobro en mano, tope de deuda en el despacho, web y móvil · `test:cash-rides`. Ver [`cash-rides.md`](cash-rides.md). En pedidos de comida queda pendiente. |
| PAG-02 | **Dividir la tarifa** entre pasajeros | Uber | **No existe.** Hay pedido grupal con tope en comida (`docs/group-orders.md`), no división de un viaje. |
| PAG-03 | **Cargar saldo en efectivo** por Rapipago o Pago Fácil | Uber Cash en Argentina | **No existe.** La Wallet se carga con tarjeta. Necesita convenio con la red de cobranza (dueño). |
| PAG-04 | **Tarjetas de regalo** y saldo de regalo | Uber | **No existe.** Hay referidos con premio acreditado (`docs/referrals.md`). |
| PAG-05 | **Perfil familiar**: un medio de pago para varias personas | Uber | **No existe.** |
| PAG-06 | **Perfil de empresa** con facturación a la empresa | Uber for Business, PedidosYa Empresas | Es P-06 de [`paridad-competitiva.md`](paridad-competitiva.md). |
| PAG-07 | **Cobro real** con tarjeta, cuotas y reintegros | Todos | Construido hasta el borde: tokenización, cuotas, webhook y conciliación existen (`docs/payment-methods.md`, `docs/payment-reconciliation.md`). **Faltan las credenciales productivas de Mercado Pago (dueño).** |
| PAG-08 | **Factura electrónica** | Todos en Argentina | Hay comprobante no fiscal (`docs/service-receipts.md`). **Necesita alta en ARCA y punto de venta (dueño).** |

## Orden de trabajo

Primero lo que protege a la gente y lo que mueve dinero, y dentro de eso lo que no depende de
un tercero.

1. **SEG-01** (hecho) y **SEG-02** (cubierto salvo lo que necesita SMS): detección de anomalías en el viaje y preferencias de seguridad.
2. **SEG-03** (hecho): PIN de entrega en pedidos de valor alto.
3. **PAG-01** (hecho en viajes): efectivo en viajes, con la comisión descontada del saldo del conductor.
4. **PAG-02**: dividir la tarifa.
5. **SEG-08**: segundo factor para clientes y conductores.
6. **FE-02**: Pedidos y Viajes separados en la app móvil.
7. **PAG-04 y PAG-05**: tarjetas de regalo y perfil familiar.

Quedan del dueño: SEG-04 (decisión legal), SEG-05 (decisión con el piloto), SEG-06 y SEG-07
(proveedores), PAG-03 (red de cobranza), PAG-07 (Mercado Pago) y PAG-08 (ARCA).

## Fuentes

- Uber, preferencias de seguridad (RideCheck, PIN, grabación de audio, compartir viaje):
  [Uber Newsroom](https://www.uber.com/us/en/newsroom/set-it-and-forget-it-how-to-maximize-your-safety-features/),
  [Insurance Journal, abril de 2024](https://www.insurancejournal.com/news/national/2024/04/15/769673.htm).
  Las fuentes difieren en quién puede escuchar la grabación.
- Uber, opción conductoras con pasajeras: [Pune Now, octubre de 2025](https://www.punenow.com/?p=35822),
  cobertura de India; no es un dato global.
- Uber Eats, PIN de entrega: [Uber Developer, proof of delivery](https://developer.uber.com/docs/deliveries/guides/proof-of-delivery),
  [Uber Eats Merchants](https://merchants.ubereats.com/nz/en/resources/articles/proof-of-delivery/).
- Uber, verificación periódica del conductor: [Uber Blog, Real-Time ID Check](https://www.uber.com/blog/real-time-id-check).
  Las fuentes son de 2016 a 2020; no se encontró una actualización de 2025.
- Uber en Argentina, efectivo y Uber Cash con Rapipago y Pago Fácil:
  [Uber Argentina](https://www.uber.com/ar/es/ride/how-it-works/uber-cash).
- Uber, dividir la tarifa: [Uber, split fare](https://www.uber.com/en-GB/ride/how-uber-works/split-fare).
- PedidosYa, medios de pago: **no se encontró una página oficial** con la lista para
  Argentina. No se afirma qué ofrece hoy.
