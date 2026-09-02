// Paneles de confianza del backoffice (ARC-001).
//
// Legajo de conductores, moderación de usuarios y MFA administrativo. Salen de
// AdminConsole porque son límites de seguridad/confianza autocontenidos.

import {
  Check,
  Copy,
  Download,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { AdminSectionHeader } from "../ui/panels";
import type { User } from "../types";
import { abrirContenidoProtegido } from "./open-protected-content";

export function DriverCompliancePanel({
  driverId,
  busy,
  runAction,
}: {
  driverId: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [compliance, setCompliance] = useState<import("../types").DriverCompliance | null>(null);
  const [reason, setReason] = useState("");
  const [vehicles, setVehicles] = useState<import("../types").DriverVehicle[]>([]);
  const load = useCallback(
    () =>
      Promise.all([api.getDriverCompliance(driverId), api.getDriverVehicles(driverId, true)])
        .then(([result, registry]) => {
          setCompliance(result.compliance);
          setVehicles(registry.vehicles);
        })
        .catch(() => {
          setCompliance(null);
          setVehicles([]);
        }),
    [driverId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!compliance)
    return (
      <div className="driver-compliance-inline">
        <small>Legajo no disponible</small>
      </div>
    );
  const pending = compliance.documents.filter((document) => document.status === "pending");
  return (
    <div className="driver-compliance-inline">
      <div>
        <strong>Legajo {compliance.status.replaceAll("_", " ")}</strong>
        <small>
          {pending.length} pendientes ·{" "}
          {compliance.documents.filter((document) => document.status === "approved").length}/
          {compliance.requiredTypes.length} aprobados
        </small>
      </div>
      {pending.map((document) => (
        <div className="driver-document-review" key={document.id}>
          <span>
            {document.type.replaceAll("_", " ")} · {(document.sizeBytes / 1024).toFixed(0)} KB
          </span>
          {/* Hasta el 28 de agosto se aprobaba o rechazaba un documento sin poder
              mirarlo: la ruta de contenido existía y ninguna pantalla la llamaba. */}
          <button
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const contenido = await api.getDriverDocumentContent(document.id);
                abrirContenidoProtegido(contenido.contentBase64, contenido.document.mimeType);
                return contenido;
              }, "Documento abierto")
            }
          >
            Ver
          </button>
          <button
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const result = await api.reviewDriverDocument(document.id, "approved");
                await load();
                return result;
              }, "Documento aprobado")
            }
          >
            Aprobar
          </button>
          <button
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              runAction(async () => {
                const result = await api.reviewDriverDocument(
                  document.id,
                  "rejected",
                  reason.trim(),
                );
                setReason("");
                await load();
                return result;
              }, "Documento rechazado")
            }
          >
            Rechazar
          </button>
        </div>
      ))}
      {vehicles
        .filter((vehicle) => vehicle.status === "pending" && !vehicle.retiredAt)
        .map((vehicle) => (
          <div className="driver-document-review" key={vehicle.id}>
            <span>
              {vehicle.kind} · {vehicle.model} · {vehicle.plate} ·{" "}
              {vehicle.serviceModes.join(" + ")}
            </span>
            <button
              disabled={busy}
              onClick={() =>
                runAction(async () => {
                  const result = await api.reviewDriverVehicle(vehicle.id, "approved");
                  await load();
                  return result;
                }, "Vehículo aprobado")
              }
            >
              Aprobar vehículo
            </button>
            <button
              disabled={busy || reason.trim().length < 5}
              onClick={() =>
                runAction(async () => {
                  const result = await api.reviewDriverVehicle(
                    vehicle.id,
                    "rejected",
                    reason.trim(),
                  );
                  setReason("");
                  await load();
                  return result;
                }, "Vehículo rechazado")
              }
            >
              Rechazar
            </button>
          </div>
        ))}
      {(pending.length > 0 ||
        vehicles.some((vehicle) => vehicle.status === "pending" && !vehicle.retiredAt)) && (
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo verificable para rechazo"
        />
      )}
    </div>
  );
}

export function AdminUserModeration({
  users,
  busy,
  runAction,
}: {
  users: User[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Usuarios y confianza"
        action={`${users.filter((user) => user.status === "suspended").length} suspendidos`}
      />
      <p>
        Suspender revoca sesiones, desconecta conductores y retira sus ofertas pendientes. Cada
        decisión queda auditada.
      </p>
      <div className="admin-table user-moderation-table">
        {users.map((user) => {
          const suspended = user.status === "suspended",
            reason = reasons[user.id] || "";
          return (
            <article className="admin-row user-moderation-row" key={user.id}>
              <UserRound size={19} />
              <div>
                <strong>{user.name}</strong>
                <span>
                  {user.email} · {user.roles.join(", ")}
                </span>
              </div>
              <b className={suspended ? "status-suspended" : "status-active"}>
                {suspended ? "Suspendido" : "Activo"}
              </b>
              <input
                aria-label={`Motivo para ${user.name}`}
                value={reason}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [user.id]: event.target.value,
                  }))
                }
                placeholder={suspended ? "Motivo de reactivación" : "Motivo de suspensión"}
              />
              <button
                type="button"
                disabled={busy || reason.trim().length < 5}
                onClick={() =>
                  runAction(
                    () =>
                      api.updateUserStatus(
                        user.id,
                        suspended ? "active" : "suspended",
                        reason.trim(),
                      ),
                    suspended ? "Cuenta reactivada" : "Cuenta suspendida",
                  )
                }
              >
                {suspended ? "Reactivar" : "Suspender"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type AdminMfaStatus = {
  enabled: boolean;
  method: string;
  confirmedAt: string | null;
  lockedUntil: string | null;
  recoveryCodesRemaining: number;
};
type AdminMfaEnrollment = {
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
};

export function AdminSecurityPanel() {
  const [status, setStatus] = useState<AdminMfaStatus | null>(null),
    [enrollment, setEnrollment] = useState<AdminMfaEnrollment | null>(null),
    [qr, setQr] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api
      .getMfaStatus()
      .then((result) => setStatus(result.mfa))
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : "No se pudo consultar MFA"),
      );
  }, []);
  useEffect(() => {
    let active = true;
    if (!enrollment) {
      setQr("");
      return;
    }
    import("qrcode")
      .then((module) =>
        module.default.toDataURL(enrollment.otpauthUri, {
          width: 260,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#151b22", light: "#ffffff" },
        }),
      )
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => setError("No se pudo generar el QR"));
    return () => {
      active = false;
    };
  }, [enrollment]);
  const begin = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.enrollMfa();
      setEnrollment(result.enrollment);
      setMessage("Escaneá el QR y guardá los códigos antes de confirmar.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar MFA");
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.confirmMfa(code);
      setStatus(result.mfa);
      setCode("");
      setEnrollment(null);
      setMessage(
        "MFA quedó activo. Las próximas sesiones administrativas exigirán el segundo factor.",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Código inválido");
    } finally {
      setBusy(false);
    }
  };
  const recoveryText = enrollment
    ? `Flash Delivery · Códigos de recuperación MFA\nGenerados: ${new Date().toISOString()}\n\n${enrollment.recoveryCodes.join("\n")}\n\nCada código sirve una sola vez. Guardar fuera del dispositivo.`
    : "";
  const copyRecovery = async () => {
    if (!recoveryText) return;
    await navigator.clipboard.writeText(recoveryText);
    setMessage("Códigos copiados. Guardalos en un gestor seguro.");
  };
  const downloadRecovery = () => {
    if (!recoveryText) return;
    const url = URL.createObjectURL(new Blob([recoveryText], { type: "text/plain;charset=utf-8" })),
      link = document.createElement("a");
    link.href = url;
    link.download = "flash-mfa-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Archivo descargado. Movelo a un almacenamiento seguro.");
  };
  return (
    <section className="admin-card admin-security-card">
      <AdminSectionHeader
        title="Seguridad de superadministración"
        action={status?.enabled ? "MFA activo" : "Acción requerida"}
      />
      {!status && !error && (
        <div className="security-loading">
          <RefreshCw size={18} /> Consultando postura de seguridad…
        </div>
      )}
      {status && (
        <div className="security-status-grid">
          <article className={`security-posture ${status.enabled ? "enabled" : "warning"}`}>
            <span>
              <ShieldCheck size={25} />
            </span>
            <div>
              <small>Segundo factor</small>
              <strong>
                {status.enabled ? "Protección TOTP activa" : "MFA todavía no configurado"}
              </strong>
              <p>
                {status.enabled
                  ? `Confirmado ${status.confirmedAt ? new Date(status.confirmedAt).toLocaleString("es-AR") : ""}. Quedan ${status.recoveryCodesRemaining} códigos de recuperación.`
                  : "En producción, las operaciones administrativas permanecen bloqueadas hasta completar este enrolamiento."}
              </p>
            </div>
          </article>
          <article className="security-policy">
            <KeyRound size={22} />
            <div>
              <strong>Política de acceso</strong>
              <span>
                Contraseña + TOTP · desafío 5 min · bloqueo tras 5 fallos · recuperación de un solo
                uso
              </span>
            </div>
          </article>
        </div>
      )}
      {status && !status.enabled && !enrollment && (
        <div className="security-enroll-start">
          <div>
            <strong>Activar una aplicación autenticadora</strong>
            <p>
              Compatible con 1Password, Google Authenticator, Microsoft Authenticator, Authy y
              cualquier cliente TOTP estándar.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={begin} disabled={busy}>
            <KeyRound size={17} />
            {busy ? "Preparando…" : "Configurar MFA"}
          </button>
        </div>
      )}
      {enrollment && (
        <div className="security-enrollment">
          <div className="security-qr">
            <span>Paso 1</span>
            <strong>Escaneá el QR</strong>
            {qr ? (
              <img src={qr} alt="Código QR para configurar MFA" />
            ) : (
              <div className="qr-placeholder">Generando QR…</div>
            )}
            <details>
              <summary>Ingresar clave manualmente</summary>
              <code>{enrollment.secret}</code>
            </details>
          </div>
          <div className="security-recovery">
            <span>Paso 2</span>
            <strong>Guardá los códigos de recuperación</strong>
            <p>Se muestran una sola vez y cada uno se invalida después de usarlo.</p>
            <div className="recovery-code-grid">
              {enrollment.recoveryCodes.map((item) => (
                <code key={item}>{item}</code>
              ))}
            </div>
            <div className="security-inline-actions">
              <button type="button" onClick={() => void copyRecovery()}>
                <Copy size={16} /> Copiar
              </button>
              <button type="button" onClick={downloadRecovery}>
                <Download size={16} /> Descargar
              </button>
            </div>
          </div>
          <form
            className="security-confirm"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <div>
              <span>Paso 3</span>
              <strong>Confirmá un código de 6 dígitos</strong>
              <p>
                La protección no se activa hasta verificar que el autenticador quedó configurado.
              </p>
            </div>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              pattern="[0-9]{6}"
              required
            />
            <button className="primary-button" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Verificando…" : "Activar MFA"}
            </button>
          </form>
        </div>
      )}
      {message && (
        <p className="security-message">
          <Check size={17} />
          {message}
        </p>
      )}
      {error && (
        <p className="security-error">
          <X size={17} />
          {error}
        </p>
      )}
    </section>
  );
}
