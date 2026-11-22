import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['main.js', 'node_modules/**', 'dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Use React rendering or Obsidian DOM APIs instead of innerHTML.',
        },
        {
          property: 'outerHTML',
          message: 'Use React rendering or Obsidian DOM APIs instead of outerHTML.',
        },
        {
          property: 'insertAdjacentHTML',
          message: 'Use React rendering or Obsidian DOM APIs instead of insertAdjacentHTML.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message: 'dangerouslySetInnerHTML is forbidden for XSS safety.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
