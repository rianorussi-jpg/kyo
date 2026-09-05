import React, { useEffect, useRef, useState } from 'react'
import { RefreshCw, ChefHat, LogOut, Clock3, MapPin, Bike, Store, Check, ArrowRight, Volume2, VolumeX, Eye, Printer, X, CreditCard, Banknote, AlertTriangle } from 'lucide-react'
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

const normalizedPaymentMethod=order=>{
  const method=String(order?.payment_method||'').trim().toLowerCase()
  if(['terminal','pos','card_terminal','terminal_card'].includes(method))return 'terminal'
  if(['card','stripe','online_card','apple_pay'].includes(method))return 'card'
  return 'cash'
}
const paymentLabel=order=>normalizedPaymentMethod(order)==='card'?'Tarjeta':normalizedPaymentMethod(order)==='terminal'?'Terminal':'Efectivo'
const isPaid=order=>order.payment_status==='paid'
const chargedTotal=order=>Number(order.total||0)+Number(order.tip_amount||0)
const escapeHtml=value=>String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]))
const customizationGroups=item=>Object.entries((Array.isArray(item.customizations)?item.customizations:[]).reduce((groups,c)=>{const title=c.template_name||c.group_name||c.customization_name||c.title||'Personalización';(groups[title]??=[]).push(c);return groups},{}))
const customizationLabel=c=>c.label||c.option_name||c.name||'Opción'
const customizationPrice=c=>Number(c.price??c.option_price??c.extra_price??0)
const customizationLineTotal=c=>customizationPrice(c)*Math.max(1,Number(c.quantity||1))
const itemExtrasPerUnit=item=>(Array.isArray(item.customizations)?item.customizations:[]).reduce((sum,c)=>sum+customizationLineTotal(c),0)
const itemBasePrice=item=>Number(item._base_price??Math.max(0,Number(item.unit_price||0)-itemExtrasPerUnit(item)))
const thermalDate=value=>new Date(value).toLocaleString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})

const RECEIPT_COLS=36

const thermalPlain=value=>String(value??'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/[“”]/g,'"')
  .replace(/[‘’]/g,"'")
  .replace(/·/g,'-')
  .replace(/…/g,'...')
  .replace(/[^\x20-\x7E\n]/g,'')

const thermalWrap=(value,width=RECEIPT_COLS)=>{
  const text=thermalPlain(value).replace(/\s+/g,' ').trim()
  if(!text)return []
  const words=text.split(' ')
  const lines=[]
  let line=''
  for(const word of words){
    if(word.length>width){
      if(line){lines.push(line);line=''}
      for(let i=0;i<word.length;i+=width)lines.push(word.slice(i,i+width))
      continue
    }
    if(!line)line=word
    else if(line.length+1+word.length<=width)line+=` ${word}`
    else{lines.push(line);line=word}
  }
  if(line)lines.push(line)
  return lines
}

const thermalCenter=value=>{
  const t=thermalPlain(value).trim().slice(0,RECEIPT_COLS)
  const left=Math.max(0,Math.floor((RECEIPT_COLS-t.length)/2))
  return `${' '.repeat(left)}${t}`
}

const thermalRule=(char='-')=>char.repeat(RECEIPT_COLS)

const thermalPair=(left,right)=>{
  const l=thermalPlain(left).trim()
  const r=thermalPlain(right).trim()
  if(!r)return thermalWrap(l)
  if(l.length+r.length+1<=RECEIPT_COLS)return [`${l}${' '.repeat(RECEIPT_COLS-l.length-r.length)}${r}`]
  return [...thermalWrap(l,RECEIPT_COLS),...thermalWrap(r,RECEIPT_COLS).map(x=>x.padStart(RECEIPT_COLS))]
}

const thermalMoney=value=>money(Number(value||0))

function ticketHeaderLines(order,kind){
  const no=String(order.order_number).padStart(4,'0')
  const pickup=order.fulfillment_type==='pickup'
  const customer=order.profiles?.full_name||'Cliente KYO'
  const lines=[
    thermalCenter('KYO SUSHI'),
    thermalCenter(branchName(order.branch_id)),
    thermalCenter(kind),
    thermalRule('='),
    ...thermalWrap(`PEDIDO: #${no}`),
    ...thermalWrap(`TIPO: ${pickup?'PICKUP':'DELIVERY'}`),
    ...thermalWrap(`FECHA: ${thermalDate(order.created_at)}`),
    ...thermalWrap(`CLIENTE: ${customer}`)
  ]
  if(order.profiles?.phone)lines.push(...thermalWrap(`TEL: ${order.profiles.phone}`))
  lines.push(...thermalWrap(`PAGO: ${paymentLabel(order)}`))
  if(order.delivery_address){lines.push(thermalRule('-'),...thermalWrap(`DIRECCION: ${order.delivery_address}`))}
  if(order.delivery_reference)lines.push(...thermalWrap(`REFERENCIA: ${order.delivery_reference}`))
  if(order.delivery_notes)lines.push(...thermalWrap(`NOTAS PEDIDO: ${order.delivery_notes}`))
  lines.push(thermalRule('='))
  return lines
}

function kitchenItemLines(order){
  const lines=[]
  for(const i of (order.order_items||[])){
    const qty=Math.max(1,Number(i.quantity||1))
    lines.push(...thermalWrap(`${qty}x ${i.product_name}`))
    for(const [title,rows] of customizationGroups(i)){
      lines.push(...thermalWrap(`  ${String(title).toUpperCase()}`))
      for(const c of rows){
        const q=Math.max(1,Number(c.quantity||1))
        lines.push(...thermalWrap(`    - ${customizationLabel(c)}${q>1?` x${q}`:''}`))
      }
    }
    if(i.item_note)lines.push(...thermalWrap(`  NOTA: ${i.item_note}`))
    lines.push(thermalRule('-'))
  }
  return lines
}

function saleItemLines(order){
  const lines=[]
  for(const i of (order.order_items||[])){
    const qty=Math.max(1,Number(i.quantity||1))
    lines.push(...thermalWrap(`${qty}x ${i.product_name}`))
    lines.push(...thermalPair('  Base c/u',thermalMoney(itemBasePrice(i))))
    for(const [title,rows] of customizationGroups(i)){
      lines.push(...thermalWrap(`  ${String(title).toUpperCase()}`))
      for(const c of rows){
        const q=Math.max(1,Number(c.quantity||1))
        const price=customizationLineTotal(c)
        lines.push(...thermalPair(`    ${customizationLabel(c)}${q>1?` x${q}`:''}`,price>0?`+${thermalMoney(price)}`:'$0'))
      }
    }
    if(itemExtrasPerUnit(i)>0)lines.push(...thermalPair('  Personaliz. c/u',`+${thermalMoney(itemExtrasPerUnit(i))}`))
    lines.push(...thermalPair('  Final c/u',thermalMoney(i.unit_price)))
    lines.push(...thermalPair('  Importe',thermalMoney(Number(i.unit_price||0)*qty)))
    if(i.item_note)lines.push(...thermalWrap(`  NOTA: ${i.item_note}`))
    lines.push(thermalRule('-'))
  }
  return lines
}

const thermalStyles=`
  @page{margin:0}
  html,body{
    margin:0!important;
    padding:0!important;
    width:80mm!important;
    min-width:80mm!important;
    max-width:80mm!important;
    background:#fff!important;
    color:#000!important;
  }
  body{font-family:"Courier New",Courier,monospace!important}
  .receipt{
    box-sizing:border-box!important;
    width:80mm!important;
    min-width:80mm!important;
    max-width:80mm!important;
    margin:0!important;
    padding:3mm 4mm 8mm!important;
  }
  .ticket-line{
    display:block!important;
    box-sizing:border-box!important;
    width:72mm!important;
    min-width:72mm!important;
    max-width:72mm!important;
    height:auto!important;
    min-height:0!important;
    margin:0!important;
    padding:0!important;
    white-space:pre!important;
    word-break:normal!important;
    overflow-wrap:normal!important;
    font-family:"Courier New",Courier,monospace!important;
    font-size:9pt!important;
    line-height:1.18!important;
    font-weight:600!important;
    letter-spacing:0!important;
    color:#000!important;
    clear:both!important;
  }
  .ticket-line.blank{height:3mm!important;min-height:3mm!important}
  @media print{
    html,body{
      width:80mm!important;
      min-width:80mm!important;
      max-width:80mm!important;
      overflow:visible!important;
    }
    .receipt{width:80mm!important;min-width:80mm!important;max-width:80mm!important}
    body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  }
`

function openThermalPrint(order,text,title){
  const no=String(order.order_number).padStart(4,'0')
  const popup=window.open('','_blank','width=420,height=800')
  if(!popup){alert('Permite ventanas emergentes para imprimir el ticket.');return}
  const lines=thermalPlain(text).split('\n')
  const htmlLines=lines.map(line=>line.length
    ?`<div class="ticket-line">${escapeHtml(line)}</div>`
    :'<div class="ticket-line blank">&nbsp;</div>'
  ).join('')
  popup.document.open()
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} #${no}</title><style>${thermalStyles}</style></head><body><main class="receipt">${htmlLines}</main><script>window.onload=()=>setTimeout(()=>{window.print();window.onafterprint=()=>window.close()},450)<\/script></body></html>`)
  popup.document.close()
}

function printKitchenTicket(order){
  const lines=[
    ...ticketHeaderLines(order,'TICKET COCINA'),
    ...kitchenItemLines(order),
    thermalCenter(`PAGO: ${paymentLabel(order)}`),
    thermalRule('='),
    thermalCenter('*** COCINA ***'),
    '', '', '', ''
  ]
  openThermalPrint(order,lines.join('\n'),'Cocina')
}

function printSaleTicket(order){
  const method=paymentLabel(order)
  const methodKey=normalizedPaymentMethod(order)
  const paymentStatus=isPaid(order)?`PAGADO - ${method}`:methodKey==='terminal'?'COBRAR CON TERMINAL':methodKey==='cash'?'COBRAR EN EFECTIVO':'PAGO CON TARJETA PENDIENTE'
  const lines=[
    ...ticketHeaderLines(order,'TICKET DE VENTA'),
    ...saleItemLines(order),
    ...thermalPair('SUBTOTAL',thermalMoney(order.subtotal))
  ]
  if(Number(order.delivery_fee||0)>0)lines.push(...thermalPair('ENVIO',thermalMoney(order.delivery_fee)))
  if(Number(order.tip_amount||0)>0)lines.push(...thermalPair('PROPINA',thermalMoney(order.tip_amount)))
  lines.push(
    thermalRule('='),
    ...thermalPair('TOTAL',thermalMoney(chargedTotal(order))),
    thermalRule('='),
    ...thermalWrap(paymentStatus),
    ...thermalPair('METODO',method),
    '',
    thermalCenter('GRACIAS POR SU PREFERENCIA'),
    thermalCenter('ESTE TICKET NO ES COMPROBANTE FISCAL'),
    '', '', '', ''
  )
  openThermalPrint(order,lines.join('\n'),'Venta')
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
  const payment=order.payment_method==='card'?`Pagado con tarjeta · Total: ${money(charge)}`:order.payment_method==='terminal'?`Cobrar: ${money(charge)} con terminal`:`Cobrar: ${money(charge)} en efectivo`
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
  const [detailOrder,setDetailOrder]=useState(null)
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
    const rawOrders=data||[]
    const allItems=rawOrders.flatMap(o=>o.order_items||[])
    const templateIds=[...new Set(allItems.flatMap(i=>(Array.isArray(i.customizations)?i.customizations:[]).map(c=>c.template_id).filter(Boolean)))]
    const {data:templates}=templateIds.length?await supabase.from('customization_templates').select('id,name,options').in('id',templateIds):{data:[]}
    const templateMap=new Map((templates||[]).map(t=>[String(t.id),t]))
    const hydrated=rawOrders.map(order=>({...order,order_items:(order.order_items||[]).map(item=>{
      const customs=(Array.isArray(item.customizations)?item.customizations:[]).map(c=>{
        const template=templateMap.get(String(c.template_id))
        const option=(template?.options||[]).find(o=>String(o.id)===String(c.option_id))
        return {...c,template_name:template?.name||c.template_name||'Personalización',label:option?.name||option?.label||c.label||c.option_name||c.name||'Opción',price:Number(option?.price??c.price??0)}
      })
      const extras=customs.reduce((sum,c)=>sum+customizationLineTotal(c),0)
      return {...item,customizations:customs,_base_price:Math.max(0,Number(item.unit_price||0)-extras),_extras_total:extras}
    })}))
    setOrders(hydrated)
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
  const advanceOrder=async(id,order)=>{
    if(order.fulfillment_type==='pickup'){
      const payment=isPaid(order)?`Este pedido YA ESTÁ PAGADO (${money(chargedTotal(order))}).`:`Este pedido se cobra por ${paymentLabel(order).toLowerCase()} (${money(chargedTotal(order))}).`
      if(!window.confirm(`CONFIRMAR ENTREGA PICKUP\n\nPedido #${String(order.order_number).padStart(4,'0')}\n${payment}\n\n¿El cliente ya recibió físicamente su pedido?`))return
      await setStatus(id,'delivered')
      return
    }
    await setStatus(id,'on_the_way')
  }
  const preparing=orders.filter(o=>o.status==='preparing');const ready=orders.filter(o=>o.status==='ready');const route=orders.filter(o=>o.status==='on_the_way')
  return <main className="kitchen-shell">
    <header className="kitchen-head"><div><span>MODO COCINA</span><h1>{branchName(branch)}</h1><p>Pedidos en tiempo real · abre detalles antes de entregar o imprimir.</p></div><div className="kitchen-head-actions"><button className={`kitchen-sound-btn ${soundReady?'ready':''}`} onClick={enableSound}>{soundReady?<Volume2/>:<VolumeX/>}<span>{soundReady?'Sonido activo':'Activar sonido'}</span></button><button onClick={()=>{load();loadRiders()}} title="Actualizar"><RefreshCw className={loading?'spin':''}/></button><button onClick={()=>supabase.auth.signOut()} title="Cerrar sesión"><LogOut/></button></div></header>
    <section className="kitchen-board"><KitchenColumn title="Preparando" tone="preparing" count={preparing.length} orders={preparing} actionLabel="Marcar listo" actionIcon={<Check/>} onAction={id=>setStatus(id,'ready')} onDetails={setDetailOrder}/><KitchenColumn title="Listos para entregar" tone="ready" count={ready.length} orders={ready} actionLabel={o=>o.fulfillment_type==='pickup'?'Confirmar entrega':'Salió a ruta'} actionIcon={o=>o.fulfillment_type==='pickup'?<Check/>:<Bike/>} onAction={advanceOrder} onDetails={setDetailOrder}/></section>
    {route.length>0&&<section className="route-strip"><div className="route-strip-head"><span>EN CAMINO</span><strong>{route.length} pedido{route.length!==1?'s':''}</strong></div><div className="route-orders-list">{route.map(o=><div className="route-order-row" key={o.id}><div className="route-order-info"><strong>Pedido #{String(o.order_number).padStart(4,'0')}</strong><small>{o.delivery_address}</small></div><div className="route-order-actions"><button className="route-detail-btn" onClick={()=>setDetailOrder(o)}><Eye/> Ver detalles</button>{riders.map((rider,index)=><button key={index} className={`rider-btn rider-${index+1}`} onClick={()=>sendOrderToRider(o,rider)}>Enviar a {rider?.name?.trim()||`Repartidor ${index+1}`}</button>)}<button className="delivered-btn" onClick={()=>setStatus(o.id,'delivered')}>Marcar entregado <ArrowRight/></button></div></div>)}</div></section>}
    {detailOrder&&<KitchenOrderDetail order={detailOrder} onClose={()=>setDetailOrder(null)} onPrintKitchen={()=>printKitchenTicket(detailOrder)} onPrintSale={()=>printSaleTicket(detailOrder)} onStatusAction={async order=>{if(order.status==='preparing'){await setStatus(order.id,'ready');setDetailOrder(null);return}if(order.status==='ready'){await advanceOrder(order.id,order);setDetailOrder(null)}}}/>}
  </main>
}

function KitchenColumn({title,tone,count,orders,actionLabel,actionIcon,onAction,onDetails}){return <section className={`kitchen-column kitchen-column-${tone||''}`}><header><div><small>{tone==='preparing'?'EN PRODUCCIÓN':'SALIDA'}</small><h2>{title}</h2></div><b>{count}</b></header><div className="kitchen-list">{orders.length===0?<div className="kitchen-empty">No hay pedidos aquí.</div>:orders.map(o=><KitchenTicket key={o.id} order={o} actionLabel={typeof actionLabel==='function'?actionLabel(o):actionLabel} actionIcon={typeof actionIcon==='function'?actionIcon(o):actionIcon} onAction={()=>onAction(o.id,o)} onDetails={()=>onDetails(o)}/>)}</div></section>}

function KitchenTicket({order,actionLabel,actionIcon,onAction,onDetails}){
  const pickup=order.fulfillment_type==='pickup'
  const paid=isPaid(order)
  const units=order.order_items?.reduce((a,i)=>a+Number(i.quantity||0),0)||0
  return <article className={`kitchen-ticket ${pickup?'pickup-ticket':'delivery-ticket'}`}>
    <div className="ticket-type-banner">{pickup?<><Store/> PICKUP · RECOGE EN SUCURSAL</>:<><Bike/> DELIVERY</>}</div>
    <div className="ticket-top"><div><small>PEDIDO</small><h3>#{String(order.order_number).padStart(4,'0')}</h3></div><span><Clock3/> {new Date(order.created_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</span></div>
    <div className={`ticket-payment-alert ${paid?'paid':'collect'}`}>{paid?<CreditCard/>:<Banknote/>}<div><small>{paid?'PAGO CONFIRMADO':'PENDIENTE DE COBRO'}</small><strong>{paid?`Ya cobrado · ${money(chargedTotal(order))}`:`Cobrar ${money(chargedTotal(order))} · ${paymentLabel(order)}`}</strong></div></div>
    <button className="ticket-products-hidden" onClick={onDetails}><span><Eye/><b>{units} producto{units!==1?'s':''}</b></span><small>Contenido oculto · abre Ver detalles para preparar</small></button>
    <div className="ticket-customer"><strong>{order.profiles?.full_name||'Cliente KYO'}</strong>{order.profiles?.phone&&<span>Tel. {order.profiles.phone}</span>}</div>
    <div className="ticket-meta">{order.delivery_address&&<span><MapPin/>{order.delivery_address}</span>}{order.delivery_reference&&<p><b>Referencia:</b> {order.delivery_reference}</p>}</div>
    <div className="ticket-quick-actions"><button className="detail-btn" onClick={onDetails}><Eye/> Ver detalles</button><button className="print-btn kitchen-print-btn" onClick={()=>printKitchenTicket(order)}><Printer/> Ticket cocina</button><button className="print-btn sale-print-btn" onClick={()=>printSaleTicket(order)}><Printer/> Ticket venta</button></div>
    <div className="ticket-foot"><div className="kitchen-payment-total"><strong>{money(chargedTotal(order))}</strong><small>{paymentLabel(order)}{Number(order.tip_amount||0)>0?` · Propina ${money(order.tip_amount)}`:''}</small></div><button className={pickup?'pickup-deliver-btn':''} onClick={onAction}>{actionIcon}{actionLabel}</button></div>
  </article>
}

function KitchenOrderDetail({order,onClose,onPrintKitchen,onPrintSale,onStatusAction}){
  const pickup=order.fulfillment_type==='pickup', paid=isPaid(order)
  const actionLabel=order.status==='preparing'?'Marcar pedido listo':order.status==='ready'?(pickup?'Confirmar entrega pickup':'Marcar salida a ruta'):null
  return <div className="kitchen-detail-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="kitchen-detail-modal">
    <header className="kitchen-detail-head"><div><small>DETALLE COMPLETO</small><h2>Pedido #{String(order.order_number).padStart(4,'0')}</h2><p>{new Date(order.created_at).toLocaleString('es-MX')} · {branchName(order.branch_id)}</p></div><button onClick={onClose}><X/></button></header>
    <div className={`kitchen-detail-fulfillment ${pickup?'pickup':'delivery'}`}><div>{pickup?<Store/>:<Bike/>}<span><small>TIPO DE PEDIDO</small><strong>{pickup?'PICKUP · RECOGE EN SUCURSAL':'DELIVERY · ENVÍO A DOMICILIO'}</strong></span></div><div className={paid?'paid':'collect'}>{paid?<CreditCard/>:<AlertTriangle/>}<span><small>{paid?'PAGO CONFIRMADO':'COBRO PENDIENTE'}</small><strong>{paid?`Ya se cobró ${money(chargedTotal(order))}`:`Cobrar ${money(chargedTotal(order))} · ${paymentLabel(order)}`}</strong></span></div></div>
    <div className="kitchen-detail-customer"><div><small>CLIENTE</small><strong>{order.profiles?.full_name||'Cliente KYO'}</strong>{order.profiles?.phone&&<span>{order.profiles.phone}</span>}</div><div><small>MÉTODO DE PAGO</small><strong>{paymentLabel(order)}</strong><span>{paid?'Pago confirmado':'Pendiente al entregar'}</span></div></div>
    {(order.delivery_address||order.delivery_reference||order.delivery_notes)&&<div className="kitchen-detail-notes">{order.delivery_address&&<p><MapPin/><span><small>DIRECCIÓN</small><strong>{order.delivery_address}</strong></span></p>}{order.delivery_reference&&<p><span><small>REFERENCIA</small><strong>{order.delivery_reference}</strong></span></p>}{order.delivery_notes&&<p className="important"><span><small>NOTAS DEL PEDIDO</small><strong>{order.delivery_notes}</strong></span></p>}</div>}
    <div className="kitchen-detail-items"><div className="kitchen-detail-section-title"><span>PRODUCTOS</span><b>{order.order_items?.reduce((a,i)=>a+Number(i.quantity||0),0)||0} unidades</b></div>{order.order_items?.map(i=><article key={i.id}><div className="detail-item-main"><span><b>{i.quantity}×</b><strong>{i.product_name}</strong></span><div><small>Precio final c/u</small><strong>{money(i.unit_price)}</strong><em>{money(Number(i.unit_price||0)*Number(i.quantity||0))} total</em></div></div><div className="detail-price-breakdown"><div><span>Producto base</span><strong>{money(itemBasePrice(i))}</strong></div>{itemExtrasPerUnit(i)>0&&<div><span>Personalizaciones</span><strong>+{money(itemExtrasPerUnit(i))}</strong></div>}<div className="final"><span>Precio final por unidad</span><strong>{money(i.unit_price)}</strong></div></div>{customizationGroups(i).length>0&&<div className="detail-customs">{customizationGroups(i).map(([title,rows])=><section key={title}><b>{title}</b>{rows.map((c,idx)=><p key={idx}><span>{customizationLabel(c)}{Number(c.quantity||1)>1?` ×${c.quantity}`:''}</span><strong>{customizationPrice(c)>0?`+${money(customizationLineTotal(c))}`:'Sin costo'}</strong></p>)}</section>)}</div>}{i.item_note&&<div className="detail-item-note"><b>NOTA DEL CLIENTE</b><span>{i.item_note}</span></div>}</article>)}</div>
    <div className="kitchen-detail-totals"><div><span>Subtotal</span><strong>{money(order.subtotal)}</strong></div>{Number(order.delivery_fee||0)>0&&<div><span>Envío</span><strong>{money(order.delivery_fee)}</strong></div>}<div><span>Venta KYO</span><strong>{money(order.total)}</strong></div>{Number(order.tip_amount||0)>0&&<div><span>Propina</span><strong>{money(order.tip_amount)}</strong></div>}<div className="grand"><span>{paid?'TOTAL COBRADO':'TOTAL A COBRAR'}</span><strong>{money(chargedTotal(order))}</strong></div></div>
    <footer className="kitchen-detail-footer"><button className="secondary" onClick={onClose}>Cerrar</button><button className="primary-print kitchen" onClick={onPrintKitchen}><Printer/> Imprimir ticket cocina</button><button className="primary-print sale" onClick={onPrintSale}><Printer/> Imprimir ticket venta</button>{actionLabel&&<button className={`detail-status-action ${order.status==='preparing'?'ready-action':pickup?'pickup-action':'route-action'}`} onClick={()=>onStatusAction(order)}>{order.status==='preparing'?<Check/>:pickup?<Check/>:<Bike/>}{actionLabel}</button>}</footer>
  </section></div>
}
