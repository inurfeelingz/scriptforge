// frontend/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    headers: {
      // Required for SharedArrayBuffer used by Transformers.js ONNX runtime
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    // Transformers.js bundles are large — raise the warning threshold
    chunkSizeWarningLimit: 10000,
  },

  // ES module workers — enables `new Worker(new URL(...), { type: 'module' })`
  worker: {
    format: 'es',
  },

  // Don't pre-bundle Transformers.js — it uses dynamic imports internally
  optimizeDeps: {
    exclude: ['@xenova/transformers', '@tensorflow/tfjs'],
  },
})
