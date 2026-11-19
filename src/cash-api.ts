// Rendición de efectivo (PAG-01).
//
// Módulo aparte y no un método más de `api.ts`, que ya es demasiado grande: es una
// sola llamada que sólo usa el backoffice.
import { request } from "./api";

export type CashDeposit = {
  /** Lo que se registró como rendido, en pesos. */
  deposited: number;
  /** Lo que le queda por rendir después de este registro, en pesos. */
  debt: number;
  /** El servidor ya tenía esta rendición con la misma clave: no se sumó dos veces. */
  duplicate: boolean;
};

/**
 * Registra que un repartidor o conductor entregó efectivo a la operación.
 *
 * La clave de idempotencia la pone quien llama, **una por envío del formulario**: si
 * la red corta después de que el servidor la asentó, reintentar con la misma clave
 * no descuenta la deuda dos veces.
 */
export function registerCashDeposit(
  driverId: string,
  payload: { amount: number; reference?: string },
  idempotencyKey: string,
) {
  return request<{ deposit: CashDeposit }>(
    `/admin/drivers/${encodeURIComponent(driverId)}/cash-deposits`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
  );
}
