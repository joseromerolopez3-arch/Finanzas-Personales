# Cuentas Personales v2

App de finanzas personales (PWA instalable en el móvil): movimientos, cuentas, presupuesto por categorías o por objetivo de ahorro, informes, pagos programados, importación/conciliación de extractos bancarios (CSV, Excel, Norma 43, OFX) y hogar compartido (varias personas, mismos datos, en tiempo real).

Stack: React + TypeScript + Vite · Supabase (auth + Postgres con RLS) · Netlify. Sin Supabase configurado funciona en modo local (datos en el navegador).

## Puesta en marcha

1. **Supabase**: ejecuta en orden los ficheros de `supabase/migrations/` (ya aplicados en el proyecto actual).
2. **Netlify**: conecta este repositorio (build `npm run build`, carpeta `dist`, ya definido en `netlify.toml`). Las variables públicas de Supabase están en `.env.production`; opcionalmente añade `VITE_ADMIN_EMAIL` para gestionar la sección Formación.
3. **Local**: `npm install && npm run dev` · tests: `npm test`.

## Pendiente
- Conexión bancaria automática con Enable Banking (modo gratuito de uso personal): sincronización diaria mediante una Edge Function de Supabase, reutilizando la conciliación actual.
