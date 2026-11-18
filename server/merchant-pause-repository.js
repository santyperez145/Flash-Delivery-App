// Pausa temporal del comercio (RES-07).
//
// La pausa se guarda en cada sucursal del comercio, con su vencimiento y su motivo.
// `app.branch_is_scheduled_open` (migración 140) es quien la hace valer: por eso
// acá no hay nada que reabrir al vencer.
import { postgresPool } from "./postgres.js";

/** Duraciones ofrecidas, en minutos. 0 reanuda. */
export const DURACIONES_PAUSA = [0, 15, 30, 60, 120];
export const MOTIVOS_PAUSA = ["high_demand", "staff", "kitchen", "other"];

export async function setPostgresMerchantPause(merchantPublicId, { minutes, reason }) {
  const resultado = await postgresPool.query(
    `UPDATE merchant_branches b
        SET paused_until = CASE WHEN $2::int > 0 THEN now() + make_interval(mins => $2::int) END,
            pause_reason = CASE WHEN $2::int > 0 THEN $3::text END
       FROM merchants m
      WHERE m.id = b.merchant_id AND m.public_id = $1
      RETURNING b.paused_until`,
    [merchantPublicId, minutes, minutes > 0 ? reason : null],
  );
  return { pausedUntil: resultado.rows[0]?.paused_until?.toISOString?.() ?? null };
}
