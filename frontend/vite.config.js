import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
    cssCodeSplit: true,
  },

  worker: {
    format: 'es',
  },

  // Only pre-bundle what's actually used — exclude the dead ML worker
  optimizeDeps: {
    exclude: ['@xenova/transformers', '@tensorflow/tfjs'],
  },
})