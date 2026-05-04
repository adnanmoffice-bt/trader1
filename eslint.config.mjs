// ESLint v9 flat config. Bridges legacy `eslint-config-next` shareable config
// via @eslint/eslintrc's FlatCompat. Keep minimal — `tsc --noEmit` is still the
// primary safety net; ESLint here only catches obvious React/Next anti-patterns.
import { FlatCompat } from '@eslint/eslintrc'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

export default [
  ...compat.extends('next/core-web-vitals'),
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'scripts/backtest-runs/**',
      'supabase/migrations/**',
      // Loose .mjs scripts use console + dynamic env shims; not worth linting.
      'scripts/**/*.mjs',
      'scripts/**/*.py',
    ],
  },
  {
    rules: {
      // Pragmatic relaxations — project uses `any` in agent outputs and inline
      // SVG/img elements; React entity warnings are noise in i18n strings.
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'off',
    },
  },
]
