import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const mock = path.resolve("tests/browser/mock-firebase.ts");
export default defineConfig({
  plugins: [
    {
      name: "isolated-firebase-fixture",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          importer?.includes("/src/") &&
          (source === "./firebase" || source === "../firebase")
        )
          return mock;
      },
    },
    react(),
  ],
  resolve: {
    alias: [
      { find: /^firebase\/(auth|firestore)$/, replacement: mock },
      { find: /^react-firebase-hooks\/(auth|firestore)$/, replacement: mock },
    ],
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
