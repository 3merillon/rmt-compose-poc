import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'RMT Compose',
  description: 'Documentation for Relative Music Theory Compose - A ratio-based music composition tool',

  // Ignore dead links during development (some pages are planned but not yet created)
  ignoreDeadLinks: true,

  // Sitemap for Google indexing
  sitemap: {
    hostname: 'https://docs.rmt.world'
  },

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['link', { rel: 'canonical', href: 'https://docs.rmt.world/' }],
    ['meta', { property: 'og:title', content: 'RMT Compose Documentation' }],
    ['meta', { property: 'og:description', content: 'Learn to compose music using exact ratios and relative music theory' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: 'https://docs.rmt.world/' }],
    ['meta', { property: 'og:image', content: 'https://docs.rmt.world/screenshot.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'RMT Compose Documentation' }],
    ['meta', { name: 'twitter:description', content: 'Learn to compose music using exact ratios and relative music theory' }],
    ['meta', { name: 'twitter:image', content: 'https://docs.rmt.world/screenshot.png' }],
  ],

  themeConfig: {
    //logo: '/logo.svg',
    siteTitle: 'RMT Compose',

    nav: [
      { text: 'Guide', link: '/getting-started/' },
      { text: 'User Guide', link: '/user-guide/' },
      { text: 'Tutorials', link: '/tutorials/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Developer', link: '/developer/' },
      { text: 'App', link: 'https://rmt.world', target: '_blank' },
      { text: '❤️ Donate', link: 'https://buy.stripe.com/7sYeV7aW70eG75I9N6bAs00', target: '_blank' }
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/getting-started/' },
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'First Composition', link: '/getting-started/first-composition' },
            { text: 'Core Concepts', link: '/getting-started/concepts' }
          ]
        }
      ],
      '/user-guide/': [
        {
          text: 'Interface',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/user-guide/' },
            { text: 'Workspace', link: '/user-guide/interface/workspace' },
            { text: 'Module Bar', link: '/user-guide/interface/module-bar' },
            { text: 'Top Bar', link: '/user-guide/interface/top-bar' },
            { text: 'Variable Widget', link: '/user-guide/interface/variable-widget' },
            { text: 'Keyboard Shortcuts', link: '/user-guide/interface/keyboard-shortcuts' }
          ]
        },
        {
          text: 'Working with Notes',
          collapsed: false,
          items: [
            { text: 'Creating Notes', link: '/user-guide/notes/creating-notes' },
            { text: 'Editing Notes', link: '/user-guide/notes/editing-notes' },
            { text: 'Expressions', link: '/user-guide/notes/expressions' },
            { text: 'Dependencies', link: '/user-guide/notes/dependencies' }
          ]
        },
        {
          text: 'Tuning Systems',
          collapsed: false,
          items: [
            { text: 'Pure Ratios', link: '/user-guide/tuning/ratios' },
            { text: 'Equal Temperament', link: '/user-guide/tuning/equal-temperament' },
            { text: '12-TET', link: '/user-guide/tuning/12-tet' },
            { text: '19-TET', link: '/user-guide/tuning/19-tet' },
            { text: '31-TET', link: '/user-guide/tuning/31-tet' },
            { text: 'Bohlen-Pierce', link: '/user-guide/tuning/bohlen-pierce' },
            { text: 'Custom TET', link: '/user-guide/tuning/custom-tet' }
          ]
        },
        {
          text: 'Modules',
          collapsed: false,
          items: [
            { text: 'Loading Modules', link: '/user-guide/modules/loading-modules' },
            { text: 'Saving Modules', link: '/user-guide/modules/saving-modules' },
            { text: 'Creating Modules', link: '/user-guide/modules/creating-modules' },
            { text: 'Module Format', link: '/user-guide/modules/module-format' }
          ]
        },
        {
          text: 'Playback',
          collapsed: false,
          items: [
            { text: 'Transport Controls', link: '/user-guide/playback/transport' },
            { text: 'Playhead Tracking', link: '/user-guide/playback/tracking' },
            { text: 'Instruments', link: '/user-guide/playback/instruments' }
          ]
        }
      ],
      '/tutorials/': [
        {
          text: 'Beginner',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/tutorials/' },
            { text: 'Build a Major Scale', link: '/tutorials/beginner/major-scale' },
            { text: 'Create a Major Triad', link: '/tutorials/beginner/major-triad' },
            { text: 'Add Rhythm', link: '/tutorials/beginner/rhythm' }
          ]
        },
        {
          text: 'Intermediate',
          collapsed: false,
          items: [
            { text: 'Note Dependencies', link: '/tutorials/intermediate/dependencies' },
            { text: 'Octave Manipulation', link: '/tutorials/intermediate/octaves' },
            { text: 'Working with Measures', link: '/tutorials/intermediate/measures' }
          ]
        },
        {
          text: 'Advanced',
          collapsed: false,
          items: [
            { text: 'Microtonal Composition', link: '/tutorials/advanced/microtonal' },
            { text: 'Understanding SymbolicPower', link: '/tutorials/advanced/symbolic-power' },
            { text: 'Complex Dependencies', link: '/tutorials/advanced/complex-dependencies' }
          ]
        },
        {
          text: 'Workflows',
          collapsed: false,
          items: [
            { text: 'Building a Module Library', link: '/tutorials/workflows/module-library' },
            { text: 'Exploring Intervals', link: '/tutorials/workflows/intervals' },
            { text: 'Microtonal Experiments', link: '/tutorials/workflows/microtonal-experiments' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Expression Language',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'Syntax', link: '/reference/expressions/syntax' },
            { text: 'Fraction API', link: '/reference/expressions/fraction-api' },
            { text: 'Module API', link: '/reference/expressions/module-api' },
            { text: 'Operators', link: '/reference/expressions/operators' }
          ]
        },
        {
          text: 'Note Properties',
          collapsed: false,
          items: [
            { text: 'frequency', link: '/reference/properties/frequency' },
            { text: 'startTime', link: '/reference/properties/start-time' },
            { text: 'duration', link: '/reference/properties/duration' },
            { text: 'tempo', link: '/reference/properties/tempo' },
            { text: 'beatsPerMeasure', link: '/reference/properties/beats-per-measure' }
          ]
        },
        {
          text: 'Other',
          collapsed: false,
          items: [
            { text: 'Module JSON Schema', link: '/reference/module-schema' },
            { text: 'Glossary', link: '/reference/glossary' }
          ]
        }
      ],
      '/developer/': [
        {
          text: 'Architecture',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/developer/' },
            { text: 'System Architecture', link: '/developer/architecture/overview' },
            { text: 'Data Flow', link: '/developer/architecture/data-flow' },
            { text: 'Module System', link: '/developer/architecture/module-system' },
            { text: 'Rendering Pipeline', link: '/developer/architecture/rendering' }
          ]
        },
        {
          text: 'Core Systems',
          collapsed: false,
          items: [
            { text: 'Expression Compiler', link: '/developer/core/expression-compiler' },
            { text: 'Binary Evaluator', link: '/developer/core/binary-evaluator' },
            { text: 'Dependency Graph', link: '/developer/core/dependency-graph' },
            { text: 'SymbolicPower', link: '/developer/core/symbolic-power' }
          ]
        },
        {
          text: 'Rendering',
          collapsed: false,
          items: [
            { text: 'WebGL2 Renderer', link: '/developer/rendering/webgl2-renderer' },
            { text: 'Camera Controller', link: '/developer/rendering/camera-controller' },
            { text: 'GPU Picking', link: '/developer/rendering/picking' }
          ]
        },
        {
          text: 'Audio',
          collapsed: false,
          items: [
            { text: 'Audio Engine', link: '/developer/audio/audio-engine' },
            { text: 'Instruments', link: '/developer/audio/instruments' },
            { text: 'Streaming Scheduler', link: '/developer/audio/streaming' }
          ]
        },
        {
          text: 'WASM',
          collapsed: false,
          items: [
            { text: 'WASM Overview', link: '/developer/wasm/overview' },
            { text: 'Building WASM', link: '/developer/wasm/building' },
            { text: 'JS/WASM Adapters', link: '/developer/wasm/adapters' }
          ]
        },
        {
          text: 'API Reference',
          collapsed: false,
          items: [
            { text: 'Module Class', link: '/developer/api/module' },
            { text: 'Note Class', link: '/developer/api/note' },
            { text: 'BinaryExpression', link: '/developer/api/binary-expression' },
            { text: 'EventBus', link: '/developer/api/event-bus' }
          ]
        },
        {
          text: 'Contributing',
          collapsed: false,
          items: [
            { text: 'Development Setup', link: '/developer/contributing/setup' },
            { text: 'Code Style', link: '/developer/contributing/code-style' },
            { text: 'Pull Requests', link: '/developer/contributing/pull-requests' }
          ]
        }
      ]
    },

    search: {
      provider: 'local',
      options: {
        detailedView: true
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/3merillon/rmt-compose-poc' }
    ],

    footer: {
      message: 'Released under the RMT Personal Non-Commercial License',
      copyright: 'Copyright 2026-present Cyril Monkewitz'
    },

    editLink: {
      pattern: 'https://github.com/3merillon/rmt-compose-poc/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    }
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true
  },

  vite: {
    // Ensure proper resolution of Vue components
    resolve: {
      alias: {
        '@': '/docs/.vitepress/theme'
      }
    }
  }
})
