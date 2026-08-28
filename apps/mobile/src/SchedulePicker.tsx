// Reservar y mover el horario de un servicio en el móvil (GTM-001).
//
// Misma decisión que en la web: la portada prometía «Programar — Food o taxi» y
// sólo los viajes sabían reservar; y nada, ni viaje ni pedido, se podía mover de
// hora sin cancelar y volver a pedir.
//
// **Un solo componente para reservar y para reprogramar** — son la misma
// decisión en dos momentos, y separarlos daría dos reglas de qué horario vale.
//
// En móvil no hay `datetime-local`. Se ofrecen atajos relativos («en 1 hora»,
// «esta noche», «mañana al mediodía») en vez de un calendario: cubren la
// enorme mayoría de las reservas reales con un toque, y evitan arrastrar una
// dependencia de picker nativo para elegir una hora redonda.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { styles } from "./styles";

// Las mismas cotas que aplica `server/scheduling.js`. Se duplican para no
// ofrecer un horario que el confirmar va a rechazar; el que manda es el
// servidor, y hay una puerta que vigila que estos números coincidan.
const MINUTOS_MINIMOS = 30;
const DIAS_MAXIMOS = 30;

export const formatearHorario = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Un horario del día indicado, a la hora redonda pedida. */
function aLaHora(diasAdelante: number, hora: number) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + diasAdelante);
  fecha.setHours(hora, 0, 0, 0);
  return fecha;
}

/**
 * Atajos ofrecidos, ya filtrados por la ventana válida.
 *
 * Filtrar acá y no al tocar es lo que evita ofrecer «esta noche» a las once de
 * la noche: el botón existiría, y el servidor devolvería un 400 que la persona
 * no puede explicarse.
 */
export function atajosDeHorario(ahora = Date.now()) {
  const piso = ahora + MINUTOS_MINIMOS * 60 * 1000;
  const techo = ahora + DIAS_MAXIMOS * 24 * 60 * 60 * 1000;
  return [
    { etiqueta: "En 1 hora", fecha: new Date(ahora + 60 * 60 * 1000) },
    { etiqueta: "Esta noche", fecha: aLaHora(0, 21) },
    { etiqueta: "Mañana al mediodía", fecha: aLaHora(1, 12) },
    { etiqueta: "Mañana a la noche", fecha: aLaHora(1, 21) },
  ].filter(({ fecha }) => fecha.getTime() >= piso && fecha.getTime() <= techo);
}

export function SchedulePicker({
  scheduledFor,
  onChange,
  disabled,
}: {
  scheduledFor: string | null;
  onChange: (iso: string | null) => void;
  disabled: boolean;
}) {
  const atajos = atajosDeHorario();
  const opcion = (clave: string, activa: boolean, alPresionar: () => void, texto: string) => (
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
      <Text style={styles.propinaOpcionTexto}>{texto}</Text>
    </Pressable>
  );
  return (
    <View style={styles.propinaSelector}>
      <Text style={styles.sectionTitle}>¿Cuándo lo querés?</Text>
      <View style={styles.propinaOpciones}>
        {/* «Lo antes posible» primero y activo por omisión: es lo que pide la
            enorme mayoría, y hacerlo elegir sería un toque de más en el camino
            normal. */}
        {opcion("ya", !scheduledFor, () => onChange(null), "Lo antes posible")}
        {atajos.map(({ etiqueta, fecha }) =>
          opcion(
            etiqueta,
            scheduledFor === fecha.toISOString(),
            () => onChange(fecha.toISOString()),
            etiqueta,
          ),
        )}
      </View>
      {scheduledFor ? (
        <Text style={styles.cardText}>
          Reservás para {formatearHorario(scheduledFor)}. Podés moverlo hasta que el comercio
          empiece a prepararlo.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Mover el horario de algo ya reservado.
 *
 * Detrás de un toque: en la lista de pedidos la acción frecuente es seguirlo, no
 * cambiarlo de hora, y cuatro botones en cada tarjeta empujan el resto fuera de
 * la pantalla.
 */
export function RescheduleControl({
  scheduledFor,
  onReschedule,
  disabled,
}: {
  scheduledFor: string;
  onReschedule: (iso: string) => void;
  disabled: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const atajos = atajosDeHorario();
  if (!abierto)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Reprogramar, ahora reservado para ${formatearHorario(scheduledFor)}`}
        disabled={disabled}
        onPress={() => setAbierto(true)}
        style={({ pressed }) => [
          styles.suscripcionBaja,
          (pressed || disabled) && styles.disabledButton,
        ]}
      >
        <Text style={styles.suscripcionBajaText}>
          Reprogramar · {formatearHorario(scheduledFor)}
        </Text>
      </Pressable>
    );
  return (
    <View style={styles.propinaOpciones}>
      {atajos.map(({ etiqueta, fecha }) => (
        <Pressable
          key={etiqueta}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => {
            onReschedule(fecha.toISOString());
            setAbierto(false);
          }}
          style={({ pressed }) => [
            styles.propinaOpcion,
            (pressed || disabled) && styles.disabledButton,
          ]}
        >
          <Text style={styles.propinaOpcionTexto}>{etiqueta}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setAbierto(false)}
        style={({ pressed }) => [styles.propinaOpcion, pressed && styles.disabledButton]}
      >
        <Text style={styles.propinaOpcionTexto}>Cancelar</Text>
      </Pressable>
    </View>
  );
}
