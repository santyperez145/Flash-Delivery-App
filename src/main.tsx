import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { PublicRideTrackingPage } from "./App";
import "./styles.css";
import "./adaptive.css";

const publicTrackingToken = window.location.pathname.match(
  /^\/track\/([A-Za-z0-9_-]{40,64})$/,
)?.[1];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {publicTrackingToken ? (
      <PublicRideTrackingPage token={publicTrackingToken} />
    ) : (
      <App />
    )}
  </StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
