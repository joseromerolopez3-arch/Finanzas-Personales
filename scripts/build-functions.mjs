import { build } from 'esbuild';

// Bundles the server logic of the `bank` Edge Function (no imports: supabase-js is injected).
await build({
  entryPoints: ['src/server/http.ts'],
  outfile: 'supabase/functions/bank/dist/bank.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  banner: { js: '// Generado por scripts/build-functions.mjs a partir de src/server — no editar a mano.' }
});
console.log('bank function bundled');
