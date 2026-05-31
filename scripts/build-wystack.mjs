#!/usr/bin/env node
/**
 * build-wystack.mjs — builds the @wystack/* packages for use in DashFrame.
 *
 * The wystack submodule's packages ship source-first (no committed dists).
 * Their `build` scripts use `tsc` with configs that include test files, which
 * import `bun:test` — types that are only available under Bun's test runner,
 * not a plain `tsc` invocation. This script builds the subset of files DashFrame
 * needs (index + electron adapter) while excluding test files.
 *
 * Called from the DashFrame `setup` script and CI as a prerequisite to
 * `bun check`, ensuring the dists are present before turbo's `^build` chain
 * runs for `@dashframe/desktop` and `@dashframe/renderer`.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const WYSTACK = path.join(ROOT, 'libs/wystack');

const packages = [
  {
    name: '@wystack/transport',
    dir: path.join(WYSTACK, 'packages/transport'),
    include: [
      'src/index.ts',
      'src/loopback.ts',
      'src/pipe.ts',
      'src/protocol.ts',
      'src/typed.ts',
    ],
  },
  {
    name: '@wystack/server',
    dir: path.join(WYSTACK, 'packages/server'),
    include: ['src'],
    exclude: [
      'src/serve-bun.ts',
      'src/**/__tests__/**',
      'src/**/*.test.ts',
    ],
  },
  {
    name: '@wystack/client',
    dir: path.join(WYSTACK, 'packages/client'),
    include: ['src'],
    exclude: [
      'src/**/__tests__/**',
      'src/**/*.test.ts',
    ],
  },
];

const BASE_COMPILER_OPTIONS = {
  target: 'ES2022',
  lib: ['ES2022', 'DOM'],
  module: 'ESNext',
  moduleResolution: 'bundler',
  declaration: true,
  declarationMap: true,
  sourceMap: true,
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  resolveJsonModule: true,
  verbatimModuleSyntax: true,
  jsx: 'react-jsx',
};

for (const pkg of packages) {
  const distDir = path.join(pkg.dir, 'dist');
  if (existsSync(distDir)) {
    console.log(`[build-wystack] ${pkg.name}: dist already exists, skipping`);
    continue;
  }

  console.log(`[build-wystack] ${pkg.name}: building...`);

  const tsconfig = {
    compilerOptions: {
      ...BASE_COMPILER_OPTIONS,
      outDir: distDir,
      rootDir: path.join(pkg.dir, 'src'),
    },
    include: pkg.include.map(p => path.join(pkg.dir, p)),
    exclude: (pkg.exclude ?? []).map(p => path.join(pkg.dir, p)),
  };

  const tmpFile = path.join(ROOT, `tsconfig.wystack-build-${pkg.name.replace('/', '-')}.tmp.json`);
  writeFileSync(tmpFile, JSON.stringify(tsconfig, null, 2));

  try {
    execSync(`bun x tsc -p ${tmpFile}`, { stdio: 'inherit' });
    console.log(`[build-wystack] ${pkg.name}: done`);
  } catch (err) {
    console.error(`[build-wystack] ${pkg.name}: build failed`);
    process.exit(1);
  } finally {
    try { execSync(`rm -f ${tmpFile}`); } catch {}
  }
}

console.log('[build-wystack] all done');
