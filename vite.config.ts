import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Production ships only the home page (the ink site). Prototypes stay reachable in `npm run dev`.
const pages = ['index'];

export default defineConfig({
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `${p}.html`)])),
    },
  },
});
