import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles/customer-food.css";
import "./styles/ride-mobility.css";
import "./styles/commerce-ops.css";
import "./styles/phone-stage.css";
import "./styles/admin-ops.css";
import "./styles/admin-shell.css";
import "./styles/merchant-desktop.css";
import "./styles/merchant-ops-detail.css";
import "./styles/foundation.css";
import "./styles/auth.css";
import "./styles/states.css";
import "./adaptive.css";

const publicTrackingToken = window.location.pathname.match(
  /^\/track\/([A-Za-z0-9_-]{40,64})$/,
)?.[1];
const PublicRideTrackingPage = lazy(() => import("./PublicRideTrackingPage"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {publicTrackingToken ? (
      <Suspense
        fallback={
          <main className="public-tracking-page">
            <section className="public-tracking-state">
              <strong>Cargando seguimiento</strong>
            </section>
          </main>
        }
      >
        <PublicRideTrackingPage token={publicTrackingToken} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
