// Propina en el checkout del móvil (ticket GTM-001).
//
// Misma decisión que en la web y por la misma razón: la competencia la pide
// antes de asignar repartidor porque así se deja más seguido, y la propina es la
// ganancia por viaje de quien reparte — la variable con la que se compite por
// oferta de reparto.
//
// **Los porcentajes se calculan sobre el subtotal, no sobre el total.** Sobre el
// total, la propina subiría cuando sube el envío o la tarifa de servicio, que no
// tienen nada que ver con quien reparte. Es la clase de detalle que nadie nota y
// que infla la propina sin que la persona lo decida.
import { Pressable, Text, TextInput, View } from "react-native";

import { money } from "./format";
import { styles } from "./styles";

const PORCENTAJES = [10, 15, 20] as const;

// Los mismos topes que aplica el servidor. Duplicarlos acá evita ofrecer un
// monto que el confirmar va a rechazar; el que manda sigue siendo el servidor.
const MIN_CENTS = 10000;
const maxCents = (totalPesos: number) =>
  Math.min(10000000, Math.max(MIN_CENTS, Math.floor(totalPesos * 100 * 0.5)));

export function TipSelector({
  subtotal,
  tipCents,
  onChange,
  orderTotal,
  disabled,
}: {
  subtotal: number;
  tipCents: number;
  onChange: (cents: number) => void;
  orderTotal: number;
  disabled: boolean;
}) {
  const techo = maxCents(orderTotal);
  const opciones = PORCENTAJES.map((porcentaje) => ({
    porcentaje,
    cents: Math.round(subtotal * 100 * (porcentaje / 100)),
  }))
    // Una opción fuera de los topes la rechazaría el servidor. Ofrecerla sería
    // prometer algo que el siguiente toque no cumple.
    .filter((opcion) => opcion.cents >= MIN_CENTS && opcion.cents <= techo);

  const opcion = (
    clave: string,
    activa: boolean,
    alPresionar: () => void,
    hijos: React.ReactNode,
  ) => (
    <Pressable
      key={clave}
      accessibilityRole="button"
      disabled={disabled}
      onPress={alPresionar}
      style={({ pressed }) => [
        styles.propinaOpcion,
        activa && styles.propinaOpcionActiva,
        (pressed || disabled) && styles.disabledButton,
      ]}
    >
      {hijos}
    </Pressable>
  );

  return (
    <View style={styles.propinaSelector}>
      <Text style={styles.sectionTitle}>Propina para quien reparte</Text>
      <Text style={styles.cardText}>Va completa al repartidor. Se cobra con el pedido.</Text>
      <View style={styles.propinaOpciones}>
        {/* Sin la opción de no dejar propina esto sería un cargo disfrazado de
            elección. */}
        {opcion(
          "cero",
          tipCents === 0,
          () => onChange(0),
          <Text style={styles.propinaOpcionTexto}>Sin propina</Text>,
        )}
        {opciones.map(({ porcentaje, cents }) =>
          opcion(
            String(porcentaje),
            tipCents === cents,
            () => onChange(cents),
            <>
              <Text style={styles.propinaOpcionTexto}>{porcentaje}%</Text>
              <Text style={styles.propinaOpcionMonto}>{money.format(cents / 100)}</Text>
            </>,
          ),
        )}
      </View>
      <View style={styles.propinaLibre}>
        <Text style={styles.cardText}>Otro monto</Text>
        <TextInput
          accessibilityLabel="Propina personalizada en pesos"
          editable={!disabled}
          keyboardType="number-pad"
          placeholder="0"
          value={tipCents ? String(Math.round(tipCents / 100)) : ""}
          onChangeText={(texto) => {
            const pesos = Number(texto.replace(/[^0-9]/g, ""));
            // Vacío o cero es «sin propina», no un monto inválido: sin este caso
            // borrar el campo dejaría una propina por debajo del mínimo que el
            // servidor rechazaría al confirmar.
            if (!Number.isFinite(pesos) || pesos <= 0) return onChange(0);
            onChange(Math.min(techo, Math.max(MIN_CENTS, Math.round(pesos) * 100)));
          }}
          style={styles.propinaInput}
        />
      </View>
      {tipCents > 0 ? (
        <Text style={styles.cardText}>
          Se retiene hasta la entrega. Si el pedido se cancela, vuelve completa.
        </Text>
      ) : null}
    </View>
  );
}
