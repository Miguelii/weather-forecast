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
  // Carrega airbnb-base + desliga regras que conflituam com Prettier
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
      // TypeScript recommended por cima do airbnb-base
      ...tsPlugin.configs.recommended.rules,

      // Ajustes ao airbnb-base para este projecto Node.js + TypeScript
      'no-console':                'off',   // CLI — console é necessário
      'no-restricted-syntax':      'off',   // permite for...of
      'no-plusplus':               'off',
      'no-await-in-loop':          'warn',

      // Extensões obrigatórias nas importações ESM (.js)
      'import/extensions': ['error', 'ignorePackages', { js: 'always', ts: 'never' }],
      'import/prefer-default-export': 'off',

      // TypeScript-specific
      '@typescript-eslint/no-explicit-any':       'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
];
