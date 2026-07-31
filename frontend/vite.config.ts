// Vite configuration for the Musical Chairs web UI.
//
// Dev server (`command === "serve"`): serves the `web/` SPA under
// `base: "/__/frontend/"`; Envoy (started by `rbt dev run`) proxies
// that prefix to this dev server for HMR.
//
// Build (`RBT_BUILD_TARGET=web`, set by `build.mjs`): builds the SPA
// into `dist/web/` for `rbt dev run --config=dist`.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";

// Redirect `/__/frontend/web` -> `/__/frontend/web/` so the SPA loads
// with or without the trailing slash (mirrors dist-mode serving).
function redirectFrontendDirTrailingSlash(root: string): Plugin {
  const prefix = "/__/frontend/";
  return {
    name: "reboot-frontend-dir-trailing-slash",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const queryAt = url.indexOf("?");
        const pathname = queryAt === -1 ? url : url.slice(0, queryAt);
        if (pathname.startsWith(prefix) && !pathname.endsWith("/")) {
          const subpath = pathname.slice(prefix.length);
          if (fs.existsSync(path.join(root, subpath, "index.html"))) {
            const query = queryAt === -1 ? "" : url.slice(queryAt);
            res.statusCode = 302;
            res.setHeader("Location", `${pathname}/${query}`);
            res.end();
            return;
          }
        }
        next();
      });
    },
  };
}

// Treat the `web/` SPA as the dev server's home page.
function serveWebAppAtRoot(root: string): Plugin {
  const webIndex = path.resolve(root, "web", "index.html");
  const target = "/__/frontend/web/";
  const homes = new Set(["/", "/__/frontend", "/__/frontend/"]);
  return {
    name: "reboot-serve-web-app-at-root",
    configureServer(server) {
      if (!fs.existsSync(webIndex)) return;
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const queryAt = url.indexOf("?");
        const pathname = queryAt === -1 ? url : url.slice(0, queryAt);
        if (homes.has(pathname)) {
          const query = queryAt === -1 ? "" : url.slice(queryAt);
          res.statusCode = 302;
          res.setHeader("Location", target + query);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

// Path alias for API imports (`@api/...` -> `./api/...`).
const resolve = {
  alias: {
    "@api": path.resolve(__dirname, "./api"),
  },
  dedupe: ["react", "react-dom"],
};

export default defineConfig(({ command }) => {
  if (command === "serve") {
    const port = parseInt(process.env.RBT_VITE_PORT || "4444", 10);
    return {
      plugins: [
        react(),
        tailwindcss(),
        redirectFrontendDirTrailingSlash(__dirname),
        serveWebAppAtRoot(__dirname),
      ],
      root: ".",
      envDir: path.resolve(__dirname, "web"),
      resolve,
      base: "/__/frontend/",
      server: {
        port,
        strictPort: true,
        host: true,
        allowedHosts: true,
      },
    };
  }

  return {
    plugins: [react(), tailwindcss()],
    root: path.resolve(__dirname, "web"),
    base: "/__/frontend/web/",
    build: {
      outDir: path.resolve(__dirname, "dist/web"),
      emptyOutDir: true,
    },
    resolve,
  };
});
