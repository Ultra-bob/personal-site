import { defineConfig } from 'astro/config';
import { visualizer } from "rollup-plugin-visualizer";

import tailwindcss from "@tailwindcss/vite";

import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://ultrablob.me",

  vite: {
    plugins: [visualizer({
      emitFile: true,
      filename: "stats.html",
      template: "sunburst",
    }), tailwindcss()]
  },

  integrations: [sitemap()]
});