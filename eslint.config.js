import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        location: 'readonly',
        history: 'readonly',
        sessionStorage: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        matchMedia: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        CustomEvent: 'readonly',
        Image: 'readonly',
        Event: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        getComputedStyle: 'readonly',
        requestIdleCallback: 'readonly',
        cancelIdleCallback: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
      },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
    settings: { react: { version: '18.3' } },
  },
  {
    // Vercel serverless functions run in Node, not the browser — separate
    // globals from the src/ browser config above (rather than adding
    // process/require to the browser set, which would be wrong there).
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // PerfOverlay uses raw browser Performance APIs not needed anywhere
    // else in src/ — scope them here instead of widening the global
    // browser globals set above.
    files: ['src/perf/PerfOverlay.jsx'],
    languageOptions: {
      globals: {
        PerformanceObserver: 'readonly',
      },
    },
  },
  {
    // dotsEngine's text-scramble effect walks the DOM with a TreeWalker,
    // which needs the NodeFilter constant — likewise scoped rather than
    // added to the general browser globals.
    files: ['src/landing/dotsEngine.js'],
    languageOptions: {
      globals: {
        NodeFilter: 'readonly',
      },
    },
  },
];
