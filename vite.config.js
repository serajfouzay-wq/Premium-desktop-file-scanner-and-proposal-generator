import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * One bundle, two destinations.
 *
 * Electron loads the built files over file://, where every asset reference has
 * to be relative. A web host serves them over http, where a relative base
 * breaks on any nested route. ELECTRON_BUILD picks the right one; the web
 * default applies everywhere else, including Vercel.
 */
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: process.env.ELECTRON_BUILD ? './' : '/',
  server: { port: 5273, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: false,
  },
  define: {
    __BUILD_TARGET__: JSON.stringify(process.env.ELECTRON_BUILD ? 'desktop' : 'web'),
  },
}));
