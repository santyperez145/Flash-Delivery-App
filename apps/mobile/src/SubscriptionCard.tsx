// Suscripción de Flash en el móvil (ticket GTM-001).
//
// Misma forma que en la web y por la misma razón: se ve el precio antes de
// decidir, se ve qué devuelve, y la baja está a un toque. Una baja escondida no
// retiene a nadie — mueve la cancelación al banco y se lleva la tarjeta.
//
// **Los beneficios se arman con los valores del servidor**, no escritos en el
// componente: el umbral que muestra la pantalla y el que aplica la tarifa tienen
// que ser el mismo número, o el checkout cobra algo distinto de lo prometido.
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api } from "./api";
import { money } from "./format";
import { styles } from "./styles";
import type { Subscription, SubscriptionPlan } from "./types";

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long" });

/** Beneficios de un plan. Los que el plan no da se omiten: «0% en viajes» es
 *  peor que no decir nada. */
function beneficiosDe(plan: SubscriptionPlan | Subscription): string[] {
  return [
    plan.freeDeliveryMinSubtotalCents !== null &&
      `Envío sin cargo desde ${money.format(plan.freeDeliveryMinSubtotalCents / 100)}`,
    plan.rideDiscountBps > 0 && `${plan.rideDiscountBps / 100}% menos en viajes`,
    plan.dispatchPriorityBoost > 0 && "Prioridad al asignar conductor",
  ].filter(Boolean) as string[];
}

export function SubscriptionCard({ busy }: { busy: boolean }) {
  const [planes, setPlanes] = useState<SubscriptionPlan[]>([]);
  const [suscripcion, setSuscripcion] = useState<Subscription | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; error: boolean } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [catalogo, propia] = await Promise.all([
        api.getSubscriptionPlans(),
        api.getSubscription(),
      ]);
      setPlanes(catalogo.plans);
      setSuscripcion(propia.subscription);
    } catch (fallo) {
      setMensaje({
        texto: fallo instanceof Error ? fallo.message : "No se pudo cargar la suscripción",
        error: true,
      });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const ejecutar = async (accion: () => Promise<unknown>, exito: string) => {
    setOcupado(true);
    setMensaje(null);
    try {
      await accion();
      await cargar();
      setMensaje({ texto: exito, error: false });
    } catch (fallo) {
      setMensaje({
        texto: fallo instanceof Error ? fallo.message : "No se pudo completar la operación",
        error: true,
      });
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return null;
  // Sin planes y sin suscripción no hay nada que ofrecer: una tarjeta vacía
  // sugeriría que algo se rompió cuando lo que pasa es que no hay oferta.
  if (!suscripcion && planes.length === 0) return null;

  const bloqueado = busy || ocupado;
  const plan = suscripcion ?? planes[0];

  return (
    <View style={styles.suscripcionCard}>
      <View style={styles.suscripcionHeader}>
        <Text style={styles.foodRestaurantTitle}>Flash Más</Text>
        {suscripcion ? (
          <View style={suscripcion.renews ? styles.suscripcionChip : styles.suscripcionChipVence}>
            <Text style={styles.suscripcionChipText}>
              {suscripcion.renews ? "Activa" : `Hasta el ${fecha(suscripcion.currentPeriodEnd)}`}
            </Text>
          </View>
        ) : (
          <Text style={styles.suscripcionPrecio}>
            {money.format(plan.priceCents / 100)}
            <Text style={styles.cardText}> / {plan.billingPeriodDays} días</Text>
          </Text>
        )}
      </View>

      {beneficiosDe(plan).map((linea) => (
        <Text key={linea} style={styles.cardText}>
          • {linea}
        </Text>
      ))}

      {suscripcion ? (
        <>
          <Text style={styles.cardText}>
            {suscripcion.renews
              ? `Se renueva el ${fecha(suscripcion.currentPeriodEnd)} por ${money.format(
                  suscripcion.priceCents / 100,
                )}`
              : "Cancelada. Los beneficios siguen hasta que termine el período que ya pagaste."}
          </Text>
          {/* El cobro recurrente depende de PAY-001. Decirlo evita que la persona
              se entere por un cargo sorpresa —o por su ausencia. */}
          {!suscripcion.billed ? (
            <Text style={styles.suscripcionAviso}>
              Período bonificado: todavía no hay cobro configurado.
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              suscripcion.renews ? "Cancelar renovación de Flash Más" : "Reactivar Flash Más"
            }
            disabled={bloqueado}
            onPress={() =>
              suscripcion.renews
                ? void ejecutar(
                    () => api.cancelSubscription(),
                    "No se renovará al terminar el período",
                  )
                : void ejecutar(
                    () => api.subscribe(suscripcion.planKey),
                    "Tu suscripción vuelve a renovar",
                  )
            }
            style={({ pressed }) => [
              suscripcion.renews ? styles.suscripcionBaja : styles.suscripcionAlta,
              (pressed || bloqueado) && styles.disabledButton,
            ]}
          >
            <Text
              style={suscripcion.renews ? styles.suscripcionBajaText : styles.suscripcionAltaText}
            >
              {suscripcion.renews ? "Cancelar renovación" : "Reactivar"}
            </Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Suscribirme a ${plan.planName}`}
          disabled={bloqueado}
          onPress={() =>
            void ejecutar(() => api.subscribe(plan.planKey), `${plan.planName} activado`)
          }
          style={({ pressed }) => [
            styles.suscripcionAlta,
            (pressed || bloqueado) && styles.disabledButton,
          ]}
        >
          <Text style={styles.suscripcionAltaText}>Suscribirme</Text>
        </Pressable>
      )}

      {mensaje ? (
        <Text style={mensaje.error ? styles.suscripcionError : styles.suscripcionOk}>
          {mensaje.texto}
        </Text>
      ) : null}
    </View>
  );
}
