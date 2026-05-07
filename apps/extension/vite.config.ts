import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  plugins: [react(), webExtension()],
  server: {
    host: "127.0.0.1",
    port: 5174
  }
});
