import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { SITE } from "./src/consts.ts";

export default defineConfig({
  site: SITE.url,
  output: "static",
  integrations: [sitemap()],
  build: {
    // Inline small stylesheets so the first paint costs no extra round trip.
    inlineStylesheets: "auto",
  },
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
});
