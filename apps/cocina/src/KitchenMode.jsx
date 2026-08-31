import React, { useEffect, useRef, useState } from 'react'
import { RefreshCw, ChefHat, LogOut, Clock3, MapPin, Bike, Store, Check, ArrowRight, Volume2, VolumeX } from 'lucide-react'
import { supabase } from './supabase'

const money=n=>`$${Number(n||0).toLocaleString('es-MX',{maximumFractionDigits:2})}`
const branchName=id=>id==='zakia'?'KYO Zákia':'KYO Milenio'

function createKitchenAudio(){
  const AudioCtx=window.AudioContext||window.webkitAudioContext
  if(!AudioCtx)return null
  return new AudioCtx()
}

function playNewOrderBeep(ctx){
  if(!ctx)return
  try{
    if(ctx.state==='suspended')ctx.resume()
    const osc=ctx.createOscillator()
    const gain=ctx.createGain()
    osc.type='sine'
    osc.frequency.setValueAtTime(880,ctx.currentTime)
    osc.connect(gain)
    gain.connect(ctx.destination)

    const start=ctx.currentTime
    gain.gain.setValueAtTime(0.0001,start)
    for(let i=0;i<10;i++){
      const t=start+i*0.3
      gain.gain.setValueAtTime(0.0001,t)
      gain.gain.linearRampToValueAtTime(0.22,t+0.035)
      gain.gain.setValueAtTime(0.22,t+0.16)
      gain.gain.linearRampToValueAtTime(0.0001,t+0.25)
    }
    osc.start(start)
    osc.stop(start+3.05)
  }catch(e){
    console.error('Kitchen sound error',e)
  }
}

const fallbackRiders={
  zakia:[{name:'Pau',phone:'525623449135'},{name:'Rodri',phone:'525542641224'}],
  milenio:[{name:'Pau',phone:'525623449135'},{name:'Rodri',phone:'525542641224'}]
}

const whatsappPhone=value=>{
  const digits=String(value||'').replace(/\D/g,'')
  if(digits.length===10)return `52${digits}`
  if(digits.length===12&&digits.startsWith('52'))return digits
  return digits
}

function sendOrderToRider(order,rider){
  const riderName=rider?.name?.trim()||'Repartidor'
  const riderPhone=whatsappPhone(rider?.phone)
  if(!riderPhone){alert('Este repartidor no tiene un teléfono configurado en Panel.');return}
  const orderNo=String(order.order_number).padStart(4,'0')
  const address=order.delivery_address||'Dirección no disponible'
  const customer=order.profiles?.full_name||'Cliente KYO'
  const phone=order.profiles?.phone||'Sin teléfono'
  const reference=order.delivery_reference?`\nReferencia: ${order.delivery_reference}`:''
  const charge=Number(order.total||0)+Number(order.tip_amount||0)
  const payment=order.payment_method==='card'?`Pagado con tarjeta · Total: ${money(charge)}`:`Cobrar: ${money(charge)} en efectivo`
  const message=`Hola ${riderName}, pedido KYO #${orderNo} listo para reparto.\n\nDirección: ${address}${reference}\nCliente: ${customer}\nTeléfono: ${phone}\nSucursal: ${branchName(order.branch_id)}\n${payment}`
  window.open(`https://wa.me/${riderPhone}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer')
}


export function KitchenGate({auth,children}){
  if(auth.loading)return <main className="kitchen-login"><RefreshCw className="spin"/><p>Comprobando acceso...</p></main>
  if(!auth.user)return <KitchenLogin/>
  if(!auth.profile?.kitchen_branch && !auth.profile?.is_admin)return <main className="kitchen-login"><ChefHat size={48}/><h1>Cuenta sin sucursal de cocina</h1><p>Asigna <b>zakia</b> o <b>milenio</b> a esta cuenta desde Supabase.</p><button className="primary" onClick={()=>supabase.auth.signOut()}>Cerrar sesión</button></main>
  return children
}
function KitchenLogin(){const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const submit=async e=>{e.preventDefault();setBusy(true);const {error}=await supabase.auth.signInWithPassword({email,password});setBusy(false);if(error)setError(error.message)};return <main className="kitchen-login"><form className="kitchen-login-card" onSubmit={submit}><ChefHat size={42}/><span>MODO COCINA</span><h1>KYO</h1><p>Entra con la cuenta de tu sucursal.</p><label>Correo<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="zakia@kyosushi.mx"/></label><label>Contraseña<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="form-message">{error}</div>}<button className="primary full" disabled={busy}>{busy?'Entrando...':'Entrar a cocina'}</button></form></main>}

export function KitchenMode({auth}){
  const branch=auth.profile?.kitchen_branch||'zakia'
  const [orders,setOrders]=useState([])
  const [loading,setLoading]=useState(true)
  const [soundReady,setSoundReady]=useState(false)
  const [riders,setRiders]=useState(fallbackRiders[branch])
  const audioRef=useRef(null)

  const enableSound=async()=>{
    try{
      if(!audioRef.current)audioRef.current=createKitchenAudio()
      if(audioRef.current?.state==='suspended')await audioRef.current.resume()
      setSoundReady(!!audioRef.current)
    }catch{setSoundReady(false)}
  }

  const loadRiders=async()=>{
    if(!supabase)return
    const {data}=await supabase.from('app_settings').select('delivery_riders').eq('id','main').maybeSingle()
    const configured=data?.delivery_riders?.[branch]
    if(Array.isArray(configured)&&configured.length)setRiders([0,1].map(i=>configured[i]||{name:`Repartidor ${i+1}`,phone:''}))
    else setRiders(fallbackRiders[branch])
  }

  const load=async()=>{
    if(!supabase)return
    setLoading(true)
    let q=supabase.from('orders').select('*, order_items(*), profiles(full_name,phone)').eq('branch_id',branch).in('status',['preparing','ready','on_the_way']).order('created_at',{ascending:true})
    const {data}=await q
    setOrders(data||[])
    setLoading(false)
  }

  useEffect(()=>{
    load()
    loadRiders()
    if(!supabase)return
    const ch=supabase.channel(`kitchen-${branch}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`branch_id=eq.${branch}`},payload=>{
        if(payload.eventType==='INSERT'&&payload.new?.status==='preparing'){
          playNewOrderBeep(audioRef.current)
        }
        load()
      })
      .subscribe()
    return()=>supabase.removeChannel(ch)
  },[branch])

  const setStatus=async(id,status)=>{await supabase.from('orders').update({status}).eq('id',id);load()}
  const preparing=orders.filter(o=>o.status==='preparing');const ready=orders.filter(o=>o.status==='ready');const route=orders.filter(o=>o.status==='on_the_way')
  return <main className="kitchen-shell"><header className="kitchen-head"><div><span>MODO COCINA</span><h1>{branchName(branch)}</h1><p>Los pedidos nuevos entran automáticamente a Preparando.</p></div><div className="kitchen-head-actions"><button className={`kitchen-sound-btn ${soundReady?'ready':''}`} onClick={enableSound}>{soundReady?<Volume2/>:<VolumeX/>}<span>{soundReady?'Sonido activo':'Activar sonido'}</span></button><button onClick={()=>{load();loadRiders()}}><RefreshCw className={loading?'spin':''}/></button><button onClick={()=>supabase.auth.signOut()}><LogOut/></button></div></header><section className="kitchen-board"><KitchenColumn title="Preparando" count={preparing.length} orders={preparing} actionLabel="Marcar listo" actionIcon={<Check/>} onAction={id=>setStatus(id,'ready')}/><KitchenColumn title="Listos" count={ready.length} orders={ready} actionLabel={o=>o.fulfillment_type==='pickup'?'Marcar entregado':'Salió a ruta'} actionIcon={o=>o.fulfillment_type==='pickup'?<Check/>:<Bike/>} onAction={(id,o)=>setStatus(id,o.fulfillment_type==='pickup'?'delivered':'on_the_way')}/></section>{route.length>0&&<section className="route-strip">
    <div className="route-strip-head"><span>EN CAMINO</span><strong>{route.length} pedido{route.length!==1?'s':''}</strong></div>
    <div className="route-orders-list">
      {route.map(o=><div className="route-order-row" key={o.id}>
        <div className="route-order-info">
          <strong>Pedido #{String(o.order_number).padStart(4,'0')}</strong>
          <small>{o.delivery_address}</small>
        </div>
        <div className="route-order-actions">
          {riders.map((rider,index)=><button key={index} className={`rider-btn rider-${index+1}`} onClick={()=>sendOrderToRider(o,rider)}>Enviar a {rider?.name?.trim()||`Repartidor ${index+1}`}</button>)}
          <button className="delivered-btn" onClick={()=>setStatus(o.id,'delivered')}>Marcar entregado <ArrowRight/></button>
        </div>
      </div>)}
    </div>
  </section>}</main>
}
function KitchenColumn({title,count,orders,actionLabel,actionIcon,onAction}){return <section className="kitchen-column"><header><h2>{title}</h2><b>{count}</b></header><div className="kitchen-list">{orders.length===0?<div className="kitchen-empty">No hay pedidos aquí.</div>:orders.map(o=><KitchenTicket key={o.id} order={o} actionLabel={typeof actionLabel==='function'?actionLabel(o):actionLabel} actionIcon={typeof actionIcon==='function'?actionIcon(o):actionIcon} onAction={()=>onAction(o.id,o)}/>)}</div></section>}
function KitchenTicket({order,actionLabel,actionIcon,onAction}){return <article className="kitchen-ticket"><div className="ticket-top"><div><small>PEDIDO</small><h3>#{String(order.order_number).padStart(4,'0')}</h3></div><span><Clock3/> {new Date(order.created_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</span></div><div className="ticket-items">{order.order_items?.map(i=><div className="kitchen-item-detail" key={i.id}><div className="kitchen-product-line"><b>{i.quantity}×</b><strong>{i.product_name}</strong></div>{i.customizations?.length>0&&<div className="kitchen-customizations">{Object.entries(i.customizations.reduce((groups,c)=>{const title=c.template_name||c.group_name||c.customization_name||c.title||'Personalización';(groups[title]??=[]).push(c);return groups},{})).map(([title,rows])=><div className="kitchen-custom-group" key={title}><strong>{title}</strong>{rows.map((c,idx)=><span key={idx}>{c.label||c.option_name||c.name}{Number(c.quantity||1)>1?` ×${c.quantity}`:''}</span>)}</div>)}</div>}{i.item_note&&<div className="kitchen-item-note"><strong>Nota del cliente</strong><p>{i.item_note}</p></div>}</div>)}</div><div className="ticket-customer"><strong>{order.profiles?.full_name||'Cliente KYO'}</strong>{order.profiles?.phone&&<span>Tel. {order.profiles.phone}</span>}</div><div className="ticket-meta"><span>{order.fulfillment_type==='delivery'?<Bike/>:<Store/>}{order.fulfillment_type==='delivery'?'Delivery':'Pickup'}</span>{order.delivery_address&&<span><MapPin/>{order.delivery_address}</span>}{order.delivery_reference&&<p><b>Referencia:</b> {order.delivery_reference}</p>}{order.delivery_notes&&<p><b>Notas del pedido:</b> {order.delivery_notes}</p>}</div><div className="ticket-foot"><div className="kitchen-payment-total"><strong>{money(Number(order.total||0)+Number(order.tip_amount||0))}</strong>{Number(order.tip_amount||0)>0&&<small>Propina: {money(order.tip_amount)}</small>}</div><button onClick={onAction}>{actionIcon}{actionLabel}</button></div></article>}
