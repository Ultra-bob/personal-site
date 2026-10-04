import { defineConfig } from "astro/config";
import { visualizer } from "rollup-plugin-visualizer";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

const visualize = process.env.ANALYZE_BUNDLE === "true";

export default defineConfig({
  site: "https://ultrablob.me",
  build: {
    // New URLs avoid Cloudflare's cached responses from before no-transform.
    assets: "_astro-br",
  },
  vite: {
    plugins: [
      ...(visualize
        ? [
            visualizer({
              emitFile: true,
              filename: "stats.html",
              template: "sunburst",
            }),
          ]
        : []),
      tailwindcss(),
    ],
  },
  integrations: [sitemap()],
});
