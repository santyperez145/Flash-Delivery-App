// Ganancias del conductor (ARC-001).
//
// Ledger, jornada observada y movimientos contables. Sale de DriverScreen
// porque es una pestaña autocontenida con su propio polling.

import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { api } from "../api";
import { compactMoney, money, operationalDuration } from "../format";
import { styles } from "../styles";
import { KpiRow } from "../ui";
import type { DriverEarnings } from "../types";

export function DriverEarningsPanel({
  driverId,
  fallbackEarningsToday,
  rating,
}: {
  driverId: string;
  fallbackEarningsToday: number;
  rating: number;
}) {
  const [driverEarnings, setDriverEarnings] = useState<DriverEarnings | null>(null);
  const [driverEarningsLoading, setDriverEarningsLoading] = useState(false);
  const [driverEarningsError, setDriverEarningsError] = useState("");
  const [selectedDriverDay, setSelectedDriverDay] = useState<string | null>(null);

  const loadDriverEarnings = useCallback(async () => {
    setDriverEarningsLoading(true);
    setDriverEarningsError("");
    try {
      setDriverEarnings((await api.getDriverEarnings()).earnings);
    } catch (error) {
      setDriverEarningsError(
        error instanceof Error ? error.message : "No se pudieron cargar las ganancias",
      );
    } finally {
      setDriverEarningsLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    void loadDriverEarnings();
    const poll = setInterval(() => void loadDriverEarnings(), 60000);
    return () => clearInterval(poll);
  }, [loadDriverEarnings]);

  const onlineToday = driverEarnings?.today.onlineSeconds;
  const activeToday = driverEarnings?.today.activeSeconds;
  const operationalRatio =
    onlineToday != null && activeToday != null && onlineToday > 0 && activeToday <= onlineToday
      ? Math.round((activeToday / onlineToday) * 100)
      : null;
  const operationalAnomaly =
    onlineToday != null && activeToday != null && activeToday > onlineToday;
  const driverWeekMagnitude = Math.max(
    1,
    ...(driverEarnings?.days || []).map((day) => Math.abs(day.amount)),
  );
  const driverSelectedDay =
    driverEarnings?.days.find((day) => day.date === selectedDriverDay) ||
    driverEarnings?.days.at(-1) ||
    null;

  return (
    <>
      <LinearGradient
        colors={["#21132f", "#6f25d8"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.driverEarningsHero}
      >
        <Text style={styles.driverEarningsLabel}>INGRESOS REGISTRADOS HOY</Text>
        <Text style={styles.driverEarningsValue}>
          {money.format(driverEarnings?.today.amount ?? fallbackEarningsToday)}
        </Text>
        <Text style={styles.driverEarningsCopy}>
          {driverEarnings?.source === "postgres-ledger"
            ? "Calculado desde asientos contables posteados. Incluye servicios, propinas y ajustes reales."
            : "Runtime local de prueba: los importes provienen de movimientos persistidos, sin proyecciones."}
        </Text>
      </LinearGradient>
      {driverEarningsLoading && !driverEarnings ? <ActivityIndicator color="#7c3cff" /> : null}
      {driverEarningsError ? (
        <Pressable style={styles.driverEarningsError} onPress={() => void loadDriverEarnings()}>
          <Ionicons name="refresh-circle-outline" size={23} color="#a33939" />
          <View style={styles.itemCopy}>
            <Text style={styles.sectionTitle}>No pudimos leer el ledger</Text>
            <Text style={styles.cardText}>{driverEarningsError} · Tocá para reintentar.</Text>
          </View>
        </Pressable>
      ) : null}
      <View style={styles.driverPeriodGrid}>
        <View style={styles.driverPeriodCard}>
          <Text style={styles.driverPeriodLabel}>ESTA SEMANA</Text>
          <Text style={styles.driverPeriodValue}>
            {money.format(driverEarnings?.week.amount ?? 0)}
          </Text>
          <Text style={styles.driverPeriodMeta}>
            {driverEarnings?.week.services ?? 0} servicios
          </Text>
        </View>
        <View style={styles.driverPeriodCard}>
          <Text style={styles.driverPeriodLabel}>SALDO WALLET</Text>
          <Text style={styles.driverPeriodValue}>
            {money.format(driverEarnings?.walletBalance ?? 0)}
          </Text>
          <Text style={styles.driverPeriodMeta}>retiro aún no habilitado</Text>
        </View>
      </View>
      {driverEarnings?.days.length ? (
        <View style={styles.driverWeekChartCard}>
          <View style={styles.driverSectionHeading}>
            <View>
              <Text style={styles.driverSectionEyebrow}>SEMANA EN CURSO</Text>
              <Text style={styles.driverTimeTitle}>Ingresos por día</Text>
            </View>
            <Text style={styles.driverWeekChartTotal}>
              {money.format(driverEarnings.week.amount)}
            </Text>
          </View>
          <View
            style={styles.driverWeekChart}
            accessibilityRole="summary"
            accessibilityLabel={`Ingresos de la semana ${money.format(driverEarnings.week.amount)}`}
          >
            {driverEarnings.days.map((day) => {
              const height = Math.max(
                day.amount === 0 ? 3 : 8,
                Math.round((Math.abs(day.amount) / driverWeekMagnitude) * 52),
              );
              const weekday = new Date(`${day.date}T12:00:00`)
                .toLocaleDateString("es-AR", { weekday: "short" })
                .replace(".", "")
                .toUpperCase();
              const selected = driverSelectedDay?.date === day.date;
              return (
                <Pressable
                  key={day.date}
                  onPress={() => setSelectedDriverDay(day.date)}
                  style={[styles.driverWeekColumn, selected && styles.driverWeekColumnSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${weekday}: ${money.format(day.amount)}, ${day.services} servicios`}
                >
                  <Text
                    style={[
                      styles.driverWeekAmount,
                      day.amount < 0 && styles.driverWeekAmountNegative,
                    ]}
                  >
                    {compactMoney(day.amount)}
                  </Text>
                  <View style={styles.driverWeekUpper}>
                    {day.amount >= 0 ? (
                      <View
                        style={[
                          styles.driverWeekBar,
                          {
                            height,
                            backgroundColor: day.amount === 0 ? "#d9d2dd" : "#7c3cff",
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.driverWeekBaseline} />
                  <View style={styles.driverWeekLower}>
                    {day.amount < 0 ? (
                      <View
                        style={[styles.driverWeekBar, { height, backgroundColor: "#c44a45" }]}
                      />
                    ) : null}
                  </View>
                  <Text style={[styles.driverWeekDay, selected && styles.driverWeekDaySelected]}>
                    {weekday}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {driverSelectedDay ? (
            <View style={styles.driverWeekDetail}>
              <View style={styles.driverWeekDetailHeader}>
                <View>
                  <Text style={styles.driverTimeLabel}>DETALLE SELECCIONADO</Text>
                  <Text style={styles.driverWeekDetailDate}>
                    {new Date(`${driverSelectedDay.date}T12:00:00`).toLocaleDateString("es-AR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.driverWeekDetailAmount,
                    driverSelectedDay.amount < 0 && styles.driverWeekAmountNegative,
                  ]}
                >
                  {money.format(driverSelectedDay.amount)}
                </Text>
              </View>
              <View style={styles.driverWeekDetailGrid}>
                <View style={styles.driverWeekDetailMetric}>
                  <Text style={styles.driverTimeMeta}>Servicios</Text>
                  <Text style={styles.driverWeekDetailValue}>{driverSelectedDay.services}</Text>
                </View>
                <View style={styles.driverWeekDetailMetric}>
                  <Text style={styles.driverTimeMeta}>Propinas</Text>
                  <Text style={styles.driverWeekDetailValue}>
                    {money.format(driverSelectedDay.tips)}
                  </Text>
                </View>
                <View style={styles.driverWeekDetailMetric}>
                  <Text style={styles.driverTimeMeta}>Conectado</Text>
                  <Text style={styles.driverWeekDetailValue}>
                    {operationalDuration(driverSelectedDay.onlineSeconds)}
                  </Text>
                </View>
                <View style={styles.driverWeekDetailMetric}>
                  <Text style={styles.driverTimeMeta}>En servicio</Text>
                  <Text style={styles.driverWeekDetailValue}>
                    {operationalDuration(driverSelectedDay.activeSeconds)}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
          <Text style={styles.driverTimeSource}>
            Neto diario posteado: servicios, propinas y ajustes. Los días vacíos son cero, no una
            proyección.
          </Text>
        </View>
      ) : null}
      {driverEarnings?.timeTracking.status === "available" ? (
        <View style={styles.driverTimeCard}>
          <View style={styles.driverSectionHeading}>
            <View>
              <Text style={styles.driverSectionEyebrow}>JORNADA OBSERVADA</Text>
              <Text style={styles.driverTimeTitle}>Tu tiempo de hoy</Text>
            </View>
            <View style={styles.driverTimeClock}>
              <Ionicons name="time-outline" size={22} color="#7c3cff" />
            </View>
          </View>
          <View style={styles.driverTimeGrid}>
            <View style={styles.driverTimeMetric}>
              <View style={styles.driverTimeMetricTop}>
                <View style={[styles.driverTimeDot, { backgroundColor: "#7c3cff" }]} />
                <Text style={styles.driverTimeLabel}>CONECTADO</Text>
              </View>
              <Text style={styles.driverTimeValue}>{operationalDuration(onlineToday)}</Text>
              <Text style={styles.driverTimeMeta}>incluye espera online</Text>
            </View>
            <View style={styles.driverTimeMetric}>
              <View style={styles.driverTimeMetricTop}>
                <View style={[styles.driverTimeDot, { backgroundColor: "#087a50" }]} />
                <Text style={styles.driverTimeLabel}>EN SERVICIO</Text>
              </View>
              <Text style={styles.driverTimeValue}>{operationalDuration(activeToday)}</Text>
              <Text style={styles.driverTimeMeta}>asignación a cierre</Text>
            </View>
          </View>
          {operationalRatio != null ? (
            <View style={styles.driverTimeRatio}>
              <View style={styles.driverTimeTrack}>
                <View style={[styles.driverTimeFill, { width: `${operationalRatio}%` }]} />
              </View>
              <Text style={styles.driverTimeRatioText}>
                {operationalRatio}% de la jornada conectada estuvo en servicio
              </Text>
            </View>
          ) : null}
          {operationalAnomaly ? (
            <View style={styles.driverTimeWarning}>
              <Ionicons name="alert-circle-outline" size={18} color="#9b5b00" />
              <Text style={styles.driverTimeWarningText}>
                Hay tiempo asignado fuera de una sesión online. El registro se conserva para
                revisión operativa.
              </Text>
            </View>
          ) : null}
          <View style={styles.driverTimeWeek}>
            <Text style={styles.driverTimeWeekLabel}>SEMANA</Text>
            <Text style={styles.driverTimeWeekValue}>
              {operationalDuration(driverEarnings.week.onlineSeconds)} conectado
            </Text>
            <View style={styles.driverTimeWeekDivider} />
            <Text style={styles.driverTimeWeekValue}>
              {operationalDuration(driverEarnings.week.activeSeconds)} en servicio
            </Text>
          </View>
          <Text style={styles.driverTimeSource}>
            PostgreSQL · actualizado{" "}
            {new Date(driverEarnings.timeTracking.observedAt).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · los solapamientos cuentan una sola vez
          </Text>
        </View>
      ) : driverEarnings ? (
        <View style={styles.driverTimeUnavailable}>
          <Ionicons name="cloud-offline-outline" size={21} color="#a33939" />
          <View style={styles.itemCopy}>
            <Text style={styles.sectionTitle}>Jornada no disponible</Text>
            <Text style={styles.cardText}>
              Este runtime no tiene sesiones PostgreSQL. No mostramos horas aproximadas.
            </Text>
          </View>
        </View>
      ) : null}
      <KpiRow
        items={[
          ["Servicios", driverEarnings?.today.services ?? 0],
          ["Propinas", money.format(driverEarnings?.today.tips ?? 0)],
          ["Ajustes", money.format(driverEarnings?.today.adjustments ?? 0)],
          ["Rating", rating],
        ]}
      />
      <View style={styles.complianceCard}>
        <View style={styles.driverSectionHeading}>
          <View>
            <Text style={styles.driverSectionEyebrow}>MOVIMIENTOS CONTABLES</Text>
            <Text style={styles.sectionTitle}>Detalle reciente</Text>
          </View>
          <Pressable
            onPress={() => void loadDriverEarnings()}
            accessibilityRole="button"
            accessibilityLabel="Actualizar ganancias"
          >
            <Ionicons name="refresh-outline" size={21} color="#7c3cff" />
          </Pressable>
        </View>
        {driverEarnings?.recent.length ? (
          driverEarnings.recent.map((entry) => (
            <View key={entry.id} style={styles.driverEarningRow}>
              <View
                style={[styles.driverInboxIcon, entry.amount < 0 && styles.driverEarningAdjustment]}
              >
                <Ionicons
                  name={
                    entry.category === "tip"
                      ? "heart-outline"
                      : entry.category === "adjustment"
                        ? "remove-circle-outline"
                        : entry.category === "ride"
                          ? "car-sport-outline"
                          : entry.category === "shipment"
                            ? "cube-outline"
                            : "bag-handle-outline"
                  }
                  size={20}
                  color={entry.amount < 0 ? "#a33939" : "#7c3cff"}
                />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.sectionTitle}>{entry.description}</Text>
                <Text style={styles.cardText}>
                  {entry.jobId || "Movimiento de cuenta"} ·{" "}
                  {new Date(entry.createdAt).toLocaleString("es-AR")}
                </Text>
              </View>
              <Text
                style={[
                  styles.driverEarningAmount,
                  entry.amount < 0 && styles.driverEarningAmountNegative,
                ]}
              >
                {entry.amount > 0 ? "+" : ""}
                {money.format(entry.amount)}
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.driverEmptyState}>
            <Ionicons name="receipt-outline" size={34} color="#7c3cff" />
            <Text style={styles.sectionTitle}>Sin movimientos todavía</Text>
            <Text style={styles.cardText}>
              Los servicios completados, propinas y ajustes aparecerán al postearse en el ledger.
            </Text>
          </View>
        )}
      </View>
      <View style={styles.driverTransparencyCard}>
        <Ionicons name="shield-checkmark-outline" size={22} color="#087a50" />
        <View style={styles.itemCopy}>
          <Text style={styles.sectionTitle}>Datos honestos</Text>
          <Text style={styles.cardText}>
            Ingresos y jornada provienen del ledger y de sesiones operativas. Metas, promociones y
            retiros siguen ocultos hasta tener contratos productivos.
          </Text>
        </View>
      </View>
    </>
  );
}
