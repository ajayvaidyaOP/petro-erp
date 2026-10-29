import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(frontendRoot, '..');

export default defineConfig(({ mode }) => {
  // Read root .env for the server-side proxy only. The browser API client uses
  // relative /api URLs, and Vite exposes no non-VITE_ variables to the bundle.
  const rootEnv = loadEnv(mode, repositoryRoot, '');
  const apiProxyTarget =
    process.env.PETROFLOW_API_URL || rootEnv.PETROFLOW_API_URL || 'http://127.0.0.1:4000';
  const hmrClientPort = process.env.PETROFLOW_HMR_CLIENT_PORT || rootEnv.PETROFLOW_HMR_CLIENT_PORT
    || (process.env.E2B_SANDBOX ? '443' : '');

  return {
    root: frontendRoot,
    envDir: repositoryRoot,
    plugins: [react()],
    resolve: {
      alias: {
        '@petroflow/shared': path.resolve(frontendRoot, '../backend/src/shared/index.ts'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: false,
          secure: false,
        },
      },
      // Preview traffic is proxied over HTTPS; ordinary localhost development
      // should use Vite's own port rather than trying to connect to port 443.
      hmr: hmrClientPort ? { clientPort: Number(hmrClientPort) } : undefined,
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: false,
          secure: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
    },
  };
});
