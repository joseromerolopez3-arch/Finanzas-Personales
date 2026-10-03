import { build } from 'esbuild';

await build({
  entryPoints: ['supabase/functions/bank/index.ts'],
  outfile: 'supabase/functions/bank/dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['deno', 'worker', 'browser'],
  minify: true,
  legalComments: 'none',
  banner: { js: '// Generado por scripts/build-functions.mjs — no editar a mano.' }
});
console.log('bank function bundled');
