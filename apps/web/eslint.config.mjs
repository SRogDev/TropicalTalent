import js from '@eslint/js';
import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,

  {
    // .mjs included: previously only *.js/.jsx/.ts/.tsx got the globals
    // block below. That never surfaced because the project's only .mjs
    // files were named *.config.mjs and excluded by the ignores block at
    // the bottom of this file. scripts/verify.mjs and migrations/apply.mjs
    // are plain scripts, not config files, so without this they'd fall
    // through to bare `js.configs.recommended` with no Node globals
    // declared — every `process`, `fetch`, `console` read flagged as
    // no-undef.
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'writable',
        require: 'readonly',
        global: 'readonly',
        window: 'readonly',
        document: 'readonly',
        Element: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        React: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        NodeJS: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        Notification: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        CustomEvent: 'readonly',
        importScripts: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      // Prettier rules
      'prettier/prettier': ['warn'],

      // Basic JS/TS rules
      'no-unused-vars': 'off', // Turn off base rule
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',
      'no-undef': 'warn',

      // Next.js specific
      'react/react-in-jsx-scope': 'off',
    },
  },

  // Test files configuration
  {
    files: [
      '**/__tests__/**/*.{js,jsx,ts,tsx}',
      '**/*.test.{js,jsx,ts,tsx}',
      '**/*.spec.{js,jsx,ts,tsx}',
      'cypress/**/*.{js,jsx,ts,tsx}',
    ],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        cy: 'readonly',
        Cypress: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Prettier config (should be last to override other formatting rules)
  prettierConfig,

  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      '*.config.js',
      '*.config.mjs',
      'jest.setup.js',
      'jest.config.js',
      '**/*.d.ts',
    ],
  },
];
