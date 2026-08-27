// El vocabulario compartido de la cancelación (ticket ARC-001).
//
// Pedidos, viajes y envíos cancelan con el mismo cuerpo: un motivo de una
// lista cerrada y detalle obligatorio cuando el motivo es `other`. Es el mismo
// esquema a propósito —los reportes comparan motivos de cancelación entre
// servicios, y tres listas que divergen harían incomparables los números—.
//
// Por eso vive acá y no repetido en cada router: la lista es una decisión de
// producto única, no tres coincidencias.
import { z } from "zod";

export const cancellationSchema = z
  .object({
    status: z.literal("cancelled"),
    reason: z.enum([
      "changed_mind",
      "wrong_address",
      "long_wait",
      "price",
      "driver_issue",
      "merchant_issue",
      "recipient_unavailable",
      "other",
    ]),
    reasonDetail: z.string().trim().min(3).max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reason === "other" && !value.reasonDetail)
      ctx.addIssue({
        code: "custom",
        path: ["reasonDetail"],
        message: "Describe el motivo",
      });
  });
