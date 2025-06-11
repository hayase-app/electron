import tseslint from '@electron-toolkit/eslint-config-ts'
import config from 'eslint-config-standard-universal'
import _globals from 'globals'

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  ...config(_globals.node),
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      'svelte/html-self-closing': [
        'error',
        'all'
      ],
      'svelte/no-reactive-reassign': 'off',
      'no-undef-init': 'off',
      'import/order': ['error', {
        'newlines-between': 'always',
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type']
      }],
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
)
