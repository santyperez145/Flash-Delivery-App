import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Users } from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import type { FareSplit, FareSplitInvitation, Ride } from "../types";

// Dividir la tarifa de un viaje (PAG-02), como Uber. Quien pidió un viaje pagado con
// Flash Wallet invita por email a otras cuentas Flash; cada una que acepta paga su
// parte desde su Wallet. La tarifa se divide en partes iguales entre quienes
// aceptaron. Mismo comportamiento que la app móvil.

const estadoTexto: Record<FareSplit["status"], string> = {
  invited: "Invitado",
  accepted: "Aceptó",
  declined: "Rechazó",
  cancelled: "Cancelado",
};

const divisible = (ride: Ride) =>
  ride.paymentMethod === "Flash Wallet" && !["completed", "cancelled"].includes(ride.status);

/** En el seguimiento del viaje, para quien lo pidió. */
export function FareSplitPanel({ ride }: { ride: Ride }) {
  const [splits, setSplits] = useState<FareSplit[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const activo = divisible(ride);
  const cargar = useCallback(
    () =>
      api
        .getRideFareSplits(ride.id)
        .then((respuesta) => setSplits(respuesta.splits))
        .catch(() => undefined),
    [ride.id],
  );
  useEffect(() => {
    if (!activo) return;
    void cargar();
    // Una aceptación cambia la parte de todos: se relee mientras el panel está abierto.
    const timer = setInterval(() => void cargar(), 15000);
    return () => clearInterval(timer);
  }, [activo, cargar]);
  if (!activo) return null;
  const aceptados = splits.filter((split) => split.status === "accepted").length;
  const invitar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setAviso(null);
    try {
      await api.inviteToSplitFare(ride.id, email.trim());
      setEmail("");
      setAviso("Invitación enviada");
      await cargar();
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "No se pudo invitar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="fare-split" aria-label="Dividir la tarifa">
      <header>
        <Users size={18} aria-hidden="true" />
        <strong>Dividir la tarifa</strong>
        <span>
          {aceptados > 0
            ? `Cada uno paga ${money.format(Math.floor((ride.fare * 100) / (aceptados + 1)) / 100)}`
            : "Invitá a quien viaja con vos"}
        </span>
      </header>
      {splits.length > 0 && (
        <ul>
          {splits.map((split) => (
            <li key={split.id}>
              <span>{split.name}</span>
              <small>{estadoTexto[split.status]}</small>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={invitar}>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email de su cuenta Flash"
          aria-label="Email de su cuenta Flash"
          required
        />
        <button type="submit" disabled={busy || !email.trim()}>
          Invitar
        </button>
      </form>
      {aviso && <small role="status">{aviso}</small>}
    </section>
  );
}

/** En el inicio de Viajes, para quien recibió una invitación. */
export function FareSplitInvitations() {
  const [invitaciones, setInvitaciones] = useState<FareSplitInvitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const cargar = useCallback(
    () =>
      api
        .getFareSplitInvitations()
        .then((respuesta) => setInvitaciones(respuesta.invitations))
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    void cargar();
  }, [cargar]);
  if (!invitaciones.length && !aviso) return null;
  const responder = async (invitacion: FareSplitInvitation, accept: boolean) => {
    setBusy(invitacion.id);
    setAviso(null);
    try {
      const respuesta = await api.respondToFareSplit(invitacion.id, accept);
      setAviso(
        accept && respuesta.split.share !== undefined
          ? `Listo: pagaste ${money.format(respuesta.split.share)} con tu Flash Wallet`
          : "Invitación rechazada",
      );
      await cargar();
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "No se pudo responder");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="fare-split-invitations" aria-label="Invitaciones a dividir un viaje">
      {invitaciones.map((invitacion) => (
        <article key={invitacion.id} className="fare-split">
          <header>
            <Users size={18} aria-hidden="true" />
            <strong>
              {invitacion.inviterName} quiere dividir el viaje a {invitacion.destination}
            </strong>
            <span>Tu parte: {money.format(invitacion.share)}, desde tu Flash Wallet</span>
          </header>
          <div className="fare-split-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy === invitacion.id}
              onClick={() => responder(invitacion, false)}
            >
              Rechazar
            </button>
            <button
              type="button"
              disabled={busy === invitacion.id}
              onClick={() => responder(invitacion, true)}
            >
              Aceptar y pagar
            </button>
          </div>
        </article>
      ))}
      {aviso && <small role="status">{aviso}</small>}
    </section>
  );
}
