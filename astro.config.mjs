import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://proterra-signal.pages.dev",
  output: "static",
  trailingSlash: "never"
});
