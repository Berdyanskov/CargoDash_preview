import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs in served HTML so the app works both at the root
  // (localhost / VS Code Tunnels' xxx-5173.devtunnels.ms subdomain) and
  // under a subpath proxy (code-server's xxx/<...>/proxy/5173/). Local
  // users see no difference: at the root, './foo' resolves the same as
  // '/foo'.
  base: "./",
  server: { port: 5173, host: true, allowedHosts: true },
  // Same knobs as `server` but for `npm run preview` (serves the built
  // dist/ as static files). On a subpath-proxy environment (code-server
  // etc.) you want preview, not dev, because vite dev injects internal
  // absolute-path scripts like /@vite/client that the proxy can't reach.
  preview: { port: 5173, host: true, allowedHosts: true },
});
