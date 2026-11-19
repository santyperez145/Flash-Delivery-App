// Rendición de efectivo en el backoffice (PAG-01).
//
// Quien reparte o maneja cobra en mano y queda debiendo ese efectivo hasta
// entregarlo. Mientras la deuda supera el tope no le llegan servicios en efectivo,
// así que registrar la rendición es lo que lo vuelve a habilitar: tiene que estar al
// lado de la persona, en la lista de supply.
import { useRef, useState } from "react";
import { Banknote } from "lucide-react";

import { registerCashDeposit } from "../cash-api";
import { money } from "../format";
import type { Driver } from "../types";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function AdminCashDeposit({
  driver,
  busy,
  runAction,
}: {
  driver: Driver;
  busy: boolean;
  runAction: RunAction;
}) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  // Una clave por rendición, no por clic: si la red corta después de que el servidor la
  // asentó, reenviar la misma carga reusa la clave y no descuenta dos veces. Cambia
  // sólo tras una rendición confirmada o al editar el importe o la referencia.
  const clave = useRef<string | null>(null);
  const pesos = Number(amount);
  const valido = amount !== "" && Number.isInteger(pesos) && pesos > 0;
  // El servidor no informa la deuda en el respaldo SQLite: sin dato no se muestra.
  if (driver.cashDebt === undefined) return null;
  const submit = () => {
    if (!valido) return;
    setError("");
    clave.current ??= crypto.randomUUID();
    const idempotencyKey = clave.current;
    runAction(async () => {
      try {
        await registerCashDeposit(
          driver.id,
          { amount: pesos, reference: reference.trim() || undefined },
          idempotencyKey,
        );
      } catch (requestError) {
        // El mensaje del servidor tal cual: dice qué corregir (importe, permisos).
        setError(requestError instanceof Error ? requestError.message : "No se pudo registrar");
        throw requestError;
      }
      clave.current = null;
      setAmount("");
      setReference("");
    }, "Rendición registrada");
  };
  return (
    <form
      className="cash-deposit-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <small>
        <Banknote size={14} aria-hidden /> Efectivo por rendir {money.format(driver.cashDebt)}
      </small>
      {driver.cashDebt > 0 && (
        <div>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Importe rendido por ${driver.name}, en pesos`}
            placeholder="Importe en pesos"
            value={amount}
            disabled={busy}
            onChange={(event) => {
              clave.current = null;
              setAmount(event.target.value.replace(/\D/g, ""));
            }}
          />
          <input
            type="text"
            maxLength={120}
            aria-label="Referencia de la rendición"
            placeholder="Referencia (opcional)"
            value={reference}
            disabled={busy}
            onChange={(event) => {
              clave.current = null;
              setReference(event.target.value);
            }}
          />
          <button type="submit" disabled={busy || !valido}>
            Registrar rendición
          </button>
        </div>
      )}
      {error && <small role="alert">{error}</small>}
    </form>
  );
}
