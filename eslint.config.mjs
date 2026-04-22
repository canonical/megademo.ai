import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['public/js/lib/**', 'public/css/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // Browser scripts — add browser globals
  {
    files: ['public/js/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  // Jest test files — add Jest globals
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
];
