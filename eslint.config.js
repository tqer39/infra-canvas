import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'artifacts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', performance: 'readonly', window: 'readonly', document: 'readonly', Blob: 'readonly', URL: 'readonly', FileReader: 'readonly', requestAnimationFrame: 'readonly', HTMLElement: 'readonly' } } }
);
