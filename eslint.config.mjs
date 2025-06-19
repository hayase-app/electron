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
    }
  }
)
