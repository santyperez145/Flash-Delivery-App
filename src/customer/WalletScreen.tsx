import { useState } from "react";
import { TicketPercent, WalletCards } from "lucide-react";

import { money } from "../format";
import type { AppState, User } from "../types";

export function WalletScreen({
  user,
  promotions,
  transactions,
  onTopUp,
}: {
  user: User | null;
  promotions: AppState["promotions"];
  transactions: AppState["walletTransactions"];
  onTopUp: (amount: number) => void;
}) {
  const [amount, setAmount] = useState("10000");
  const parsedAmount = Number(amount);

  return (
    <div className="activity-stack">
      <section className="wallet-card">
        <WalletCards size={25} />
        <div>
          <span>Flash Wallet</span>
          <strong>{money.format(user?.wallet || 0)}</strong>
        </div>
        <div className="wallet-topup">
          <input
            type="number"
            min="1000"
            max="200000"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label="Monto a cargar"
          />
          <button
            type="button"
            disabled={
              !Number.isInteger(parsedAmount) || parsedAmount < 1000 || parsedAmount > 200000
            }
            onClick={() => onTopUp(parsedAmount)}
          >
            Cargar saldo
          </button>
        </div>
      </section>
      <section className="loyalty-card">
        <div>
          <span>Actividad financiera</span>
          <strong>{transactions.length} movimientos registrados</strong>
        </div>
        <small>Las cargas y consumos quedan auditados en la cuenta autenticada.</small>
      </section>
      {transactions.slice(0, 5).map((transaction) => (
        <article className="promo-row" key={transaction.id}>
          <WalletCards size={18} />
          <div>
            <strong>{transaction.description}</strong>
            <span>{new Date(transaction.createdAt).toLocaleString("es-AR")}</span>
          </div>
          <small>
            {transaction.kind === "credit" ? "+" : "-"}
            {money.format(transaction.amount)}
          </small>
        </article>
      ))}
      {promotions.map((promotion) => (
        <article className="promo-row" key={promotion.id}>
          <TicketPercent size={18} />
          <div>
            <strong>{promotion.title}</strong>
            <span>{promotion.description}</span>
          </div>
          <small>{promotion.discountPercent}%</small>
        </article>
      ))}
    </div>
  );
}
