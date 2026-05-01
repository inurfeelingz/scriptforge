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
    target: 'es2020',        // modern browsers only — smaller output
    chunkSizeWarningLimit: 1000,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Split vendor chunks for better caching
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react/') || id.includes('react-router')) return 'react'
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('@supabase')) return 'supabase'
            if (id.includes('@anthropic')) return 'anthropic'
            return 'vendor'
          }
        },
      },
    },
  },

  worker: {
    format: 'es',
  },

  // Only pre-bundle what's actually used — exclude the dead ML worker
  optimizeDeps: {
    exclude: ['@xenova/transformers', '@tensorflow/tfjs'],
  },
})