import { createClient } from 'npm:@supabase/supabase-js@2'

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i=0;i<a.length;i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('')
}

async function verifyStripeSignature(raw: string, header: string, secrets: string[]) {
  const parts = header.split(',')
  const timestamp = parts.find(x=>x.startsWith('t='))?.slice(2)
  const signatures = parts.filter(x=>x.startsWith('v1=')).map(x=>x.slice(3))
  if (!timestamp || !signatures.length) return false
  const age = Math.abs(Math.floor(Date.now()/1000) - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return false
  for (const secret of secrets.filter(Boolean)) {
    const expected = await hmacHex(secret, `${timestamp}.${raw}`)
    if (signatures.some(sig=>timingSafeEqual(sig, expected))) return true
  }
  return false
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await req.text()
  const signature = req.headers.get('Stripe-Signature') || ''
  const secrets = [Deno.env.get('STRIPE_ZAKIA_WEBHOOK_SECRET') || '', Deno.env.get('STRIPE_MILENIO_WEBHOOK_SECRET') || '']
  if (!await verifyStripeSignature(raw, signature, secrets)) return new Response('Invalid signature', { status: 400 })

  let event: any
  try { event = JSON.parse(raw) } catch { return new Response('Invalid JSON', { status: 400 }) }
  const pi = event?.data?.object
  const orderId = pi?.metadata?.order_id
  if (!orderId || !pi?.id) return new Response('ok', { status: 200 })

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: order } = await service.from('orders').select('id,payment_total,stripe_payment_intent_id,payment_status,status').eq('id',orderId).maybeSingle()
  if (!order || order.stripe_payment_intent_id !== pi.id) return new Response('ok', { status: 200 })

  if (event.type === 'payment_intent.succeeded') {
    const expected = Math.round(Number(order.payment_total || 0) * 100)
    const received = Number(pi.amount_received ?? pi.amount ?? 0)
    if (expected !== received) {
      console.error('Stripe amount mismatch', { orderId, expected, received })
      return new Response('Amount mismatch', { status: 400 })
    }
    await service.from('orders').update({
      payment_status: 'paid',
      status: order.status === 'pending_payment' ? 'preparing' : order.status,
      paid_at: new Date().toISOString(),
      stripe_charge_id: typeof pi.latest_charge === 'string' ? pi.latest_charge : null,
    }).eq('id', orderId).eq('stripe_payment_intent_id', pi.id)
  } else if (event.type === 'payment_intent.payment_failed') {
    await service.from('orders').update({ payment_status: 'failed' }).eq('id', orderId).eq('stripe_payment_intent_id', pi.id)
  } else if (event.type === 'payment_intent.processing') {
    await service.from('orders').update({ payment_status: 'pending' }).eq('id', orderId).eq('stripe_payment_intent_id', pi.id)
  }

  return new Response('ok', { status: 200 })
})
