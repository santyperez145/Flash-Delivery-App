// Propina en el checkout (ticket GTM-001, segundo hueco comercial).
//
// Hasta ahora la propina sólo existía después de entregar. La competencia la
// pide acá, antes de asignar repartidor, porque así se deja más seguido — y la
// propina es la ganancia por viaje del repartidor, que es la variable con la que
// se compite por oferta de reparto.
//
// **Los porcentajes se calculan sobre el subtotal, no sobre el total.** Un
// porcentaje sobre el total haría que la propina suba cuando sube el envío o la
// tarifa de servicio, que no tienen nada que ver con quien reparte. Es la clase
// de detalle que nadie nota y que infla la propina sin que la persona lo decida.
import { money } from "../format";

// Los tres porcentajes que ofrece la categoría, más «sin propina» y un monto
// libre. Sin la opción de no dejar propina esto sería un cargo disfrazado de
// elección.
const PORCENTAJES = [10, 15, 20] as const;

export function TipSelector({
  subtotal,
  tipCents,
  onChange,
  minCents,
  maxCents,
  disabled,
}: {
  subtotal: number;
  tipCents: number;
  onChange: (cents: number) => void;
  minCents: number;
  maxCents: number;
  disabled: boolean;
}) {
  const opciones = PORCENTAJES.map((porcentaje) => ({
    porcentaje,
    cents: Math.round(subtotal * 100 * (porcentaje / 100)),
  }))
    // Una opción por debajo del mínimo o por encima del techo la rechazaría el
    // servidor. Ofrecerla sería prometer algo que el siguiente toque no cumple.
    .filter((opcion) => opcion.cents >= minCents && opcion.cents <= maxCents);

  return (
    <section className="propina-selector">
      <div className="propina-encabezado">
        <strong>Propina para quien reparte</strong>
        <small>Va completa al repartidor. Se cobra con el pedido.</small>
      </div>
      <div className="propina-opciones">
        <button
          type="button"
          className={tipCents === 0 ? "propina-opcion activa" : "propina-opcion"}
          disabled={disabled}
          onClick={() => onChange(0)}
        >
          Sin propina
        </button>
        {opciones.map(({ porcentaje, cents }) => (
          <button
            key={porcentaje}
            type="button"
            className={tipCents === cents ? "propina-opcion activa" : "propina-opcion"}
            disabled={disabled}
            onClick={() => onChange(cents)}
          >
            <span>{porcentaje}%</span>
            <small>{money.format(cents / 100)}</small>
          </button>
        ))}
      </div>
      <label className="propina-libre">
        <span>Otro monto</span>
        <input
          type="number"
          min={0}
          max={Math.floor(maxCents / 100)}
          step={100}
          disabled={disabled}
          value={tipCents ? Math.round(tipCents / 100) : ""}
          placeholder="0"
          onChange={(evento) => {
            const pesos = Number(evento.target.value);
            // Vacío o cero es «sin propina», no un monto inválido. Sin este caso
            // borrar el campo dejaría una propina por debajo del mínimo que el
            // servidor rechazaría al confirmar.
            if (!Number.isFinite(pesos) || pesos <= 0) return onChange(0);
            onChange(Math.min(maxCents, Math.max(minCents, Math.round(pesos) * 100)));
          }}
        />
      </label>
      {tipCents > 0 && (
        <p className="propina-retenida">
          Se retiene hasta la entrega. Si el pedido se cancela, vuelve completa.
        </p>
      )}
    </section>
  );
}
