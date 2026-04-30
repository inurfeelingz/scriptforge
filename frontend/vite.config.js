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
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Split vendor chunks for better caching
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React core — tiny, cache forever
            if (id.includes('react-dom') || id.includes('react/')) return 'react'
            // Router
            if (id.includes('react-router')) return 'router'
            // Lucide icons — large, rarely changes
            if (id.includes('lucide-react')) return 'icons'
            // Supabase
            if (id.includes('@supabase')) return 'supabase'
            // Anthropic SDK
            if (id.includes('@anthropic')) return 'anthropic'
            // Everything else vendor
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