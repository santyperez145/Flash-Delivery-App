// Puesta en marcha del comercio (FE-05, MERW-17).
//
// Un comercio recién aprobado entra a una consola vacía: sin horarios, sin
// productos, cerrado. Sin una guía, lo que pasa es que nunca abre o abre a
// medias, y el cliente ve un local sin nada que pedir. Uber Eats y PedidosYa
// acompañan el alta con una lista de pasos; esta es la de Flash.
//
// **Cada paso se calcula de datos reales que la consola ya tiene, o se lee del
// servidor.** Nada se marca hecho porque alguien tocó un botón en esta sesión:
// si el horario no está guardado en la sucursal, el paso sigue pendiente aunque
// se haya abierto el editor. Y lo que no se puede saber se dice así, en lugar
// de darlo por bueno o por malo.
import { Check, ChevronDown, ChevronUp, Circle, CircleDashed } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { MerchantPaymentConnection, Restaurant } from "../types";
import "../styles/merchant-onboarding.css";

export type DestinoPuesta = {
  section: "catalog" | "branches" | "finance";
  /** Id del elemento que hay que llevar a la vista y enfocar. */
  ancla: string;
};

type Paso = {
  id: string;
  titulo: string;
  detalle: string;
  /** `borde`: depende de un tercero o no se pudo comprobar; no se cuenta como hecho. */
  estado: "hecho" | "pendiente" | "borde";
  accion: string;
  destino: DestinoPuesta;
};

type Lectura<T> = { estado: "cargando" } | { estado: "ok"; valor: T } | { estado: "error" };

export function MerchantSetupChecklist({
  restaurant,
  revision,
  onGo,
}: {
  restaurant: Restaurant;
  /** Cambia cuando la consola sabe que algo de lo que se lee acá cambió (MFA, cobros). */
  revision: string;
  onGo: (destino: DestinoPuesta) => void;
}) {
  const [mfa, setMfa] = useState<Lectura<boolean>>({ estado: "cargando" });
  const [cobros, setCobros] = useState<
    Lectura<{ connection: MerchantPaymentConnection | null; configured: boolean }>
  >({ estado: "cargando" });
  const [abierta, setAbierta] = useState(true);

  const leer = useCallback(async () => {
    // Las dos lecturas son independientes: si una falla, la otra igual se muestra.
    const [mfaResultado, cobrosResultado] = await Promise.allSettled([
      api.getMfaStatus(),
      api.getMerchantPaymentConnection(restaurant.id),
    ]);
    setMfa(
      mfaResultado.status === "fulfilled"
        ? { estado: "ok", valor: mfaResultado.value.mfa.enabled }
        : { estado: "error" },
    );
    setCobros(
      cobrosResultado.status === "fulfilled"
        ? { estado: "ok", valor: cobrosResultado.value }
        : { estado: "error" },
    );
  }, [restaurant.id]);

  useEffect(() => {
    void leer();
  }, [leer, revision]);

  const sucursales = restaurant.branches || [];
  const productos = restaurant.menu;
  const sinHorario = sucursales.filter(
    (sucursal) => !sucursal.weeklyHours.some((franja) => franja.enabled),
  );
  const conFoto = productos.filter((producto) => Boolean(producto.image)).length;
  const categorias = new Set(
    productos.map((producto) => producto.category?.trim()).filter((categoria) => categoria),
  );
  const primeraSucursal = sinHorario[0] || sucursales[0];
  const anclaSucursal = primeraSucursal
    ? `merchant-branch-${primeraSucursal.id}`
    : "merchant-branches";

  const pasos: Paso[] = [
    {
      id: "horarios",
      titulo: "Horario de cada sucursal",
      detalle: !sucursales.length
        ? "No hay sucursales cargadas."
        : sinHorario.length
          ? `Falta en ${sinHorario.map((sucursal) => sucursal.name).join(", ")}. Sin horario la sucursal no abre sola.`
          : `Cargado en ${sucursales.length === 1 ? "la sucursal" : `las ${sucursales.length} sucursales`}.`,
      estado: sucursales.length && !sinHorario.length ? "hecho" : "pendiente",
      accion: "Cargar horario",
      destino: { section: "branches", ancla: anclaSucursal },
    },
    {
      id: "productos",
      titulo: "Al menos un producto",
      detalle: productos.length
        ? `${productos.length} producto${productos.length === 1 ? "" : "s"} en el catálogo.`
        : "El catálogo está vacío: el cliente no tiene nada para pedir.",
      estado: productos.length ? "hecho" : "pendiente",
      accion: "Crear producto",
      destino: { section: "catalog", ancla: "merchant-new-product" },
    },
    {
      id: "categoria",
      titulo: "Al menos una categoría",
      detalle: categorias.size
        ? `${categorias.size} categoría${categorias.size === 1 ? "" : "s"}: ${[...categorias].slice(0, 3).join(", ")}${categorias.size > 3 ? "…" : ""}.`
        : "Las categorías ordenan el menú que ve el cliente.",
      estado: categorias.size ? "hecho" : "pendiente",
      accion: "Ver catálogo",
      destino: {
        section: "catalog",
        ancla: productos.length ? "merchant-products" : "merchant-new-product",
      },
    },
    {
      id: "fotos",
      titulo: "Productos con foto propia",
      // La consola todavía no sube fotos: se dice, en lugar de mandar a una
      // pantalla que no tiene cómo resolverlo y dejar que se descubra ahí.
      detalle: !productos.length
        ? "Primero cargá un producto."
        : conFoto === productos.length
          ? "Todos tus productos tienen su foto."
          : `${conFoto} de ${productos.length} con foto. La carga de fotos desde esta consola todavía no está disponible.`,
      estado: productos.length && conFoto === productos.length ? "hecho" : "pendiente",
      accion: "Ver productos",
      destino: {
        section: "catalog",
        ancla: productos.length ? "merchant-products" : "merchant-new-product",
      },
    },
    pasoCobros(cobros),
    {
      id: "dos-pasos",
      titulo: "Verificación en dos pasos",
      detalle:
        mfa.estado === "cargando"
          ? "Consultando…"
          : mfa.estado === "error"
            ? "No pudimos comprobarla. Revisala en Finanzas."
            : mfa.valor
              ? "Activa: retirar plata y desvincular la cuenta piden un código."
              : "Protege la cuenta que mueve la plata del comercio.",
      estado: mfa.estado === "ok" ? (mfa.valor ? "hecho" : "pendiente") : "borde",
      accion: mfa.estado === "ok" && mfa.valor ? "Ver" : "Activar",
      destino: { section: "finance", ancla: "merchant-two-step" },
    },
  ];

  const hechos = pasos.filter((paso) => paso.estado === "hecho").length;
  const total = pasos.length;
  const completa = hechos === total;

  // Retiro y efectivo no se cuentan: la consola no guarda si alguien los
  // revisó, sólo cómo están. Apagados es una decisión válida del local, no un
  // paso que falta; contarlos como pendientes sería empujar a prenderlos.
  const conRetiro = sucursales.filter((sucursal) => sucursal.pickupEnabled).length;
  const conEfectivo = sucursales.filter((sucursal) => sucursal.cashEnabled === true).length;
  const resumenSucursales = (cantidad: number) =>
    !sucursales.length
      ? "sin sucursales"
      : cantidad === 0
        ? "apagado"
        : cantidad === sucursales.length
          ? "encendido"
          : `encendido en ${cantidad} de ${sucursales.length} sucursales`;

  return (
    <section className="puesta-en-marcha" aria-labelledby="puesta-titulo">
      <div className="puesta-encabezado">
        <div>
          <h2 id="puesta-titulo">
            Puesta en marcha · {hechos} de {total}
          </h2>
          <small>
            {completa
              ? "Tu comercio tiene todo lo necesario para vender."
              : "Lo que falta para que tu comercio esté listo para vender."}
          </small>
        </div>
        <button
          type="button"
          aria-expanded={abierta}
          aria-controls="puesta-pasos"
          onClick={() => setAbierta((valor) => !valor)}
        >
          {abierta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {abierta ? " Ocultar" : " Ver pasos"}
        </button>
      </div>
      <div
        className="puesta-barra"
        role="progressbar"
        aria-label="Avance de la puesta en marcha"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={hechos}
        aria-valuetext={`${hechos} de ${total} pasos`}
      >
        <span style={{ width: `${(hechos / total) * 100}%` }} />
      </div>
      {abierta && (
        <div id="puesta-pasos">
          <ul className="puesta-lista">
            {pasos.map((paso) => (
              <li key={paso.id} className="puesta-item">
                <span className={`puesta-icono ${paso.estado}`} aria-hidden="true">
                  {paso.estado === "hecho" ? (
                    <Check size={16} />
                  ) : paso.estado === "borde" ? (
                    <CircleDashed size={14} />
                  ) : (
                    <Circle size={10} />
                  )}
                </span>
                <div>
                  <strong>
                    {paso.titulo}
                    <span className="puesta-oculto">
                      {paso.estado === "hecho" ? " (listo)" : " (pendiente)"}
                    </span>
                  </strong>
                  <small>{paso.detalle}</small>
                </div>
                <button
                  type="button"
                  aria-label={`${paso.accion}: ${paso.titulo}`}
                  onClick={() => onGo(paso.destino)}
                >
                  {paso.accion}
                </button>
              </li>
            ))}
            <li className="puesta-item">
              <span className="puesta-icono borde" aria-hidden="true">
                <CircleDashed size={14} />
              </span>
              <div>
                <strong>Retiro en el local y efectivo</strong>
                <small>
                  {`Retiro ${resumenSucursales(conRetiro)} · Efectivo ${resumenSucursales(conEfectivo)}. `}
                  Revisá si es lo que querés; no cuenta para el total.
                </small>
              </div>
              <button
                type="button"
                aria-label="Revisar retiro en el local y efectivo"
                onClick={() => onGo({ section: "branches", ancla: anclaSucursal })}
              >
                Revisar
              </button>
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * El paso de Mercado Pago. Es el borde de un tercero (CONTRIBUTING §3.7): la
 * vinculación necesita que Flash tenga credenciales productivas y que el dueño
 * del local autorice su cuenta en Mercado Pago. Se muestra lo que el servidor
 * dice, sin simular una cuenta vinculada.
 */
function pasoCobros(
  cobros: Lectura<{ connection: MerchantPaymentConnection | null; configured: boolean }>,
): Paso {
  const base = {
    id: "mercado-pago",
    titulo: "Cobros con Mercado Pago",
    destino: { section: "finance", ancla: "merchant-payments" } as DestinoPuesta,
  };
  if (cobros.estado === "cargando")
    return { ...base, detalle: "Consultando…", estado: "borde", accion: "Ver" };
  if (cobros.estado === "error")
    return {
      ...base,
      detalle: "No pudimos comprobar la vinculación. Revisala en Finanzas.",
      estado: "borde",
      accion: "Ver",
    };
  const { connection, configured } = cobros.valor;
  if (connection?.status === "connected" && connection.liveMode)
    return {
      ...base,
      detalle: `Vinculado · cuenta terminada en ${connection.externalAccountId.slice(-4)}.`,
      estado: "hecho",
      accion: "Ver",
    };
  if (connection?.status === "connected")
    return {
      ...base,
      detalle: "Vinculada una cuenta de prueba: no recibe cobros reales.",
      estado: "pendiente",
      accion: "Ver",
    };
  if (connection?.status === "reconnect_required")
    return {
      ...base,
      detalle: "Pendiente: Mercado Pago pide volver a autorizar la cuenta.",
      estado: "pendiente",
      accion: "Volver a vincular",
    };
  return {
    ...base,
    detalle: configured
      ? "Pendiente: vinculación con Mercado Pago."
      : "Pendiente: vinculación con Mercado Pago. Se habilita cuando Flash tenga las credenciales productivas.",
    estado: configured ? "pendiente" : "borde",
    accion: "Ver",
  };
}
