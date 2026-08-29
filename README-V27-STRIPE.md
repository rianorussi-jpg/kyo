# KYO v27 — Stripe + Apple Pay + tarjetas guardables

## Qué cambia
- Cliente: pago con tarjeta usando Stripe Payment Element.
- Apple Pay aparece automáticamente en dispositivos/navegadores compatibles cuando el dominio está registrado en Stripe.
- Opción explícita para guardar tarjeta para próximos pedidos.
- La tarjeta queda asociada a un Stripe Customer por sucursal/cuenta Stripe; KYO no almacena PAN/CVC.
- Pedidos con tarjeta nacen como `pending_payment`.
- Cocina NO recibe el pedido hasta que el webhook `payment_intent.succeeded` confirma el cobro.
- Efectivo continúa entrando directo a `preparing`.
- Propina entra en el cobro Stripe mediante `payment_total`, pero sigue separada de `orders.total` y de KPIs/ventas.
- Panel muestra `Esperando pago`; no permite forzar manualmente ese pedido a Cocina.
- Estadísticas y Registros no contabilizan pedidos `pending_payment`.

## 1. SQL
Ejecutar SOLO:

`supabase/migrate-v27-stripe.sql`

Requiere haber ejecutado antes v26.

## 2. Secrets de Supabase Edge Functions
No poner `sk_live_...` en Vercel/Vite.

Configurar en Supabase > Edge Functions > Secrets (o con Supabase CLI):

- `STRIPE_ZAKIA_SECRET_KEY`
- `STRIPE_ZAKIA_PUBLISHABLE_KEY`
- `STRIPE_ZAKIA_WEBHOOK_SECRET`
- `STRIPE_MILENIO_SECRET_KEY`
- `STRIPE_MILENIO_PUBLISHABLE_KEY`
- `STRIPE_MILENIO_WEBHOOK_SECRET`

Si ambas sucursales usan LA MISMA cuenta Stripe, usa la misma Publishable Key y Secret Key para Zákia y Milenio. Si el mismo endpoint webhook se registra una sola vez en esa misma cuenta, usa el mismo `whsec_...` en ambas variables webhook.

Si cada sucursal usa una cuenta Stripe diferente, registra el mismo endpoint en cada cuenta y coloca cada juego de claves en sus variables correspondientes.

## 3. Deploy Edge Functions
Desplegar:
- `stripe-create-payment-intent` (JWT activado)
- `stripe-webhook` (JWT desactivado; `supabase/config.toml` ya lo indica)

Con CLI:

`supabase functions deploy stripe-create-payment-intent`

`supabase functions deploy stripe-webhook --no-verify-jwt`

La URL que debes registrar en Stripe será:

`https://TU_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`

## 4. Webhook en Stripe
En Stripe > Developers / Workbench > Webhooks, agrega la URL anterior.

Eventos necesarios:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.processing`

Después copia `Signing secret` (`whsec_...`) a Supabase Secrets.

## 5. Apple Pay
En Stripe > Settings > Payment methods > Payment method domains registra:
- `kyosushi.com.mx`
- cualquier otro dominio/subdominio donde se muestre el checkout (por ejemplo preview si realmente vas a probar Apple Pay ahí).

Stripe hace la validación de comerciante Apple Pay. Apple Pay solo aparece cuando el dispositivo, navegador, país/cuenta y configuración son compatibles.

## 6. Deploy Cliente y Panel
Después del SQL + funciones + secrets:
- deploy `apps/cliente`
- deploy `apps/panel`

Cocina no necesita cambios de frontend en v27 porque ya filtra únicamente `preparing`, `ready` y `on_the_way`; por diseño nunca ve `pending_payment`.

## 7. Pruebas
Primero usa claves `pk_test_...` / `sk_test_...` y webhook de test. Prueba al menos:
- tarjeta aprobada sin propina
- tarjeta aprobada con 5/10/20% propina
- tarjeta rechazada
- 3DS si aplica
- Apple Pay en Safari/iPhone compatible
- guardar tarjeta y reutilizarla en el siguiente pedido
- pedido en efectivo
- confirmar que Cocina solo recibe pedidos pagados
- confirmar que KPI/ventas no suman propina ni pedidos pendientes de pago

Cuando todo pase, cambia los Secrets a claves Live y crea/usa el webhook Live correspondiente.
