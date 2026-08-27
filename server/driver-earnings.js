// Las ganancias del conductor, acreditadas en el runtime que esté activo
// (ticket ARC-001).
//
// Vivía en `server/index.js` y lo comparten los tres flujos que le pagan a un
// conductor: pedidos, viajes y envíos. Extraer el primero de los tres lo
// hubiera duplicado.
//
// Son dos funciones porque son dos mundos. `creditDriverEarnings` muta el
// estado SQLite del respaldo: suma a `earningsToday`, acredita la billetera y
// deja la transacción. `creditDriverEarningsRuntime` decide: sobre PostgreSQL
// delega en el asiento contable real (`settleMobilityWalletPayment`), que es
// quien garantiza que la ganancia y el débito del cliente cuadren.
//
// El monto se redondea siempre: una ganancia con decimales de más es un
// asiento que después no concilia.
import { getPostgresDrivers } from "./driver-roster-repository.js";
import { usesPostgresCommerce } from "./postgres.js";
import { createId, getTimestamp } from "./store.js";
import { settleMobilityWalletPayment } from "./wallet-repository.js";

export function creditDriverEarnings(db, driverId, amount, reference) {
  const driver = db.drivers.find((entry) => entry.id === driverId);
  if (!driver || !Number.isFinite(amount) || amount <= 0) return;
  driver.earningsToday = Number(driver.earningsToday || 0) + Math.round(amount);
  const user = db.users.find((entry) => entry.id === driver.userId);
  if (user) user.wallet = Number(user.wallet || 0) + Math.round(amount);
  db.walletTransactions ||= [];
  db.walletTransactions.unshift({
    id: createId("WAL"),
    userId: driver.userId,
    kind: "credit",
    amount: Math.round(amount),
    description: `Ganancia ${reference}`,
    createdAt: getTimestamp(),
  });
}

export async function creditDriverEarningsRuntime(db, driverId, amount, reference) {
  if (!usesPostgresCommerce()) return creditDriverEarnings(db, driverId, amount, reference);
  const driver = (await getPostgresDrivers()).find((entry) => entry.id === driverId);
  if (!driver || amount <= 0) return;
  const publicId = reference.replace(/^(viaje|envio)-/, "");
  return settleMobilityWalletPayment({
    publicId,
    driverPublicId: driverId,
    driverAmount: Math.round(amount),
    reference,
  });
}
