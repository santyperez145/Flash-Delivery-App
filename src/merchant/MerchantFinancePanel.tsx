// Liquidaciones y conexión de cobro del comercio (ARC-001).
//
// Uber Eats Manager y DoorDash Merchant aíslan payouts y la cuenta seller de
// la cocina. Flash conserva ledger, retiro con step-up y OAuth de Mercado Pago
// aquí; la ausencia de credenciales se muestra como pendiente, no como cobro.
import { useCallback, useEffect, useState } from "react";
import { ReceiptText, WalletCards } from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import { AdminSectionHeader } from "../ui/panels";
import type { MerchantFinance, MerchantPaymentConnection, Restaurant } from "../types";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function MerchantFinancePanel({
  restaurant,
  busy,
  runAction,
}: {
  restaurant: Restaurant;
  busy: boolean;
  runAction: RunAction;
}) {
  const [finance, setFinance] = useState<MerchantFinance | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutPassword, setPayoutPassword] = useState("");
  const [paymentConnection, setPaymentConnection] = useState<MerchantPaymentConnection | null>(
    null,
  );
  const [paymentProviderConfigured, setPaymentProviderConfigured] = useState(false);
  const [paymentConnectionPassword, setPaymentConnectionPassword] = useState("");
  const loadFinance = useCallback(async () => {
    setFinanceLoading(true);
    try {
      const [financeResult, connectionResult] = await Promise.all([
        api.getMerchantFinance(restaurant.id),
        api.getMerchantPaymentConnection(restaurant.id),
      ]);
      setFinance(financeResult.finance);
      setPaymentConnection(connectionResult.connection);
      setPaymentProviderConfigured(connectionResult.configured);
    } finally {
      setFinanceLoading(false);
    }
  }, [restaurant.id]);
  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  return (
    <div className="merchant-finance-grid">
      <section className="admin-card merchant-payout-history">
        <AdminSectionHeader
          title="Cobros del marketplace"
          action={
            paymentConnection?.status === "connected"
              ? paymentConnection.liveMode
                ? "Cuenta real"
                : "Cuenta de prueba"
              : "Sin vincular"
          }
        />
        {paymentConnection?.status === "connected" ? (
          <>
            <p>
              Mercado Pago conectado · cuenta terminada en{" "}
              {paymentConnection.externalAccountId.slice(-4)}.
            </p>
            <small>
              Conectado {new Date(paymentConnection.connectedAt).toLocaleString("es-AR")}. Flash
              renueva la autorización antes de vencer y nunca muestra tokens sin cifrar.
            </small>
            <div className="merchant-payout-form">
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Contraseña para desvincular"
                value={paymentConnectionPassword}
                onChange={(event) => setPaymentConnectionPassword(event.target.value)}
              />
              <button
                className="secondary-button"
                disabled={busy || paymentConnectionPassword.length < 4}
                onClick={() =>
                  runAction(async () => {
                    const result = await api.disconnectMerchantPaymentConnection(
                      restaurant.id,
                      paymentConnectionPassword,
                    );
                    setPaymentConnection(result.connection);
                    setPaymentConnectionPassword("");
                  }, "Mercado Pago desvinculado y credenciales eliminadas")
                }
              >
                Desvincular de forma segura
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              {paymentConnection?.status === "revoked"
                ? "La conexión anterior fue revocada y sus credenciales se eliminaron."
                : paymentConnection?.status === "reconnect_required"
                  ? "Mercado Pago requiere renovar el consentimiento. Reconectá la cuenta antes de que se interrumpan los cobros."
                  : "Vinculá la cuenta seller para que Mercado Pago pueda dividir cobros entre el comercio y Flash."}
            </p>
            <button
              className="primary-button"
              disabled={busy || !paymentProviderConfigured}
              onClick={() =>
                runAction(async () => {
                  const result = await api.beginMerchantPaymentConnection(restaurant.id);
                  window.location.assign(result.authorizationUrl);
                }, "Redirigiendo a Mercado Pago")
              }
            >
              {paymentProviderConfigured
                ? paymentConnection?.status === "reconnect_required"
                  ? "Reconectar Mercado Pago"
                  : "Conectar Mercado Pago"
                : "Integración pendiente de credenciales"}
            </button>
          </>
        )}
      </section>
      <section className="admin-card">
        <AdminSectionHeader
          title="Saldo liquidable"
          action={financeLoading ? "Actualizando…" : "PostgreSQL ledger"}
        />
        <strong className="merchant-balance">{money.format(finance?.availableBalance || 0)}</strong>
        <p>Ventas capturadas menos comisión y retiros reservados.</p>
        <div className="merchant-payout-form">
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Monto a retirar"
            value={payoutAmount}
            onChange={(event) => setPayoutAmount(event.target.value)}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Contraseña actual"
            value={payoutPassword}
            onChange={(event) => setPayoutPassword(event.target.value)}
            aria-label="Contraseña actual para autorizar el retiro"
          />
          <button
            className="primary-button"
            disabled={
              busy ||
              !Number(payoutAmount) ||
              payoutPassword.length < 4 ||
              Number(payoutAmount) > (finance?.availableBalance || 0)
            }
            onClick={async () => {
              const amount = Number(payoutAmount);
              await runAction(async () => {
                const authorization = await api.authorizeMerchantPayout(
                  restaurant.id,
                  amount,
                  payoutPassword,
                );
                return api.requestMerchantPayout(
                  restaurant.id,
                  amount,
                  authorization.authorizationToken,
                );
              }, "Retiro reservado");
              setPayoutAmount("");
              setPayoutPassword("");
              await loadFinance();
            }}
          >
            Solicitar retiro
          </button>
        </div>
        <small>
          Confirmás comercio e importe con tu contraseña. La autorización vence en 5 minutos,
          funciona una sola vez y el retiro queda pendiente del proveedor bancario.
        </small>
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Movimientos" action={`${finance?.movements.length || 0}`} />
        <div className="admin-table">
          {finance?.movements.map((entry) => (
            <article className="admin-row compact" key={entry.id}>
              <ReceiptText size={17} />
              <div>
                <strong>{entry.description}</strong>
                <span>{new Date(entry.createdAt).toLocaleString("es-AR")}</span>
              </div>
              <b>
                {entry.direction === "credit" ? "+" : "-"}
                {money.format(entry.amount)}
              </b>
              <small>{entry.kind}</small>
            </article>
          ))}
          {!financeLoading && !finance?.movements.length && <p>Sin liquidaciones todavía.</p>}
        </div>
      </section>
      <section className="admin-card merchant-payout-history">
        <AdminSectionHeader title="Retiros" action={`${finance?.payouts.length || 0}`} />
        <div className="admin-table">
          {finance?.payouts.map((entry) => (
            <article className="admin-row compact" key={entry.id}>
              <WalletCards size={17} />
              <div>
                <strong>{entry.id}</strong>
                <span>{new Date(entry.createdAt).toLocaleDateString("es-AR")}</span>
              </div>
              <b>{money.format(entry.amount)}</b>
              <small>{entry.status}</small>
            </article>
          ))}
          {!financeLoading && !finance?.payouts.length && <p>No hay retiros solicitados.</p>}
        </div>
      </section>
    </div>
  );
}
