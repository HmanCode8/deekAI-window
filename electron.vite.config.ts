import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const sharedAlias = "@shared";
const sharedPath = resolve(__dirname, "src/shared");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { [sharedAlias]: sharedPath },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { [sharedAlias]: sharedPath },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        [sharedAlias]: sharedPath,
        "@renderer": resolve(__dirname, "src/renderer/src"),
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
  },
});
