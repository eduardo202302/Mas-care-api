import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config({ ignores: ['dist/**', 'node_modules/**', 'coverage/**'] }, js.configs.recommended, ...ts.configs.recommended, {
  files: ['**/*.ts'],
  languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  rules: { '@typescript-eslint/no-explicit-any': 'error' },
});
