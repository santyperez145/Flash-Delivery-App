# Comprobantes de servicio

Flash emite un comprobante persistente cuando un pedido, viaje o envío llega a `completed`. No es una factura fiscal ni reemplaza la integración tributaria argentina.

## Contrato

- `GET /api/jobs/:jobId/receipt` exige sesión y rol `customer` o `admin`.
- El cliente sólo puede acceder a jobs propios; un identificador ajeno responde como no encontrado.
- Antes de completar el servicio responde conflicto y no crea filas.
- La primera lectura crea el snapshot dentro de una transacción y las siguientes devuelven el mismo identificador y número.
- El snapshot incluye desglose, ítems, total, moneda y un resumen de pago sanitizado. No persiste payloads del proveedor, credenciales, PIN ni tokens.
- Las propinas son movimientos posteriores e independientes y no mutan el importe histórico del servicio.

## Seguridad e integridad

`service_receipts.job_id` es único, por lo que existe como máximo un comprobante por servicio. RLS limita la lectura al cliente propietario o a administración; el driver no recibe datos del comprobante. La emisión se registra en auditoría sin copiar ítems ni datos sensibles.

La app móvil lo muestra en Actividad como “Comprobante de servicio no fiscal”. La facturación fiscal requiere un proveedor habilitado, numeración legal y datos impositivos, por lo que permanece como integración separada en el roadmap.
