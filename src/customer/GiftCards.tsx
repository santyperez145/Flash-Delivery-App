import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, Gift, Share2 } from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import {
  cancelGiftCard,
  claimGiftCard,
  getGiftCards,
  purchaseGiftCard,
  redeemGiftCardCode,
} from "../gift-card-api";
import type { GiftCard, ReceivedGiftCard } from "../types";

// Tarjetas de regalo (PAG-04), como las de Uber: se compran con el saldo de Flash
// Wallet y se regalan con el código o dirigidas a otra cuenta Flash. Quien la
// recibe la canjea y el importe entra a su Wallet. No vence. Quien la compró la
// anula mientras nadie la canjeó. Mismo comportamiento que la app móvil.

const MINIMO = 1000;
const SUGERIDOS = [5000, 10000, 20000];
const estadoTexto: Record<GiftCard["status"], string> = {
  active: "Vigente",
  redeemed: "Canjeada",
  cancelled: "Anulada",
};
const nuevaClave = () => `gift-${crypto.randomUUID()}`;

export function GiftCards({
  wallet,
  onWalletChanged,
}: {
  /** El saldo de la Wallet: una tarjeta no puede costar más. */
  wallet: number;
  /** La Wallet cambió (compra, canje o anulación): la cuenta se vuelve a leer. */
  onWalletChanged: (aviso: string) => void;
}) {
  const [compradas, setCompradas] = useState<GiftCard[]>([]);
  const [recibidas, setRecibidas] = useState<ReceivedGiftCard[]>([]);
  const [fallo, setFallo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const [monto, setMonto] = useState(String(SUGERIDOS[1]));
  const [email, setEmail] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [codigoMfa, setCodigoMfa] = useState("");
  // `null`: no se pudo saber. El campo se muestra, pero no se exige: el servidor
  // responde si hace falta. Exigirlo dejaba sin poder comprar a quien no la usa
  // cada vez que la lectura fallaba (por ejemplo, sin conexión).
  const [conMfa, setConMfa] = useState<boolean | null>(false);
  const [codigoCanje, setCodigoCanje] = useState("");
  const [recien, setRecien] = useState<GiftCard | null>(null);
  // Una clave por compra: un reintento tras un corte devuelve la misma tarjeta. Si
  // cambian el importe, el destinatario o el mensaje, es otra compra y lleva otra clave
  // (el servidor además rechaza una clave repetida con otros datos).
  const clave = useRef(nuevaClave());
  useEffect(() => {
    clave.current = nuevaClave();
  }, [monto, email, mensaje]);

  const cargar = useCallback(
    () =>
      getGiftCards()
        .then((respuesta) => {
          setCompradas(respuesta.purchased);
          setRecibidas(respuesta.received);
          setFallo(false);
        })
        .catch(() => setFallo(true)),
    [],
  );
  // Con la verificación en dos pasos activa, comprar pide el código. El estado se
  // lee al abrir y **otra vez antes de comprar**: se puede activar en esta misma
  // pantalla, y sin el campo la compra fallaría sin forma de mandar el código.
  const releerMfa = useCallback(
    () =>
      api
        .getMfaStatus()
        .then((respuesta): boolean | null => respuesta.mfa.enabled)
        .catch(() => null)
        .then((activa) => {
          setConMfa(activa);
          return activa;
        }),
    [],
  );
  useEffect(() => {
    void cargar();
    void releerMfa();
  }, [cargar, releerMfa]);

  const importe = Number(monto);
  const importeValido = Number.isInteger(importe) && importe >= MINIMO;
  const alcanza = importeValido && importe <= wallet;

  const hacer = async (id: string, trabajo: () => Promise<string>) => {
    setOcupado(id);
    setAviso(null);
    try {
      const texto = await trabajo();
      setAviso({ texto, error: false });
      onWalletChanged(texto);
      await cargar();
    } catch (error) {
      setAviso({
        texto: error instanceof Error ? error.message : "No se pudo completar",
        error: true,
      });
      // Una compra cuya respuesta se perdió pudo haberse hecho: la lista lo muestra.
      void cargar();
    } finally {
      setOcupado(null);
    }
  };

  const comprar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!alcanza) return;
    void hacer("comprar", async () => {
      // Sólo si no hay un código escrito: con uno, se manda y el servidor decide.
      if (!codigoMfa && conMfa !== true && (await releerMfa()) === true)
        throw new Error("Escribí el código de tu app autenticadora para comprar");
      const conCodigo = conMfa !== false && Boolean(codigoMfa);
      const { card } = await purchaseGiftCard(
        {
          amount: importe,
          ...(email.trim() ? { recipientEmail: email.trim() } : {}),
          ...(mensaje.trim() ? { message: mensaje.trim() } : {}),
          ...(conCodigo ? { mfaCode: codigoMfa } : {}),
        },
        clave.current,
      ).catch((fallo: unknown) => {
        // Un 403 que pide el código, entre otros: se vuelve a leer el estado.
        void releerMfa();
        // El código pudo haberse usado aunque la compra fallara: sirve una sola vez.
        if (conCodigo) {
          setCodigoMfa("");
          throw new Error(
            `${fallo instanceof Error ? fallo.message : "No se pudo comprar"}. Para reintentar, escribí un código nuevo.`,
          );
        }
        throw fallo;
      });
      clave.current = nuevaClave();
      setRecien(card);
      setEmail("");
      setMensaje("");
      setCodigoMfa("");
      return `Compraste una tarjeta de ${money.format(card.amount)}`;
    });
  };

  const canjear = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void hacer("canjear", async () => {
      const { card } = await redeemGiftCardCode(codigoCanje.trim());
      setCodigoCanje("");
      return `Listo: sumaste ${money.format(card.amount)} a tu Flash Wallet`;
    });
  };

  const copiar = (codigo: string) => {
    void navigator.clipboard
      ?.writeText(codigo)
      .then(() => setAviso({ texto: "Código copiado", error: false }))
      .catch(() => setAviso({ texto: "No se pudo copiar el código", error: true }));
  };
  const compartir = (card: GiftCard) => {
    if (!card.code) return;
    const texto = `Te regalo ${money.format(card.amount)} para usar en Flash. Canjealo en la Wallet con el código ${card.code}`;
    if (navigator.share) void navigator.share({ text: texto }).catch(() => undefined);
    else copiar(card.code);
  };

  return (
    <section className="gift-cards" aria-labelledby="gift-cards-title">
      <header>
        <Gift size={20} aria-hidden="true" />
        <div>
          <strong id="gift-cards-title">Tarjetas de regalo</strong>
          <p>
            Regalá saldo de Flash para pedidos, viajes y envíos. No vence y no se cambia por dinero.
          </p>
        </div>
      </header>

      {fallo && (
        <p role="alert">
          No pudimos leer tus tarjetas de regalo.{" "}
          <button type="button" className="secondary" onClick={() => void cargar()}>
            Reintentar
          </button>
        </p>
      )}

      {recibidas.map((tarjeta) => (
        <article key={tarjeta.id} className="gift-card gift-card-received">
          <div>
            <strong>
              {tarjeta.fromName} te regaló {money.format(tarjeta.amount)}
            </strong>
            {tarjeta.message && <q>{tarjeta.message}</q>}
          </div>
          <button
            type="button"
            disabled={ocupado === tarjeta.id}
            onClick={() =>
              void hacer(tarjeta.id, async () => {
                const { card } = await claimGiftCard(tarjeta.id);
                return `Listo: sumaste ${money.format(card.amount)} a tu Flash Wallet`;
              })
            }
          >
            Canjear
          </button>
        </article>
      ))}

      <form className="gift-cards-redeem" onSubmit={canjear}>
        <label htmlFor="gift-card-code">¿Te regalaron un código?</label>
        <div>
          <input
            id="gift-card-code"
            value={codigoCanje}
            onChange={(event) => setCodigoCanje(event.target.value.toUpperCase())}
            placeholder="ABCD-EFGH-JKLM-NPQR"
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
          />
          <button type="submit" disabled={!codigoCanje.trim() || ocupado === "canjear"}>
            Canjear
          </button>
        </div>
      </form>

      <form className="gift-cards-buy" onSubmit={comprar}>
        <strong>Regalar una tarjeta</strong>
        <div className="gift-cards-amounts" role="group" aria-label="Importe sugerido">
          {SUGERIDOS.map((sugerido) => (
            <button
              type="button"
              key={sugerido}
              className={importe === sugerido ? "" : "secondary"}
              aria-pressed={importe === sugerido}
              onClick={() => setMonto(String(sugerido))}
            >
              {money.format(sugerido)}
            </button>
          ))}
        </div>
        <label>
          Importe
          <input
            type="number"
            inputMode="numeric"
            min={MINIMO}
            step={1}
            value={monto}
            onChange={(event) => setMonto(event.target.value)}
          />
        </label>
        <label>
          Email de quien la recibe (opcional)
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Si tiene cuenta Flash, le aparece en su Wallet"
            maxLength={254}
          />
        </label>
        <label>
          Mensaje (opcional)
          <input
            value={mensaje}
            onChange={(event) => setMensaje(event.target.value)}
            maxLength={140}
            placeholder="¡Feliz cumple!"
          />
        </label>
        {conMfa !== false && (
          <label>
            {conMfa
              ? "Código de tu app autenticadora"
              : "Código de tu app autenticadora, si la usás"}
            <input
              value={codigoMfa}
              onChange={(event) => setCodigoMfa(event.target.value.replace(/\s/g, ""))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={32}
            />
          </label>
        )}
        {importeValido && !alcanza && (
          <small role="status">Tu saldo es {money.format(wallet)}: cargá la Wallet primero.</small>
        )}
        <button
          type="submit"
          disabled={!alcanza || ocupado === "comprar" || (conMfa === true && !codigoMfa)}
        >
          {importeValido
            ? `Comprar por ${money.format(importe)}`
            : `Mínimo ${money.format(MINIMO)}`}
        </button>
      </form>

      {recien?.code && (
        <div className="gift-card-new" role="status">
          <span>Tu tarjeta de {money.format(recien.amount)}</span>
          <code>{recien.code}</code>
          <div className="gift-card-actions">
            <button type="button" onClick={() => compartir(recien)}>
              <Share2 size={15} aria-hidden="true" /> Compartir
            </button>
            <button type="button" className="secondary" onClick={() => copiar(recien.code!)}>
              <Copy size={15} aria-hidden="true" /> Copiar
            </button>
          </div>
        </div>
      )}

      {aviso && <p role={aviso.error ? "alert" : "status"}>{aviso.texto}</p>}

      {compradas.length > 0 && (
        <div className="gift-cards-list">
          <strong>Las que regalaste</strong>
          {compradas.map((tarjeta) => (
            <article key={tarjeta.id} className="gift-card">
              <div>
                <strong>{money.format(tarjeta.amount)}</strong>
                <span className={`gift-card-status gift-card-${tarjeta.status}`}>
                  {estadoTexto[tarjeta.status]}
                </span>
                <small>
                  {tarjeta.recipientEmail ? `Para ${tarjeta.recipientEmail} · ` : ""}
                  {new Date(tarjeta.createdAt).toLocaleDateString("es-AR")}
                  {tarjeta.code ? "" : ` · termina en ${tarjeta.last4}`}
                </small>
                {tarjeta.code && <code>{tarjeta.code}</code>}
              </div>
              {tarjeta.status === "active" && tarjeta.code && (
                <div className="gift-card-actions">
                  <button type="button" className="secondary" onClick={() => compartir(tarjeta)}>
                    Compartir
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={ocupado === tarjeta.id}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `¿Anular la tarjeta de ${money.format(tarjeta.amount)}? El código deja de servir y el importe vuelve a tu Wallet.`,
                        )
                      )
                        return;
                      void hacer(tarjeta.id, async () => {
                        await cancelGiftCard(tarjeta.id);
                        if (recien?.id === tarjeta.id) setRecien(null);
                        return `Anulada: ${money.format(tarjeta.amount)} volvieron a tu Wallet`;
                      });
                    }}
                  >
                    Anular
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
