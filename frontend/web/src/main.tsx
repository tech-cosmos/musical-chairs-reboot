import { RebootClientProvider } from "@reboot-dev/reboot-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// The app is always served through the backend's proxy (Envoy), so the
// API lives at the page's own origin. This makes the same build work on
// localhost, a LAN IP (phones at the venue), or a tunnel — no env vars.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RebootClientProvider url={window.location.origin}>
      <App />
    </RebootClientProvider>
  </StrictMode>
);
