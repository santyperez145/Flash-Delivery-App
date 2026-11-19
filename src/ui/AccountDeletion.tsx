import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteAccount } from "../account-api";
import { api } from "../api";

// Eliminar la cuenta desde la app (LAN-001). Requisito de Apple y Google para
// publicar, y el camino para ejercer el derecho de supresión.
//
// Antes de pedir la contraseña dice qué se borra y qué se conserva: la persona
// tiene que poder decidir sabiendo que sus pedidos y pagos quedan registrados,
// sin su nombre, porque son comprobantes.

export function AccountDeletion() {
  const [abierto, setAbierto] = useState(false);
  const [password, setPassword] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<"deleted" | "requested" | null>(null);
  // Con la verificación en dos pasos activa (SEG-08) también se pide el código. Si
  // no se puede saber, se muestra el campo: el servidor decide si lo exige.
  const [conCodigo, setConCodigo] = useState(false);
  const [codigo, setCodigo] = useState("");
  useEffect(() => {
    if (!abierto) return;
    api
      .getMfaStatus()
      .then((respuesta) => setConCodigo(respuesta.mfa.enabled))
      .catch(() => setConCodigo(true));
  }, [abierto]);

  const eliminar = async () => {
    setOcupado(true);
    setError("");
    try {
      const { status } = await deleteAccount(password, conCodigo ? codigo : undefined);
      setResultado(status);
      setPassword("");
      setCodigo("");
      // El servidor ya cerró las sesiones: recargar lleva al ingreso.
      if (status === "deleted") window.setTimeout(() => window.location.reload(), 3000);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo eliminar la cuenta");
    } finally {
      setOcupado(false);
    }
  };

  if (resultado)
    return (
      <section className="account-deletion" role="status">
        <strong>
          {resultado === "deleted" ? "Tu cuenta fue eliminada" : "Recibimos tu solicitud"}
        </strong>
        <p>
          {resultado === "deleted"
            ? "Borramos tus datos personales y cerramos todas tus sesiones."
            : "Tu cuenta tiene pagos o liquidaciones pendientes. Soporte te va a contactar para cerrarlos y eliminarla."}
        </p>
      </section>
    );

  if (!abierto)
    return (
      <button type="button" className="account-deletion-open" onClick={() => setAbierto(true)}>
        <Trash2 size={16} /> Eliminar mi cuenta
      </button>
    );

  return (
    <section className="account-deletion" aria-labelledby="account-deletion-title">
      <strong id="account-deletion-title">Eliminar tu cuenta</strong>
      <ul>
        <li>Se borran tu nombre, correo, teléfono, direcciones, dispositivos y preferencias.</li>
        <li>Se desactivan tus métodos de pago guardados y tu suscripción.</li>
        <li>
          Tus pedidos, pagos y comprobantes se conservan sin tus datos, porque son registros que la
          ley obliga a guardar.
        </li>
        <li>No se puede deshacer.</li>
      </ul>
      <label>
        <span>Confirmá con tu contraseña</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={ocupado}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {conCodigo && (
        <label>
          <span>Y con un código de tu app autenticadora (o uno de recuperación)</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            disabled={ocupado}
            onChange={(event) => setCodigo(event.target.value.trim())}
          />
        </label>
      )}
      {error && (
        <p className="account-deletion-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-deletion-actions">
        <button type="button" disabled={ocupado} onClick={() => setAbierto(false)}>
          Cancelar
        </button>
        <button
          type="button"
          className="danger"
          disabled={ocupado || !password || (conCodigo && codigo.length < 6)}
          onClick={() => void eliminar()}
        >
          {ocupado ? "Eliminando…" : "Eliminar definitivamente"}
        </button>
      </div>
    </section>
  );
}
