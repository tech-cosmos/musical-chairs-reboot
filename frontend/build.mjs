// Builds the `web/` SPA into `dist/web/` (see `vite.config.ts`).
import { build } from "vite";

process.env.RBT_BUILD_TARGET = "web";
await build();
