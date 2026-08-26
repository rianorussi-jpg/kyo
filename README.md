# KYO Sushi — estructura separada

apps/
- cliente/ — app del cliente. No contiene Panel ni Modo Cocina.
- panel/ — administración, productos, categorías, horarios, pedidos y registros.
- cocina/ — pantalla operativa de cocina con Realtime y sonido.

Las tres apps usan el mismo proyecto de Supabase y las mismas variables:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

## Desarrollo desde la raíz
npm install
npm run dev:cliente
npm run dev:panel
npm run dev:cocina

## Vercel
Puedes crear tres proyectos de Vercel apuntando al mismo repositorio:
- Root Directory: apps/cliente
- Root Directory: apps/panel
- Root Directory: apps/cocina

Configura las mismas variables de Supabase en los tres proyectos.

Los SQL se mantienen una sola vez en `/supabase`; no debes ejecutar migraciones por cada app.
