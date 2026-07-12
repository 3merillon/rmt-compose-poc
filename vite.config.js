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
        // Phase 8: split the ~653KB entry monolith into independently-cacheable chunks.
        // Each split is a verified singleton-free leaf (no eventBus/app-state/settingsStore),
        // so eventBus/app-state/settingsStore stay coalesced in the single entry chunk — no
        // duplication. `id` is normalized to forward slashes for reliable matching on Windows.
        manualChunks(id) {
          const s = id.replace(/\\/g, '/');
          // Third-party (fraction.js) — effectively immutable, highest cache value.
          if (s.includes('/node_modules/')) return 'vendor';
          if (!s.includes('/src/')) return;
          // Renderer: ~490KB clean leaf (imports only renderer-config.js).
          if (s.includes('/renderer/webgl2/renderer.js') || s.includes('/renderer/webgl2/renderer-config.js')) return 'renderer';
          // DSL grammar/compiler + the bytecode foundation it shares with core. Bundling
          // binary-note/binary-utils here breaks the core<->dsl cross-chunk cycle.
          if (s.includes('/src/dsl/') || s.endsWith('/src/binary-note.js') || s.endsWith('/src/binary-utils.js')) return 'dsl';
          // Instruments: singleton-free leaf (synth + sample + multisample).
          if (s.includes('/src/instruments/')) return 'instruments';
          // Everything else (player.js, module.js, workspace, menu-bar, modals, engine,
          // singletons, audio, theme, settings-store) -> default entry chunk.
        }
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