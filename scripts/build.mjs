import { build } from 'esbuild';
import { builtinModules } from 'node:module';

await build({
  entryPoints: ['src/worker.mjs'], outfile: 'dist/worker.mjs',
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  external: ['cloudflare:*', 'node:*', ...builtinModules],
  conditions: ['workerd', 'worker', 'browser'],
  minify: true, sourcemap: 'external',
});
