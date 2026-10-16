import js from '@eslint/js'
import globals from 'globals'
// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook'

import tsPlugin from '@typescript-eslint/eslint-plugin'
import unusedImports from 'eslint-plugin-unused-imports'
import reactHooks from 'eslint-plugin-react-hooks'

// Generated artifacts and the Leyline submodule stay outside the lint surface.
const ignored = [
  'leyline/**',
  'node_modules/**',
  'dist/**',
  'dist-browser/**',
  'dist-ssr/**',
  'server/build/**',
  'card-presentation/build/**',
  'browser-engine/build/**',
  'public/browser-engine/**',
  'test-results/**',
  'playwright-report/**',
  'storybook-static/**',
  'src/engine/generated/**',
  'src/shared/api/types.ts',
  '**/*.module.css.d.ts',
]

const authored = ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}']

export default [
  { ignores: ignored },
  {
    files: [
      'eslint.config.js',
      '*.config.{js,mjs,cjs}',
      'scripts/**/*.{js,mjs,cjs}',
      'tools/**/*.{js,mjs,cjs}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['browser-engine/web/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.worker,
        // Injected by the CheerpJ loader script.
        cheerpjInit: 'readonly',
        cheerpjRunLibrary: 'readonly',
        cheerpOSAddStringFile: 'readonly',
        cheerpOSRemoveStringFile: 'readonly',
      },
    },
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    files: authored,
    plugins: { 'unused-imports': unusedImports },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Explicit `any` cleanup is a later ratchet.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      curly: 'error',
      // `== null` intentionally matches `undefined`; keep that idiom.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Type-aware correctness rules run only where the parser can resolve a
    // project: the app, the end-to-end suite, and the browser driver each have
    // their own tsconfig.
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts', 'tools/browser-driver/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
    },
  },
  {
    // Only the two classic hook rules. The plugin's `recommended` set also
    // carries the React Compiler rules, which are a separate decision — this app
    // does not run the compiler.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  ...storybook.configs['flat/recommended'],
]
