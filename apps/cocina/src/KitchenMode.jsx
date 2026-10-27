import React, { useEffect, useRef, useState } from 'react'
import { RefreshCw, ChefHat, LogOut, Clock3, MapPin, Bike, Store, Check, ArrowRight, VolumeX, Eye, Printer, X, CreditCard, Banknote, AlertTriangle } from 'lucide-react'
import { supabase } from './supabase'

const money=n=>`$${Number(n||0).toLocaleString('es-MX',{maximumFractionDigits:2})}`
const branchName=id=>id==='zakia'?'KYO Zákia':'KYO Milenio'

let sharedKitchenAudioContext=null

function getKitchenAudio(){
  if(sharedKitchenAudioContext)return sharedKitchenAudioContext
  const AudioCtx=window.AudioContext||window.webkitAudioContext
  if(!AudioCtx)return null
  sharedKitchenAudioContext=new AudioCtx()
  return sharedKitchenAudioContext
}

async function unlockKitchenAudio(){
  const ctx=getKitchenAudio()
  if(!ctx)return null
  try{if(ctx.state==='suspended')await ctx.resume()}catch{}
  return ctx
}

function playKitchenAlarmPulse(ctx){
  if(!ctx||ctx.state!=='running')return
  try{
    const start=ctx.currentTime
    ;[0,0.28,0.56,0.84].forEach((offset,index)=>{
      const osc=ctx.createOscillator()
      const gain=ctx.createGain()
      const at=start+offset
      osc.type=index%2===0?'square':'sawtooth'
      osc.frequency.setValueAtTime(index%2===0?960:720,at)
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.0001,at)
      gain.gain.linearRampToValueAtTime(0.34,at+0.025)
      gain.gain.setValueAtTime(0.34,at+0.16)
      gain.gain.exponentialRampToValueAtTime(0.0001,at+0.24)
      osc.start(at)
      osc.stop(at+0.25)
    })
  }catch(error){
    console.error('Kitchen alarm error',error)
  }
}

const kitchenElapsedSeconds=(order,nowMs=Date.now())=>{
  const saved=Number(order?.kitchen_prep_seconds)
  if(order?.kitchen_ready_at&&Number.isFinite(saved)&&saved>=0)return Math.floor(saved)
  const start=Date.parse(order?.kitchen_started_at||'')
  if(!Number.isFinite(start))return null
  const ready=order?.kitchen_ready_at?Date.parse(order.kitchen_ready_at):NaN
  const end=Number.isFinite(ready)?ready:nowMs
  return Math.max(0,Math.floor((end-start)/1000))
}

const formatKitchenDuration=seconds=>{
  if(seconds===null||seconds===undefined||!Number.isFinite(Number(seconds)))return '00:00'
  const total=Math.max(0,Math.floor(Number(seconds)))
  const hours=Math.floor(total/3600)
  const minutes=Math.floor((total%3600)/60)
  const secs=total%60
  if(hours>0)return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
  return `${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
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
const firstOrderDiscount=order=>Number(order?.first_order_discount||0)
const escapeHtml=value=>String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]))
const customizationGroups=item=>Object.entries((Array.isArray(item.customizations)?item.customizations:[]).reduce((groups,c)=>{const title=c.template_name||c.group_name||c.customization_name||c.title||'Personalización';(groups[title]??=[]).push(c);return groups},{}))
const customizationLabel=c=>String(c.label||c.option_name||c.name||'Opción').replace(/^\s*\d+\s*[x×]\s*/i,'').trim()||'Opción'
const customizationPrice=c=>Number(c.price??c.option_price??c.extra_price??0)
const customizationLineTotal=c=>customizationPrice(c)*Math.max(1,Number(c.quantity||1))
const itemExtrasPerUnit=item=>(Array.isArray(item.customizations)?item.customizations:[]).reduce((sum,c)=>sum+customizationLineTotal(c),0)
const itemBasePrice=item=>Number(item._base_price??Math.max(0,Number(item.unit_price||0)-itemExtrasPerUnit(item)))
const expandedItemUnits=item=>{
  const qty=Math.max(1,Number(item.quantity||1))
  const freeQty=Math.max(0,Number(item._promo_free_qty||0))
  return Array.from({length:qty},(_,unitIndex)=>({...item,quantity:1,_unit_index:unitIndex,_promo_free_qty:unitIndex<freeQty?1:0}))
}
const expandedOrderItems=order=>(order?.order_items||[]).flatMap(expandedItemUnits)
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
const promoDiscount=order=>Number(order?.promo_discount||0)
const promoPackagingFee=order=>Number(order?.promo_packaging_fee||0)
const promoPackagingCount=order=>Number(order?.promo_packaging_count||0)
const subtotalBeforePromo=order=>Number(order?.subtotal||0)+promoDiscount(order)

function applyPromoFreeUnits(order){
  const items=(order.order_items||[]).map(i=>({...i,_promo_free_qty:0}))
  if(!order.promo_3x2_applied||promoDiscount(order)<=0)return {...order,order_items:items}
  const eligibleUnits=[]
  items.forEach((item,itemIndex)=>{
    if(!item._promo_eligible)return
    const qty=Math.max(1,Number(item.quantity||1))
    const base=Number(item._catalog_base_price??itemBasePrice(item))
    for(let n=0;n<qty;n++)eligibleUnits.push({itemIndex,base})
  })
  const freeCount=Math.floor(eligibleUnits.length/3)
  eligibleUnits.sort((a,b)=>a.base-b.base).slice(0,freeCount).forEach(({itemIndex})=>{
    items[itemIndex]._promo_free_qty=(items[itemIndex]._promo_free_qty||0)+1
  })
  return {...order,order_items:items}
}

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
  for(const i of expandedOrderItems(order)){
    lines.push(...thermalWrap(i.product_name))
    for(const [title,rows] of customizationGroups(i)){
      lines.push(...thermalWrap(`  ${String(title).toUpperCase()}`))
      for(const c of rows){
        const q=Math.max(1,Number(c.quantity||1))
        lines.push(...thermalWrap(`    - ${q}x ${customizationLabel(c)}`))
      }
    }
    if(i.item_note)lines.push(...thermalWrap(`  NOTA: ${i.item_note}`))
    lines.push(thermalRule('-'))
  }
  return lines
}

function saleItemLines(order){
  const lines=[]
  for(const i of expandedOrderItems(order)){
    const groups=customizationGroups(i)
    const basePrice=itemBasePrice(i)
    const hasCustomizations=groups.length>0

    if(!hasCustomizations){
      lines.push(...thermalPair(i.product_name,thermalMoney(Number(i.unit_price||0))))
    }else{
      lines.push(...thermalWrap(i.product_name))
      if(basePrice>0)lines.push(...thermalPair('  Base c/u',thermalMoney(basePrice)))

      for(const [title,rows] of groups){
        const visibleRows=basePrice<=0?rows.filter(c=>customizationLineTotal(c)>0):rows
        if(!visibleRows.length)continue
        lines.push(...thermalWrap(`  ${String(title).toUpperCase()}`))
        for(const c of visibleRows){
          const q=Math.max(1,Number(c.quantity||1))
          const price=customizationLineTotal(c)
          lines.push(...thermalPair(`    ${q}x ${customizationLabel(c)}`,price>0?`+${thermalMoney(price)}`:'$0'))
        }
      }
    }

    if(Number(i._promo_free_qty||0)>0){
      const freeBase=Number(i._catalog_base_price??basePrice)
      lines.push(...thermalPair('  PROMO 3x2: base gratis', `-${thermalMoney(freeBase)}`))
      if(itemExtrasPerUnit(i)>0)lines.push(...thermalWrap('    Personalizaciones se cobran normal'))
    }
    if(i.item_note)lines.push(...thermalWrap(`  NOTA: ${i.item_note}`))
    lines.push(thermalRule('-'))
  }
  return lines
}

const thermalStyles=`
  @page{margin:2mm 3mm 5mm}
  html,body{margin:0!important;padding:0!important;background:#fff!important;color:#000!important}
  body{font-family:"Courier New",Courier,monospace!important}
  .receipt{box-sizing:border-box!important;width:70mm!important;max-width:70mm!important;margin:0!important;padding:0!important}
  .ticket-line{display:block!important;box-sizing:border-box!important;width:100%!important;min-height:3.3mm!important;margin:0!important;padding:0!important;white-space:pre-wrap!important;word-break:normal!important;overflow-wrap:break-word!important;font-family:"Courier New",Courier,monospace!important;font-size:8.2pt!important;line-height:1.25!important;font-weight:600!important;letter-spacing:0!important;color:#000!important;clear:both!important;break-inside:avoid!important}
  .ticket-line.blank{height:3.3mm!important;min-height:3.3mm!important}
  @media print{
    html,body{width:auto!important;max-width:none!important}
    .receipt{width:70mm!important;max-width:70mm!important}
    body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  }
`

function openThermalPrint(order,text,title,popup=null){
  const no=String(order.order_number).padStart(4,'0')
  popup=popup||window.open('','_blank','width=420,height=800')
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

function kitchenSectionOrder(order,temp){
  return {...order,order_items:(order.order_items||[]).filter(i=>(i._kitchen_temp==='F'?'F':'C')===temp)}
}

function printKitchenSection(order,temp,popup=null){
  const section=kitchenSectionOrder(order,temp)
  if(!section.order_items.length)return false
  const label=temp==='F'?'PRODUCTOS DE FRIO':'PRODUCTOS DE CALIENTE'
  const lines=[
    thermalCenter(`*** ${label} ***`),
    thermalRule('='),
    ...kitchenItemLines(section),
    '', '', '', ''
  ]
  openThermalPrint(order,lines.join('\n'),temp==='F'?'Cocina - Frio':'Cocina - Caliente',popup)
  return true
}

function printKitchenTicket(order){
  const cold=order.order_items?.some(i=>i._kitchen_temp==='F')
  const hot=order.order_items?.some(i=>i._kitchen_temp!=='F')
  if(cold&&hot){
    const coldPopup=window.open('','_blank','width=420,height=800')
    const hotPopup=window.open('','_blank','width=420,height=800')
    if(!coldPopup||!hotPopup){
      coldPopup?.close();hotPopup?.close()
      alert('Permite ventanas emergentes para imprimir los tickets de frio y caliente por separado.')
      return
    }
    printKitchenSection(order,'F',coldPopup)
    printKitchenSection(order,'C',hotPopup)
    return
  }
  if(cold){printKitchenSection(order,'F');return}
  printKitchenSection(order,'C')
}

function printSaleTicket(order){
  const method=paymentLabel(order)
  const methodKey=normalizedPaymentMethod(order)
  const paymentStatus=isPaid(order)?`PAGADO - ${method}`:methodKey==='terminal'?'COBRAR CON TERMINAL':methodKey==='cash'?'COBRAR EN EFECTIVO':'PAGO CON TARJETA PENDIENTE'
  const lines=[
    ...ticketHeaderLines(order,'TICKET DE VENTA'),
    ...saleItemLines(order)
  ]
  if(promoDiscount(order)>0){
    lines.push(...thermalPair('PRODUCTOS ANTES PROMO',thermalMoney(subtotalBeforePromo(order))))
    lines.push(...thermalPair('PROMO 3x2',`-${thermalMoney(promoDiscount(order))}`))
    lines.push(...thermalPair('SUBTOTAL CON PROMO',thermalMoney(order.subtotal)))
  }else{
    lines.push(...thermalPair('SUBTOTAL',thermalMoney(order.subtotal)))
  }
  if(firstOrderDiscount(order)>0)lines.push(...thermalPair('REGALO PRIMER PEDIDO',`-${thermalMoney(firstOrderDiscount(order))}`))
  if(promoPackagingFee(order)>0)lines.push(...thermalPair(`EMPAQUE 3x2 (${promoPackagingCount(order)} x $14)`,thermalMoney(promoPackagingFee(order))))
  if(Number(order.delivery_fee||0)>0)lines.push(...thermalPair(order.delivery_zone_name?`ENVIO ${order.delivery_zone_name.toUpperCase()}`:'ENVIO',thermalMoney(order.delivery_fee)))
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
function KitchenLogin(){const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const submit=async e=>{e.preventDefault();await unlockKitchenAudio();setBusy(true);const {error}=await supabase.auth.signInWithPassword({email,password});setBusy(false);if(error)setError(error.message)};return <main className="kitchen-login"><form className="kitchen-login-card" onSubmit={submit}><ChefHat size={42}/><span>MODO COCINA</span><h1>KYO</h1><p>Entra con la cuenta de tu sucursal.</p><label>Correo<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="zakia@kyosushi.mx"/></label><label>Contraseña<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="form-message">{error}</div>}<button className="primary full" disabled={busy}>{busy?'Entrando...':'Entrar a cocina'}</button></form></main>}

export function KitchenMode({auth}){
  const branch=auth.profile?.kitchen_branch||'zakia'
  const [orders,setOrders]=useState([])
  const [loading,setLoading]=useState(true)
  const [riders,setRiders]=useState(fallbackRiders[branch])
  const [detailOrder,setDetailOrder]=useState(null)
  const [realtimeState,setRealtimeState]=useState(typeof navigator!=='undefined'&&!navigator.onLine?'offline':'connecting')
  const [lastSyncAt,setLastSyncAt]=useState(null)
  const [syncError,setSyncError]=useState('')
  const [alarmBlocked,setAlarmBlocked]=useState(false)
  const [audioReady,setAudioReady]=useState(false)
  const [nowMs,setNowMs]=useState(Date.now())
  const loadRequestRef=useRef(0)
  const branchRef=useRef(branch)
  const alarmIntervalRef=useRef(null)
  branchRef.current=branch

  useEffect(()=>{
    const timer=setInterval(()=>setNowMs(Date.now()),1000)
    return()=>clearInterval(timer)
  },[])

  useEffect(()=>{
    let disposed=false
    const checkAudio=async()=>{
      const ctx=await unlockKitchenAudio()
      if(disposed)return
      const ready=!!ctx&&ctx.state==='running'
      setAudioReady(ready)
      setAlarmBlocked(!ready)
    }
    checkAudio()
    return()=>{disposed=true}
  },[])

  const activateKitchenAudio=async()=>{
    const ctx=await unlockKitchenAudio()
    const ready=!!ctx&&ctx.state==='running'
    setAudioReady(ready)
    setAlarmBlocked(!ready)
    if(ready){
      // Feedback confirms that the browser has really enabled sound. If a new
      // order is already waiting for acknowledgement, the alarm effect below
      // immediately takes over and keeps repeating until Enterado.
      playKitchenAlarmPulse(ctx)
    }
    return ready
  }

  const loadRiders=async()=>{
    if(!supabase)return
    const {data,error}=await supabase.from('app_settings').select('delivery_riders').eq('id','main').maybeSingle()
    if(error){console.error('Kitchen riders load error',error);return}
    const configured=data?.delivery_riders?.[branch]
    if(Array.isArray(configured)&&configured.length)setRiders([0,1].map(i=>configured[i]||{name:`Repartidor ${i+1}`,phone:''}))
    else setRiders(fallbackRiders[branch])
  }

  const load=async({silent=false}={})=>{
    if(!supabase)return false
    const requestId=++loadRequestRef.current
    const requestBranch=branch
    if(!silent)setLoading(true)
    try{
      const {data,error}=await supabase
        .from('orders')
        .select('*, order_items(*), profiles(full_name,phone)')
        .eq('branch_id',requestBranch)
        .in('status',['preparing','ready','on_the_way'])
        .order('created_at',{ascending:true})
      if(error)throw error

      const rawOrders=data||[]
      const allItems=rawOrders.flatMap(o=>o.order_items||[])
      const templateIds=[...new Set(allItems.flatMap(i=>(Array.isArray(i.customizations)?i.customizations:[]).map(c=>c.template_id).filter(Boolean)))]
      const productIds=[...new Set(allItems.map(i=>i.product_id).filter(Boolean))]
      const [templatesResult,promoProductsResult]=await Promise.all([
        templateIds.length?supabase.from('customization_templates').select('id,name,options').in('id',templateIds):Promise.resolve({data:[],error:null}),
        productIds.length?supabase.from('products').select('id,price,promo_3x2_eligible,kitchen_temp').in('id',productIds):Promise.resolve({data:[],error:null})
      ])
      if(templatesResult.error)throw templatesResult.error
      if(promoProductsResult.error)throw promoProductsResult.error

      const templateMap=new Map((templatesResult.data||[]).map(t=>[String(t.id),t]))
      const productMap=new Map((promoProductsResult.data||[]).map(p=>[String(p.id),p]))
      const hydrated=rawOrders.map(order=>applyPromoFreeUnits({...order,order_items:(order.order_items||[]).map(item=>{
        const customs=(Array.isArray(item.customizations)?item.customizations:[]).map(c=>{
          const template=templateMap.get(String(c.template_id))
          const option=(template?.options||[]).find(o=>String(o.id)===String(c.option_id))
          return {...c,template_name:template?.name||c.template_name||'Personalización',label:option?.name||option?.label||c.label||c.option_name||c.name||'Opción',price:Number(option?.price??c.price??0)}
        })
        const extras=customs.reduce((sum,c)=>sum+customizationLineTotal(c),0)
        const product=productMap.get(String(item.product_id))
        return {...item,customizations:customs,_base_price:Math.max(0,Number(item.unit_price||0)-extras),_extras_total:extras,_promo_eligible:!!product?.promo_3x2_eligible,_catalog_base_price:Number(product?.price??Math.max(0,Number(item.unit_price||0)-extras)),_kitchen_temp:product?.kitchen_temp==='F'?'F':'C'}
      })}))

      // Only the newest request is allowed to update the board. This prevents an
      // older/slower response from overwriting a newer snapshot of active orders.
      if(requestId!==loadRequestRef.current||branchRef.current!==requestBranch)return false

      setOrders(hydrated)
      setDetailOrder(current=>{
        if(!current)return current
        return hydrated.find(o=>String(o.id)===String(current.id))||current
      })
      setLastSyncAt(new Date())
      setSyncError('')
      return true
    }catch(error){
      if(requestId===loadRequestRef.current&&branchRef.current===requestBranch){
        console.error('Kitchen orders load error',error)
        setSyncError('No se pudo verificar la lista de pedidos. Se volverá a intentar automáticamente.')
      }
      return false
    }finally{
      if(requestId===loadRequestRef.current&&branchRef.current===requestBranch)setLoading(false)
    }
  }

  useEffect(()=>{
    setSyncError('')
    setRealtimeState(typeof navigator!=='undefined'&&!navigator.onLine?'offline':'connecting')

    if(!supabase){setLoading(false);return}

    let disposed=false
    let channel=null
    let reconnectTimer=null
    let channelAttempt=0

    const scheduleReconnect=()=>{
      if(disposed||typeof navigator!=='undefined'&&!navigator.onLine)return
      if(reconnectTimer)clearTimeout(reconnectTimer)
      reconnectTimer=setTimeout(()=>{
        if(disposed)return
        setRealtimeState('connecting')
        connectRealtime()
      },2500)
    }

    const connectRealtime=()=>{
      if(disposed||!supabase)return
      if(typeof navigator!=='undefined'&&!navigator.onLine){setRealtimeState('offline');return}

      if(channel){
        const oldChannel=channel
        channel=null
        supabase.removeChannel(oldChannel).catch(()=>{})
      }

      const nextChannel=supabase
        .channel(`kitchen-${branch}-${++channelAttempt}`)
        .on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`branch_id=eq.${branch}`},payload=>{
          if(disposed)return
          load({silent:true})
        })

      channel=nextChannel
      nextChannel.subscribe(status=>{
        if(disposed||channel!==nextChannel)return
        if(status==='SUBSCRIBED'){
          if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}
          setRealtimeState('live')
          // Fresh snapshot after subscription closes the startup gap between
          // the first database read and Realtime becoming fully connected.
          load({silent:true})
          return
        }
        if(['TIMED_OUT','CHANNEL_ERROR','CLOSED'].includes(status)){
          setRealtimeState(typeof navigator!=='undefined'&&!navigator.onLine?'offline':'degraded')
          scheduleReconnect()
        }
      })
    }

    const online=()=>{
      if(disposed)return
      setRealtimeState('connecting')
      load({silent:true})
      connectRealtime()
    }
    const offline=()=>{if(!disposed)setRealtimeState('offline')}
    const refreshWhenVisible=()=>{
      if(disposed)return
      if(typeof document!=='undefined'&&document.visibilityState==='visible'&&(typeof navigator==='undefined'||navigator.onLine))load({silent:true})
    }
    const refreshOnFocus=()=>{
      if(disposed)return
      if(typeof navigator==='undefined'||navigator.onLine)load({silent:true})
    }

    // Connect first, then take a snapshot; another snapshot runs on SUBSCRIBED.
    // Together this eliminates the small startup window where an order could be missed.
    connectRealtime()
    load()
    loadRiders()

    // Realtime remains the primary path. This 10-second poll is a safety net in
    // case the browser/WebSocket ever misses an event.
    const safetyPoll=setInterval(()=>{
      if(disposed)return
      const visible=typeof document==='undefined'||document.visibilityState==='visible'
      const onlineNow=typeof navigator==='undefined'||navigator.onLine
      if(visible&&onlineNow)load({silent:true})
    },10000)

    window.addEventListener('online',online)
    window.addEventListener('offline',offline)
    window.addEventListener('focus',refreshOnFocus)
    document.addEventListener('visibilitychange',refreshWhenVisible)

    return()=>{
      disposed=true
      loadRequestRef.current+=1
      clearInterval(safetyPoll)
      if(reconnectTimer)clearTimeout(reconnectTimer)
      window.removeEventListener('online',online)
      window.removeEventListener('offline',offline)
      window.removeEventListener('focus',refreshOnFocus)
      document.removeEventListener('visibilitychange',refreshWhenVisible)
      if(channel){
        const oldChannel=channel
        channel=null
        supabase.removeChannel(oldChannel).catch(()=>{})
      }
    }
  },[branch])

  const unacknowledgedPreparing=orders.filter(o=>o.status==='preparing'&&!o.kitchen_acknowledged_at)
  const unacknowledgedPreparingKey=unacknowledgedPreparing.map(o=>String(o.id)).sort().join('|')

  useEffect(()=>{
    const stopAlarm=()=>{
      if(alarmIntervalRef.current){
        clearInterval(alarmIntervalRef.current)
        alarmIntervalRef.current=null
      }
    }

    stopAlarm()
    if(!unacknowledgedPreparingKey){
      setAlarmBlocked(false)
      return
    }

    let disposed=false
    const startAlarm=async()=>{
      if(disposed||alarmIntervalRef.current)return
      const ctx=getKitchenAudio()
      if(!audioReady||!ctx||ctx.state!=='running'){
        setAlarmBlocked(true)
        setAudioReady(false)
        return
      }
      setAlarmBlocked(false)
      playKitchenAlarmPulse(ctx)
      alarmIntervalRef.current=setInterval(()=>playKitchenAlarmPulse(ctx),1450)
    }

    startAlarm()
    return()=>{
      disposed=true
      stopAlarm()
    }
  },[unacknowledgedPreparingKey,audioReady])


  const acknowledgeOrder=async order=>{
    if(!order?.id||order.status!=='preparing'||order.kitchen_acknowledged_at)return true
    // Invalidate any snapshot that may have started before this acknowledgement,
    // so a stale response cannot paint the ticket red again.
    loadRequestRef.current+=1
    const acknowledgedAt=new Date().toISOString()
    const {data,error}=await supabase
      .from('orders')
      .update({kitchen_acknowledged_at:acknowledgedAt})
      .eq('id',order.id)
      .eq('branch_id',branch)
      .eq('status','preparing')
      .select('id,kitchen_acknowledged_at')
      .maybeSingle()
    if(error){
      console.error('Kitchen acknowledge error',error)
      alert('No pudimos marcar el pedido como enterado. Revisa la conexión e intenta nuevamente.')
      return false
    }
    const stamp=data?.kitchen_acknowledged_at||acknowledgedAt
    setOrders(current=>current.map(o=>String(o.id)===String(order.id)?{...o,kitchen_acknowledged_at:stamp}:o))
    setDetailOrder(current=>current&&String(current.id)===String(order.id)?{...current,kitchen_acknowledged_at:stamp}:current)
    load({silent:true})
    return true
  }

  const setStatus=async(id,status)=>{
    const currentOrder=orders.find(o=>String(o.id)===String(id))
    if(status==='ready'&&currentOrder?.status==='preparing'&&!currentOrder?.kitchen_acknowledged_at){
      alert('Primero toca MUTE · Enterado en este pedido. Así Cocina confirma que ya lo vio antes de marcarlo listo.')
      return false
    }
    const {error}=await supabase.from('orders').update({status}).eq('id',id)
    if(error){
      console.error('Kitchen status update error',error)
      alert('No pudimos actualizar el estado del pedido. Revisa la conexión e intenta nuevamente.')
      await load({silent:true})
      return false
    }
    await load()
    return true
  }
  const advanceOrder=async(id,order)=>{
    if(order.fulfillment_type==='pickup'){
      const payment=isPaid(order)?`Este pedido YA ESTÁ PAGADO (${money(chargedTotal(order))}).`:`Este pedido se cobra por ${paymentLabel(order).toLowerCase()} (${money(chargedTotal(order))}).`
      if(!window.confirm(`CONFIRMAR ENTREGA PICKUP\n\nPedido #${String(order.order_number).padStart(4,'0')}\n${payment}\n\n¿El cliente ya recibió físicamente su pedido?`))return
      await setStatus(id,'delivered')
      return
    }
    await setStatus(id,'on_the_way')
  }

  const preparing=orders.filter(o=>o.status==='preparing')
  const ready=orders.filter(o=>o.status==='ready')
  const route=orders.filter(o=>o.status==='on_the_way')
  const visualSyncState=syncError&&realtimeState==='live'?'degraded':realtimeState
  const syncTitle=visualSyncState==='live'?'En vivo':visualSyncState==='offline'?'Sin conexión':visualSyncState==='degraded'?'Respaldo activo':'Conectando'
  const syncDetail=visualSyncState==='offline'
    ?'Se sincroniza al volver internet'
    :lastSyncAt
      ?`Verificado ${lastSyncAt.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} · respaldo 10 s`
      :'Preparando sincronización'

  return <main className="kitchen-shell">
    {!audioReady&&<div className="kitchen-audio-gate" role="dialog" aria-modal="true"><section><div className="kitchen-audio-gate-icon"><VolumeX/></div><span>ALERTA DE COCINA</span><h2>Activa el sonido antes de recibir pedidos</h2><p>El navegador necesita una activación manual una sola vez. Después, cada pedido nuevo sonará desde que entra en <b>Preparando</b> y no se callará hasta tocar <b>MUTE · Enterado</b> en ese pedido.</p><button onClick={activateKitchenAudio}>Activar alarmas de cocina</button><small>Este paso evita que el primer pedido quede en silencio por el bloqueo de audio del navegador.</small></section></div>}
    <header className="kitchen-head"><div><span>MODO COCINA</span><h1>{branchName(branch)}</h1><p>Pedidos en tiempo real · cada pedido nuevo requiere confirmación de Enterado.</p></div><div className="kitchen-head-actions"><div className={`kitchen-sync-pill ${visualSyncState}`} title={syncError||syncDetail}><i/><div><strong>{syncTitle}</strong><small>{syncDetail}</small></div></div><button onClick={()=>{load();loadRiders()}} title="Actualizar"><RefreshCw className={loading?'spin':''}/></button><button onClick={()=>supabase.auth.signOut()} title="Cerrar sesión"><LogOut/></button></div></header>
    {alarmBlocked&&audioReady&&unacknowledgedPreparing.length>0&&<div className="kitchen-audio-warning"><VolumeX/><div><strong>La alarma perdió permiso de audio</strong><small>Activa nuevamente el sonido para que los pedidos pendientes sigan sonando. No marques Enterado hasta recuperar la alarma.</small></div><button onClick={activateKitchenAudio}>Reactivar alarma</button></div>}
    {(visualSyncState==='offline'||visualSyncState==='degraded')&&<div className={`kitchen-sync-warning ${visualSyncState}`}><AlertTriangle/><div><strong>{visualSyncState==='offline'?'Cocina está sin internet':'Realtime tuvo una interrupción'}</strong><small>{visualSyncState==='offline'?'No se pueden recibir cambios hasta recuperar conexión. Al volver internet, Cocina actualizará los pedidos automáticamente.':'La pantalla sigue verificando la base de datos cada 10 segundos y está intentando reconectar Realtime.'}</small></div></div>}
    <section className="kitchen-board"><KitchenColumn title="Preparando" tone="preparing" count={preparing.length} orders={preparing} actionLabel="Marcar listo" actionIcon={<Check/>} onAction={id=>setStatus(id,'ready')} onDetails={setDetailOrder} onAcknowledge={acknowledgeOrder} nowMs={nowMs}/><KitchenColumn title="Listos para entregar" tone="ready" count={ready.length} orders={ready} actionLabel={o=>o.fulfillment_type==='pickup'?'Confirmar entrega':'Salió a ruta'} actionIcon={o=>o.fulfillment_type==='pickup'?<Check/>:<Bike/>} onAction={advanceOrder} onDetails={setDetailOrder} onAcknowledge={acknowledgeOrder} nowMs={nowMs}/></section>
    {route.length>0&&<section className="route-strip"><div className="route-strip-head"><span>EN CAMINO</span><strong>{route.length} pedido{route.length!==1?'s':''}</strong></div><div className="route-orders-list">{route.map(o=><div className="route-order-row" key={o.id}><div className="route-order-info"><strong>Pedido #{String(o.order_number).padStart(4,'0')}</strong><small>{o.delivery_address}</small></div><div className="route-order-actions"><button className="route-detail-btn" onClick={()=>setDetailOrder(o)}><Eye/> Ver detalles</button>{riders.map((rider,index)=><button key={index} className={`rider-btn rider-${index+1}`} onClick={()=>sendOrderToRider(o,rider)}>Enviar a {rider?.name?.trim()||`Repartidor ${index+1}`}</button>)}<button className="delivered-btn" onClick={()=>setStatus(o.id,'delivered')}>Marcar entregado <ArrowRight/></button></div></div>)}</div></section>}
    {detailOrder&&<KitchenOrderDetail order={detailOrder} nowMs={nowMs} onAcknowledge={acknowledgeOrder} onClose={()=>setDetailOrder(null)} onPrintKitchen={()=>printKitchenTicket(detailOrder)} onPrintSale={()=>printSaleTicket(detailOrder)} onStatusAction={async order=>{if(order.status==='preparing'){const ok=await setStatus(order.id,'ready');if(ok)setDetailOrder(null);return}if(order.status==='ready'){await advanceOrder(order.id,order);setDetailOrder(null)}}}/>}
  </main>
}

function KitchenColumn({title,tone,count,orders,actionLabel,actionIcon,onAction,onDetails,onAcknowledge,nowMs}){return <section className={`kitchen-column kitchen-column-${tone||''}`}><header><div><small>{tone==='preparing'?'EN PRODUCCIÓN':'SALIDA'}</small><h2>{title}</h2></div><b>{count}</b></header><div className="kitchen-list">{orders.length===0?<div className="kitchen-empty">No hay pedidos aquí.</div>:orders.map(o=><KitchenTicket key={o.id} order={o} actionLabel={typeof actionLabel==='function'?actionLabel(o):actionLabel} actionIcon={typeof actionIcon==='function'?actionIcon(o):actionIcon} onAction={()=>onAction(o.id,o)} onDetails={()=>onDetails(o)} onAcknowledge={()=>onAcknowledge(o)} nowMs={nowMs}/>)}</div></section>}

function KitchenTicket({order,actionLabel,actionIcon,onAction,onDetails,onAcknowledge,nowMs}){
  const pickup=order.fulfillment_type==='pickup'
  const paid=isPaid(order)
  const units=order.order_items?.reduce((a,i)=>a+Number(i.quantity||0),0)||0
  const needsAck=order.status==='preparing'&&!order.kitchen_acknowledged_at
  const prepSeconds=kitchenElapsedSeconds(order,nowMs)
  const prepLabel=formatKitchenDuration(prepSeconds)
  const blockedReady=order.status==='preparing'&&needsAck
  return <article className={`kitchen-ticket ${pickup?'pickup-ticket':'delivery-ticket'} ${needsAck?'needs-ack':''}`}>
    <div className="ticket-type-banner">{pickup?<><Store/> PICKUP · RECOGE EN SUCURSAL</>:<><Bike/> DELIVERY</>}</div>
    <div className={`ticket-kitchen-alert ${needsAck?'alarm':order.status==='ready'?'done':'acknowledged'}`}>
      <div className="ticket-prep-clock"><Clock3/><span><small>{order.status==='ready'?'TIEMPO HASTA LISTO':'TIEMPO PREPARANDO'}</small><strong>{prepLabel}</strong></span></div>
      {needsAck?<button className="ticket-ack-btn" onClick={onAcknowledge}><VolumeX/><span><small>MUTE</small><strong>Enterado</strong></span></button>:<div className="ticket-ack-ok"><Check/><span>{order.status==='ready'?'Listo':'Enterado'}</span></div>}
    </div>
    <div className="ticket-top"><div><small>PEDIDO</small><h3>#{String(order.order_number).padStart(4,'0')}</h3></div><span><Clock3/> {new Date(order.created_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</span></div>
    <div className={`ticket-payment-alert ${paid?'paid':'collect'}`}>{paid?<CreditCard/>:<Banknote/>}<div><small>{paid?'PAGO CONFIRMADO':'PENDIENTE DE COBRO'}</small><strong>{paid?`Ya cobrado · ${money(chargedTotal(order))}`:`Cobrar ${money(chargedTotal(order))} · ${paymentLabel(order)}`}</strong></div></div>
    <button className="ticket-products-hidden" onClick={onDetails}><span><Eye/><b>{units} producto{units!==1?'s':''}</b></span><small>Contenido oculto · abre Ver detalles para preparar</small></button>
    <div className="ticket-customer"><strong>{order.profiles?.full_name||'Cliente KYO'}</strong>{order.profiles?.phone&&<span>Tel. {order.profiles.phone}</span>}</div>
    <div className="ticket-meta">{order.delivery_address&&<span><MapPin/>{order.delivery_address}</span>}{order.delivery_reference&&<p><b>Referencia:</b> {order.delivery_reference}</p>}</div>
    <div className="ticket-quick-actions"><button className="detail-btn" onClick={onDetails}><Eye/> Ver detalles</button><button className="print-btn kitchen-print-btn" onClick={()=>printKitchenTicket(order)}><Printer/> Ticket cocina</button><button className="print-btn sale-print-btn" onClick={()=>printSaleTicket(order)}><Printer/> Ticket venta</button></div>
    <div className="ticket-foot"><div className="kitchen-payment-total"><strong>{money(chargedTotal(order))}</strong><small>{paymentLabel(order)}{Number(order.tip_amount||0)>0?` · Propina ${money(order.tip_amount)}`:''}</small></div><button className={pickup?'pickup-deliver-btn':''} disabled={blockedReady} title={blockedReady?'Primero marca este pedido como Enterado':''} onClick={onAction}>{blockedReady?<VolumeX/>:actionIcon}{blockedReady?'Primero Enterado':actionLabel}</button></div>
  </article>
}

function KitchenOrderDetail({order,nowMs,onAcknowledge,onClose,onPrintKitchen,onPrintSale,onStatusAction}){
  const pickup=order.fulfillment_type==='pickup', paid=isPaid(order)
  const needsAck=order.status==='preparing'&&!order.kitchen_acknowledged_at
  const prepLabel=formatKitchenDuration(kitchenElapsedSeconds(order,nowMs))
  const actionLabel=order.status==='preparing'?'Marcar pedido listo':order.status==='ready'?(pickup?'Confirmar entrega pickup':'Marcar salida a ruta'):null
  return <div className="kitchen-detail-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="kitchen-detail-modal">
    <header className="kitchen-detail-head"><div><small>DETALLE COMPLETO</small><h2>Pedido #{String(order.order_number).padStart(4,'0')}</h2><p>{new Date(order.created_at).toLocaleString('es-MX')} · {branchName(order.branch_id)}</p></div><button onClick={onClose}><X/></button></header>
    <div className={`kitchen-detail-fulfillment ${pickup?'pickup':'delivery'}`}><div>{pickup?<Store/>:<Bike/>}<span><small>TIPO DE PEDIDO</small><strong>{pickup?'PICKUP · RECOGE EN SUCURSAL':'DELIVERY · ENVÍO A DOMICILIO'}</strong></span></div><div className={paid?'paid':'collect'}>{paid?<CreditCard/>:<AlertTriangle/>}<span><small>{paid?'PAGO CONFIRMADO':'COBRO PENDIENTE'}</small><strong>{paid?`Ya se cobró ${money(chargedTotal(order))}`:`Cobrar ${money(chargedTotal(order))} · ${paymentLabel(order)}`}</strong></span></div></div>
    <div className={`kitchen-detail-timing ${needsAck?'alarm':''}`}><div><Clock3/><span><small>{order.status==='ready'?'TIEMPO HASTA LISTO':'TIEMPO PREPARANDO'}</small><strong>{prepLabel}</strong></span></div>{needsAck?<button onClick={()=>onAcknowledge(order)}><VolumeX/><span><small>MUTE</small><strong>Enterado</strong></span></button>:<span className="kitchen-detail-ack-ok"><Check/> {order.status==='ready'?'Pedido listo':'Enterado'}</span>}</div>
    <div className="kitchen-detail-customer"><div><small>CLIENTE</small><strong>{order.profiles?.full_name||'Cliente KYO'}</strong>{order.profiles?.phone&&<span>{order.profiles.phone}</span>}</div><div><small>MÉTODO DE PAGO</small><strong>{paymentLabel(order)}</strong><span>{paid?'Pago confirmado':'Pendiente al entregar'}</span></div></div>
    {(order.delivery_address||order.delivery_reference||order.delivery_notes)&&<div className="kitchen-detail-notes">{order.delivery_address&&<p><MapPin/><span><small>DIRECCIÓN</small><strong>{order.delivery_address}</strong></span></p>}{order.delivery_reference&&<p><span><small>REFERENCIA</small><strong>{order.delivery_reference}</strong></span></p>}{order.delivery_notes&&<p className="important"><span><small>NOTAS DEL PEDIDO</small><strong>{order.delivery_notes}</strong></span></p>}</div>}
    <div className="kitchen-detail-items"><div className="kitchen-detail-section-title"><span>PRODUCTOS</span><b>{order.order_items?.reduce((a,i)=>a+Number(i.quantity||0),0)||0} unidades</b></div>{expandedOrderItems(order).map(i=><article key={`${i.id}-${i._unit_index}`}><div className="detail-item-main"><span><strong>{i.product_name}</strong></span><div><small>Precio</small><strong>{money(i.unit_price)}</strong></div></div><div className="detail-price-breakdown"><div><span>Producto base</span><strong>{money(itemBasePrice(i))}</strong></div>{itemExtrasPerUnit(i)>0&&<div><span>Personalizaciones</span><strong>+{money(itemExtrasPerUnit(i))}</strong></div>}{Number(i._promo_free_qty||0)>0&&<div className="promo-free-detail"><span>Promo 3×2 · base gratis</span><strong>-{money(Number(i._catalog_base_price??itemBasePrice(i)))}</strong></div>}<div className="final"><span>Precio final</span><strong>{money(i.unit_price)}</strong></div></div>{customizationGroups(i).length>0&&<div className="detail-customs">{customizationGroups(i).map(([title,rows])=><section key={title}><b>{title}</b>{rows.map((c,idx)=><p key={idx}><span>{Math.max(1,Number(c.quantity||1))}× {customizationLabel(c)}</span><strong>{customizationPrice(c)>0?`+${money(customizationLineTotal(c))}`:'Sin costo'}</strong></p>)}</section>)}</div>}{i.item_note&&<div className="detail-item-note"><b>NOTA DEL CLIENTE</b><span>{i.item_note}</span></div>}</article>)}</div>
    <div className="kitchen-detail-totals"><div><span>Productos antes de promo</span><strong>{money(subtotalBeforePromo(order))}</strong></div>{promoDiscount(order)>0&&<div className="promo-free-detail"><span>Promo 3×2 · producto(s) base gratis</span><strong>-{money(promoDiscount(order))}</strong></div>}<div><span>Subtotal después de promo</span><strong>{money(order.subtotal)}</strong></div>{firstOrderDiscount(order)>0&&<div className="promo-free-detail"><span>Regalo primer pedido</span><strong>-{money(firstOrderDiscount(order))}</strong></div>}{promoPackagingFee(order)>0&&<div><span>Empaque promo 3×2 · {promoPackagingCount(order)} × $14</span><strong>{money(promoPackagingFee(order))}</strong></div>}{Number(order.delivery_fee||0)>0&&<div><span>Envío{order.delivery_zone_name?` · ${order.delivery_zone_name}`:''}</span><strong>{money(order.delivery_fee)}</strong></div>}<div><span>Venta KYO</span><strong>{money(order.total)}</strong></div>{Number(order.tip_amount||0)>0&&<div><span>Propina</span><strong>{money(order.tip_amount)}</strong></div>}<div className="grand"><span>{paid?'TOTAL COBRADO':'TOTAL A COBRAR'}</span><strong>{money(chargedTotal(order))}</strong></div></div>
    <footer className="kitchen-detail-footer"><button className="secondary" onClick={onClose}>Cerrar</button><button className="primary-print kitchen" onClick={onPrintKitchen}><Printer/> Imprimir ticket cocina</button><button className="primary-print sale" onClick={onPrintSale}><Printer/> Imprimir ticket venta</button>{actionLabel&&<button className={`detail-status-action ${order.status==='preparing'?'ready-action':pickup?'pickup-action':'route-action'}`} disabled={order.status==='preparing'&&needsAck} onClick={()=>onStatusAction(order)}>{order.status==='preparing'&&needsAck?<VolumeX/>:order.status==='preparing'?<Check/>:pickup?<Check/>:<Bike/>}{order.status==='preparing'&&needsAck?'Primero marca Enterado':actionLabel}</button>}</footer>
  </section></div>
}
