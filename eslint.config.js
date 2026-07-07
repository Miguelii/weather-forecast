import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends('airbnb-base', 'prettier'),
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-console':                'off',
      'no-restricted-syntax':      'off',
      'no-plusplus':               'off',
      'no-await-in-loop':          'warn',
      'func-names': 'off', // off because of effect-ts
      'no-underscore-dangle': 'off', // off because of effect-ts
      'max-classes-per-file': 'off',
      'import/extensions': ['error', 'ignorePackages', { js: 'always', ts: 'never' }],
      'import/prefer-default-export': 'off',
      '@typescript-eslint/no-explicit-any':       'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
];
