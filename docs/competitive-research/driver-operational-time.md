# Tiempo operativo en Flash Driver

Investigación verificada el 22 de agosto de 2026. Se comparan contratos y estados observables; Flash no copia texto, activos ni identidad de terceros.

## Referencias oficiales

- [DoorDash — Earn by Time](https://help.doordash.com/en-us/dashers/article/time-earnings-mode?ctry=US&divcode=NY) distingue `active time`, desde la aceptación hasta completar o cancelar una oferta, de `dash time`, que cubre toda la sesión conectada e incluye espera.
- [DoorDash — Dasher pay](https://help.doordash.com/en-us/dashers/article/how-is-dasher-pay-calculated?ctry=US&divcode=MS) ubica el detalle de ganancias y sesiones en la superficie de Earnings y separa esos datos de las ofertas.
- [Uber Driver App](https://www.uber.com/us/en/drive/driver-app/) separa el control Go/online del detalle de Earnings y conserva estados distintos para pickup, espera, inicio y finalización.

## Decisión Flash

- **Tiempo conectado** es la unión de intervalos en los que el Driver estuvo `online`. Cambiar entre Delivery y Viajes cierra un intervalo identificado y abre otro, sin perder atribución por modo.
- **Tiempo activo** es la unión de intervalos desde asignación/aceptación hasta finalización, cancelación o reasignación del job. Los intervalos solapados se unen para no duplicar tiempo por batching.
- Los triggers PostgreSQL capturan también cierres impuestos por compliance, suspensión o retiro de vehículo, aunque la escritura no provenga de la pantalla de disponibilidad.
- La migración empieza a medir conductores ya conectados y jobs ya asignados desde su despliegue con `migration_baseline`; nunca reconstruye ni afirma horas históricas.
- Estas métricas no implican salario horario, garantía de ingreso, incentivo, surge ni criterio de liquidación. Flash sólo muestra tiempo observado junto al ledger real.
- Las sesiones no almacenan GPS. La ubicación continúa bajo su política de telemetría independiente.

## Contrato y privacidad

- `GET /api/driver/earnings` deriva la identidad de la sesión y devuelve `onlineSeconds`, `activeSeconds`, fuente y momento de observación para hoy y la semana local del Driver.
- La serie de la semana se materializa por día local desde el ledger y las sesiones; no se rellena con proyecciones y cada total diario reconcilia con el corte semanal.
- PostgreSQL es obligatorio. El fallback SQLite devuelve `null` y `timeTracking.status=unavailable`; nunca inventa horas.
- RLS expone los intervalos sólo al Driver propietario y a roles operativos autorizados. El rol auditor tiene metadatos de sólo lectura y no puede alterar duración ni atribución.
- La respuesta es privada y `no-store`. Los cálculos recortan cada intervalo al período y al momento de observación.
