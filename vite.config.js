import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    fs: {
      // Allow serving files from the rust/pkg directory
      allow: ['..']
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  publicDir: 'public',
  optimizeDeps: {
    // Don't pre-bundle the WASM module
    exclude: ['rmt-core']
  },
  // Handle WASM files properly
  assetsInclude: ['**/*.wasm']
});