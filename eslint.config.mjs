import nx from '@nx/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SOURCES = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];

// the React preset of Nx, for the projects with React (their config puts it before this one, as the eslintrc did):
// of the recommended rules of react-hooks only the rules of hooks and the dependencies of effects, not those of
// the React Compiler it added in v6
const HOOKS_RULES = ['react-hooks/rules-of-hooks', 'react-hooks/exhaustive-deps'];
export const react = [
  ...nx.configs['flat/react'],
  {
    files: SOURCES,
    rules: Object.fromEntries(
      Object.keys(reactHooks.configs.recommended.rules)
        .filter((rule) => !HOOKS_RULES.includes(rule))
        .map((rule) => [rule, 'off'])
    ),
  },
];

export default [
  // the local builds of `netlify dev` (gitignored): ESLint 9 lints dot folders
  { ignores: ['**/.netlify'] },
  ...nx.configs['flat/base'],
  // every source: the recommended rules of typescript-eslint (its overrides of the core rules on TS files only)
  // and of imports
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: config.files ?? SOURCES })),
  // the plugin itself, as the React preset of Nx registers it (its flat configs carry copies of it)
  { ...importPlugin.flatConfigs.recommended, plugins: { import: importPlugin }, files: SOURCES },
  { ...importPlugin.flatConfigs.typescript, plugins: { import: importPlugin }, files: SOURCES },
  {
    files: SOURCES,
    rules: {
      'import/no-unresolved': 0,
      'import/order': 2,
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }],
        },
      ],
    },
  },
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.spec.js', '**/*.spec.jsx'],
    languageOptions: { globals: globals.jest },
  },
];
