# Cuentas Personales v2

App de finanzas personales (PWA instalable en el móvil): movimientos, cuentas, presupuesto por categorías o por objetivo de ahorro, informes, pagos programados, importación/conciliación de extractos bancarios (CSV, Excel, Norma 43, OFX) y hogar compartido (varias personas, mismos datos, en tiempo real).

Stack: React + TypeScript + Vite · Supabase (auth + Postgres con RLS) · Cloudflare Pages. Sin Supabase configurado funciona en modo local (datos en el navegador).

## Puesta en marcha

1. **Supabase**: ejecuta en orden los ficheros de `supabase/migrations/` (ya aplicados en el proyecto actual).
2. **Cloudflare Pages**: Workers & Pages → Create → Pages → Connect to Git → este repositorio. Preset «React (Vite)» (build `npm run build`, salida `dist`). Las variables públicas de Supabase ya están en `.env.production`; opcionalmente añade `VITE_ADMIN_EMAIL` para gestionar la sección Formación.
3. **Supabase → Authentication → URL Configuration**: *Site URL* = la dirección de Cloudflare (`https://<proyecto>.pages.dev`) y añádela también en *Redirect URLs* como `https://<proyecto>.pages.dev/**` (enlaces de confirmación y recuperación de contraseña).
4. **Local**: `npm install && npm run dev` · tests: `npm test`.

## Conexión bancaria (Enable Banking)

Sincronización diaria de movimientos y saldos con conciliación automática (función `bank` de Supabase + tarea `bank-sync-daily`).

1. En [enablebanking.com](https://enablebanking.com) → Control Panel → *API applications* → registra una aplicación de **producción** con la URL de retorno `https://finanzas-personales-4yj.pages.dev/banco` y descarga la clave privada (`.pem`).
2. Actívala en modo restringido (gratuito) vinculando las cuentas de cada persona (*Activate by linking accounts*).
3. En Supabase → Edge Functions → Secrets añade `ENABLE_BANKING_APP_ID` y `ENABLE_BANKING_PRIVATE_KEY` (contenido del `.pem`).
4. En la app: Ajustes → Bancos conectados → Conectar un banco.

Código: la lógica está en `src/server` y `src/domain/bankSync.ts`; `npm run build:functions` la empaqueta en `supabase/functions/bank/dist/bank.js`, que la función desplegada importa fijada a un commit.
