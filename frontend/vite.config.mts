import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { resolve } from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

let devProxyServer = "http://localhost:8787";
if (process.env.DEV_PROXY_SERVER && process.env.DEV_PROXY_SERVER.length > 0) {
  console.log("Use devProxyServer from environment: ", process.env.DEV_PROXY_SERVER);
  devProxyServer = process.env.DEV_PROXY_SERVER;
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    codeInspectorPlugin({
      bundler: "vite",
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "^/api": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/memos.api.v1": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/file": {
        target: devProxyServer,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/": `${resolve(__dirname, "src")}/`,
    },
  },
  // NOTE: this used to use the object form of manualChunks to pin mermaid /
  // katex / leaflet into named vendor chunks. That defeated code splitting:
  // those chunks were emitted as STATIC imports of the entry and got
  // modulepreloaded on every page view, even for visitors whose memos contain
  // no math, no diagram and no location (~230kB gzip wasted on first load).
  // Leaving this unset lets Rollup keep dynamically imported libraries
  // (mermaid via MermaidBlock, katex via Math) in true on-demand chunks.
  build: {
    rollupOptions: {
      output: {
        // Still group large, always-used frameworks so they can be cached
        // separately from app code across deploys.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(@mui|@emotion)\//.test(id)) return "mui-vendor";
          if (/node_modules\/(dayjs|lodash-es)\//.test(id)) return "utils-vendor";
        },
      },
    },
  },
});
