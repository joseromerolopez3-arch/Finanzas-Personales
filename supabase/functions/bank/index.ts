// Edge Function `bank`: conexión con Enable Banking y sincronización diaria.
// La lógica vive en src/server (comprobada y probada con la app). `npm run build:functions`
// la empaqueta en dist/bank.js. Al desplegar, este import apunta a ese fichero en GitHub
// fijado a un commit (ver README).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeHandler } from './dist/bank.js';

declare const Deno: { env: { get(name: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };

Deno.serve(makeHandler(Deno.env, createClient));
