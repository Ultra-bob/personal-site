import { defineConfig } from 'astro/config';
import { visualizer } from "rollup-plugin-visualizer";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

const visualize = process.env.ANALYZE_BUNDLE === "true";

export default defineConfig({
  site: "https://ultrablob.me",
  vite: {
    plugins: [
      ...(visualize
        ? [visualizer({
            emitFile: true,
            filename: "stats.html",
            template: "sunburst",
          })]
        : []),
      tailwindcss(),
    ],
  },
  integrations: [sitemap()],
});