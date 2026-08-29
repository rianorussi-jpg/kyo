import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function stripeConfig(branch: string) {
  const suffix = branch === 'zakia' ? 'ZAKIA' : branch === 'milenio' ? 'MILENIO' : ''
  if (!suffix) throw new Error('Sucursal Stripe inválida')
  const secretKey = Deno.env.get(`STRIPE_${suffix}_SECRET_KEY`)
  const publishableKey = Deno.env.get(`STRIPE_${suffix}_PUBLISHABLE_KEY`)
  if (!secretKey || !publishableKey) throw new Error(`Stripe no está configurado para ${branch}`)
  return { secretKey, publishableKey, suffix }
}

async function stripeRequest(secretKey: string, path: string, body?: URLSearchParams, method = 'POST', idempotencyKey?: string) {
  const headers: Record<string,string> = { Authorization: `Bearer ${secretKey}` }
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe rechazó la solicitud')
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Sesión requerida' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const service = createClient(supabaseUrl, serviceKey)
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sesión inválida' }, 401)

    const { order_id, save_payment_method = false } = await req.json()
    if (!order_id) return json({ error: 'Falta order_id' }, 400)

    const { data: order, error: orderError } = await service.from('orders')
      .select('id,order_number,user_id,branch_id,payment_method,payment_status,status,payment_total,stripe_payment_intent_id')
      .eq('id', order_id).maybeSingle()
    if (orderError || !order || order.user_id !== user.id) return json({ error: 'Pedido no encontrado' }, 404)
    if (order.payment_method !== 'card') return json({ error: 'Este pedido no usa tarjeta' }, 400)
    if (!['pending_payment','preparing'].includes(order.status)) return json({ error: 'El pedido no está disponible para pago' }, 409)
    if (order.payment_status === 'paid') return json({ error: 'Este pedido ya fue pagado' }, 409)

    const amount = Math.round(Number(order.payment_total || 0) * 100)
    if (!Number.isFinite(amount) || amount < 100) return json({ error: 'Importe inválido' }, 400)

    const { secretKey, publishableKey } = stripeConfig(order.branch_id)
    let paymentIntent: any = null

    if (order.stripe_payment_intent_id) {
      try {
        paymentIntent = await stripeRequest(secretKey, `/payment_intents/${encodeURIComponent(order.stripe_payment_intent_id)}`, undefined, 'GET')
      } catch (_) {
        paymentIntent = null
      }
    }

    if (!paymentIntent || paymentIntent.status === 'canceled') {
      const { data: profile } = await service.from('profiles').select('full_name,phone,stripe_customer_ids').eq('id', user.id).maybeSingle()
      const customerIds = profile?.stripe_customer_ids || {}
      let customerId = customerIds[order.branch_id]

      if (!customerId) {
        const customerBody = new URLSearchParams()
        if (user.email) customerBody.set('email', user.email)
        if (profile?.full_name) customerBody.set('name', profile.full_name)
        if (profile?.phone) customerBody.set('phone', profile.phone)
        customerBody.set('metadata[user_id]', user.id)
        customerBody.set('metadata[kyo_branch]', order.branch_id)
        const customer = await stripeRequest(secretKey, '/customers', customerBody, 'POST', `kyo-customer-${order.branch_id}-${user.id}`)
        customerId = customer.id
        await service.from('profiles').update({ stripe_customer_ids: { ...customerIds, [order.branch_id]: customerId } }).eq('id', user.id)
      }

      const body = new URLSearchParams()
      body.set('amount', String(amount))
      body.set('currency', 'mxn')
      body.append('payment_method_types[]', 'card')
      body.set('customer', customerId)
      if (save_payment_method) body.set('setup_future_usage', 'off_session')
      body.set('description', `KYO Sushi pedido #${order.order_number}`)
      body.set('metadata[order_id]', order.id)
      body.set('metadata[order_number]', String(order.order_number))
      body.set('metadata[branch_id]', order.branch_id)
      if (user.email) body.set('receipt_email', user.email)
      paymentIntent = await stripeRequest(secretKey, '/payment_intents', body, 'POST', `kyo-order-${order.id}`)

      await service.from('orders').update({ stripe_payment_intent_id: paymentIntent.id, payment_status: 'pending', save_payment_method: Boolean(save_payment_method) }).eq('id', order.id)
    }


    let customerSessionClientSecret: string | undefined
    if (paymentIntent?.customer) {
      try {
        const sessionBody = new URLSearchParams()
        sessionBody.set('customer', typeof paymentIntent.customer === 'string' ? paymentIntent.customer : paymentIntent.customer.id)
        sessionBody.set('components[payment_element][enabled]', 'true')
        sessionBody.set('components[payment_element][features][payment_method_redisplay]', 'enabled')
        sessionBody.append('components[payment_element][features][payment_method_allow_redisplay_filters][]', 'always')
        sessionBody.append('components[payment_element][features][payment_method_allow_redisplay_filters][]', 'limited')
        sessionBody.append('components[payment_element][features][payment_method_allow_redisplay_filters][]', 'unspecified')
        const customerSession = await stripeRequest(secretKey, '/customer_sessions', sessionBody)
        customerSessionClientSecret = customerSession.client_secret
      } catch (sessionError) {
        console.error('CustomerSession unavailable; payment can continue', sessionError)
      }
    }

    return json({
      clientSecret: paymentIntent.client_secret,
      publishableKey,
      customerSessionClientSecret,
      amount: amount / 100,
      orderId: order.id,
      paymentIntentId: paymentIntent.id,
    })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'No pudimos iniciar el pago' }, 500)
  }
})
