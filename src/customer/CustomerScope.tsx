import { useEffect, useState } from "react";
import { Car, ShoppingBag } from "lucide-react";

// Pedidos y Viajes son dos experiencias separadas (FE-01), como Uber Eats y Uber:
// cada una con su inicio, sus secciones y su actividad. Antes todo vivía en una
// misma portada y una misma lista, y pedir una pizza y pedir un auto se mezclaban.
//
// - **Pedidos**: comida, súper, farmacia, kiosco y tiendas. Carrito, «Volver a
//   pedir», comercios.
// - **Viajes**: viajes y envíos de paquetes (Uber también ofrece los envíos desde su
//   app de viajes): «¿A dónde vas?», destinos recientes, el conductor.
//
// El ámbito se recuerda en el navegador y tiene su dirección: `/viajes` abre Viajes,
// para poder compartirla o guardarla como acceso.

export type Ambito = "pedidos" | "viajes";

const CLAVE = "flash.ambito";

function inicial(): Ambito {
  if (typeof window === "undefined") return "pedidos";
  if (window.location.pathname.startsWith("/viajes")) return "viajes";
  try {
    return window.localStorage.getItem(CLAVE) === "viajes" ? "viajes" : "pedidos";
  } catch {
    return "pedidos";
  }
}

/** Sólo se toca la dirección en el inicio: otra ruta no es de este selector. */
function reflejarEnDireccion(ambito: Ambito) {
  if (["/", "/viajes"].includes(window.location.pathname))
    window.history.replaceState(null, "", ambito === "viajes" ? "/viajes" : "/");
}

export function useAmbito() {
  const [ambito, setAmbito] = useState<Ambito>(inicial);
  // El ámbito recordado también se ve en la dirección, para que lo que se comparte
  // abra lo mismo que se está viendo.
  useEffect(() => reflejarEnDireccion(ambito), [ambito]);
  const cambiar = (siguiente: Ambito) => {
    setAmbito(siguiente);
    try {
      window.localStorage.setItem(CLAVE, siguiente);
    } catch {
      // Sin almacenamiento (ventana privada): el ámbito vale para esta visita.
    }
  };
  return { ambito, cambiar };
}

export function AmbitoSwitch({
  ambito,
  onChange,
}: {
  ambito: Ambito;
  onChange: (ambito: Ambito) => void;
}) {
  const opciones = [
    { id: "pedidos" as const, rotulo: "Pedidos", Icono: ShoppingBag },
    { id: "viajes" as const, rotulo: "Viajes", Icono: Car },
  ];
  return (
    <div className="ambito-switch" role="group" aria-label="Pedidos o Viajes">
      {opciones.map(({ id, rotulo, Icono }) => (
        <button
          key={id}
          type="button"
          aria-pressed={ambito === id}
          data-ambito={id}
          onClick={() => ambito !== id && onChange(id)}
        >
          <Icono size={16} /> {rotulo}
        </button>
      ))}
    </div>
  );
}
