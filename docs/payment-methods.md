# Métodos de pago tokenizados

La cuenta mobile permite listar, agregar, seleccionar y revocar métodos de pago persistidos en PostgreSQL. Flash sólo recibe un identificador tokenizado generado por el SDK del proveedor junto con marca, últimos cuatro dígitos y vencimiento; la API no acepta PAN ni CVV.

## Sandbox local

`POST /api/payment-methods/sandbox` está disponible únicamente fuera de producción y exige tokens `pm_test_*`. Valida vencimiento, evita duplicados globales y limita cada cuenta a ocho tarjetas activas. La ruta responde `404` en producción para impedir que el adaptador de prueba quede expuesto.

- `PATCH /api/payment-methods/:id/default` cambia el método principal dentro de una transacción.
- `DELETE /api/payment-methods/:id` hace revocación lógica y elige un reemplazo seguro si era el principal.
- Flash Wallet no puede eliminarse.
- Todas las mutaciones verifican ownership por usuario autenticado y generan auditoría sin incluir el token.
- `/api/me` expone sólo metadata enmascarada y nunca `provider_payment_method_id`.

`npm run test:payment-methods` cubre alta, duplicado, vencimiento, BOLA, método principal, enmascarado, revocación y auditoría; sus fixtures se eliminan al finalizar.

## Paso productivo pendiente

El contrato está preparado para que el cliente móvil reemplace el formulario sandbox por el SDK oficial de Mercado Pago o Stripe y envíe únicamente el token resultante. Antes de habilitarlo deben configurarse credenciales, webhook firmado, conciliación y tratamiento de tokens revocados por el proveedor.
