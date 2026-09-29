# Cuentas Personales v2

App de finanzas personales (PWA instalable en el móvil): movimientos, cuentas, presupuesto por categorías o por objetivo de ahorro, informes, pagos programados, importación/conciliación de extractos bancarios (CSV, Excel, Norma 43, OFX) y hogar compartido (varias personas, mismos datos, en tiempo real).

Stack: React + TypeScript + Vite · Supabase (auth + Postgres con RLS) · Cloudflare Pages. Sin Supabase configurado funciona en modo local (datos en el navegador).

## Puesta en marcha

1. **Supabase**: ejecuta en orden los ficheros de `supabase/migrations/` (ya aplicados en el proyecto actual).
2. **Cloudflare Pages**: Workers & Pages → Create → Pages → Connect to Git → este repositorio. Preset «React (Vite)» (build `npm run build`, salida `dist`). Las variables públicas de Supabase ya están en `.env.production`; opcionalmente añade `VITE_ADMIN_EMAIL` para gestionar la sección Formación.
3. **Supabase → Authentication → URL Configuration**: *Site URL* = la dirección de Cloudflare (`https://<proyecto>.pages.dev`) y añádela también en *Redirect URLs* como `https://<proyecto>.pages.dev/**` (enlaces de confirmación y recuperación de contraseña).
4. **Local**: `npm install && npm run dev` · tests: `npm test`.

## Pendiente
- Conexión bancaria automática con Enable Banking (modo gratuito de uso personal): sincronización diaria mediante una Edge Function de Supabase, reutilizando la conciliación actual.
