# @dashframe/eslint-config

Shared ESLint 9 flat configuration for DashFrame packages.

## Installation

This package is internal to the monorepo. It's used via workspace dependency:

```json
{
  "devDependencies": {
    "@dashframe/eslint-config": "workspace:*"
  }
}
```

## Overview

This package provides a shared ESLint 9 flat config that includes:

- **TypeScript ESLint** - TypeScript-aware linting
- **SonarJS** - Bug detection and code quality
- **Prettier** - Disables formatting rules (Prettier handles formatting)
- **Custom rules** - Unused variable handling with underscore prefix support

## Usage

In your package's `eslint.config.js` or `eslint.config.mjs`:

```javascript
import sharedConfig from "@dashframe/eslint-config";

export default [
  ...sharedConfig,
  // Add package-specific rules here
];
```

## Included Configurations

```javascript
// Composed from:
tseslint.configs.recommended,  // TypeScript ESLint recommended rules
sonarjs.configs.recommended,   // SonarJS bug detection
prettierConfig,                // Disable formatting rules (conflicts with Prettier)
```

## Custom Rules

### Unused Variables

Configured to allow underscore-prefixed unused variables:

```javascript
"@typescript-eslint/no-unused-vars": [
  "warn",
  {
    ignoreRestSiblings: true,     // Allow { used, ...rest }
    varsIgnorePattern: "^_",       // Allow _unusedVar
    argsIgnorePattern: "^_",       // Allow function(_unused) {}
    caughtErrorsIgnorePattern: "^_", // Allow catch(_error) {}
  },
]
```

## Global Ignores

Pre-configured to ignore common build output directories:

```javascript
globalIgnores([
  "node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "apps/web/next-env.d.ts",
]);
```

## Exports

```javascript
// Default export: full flat config array
export default sharedConfig;

// Named export: just the rules (for extension)
export const sharedRules = {
  "@typescript-eslint/no-unused-vars": [...],
};
```

## Peer Dependencies

| Package                | Version  |
| ---------------------- | -------- |
| eslint                 | >=9.39.0 |
| eslint-config-prettier | >=10.0.0 |
| eslint-plugin-sonarjs  | >=3.0.0  |
| typescript-eslint      | >=8.0.0  |

## See Also

- [ESLint 9 Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files)
- [TypeScript ESLint](https://typescript-eslint.io/)
- [SonarJS](https://github.com/SonarSource/eslint-plugin-sonarjs)
