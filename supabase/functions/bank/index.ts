// Edge Function `bank`: conexión con Enable Banking y sincronización diaria.
// El código vive en src/server (comprobado y probado con la app); `npm run build:functions`
// lo empaqueta en supabase/functions/bank/dist/index.js, que es lo que se despliega.
import { makeHandler } from '../../../src/server/http';

declare const Deno: { env: { get(name: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };

Deno.serve(makeHandler(Deno.env));
