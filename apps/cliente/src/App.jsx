import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Home, Gift, ShoppingBag, User, Search, BookOpen, MapPin, ChevronRight, Flame, Plus, Minus,
  ArrowLeft, CreditCard, Banknote, Store, Bike, Check, LogOut, Settings,
  Trash2, Navigation, ChevronDown, Sparkles, RefreshCw, X, MapPinned, Pencil, Clock3, CircleHelp, MessageCircle
} from 'lucide-react'
import { fallbackCategories, fallbackProducts, branches as fallbackBranches } from './data'
import { supabase, supabaseConfigured } from './supabase'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

const money = n => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`
const clientStatus = (status,fulfillment='delivery') => status === 'pending_payment' ? 'Esperando pago' : status === 'delivered' ? 'Entregado' : status === 'cancelled' ? 'Cancelado' : fulfillment==='pickup' && ['ready','on_the_way'].includes(status) ? 'Listo para recoger' : status === 'on_the_way' ? 'En camino' : 'Preparando'
const emptyAddress = { label:'Casa', street:'', exterior_number:'', interior_number:'', neighborhood:'', postal_code:'', branch_id:'', notes:'' }

function newRequestId(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0
    const v=c==='x'?r:(r&0x3|0x8)
    return v.toString(16)
  })
}

function whatsappNumber(phone){
  const digits=String(phone||'').replace(/\D/g,'')
  if(digits.length===10)return `52${digits}`
  if(digits.length===12&&digits.startsWith('52'))return digits
  return digits
}

function usePersistedState(key, initial) {
  const [state, setState] = useState(() => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : initial } catch { return initial }
  })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)) }, [key, state])
  return [state, setState]
}

function friendlyError(error,context='general'){
  if(typeof navigator!=='undefined'&&!navigator.onLine){
    return 'Sin conexión a internet. Revisa tu conexión e intenta nuevamente.'
  }

  const raw=String(error?.message||error||'').trim()
  const lower=raw.toLowerCase()

  if(context==='login'&&lower.includes('invalid login credentials')){
    return 'Contraseña incorrecta, intenta de nuevo.'
  }
  if(lower.includes('user already registered')||lower.includes('already been registered')){
    return 'Ya existe una cuenta con este correo.'
  }
  if(lower.includes('email rate limit')||lower.includes('rate limit')){
    return 'Hiciste varios intentos seguidos. Espera un momento e intenta nuevamente.'
  }

  const safeBackendMessages=[
    'kyo está cerrado',
    'pedido mínimo',
    'no tienes suficientes puntos',
    'aún no completas 6 pedidos',
    'no está disponible en esta sucursal',
    'no está disponible',
    'este reward ya',
    'debes iniciar sesión',
    'no puedes eliminar tu cuenta mientras tengas un pedido activo',
    'el reward de 6 pedidos'
  ]
  if(safeBackendMessages.some(x=>lower.includes(x)))return raw

  if(context==='order')return 'No pudimos procesar tu pedido. Intenta nuevamente.'
  if(context==='address')return 'No pudimos guardar la dirección. Revisa tu conexión e intenta nuevamente.'
  if(context==='profile')return 'No pudimos guardar el cambio. Intenta nuevamente.'
  if(context==='email')return 'No pudimos actualizar tu correo. Intenta nuevamente.'
  if(context==='rewards')return 'No pudimos procesar tu reward. Intenta nuevamente.'
  if(context==='account_delete')return 'No pudimos eliminar tu cuenta. Intenta nuevamente o contacta a KYO.'
  if(context==='password')return 'No pudimos completar la recuperación. Intenta nuevamente.'
  return 'Ocurrió un problema. Intenta nuevamente.'
}

function useOnlineStatus(){
  const [online,setOnline]=useState(typeof navigator==='undefined'?true:navigator.onLine)
  useEffect(()=>{
    const on=()=>setOnline(true)
    const off=()=>setOnline(false)
    window.addEventListener('online',on)
    window.addEventListener('offline',off)
    return()=>{
      window.removeEventListener('online',on)
      window.removeEventListener('offline',off)
    }
  },[])
  return online
}

function ConnectionBanner(){
  const online=useOnlineStatus()
  if(online)return null
  return <div className="connection-banner"><span></span><div><strong>Sin conexión</strong><small>Revisa tu internet. Algunas acciones están pausadas.</small></div></div>
}

function useAuth(){
  const [session,setSession]=useState(null)
  const [profile,setProfile]=useState(null)
  const [loading,setLoading]=useState(supabaseConfigured)
  const loadProfile=async user=>{
    if(!supabase || !user){setProfile(null);return}
    const {data}=await supabase.from('profiles').select('*').eq('id',user.id).maybeSingle()
    setProfile(data || null)
  }
  useEffect(()=>{
    if(!supabase){setLoading(false);return}
    supabase.auth.getSession().then(async ({data})=>{setSession(data.session);await loadProfile(data.session?.user);setLoading(false)})
    const {data:{subscription}}=supabase.auth.onAuthStateChange(async (_event,next)=>{setSession(next);await loadProfile(next?.user);setLoading(false)})
    return ()=>subscription.unsubscribe()
  },[])
  return {session,user:session?.user||null,profile,setProfile,loading,refreshProfile:()=>loadProfile(session?.user)}
}

const defaultBusinessHours={
  mon:{closed:true,open:'13:00',close:'21:00'},
  tue:{closed:false,open:'13:00',close:'21:00'},
  wed:{closed:false,open:'13:00',close:'21:00'},
  thu:{closed:false,open:'13:00',close:'22:00'},
  fri:{closed:false,open:'13:00',close:'22:00'},
  sat:{closed:false,open:'13:00',close:'22:00'},
  sun:{closed:false,open:'13:00',close:'22:00'}
}

const mexicoDayMap={Mon:'mon',Tue:'tue',Wed:'wed',Thu:'thu',Fri:'fri',Sat:'sat',Sun:'sun'}

function mexicoNowParts(){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Mexico_City',
    weekday:'short',
    hour:'2-digit',
    minute:'2-digit',
    hourCycle:'h23'
  }).formatToParts(new Date())
  const get=t=>parts.find(p=>p.type===t)?.value
  return {day:mexicoDayMap[get('weekday')],time:`${get('hour')}:${get('minute')}`}
}

function storeStatusFromHours(hours){
  const now=mexicoNowParts()
  if(!hours)return {ready:false,open:false,day:now.day,time:now.time,today:null}
  const today=hours[now.day]
  if(!today)return {ready:false,open:false,day:now.day,time:now.time,today:null}
  if(today.closed)return {ready:true,open:false,day:now.day,time:now.time,today}
  return {ready:true,open:now.time>=today.open&&now.time<today.close,day:now.day,time:now.time,today}
}

function useCatalog(){
  const [products,setProducts]=useState(fallbackProducts.map((p,i)=>({...p,id:p.slug,sort_order:(i+1)*10,available:true})))
  const [categories,setCategories]=useState(fallbackCategories.filter(c=>c!=='Favoritos'))
  const [categoryObjects,setCategoryObjects]=useState(fallbackCategories.filter(c=>c!=='Favoritos').map((name,i)=>({id:name, name, slug:name.toLowerCase().replace(/\s+/g,'-'), parent_id:null, sort_order:(i+1)*10})))
  const [branches,setBranches]=useState(fallbackBranches)
  const [settings,setSettings]=useState({minimum_order:200,points_reward_cost:250,points_reward_product_id:null,business_hours:null})
  const [loading,setLoading]=useState(supabaseConfigured)
  const refresh=async()=>{
    if(!supabase){setLoading(false);return}
    setLoading(true)
    const [{data:p,error:pe},{data:c},{data:b},{data:s}]=await Promise.all([
      supabase.from('products').select('*, category:categories!products_category_id_fkey(id,name,slug), subcategory:categories!products_subcategory_id_fkey(id,name,slug,parent_id,sort_order), product_branch_availability(branch_id,available), product_customizations(sort_order, customization_templates(id,name,input_type,required,min_select,max_select,options, customization_option_branch_availability(option_id,branch_id,available)))').order('sort_order'),
      supabase.from('categories').select('*').eq('active',true).order('sort_order'),
      supabase.from('branches').select('*').eq('active',true),
      supabase.from('app_settings').select('*').eq('id','main').maybeSingle()
    ])
    if(!pe && p?.length) setProducts(p.map(x=>({...x,price:Number(x.price),category:x.category?.name||'Otros',categorySlug:x.category?.slug||'',subcategory:x.subcategory?.name||null,subcategorySlug:x.subcategory?.slug||null,desc:x.description,image:x.image_url||'/assets/kyo-logo.jpg',branchAvailability:Object.fromEntries((x.product_branch_availability||[]).map(r=>[r.branch_id,r.available])),customizations:(x.product_customizations||[]).sort((a,b)=>a.sort_order-b.sort_order).map(pc=>{const t=pc.customization_templates;if(!t)return null;const rows=t.customization_option_branch_availability||[];return {...t,sort_order:pc.sort_order,options:(t.options||[]).map(o=>({...o,branchAvailability:Object.fromEntries(rows.filter(r=>r.option_id===o.id).map(r=>[r.branch_id,r.available]))}))}}).filter(Boolean)})))
    if(c?.length){setCategoryObjects(c);setCategories(c.filter(x=>!x.parent_id).map(x=>x.name))}
    if(b?.length) setBranches(b.map(x=>({id:x.id,name:x.name,short:x.short_name,address:x.address,phone:x.phone,eta:x.eta})))
    if(s) setSettings({minimum_order:Number(s.minimum_order||200),points_reward_cost:Number(s.points_reward_cost||250),points_reward_product_id:s.points_reward_product_id||null,business_hours:s.business_hours||defaultBusinessHours})
    setLoading(false)
  }
  useEffect(()=>{refresh()},[])
  return {products,categories,categoryObjects,branches,settings,loading,refresh,setProducts}
}

function useAddresses(auth){
  const [addresses,setAddresses]=useState([])
  const [loading,setLoading]=useState(false)
  const refresh=async()=>{
    if(!supabase||!auth.user){setAddresses([]);return}
    setLoading(true)
    const {data}=await supabase.from('addresses').select('*').eq('user_id',auth.user.id).order('is_default',{ascending:false}).order('created_at')
    setAddresses(data||[]);setLoading(false)
  }
  useEffect(()=>{refresh()},[auth.user?.id])
  return {addresses,setAddresses,loading,refresh}
}

function ScrollToTop(){
  const {pathname}=useLocation()
  useEffect(()=>{window.scrollTo({top:0,left:0,behavior:'auto'})},[pathname])
  return null
}

function App(){
  const auth=useAuth()
  const catalog=useCatalog()
  const addressBook=useAddresses(auth)
  const [cart,setCart]=usePersistedState('kyo-cart-v3',[])
  const [configuring,setConfiguring]=useState(null)
  const [destination,setDestination]=usePersistedState('kyo-destination-v1',{mode:'pickup',branchId:'zakia',addressId:null})
  const cartCount=cart.reduce((a,i)=>a+i.qty,0)
  const cartTotal=cart.reduce((a,i)=>a+Number(i.price)*i.qty,0)
  const selectedAddress=addressBook.addresses.find(a=>a.id===destination.addressId)||null
  const branchId=destination.mode==='delivery' && selectedAddress ? selectedAddress.branch_id : destination.branchId
  const branch=catalog.branches.find(b=>b.id===branchId)||catalog.branches[0]||fallbackBranches[0]
  const [storeClockTick,setStoreClockTick]=useState(0)
  const storeStatus=useMemo(()=>{
    const hours=catalog.settings?.business_hours
    if(catalog.loading||!hours)return {ready:false,open:false,day:null,time:null,today:null}
    return {...storeStatusFromHours(hours),ready:true}
  },[catalog.loading,catalog.settings?.business_hours,storeClockTick])

  useEffect(()=>{
    const timer=setInterval(()=>setStoreClockTick(x=>x+1),30000)
    return()=>clearInterval(timer)
  },[])

  useEffect(()=>{
    if(auth.user && addressBook.addresses.length && destination.mode==='delivery' && !selectedAddress){
      const a=addressBook.addresses[0]
      setDestination({mode:'delivery',addressId:a.id,branchId:a.branch_id})
    }
  },[auth.user?.id,addressBook.addresses.length])

  const add=p=>{
    if(!storeStatus.ready){return}
    if(!storeStatus.open){alert('KYO está cerrado en este momento. Puedes volver a pedir dentro de nuestro horario de servicio.');return}
    setConfiguring(p)
  }
  const addConfigured=item=>{
    const liveStatus=storeStatusFromHours(catalog.settings?.business_hours)
    if(!liveStatus.ready){setConfiguring(null);alert('Estamos cargando el horario de KYO. Intenta nuevamente en un momento.');return}
    if(!liveStatus.open){setConfiguring(null);alert('KYO acaba de cerrar. No pudimos agregar este producto al carrito.');return}
    setCart(prev=>[...prev,{...item,cartLineId:crypto.randomUUID(),qty:1}]);setConfiguring(null)
  }
  const update=async(id,delta)=>{
    const item=cart.find(i=>(i.cartLineId||i.id)===id)
    if(item?.reward && delta<0){
      if(item.rewardVoucherId&&supabase){
        const {error}=await supabase.rpc('cancel_reward_voucher',{p_voucher_id:item.rewardVoucherId})
        if(error){console.error(error);return alert(friendlyError(error,'rewards'))}
        await auth.refreshProfile()
      }
      setCart(prev=>prev.filter(i=>(i.cartLineId||i.id)!==id))
      return
    }
    setCart(prev=>prev.map(i=>(i.cartLineId||i.id)===id?{...i,qty:i.qty+delta}:i).filter(i=>i.qty>0))
  }
  const shared={auth,catalog,addressBook,destination,setDestination,selectedAddress,branch,storeStatus}
  return <div className="app-shell"><ScrollToTop/><ConnectionBanner/>
    <Routes>
      <Route path="/" element={<HomePage {...shared} add={add} cartCount={cartCount}/>}/>
      <Route path="/menu" element={<MenuPage {...shared} add={add} cartCount={cartCount} cartTotal={cartTotal}/>}/>
      <Route path="/rewards" element={<RewardsPage {...shared} cart={cart} setCart={setCart}/>}/>
      <Route path="/orders" element={<OrdersPage {...shared}/>}/>
      <Route path="/profile" element={<ProfilePage {...shared}/>}/>
      <Route path="/profile/preferences" element={<PreferencesPage {...shared}/>}/>
      <Route path="/support" element={<SupportPage {...shared}/>}/>
      <Route path="/login" element={<LoginPage auth={auth}/>}/>
      <Route path="/reset-password" element={<ResetPasswordPage auth={auth}/>}/>
      <Route path="/complete-profile" element={<CompleteGoogleProfilePage auth={auth}/>}/>
      <Route path="/legal" element={<LegalPage/>}/>
      <Route path="/privacy" element={<PrivacyPage/>}/>
      <Route path="/terms" element={<TermsPage/>}/>
      <Route path="/cart" element={<CartPage cart={cart} update={update} total={cartTotal} destination={destination} selectedAddress={selectedAddress} branch={branch} catalog={catalog} storeStatus={storeStatus}/>}/>
      <Route path="/checkout" element={<CheckoutPage cart={cart} total={cartTotal} setCart={setCart} {...shared}/>}/>
      <Route path="/success" element={<SuccessPage setCart={setCart}/>}/>


      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
    {configuring&&<ProductCustomizeModal product={configuring} branchId={branchId} onClose={()=>setConfiguring(null)} onAdd={addConfigured}/>}
    <BottomNav auth={auth}/>
  </div>
}

function Brand(){return <div className="brand"><img className="brand-logo-img" src="/assets/logo.png?v=3" alt="KYO Sushi"/></div>}

function formatAddress(a){
  if(!a)return ''
  return `${a.street || a.address_line || ''}${a.exterior_number?` #${a.exterior_number}`:''}${a.interior_number?` Int. ${a.interior_number}`:''}${a.neighborhood?`, ${a.neighborhood}`:''}${a.postal_code?`, CP ${a.postal_code}`:''}`
}

function Header({auth,catalog,addressBook,destination,setDestination,selectedAddress,plain=false,hideBrand=false}){
  const [open,setOpen]=useState(false); const [adding,setAdding]=useState(false); const [editingAddress,setEditingAddress]=useState(null); const nav=useNavigate()
  const chooseAddress=a=>{setDestination({mode:'delivery',addressId:a.id,branchId:a.branch_id});setOpen(false)}
  const choosePickup=id=>{setDestination({mode:'pickup',addressId:null,branchId:id});setOpen(false)}
  const label=destination?.mode==='delivery'&&selectedAddress ? (selectedAddress.label||'Entrega') : `Recoger en ${catalog?.branches?.find(b=>b.id===destination?.branchId)?.short||'sucursal'}`
  const detail=destination?.mode==='delivery'&&selectedAddress ? formatAddress(selectedAddress) : 'Pickup en sucursal'
  return <>
    <header className={`topbar ${plain?'plain':''} ${hideBrand?'no-brand':''}`}>{!hideBrand&&<Brand/>}{!plain&&<div className="branch-wrap"><button className="branch-btn destination-btn" onClick={()=>setOpen(v=>!v)}><MapPin size={16}/><span><small>Entregar en</small><strong>{label}</strong><em>{detail}</em></span><ChevronDown size={16}/></button>{open&&<div className="branch-menu destination-menu"><div className="destination-title">¿Dónde quieres recibir tu KYO?</div>{auth?.user&&addressBook?.addresses?.map(a=><div className={`destination-address-row ${destination?.addressId===a.id?'active':''}`} key={a.id}><button className="destination-address-main" onClick={()=>chooseAddress(a)}><span><strong>{a.label||'Dirección'} · {a.branch_id==='zakia'?'Zákia':'Milenio'}</strong><small>{formatAddress(a)}</small></span></button><button className="destination-edit" onClick={()=>setEditingAddress(a)} aria-label="Editar dirección"><Pencil size={15}/></button></div>)}<button className="add-location" onClick={()=>auth?.user?setAdding(true):nav('/login')}><Plus size={16}/><span><strong>Agregar otra dirección</strong><small>Guárdala para futuros pedidos</small></span></button><div className="pickup-title">O recoger en sucursal</div>{catalog?.branches?.map(b=><button key={b.id} onClick={()=>choosePickup(b.id)} className={`pickup-option ${destination?.mode==='pickup'&&destination?.branchId===b.id?'active':''}`}><Store size={16}/><span><strong>{b.name}</strong><small>{b.address}</small></span></button>)}</div>}</div>}</header>
    {adding&&<AddressModal auth={auth} branches={catalog.branches} onClose={()=>setAdding(false)} onSaved={async a=>{await addressBook.refresh();setDestination({mode:'delivery',addressId:a.id,branchId:a.branch_id});setAdding(false);setOpen(false)}}/>}
    {editingAddress&&<AddressModal auth={auth} branches={catalog.branches} initial={editingAddress} onClose={()=>setEditingAddress(null)} onSaved={async a=>{await addressBook.refresh();if(destination?.addressId===a.id)setDestination({mode:'delivery',addressId:a.id,branchId:a.branch_id});setEditingAddress(null)}}/>}
  </>
}

function BottomNav({auth}){
  const loc=useLocation()
  const [hasActiveOrder,setHasActiveOrder]=useState(false)

  useEffect(()=>{
    if(!supabase||!auth?.user){setHasActiveOrder(false);return}
    let alive=true
    const loadActive=async()=>{
      const {data}=await supabase
        .from('orders')
        .select('id')
        .eq('user_id',auth.user.id)
        .in('status',['preparing','ready','on_the_way'])
        .limit(1)
      if(alive)setHasActiveOrder(!!data?.length)
    }
    loadActive()
    const channel=supabase
      .channel(`bottom-nav-orders-${auth.user.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`user_id=eq.${auth.user.id}`},loadActive)
      .subscribe()
    return()=>{alive=false;supabase.removeChannel(channel)}
  },[auth?.user?.id])

  if(['/login','/checkout','/success'].some(p=>loc.pathname.startsWith(p)))return null

  return <nav className="bottom-nav">
    {[['/',Home,'Inicio'],['/menu',BookOpen,'Menú'],['/rewards',Gift,'Rewards'],['/orders',ShoppingBag,'Pedidos'],['/profile',User,'Perfil']].map(([to,Icon,label])=>
      <NavLink key={to} to={to} end={to==='/' } className={({isActive})=>isActive?'active':''}>
        <Icon size={21}/>
        <span>{label}</span>
        {to==='/orders'&&hasActiveOrder?<b className="active-order-dot" aria-label="Tienes un pedido activo"/>:null}
      </NavLink>
    )}
  </nav>
}

function HomePage({auth,catalog,addressBook,destination,setDestination,selectedAddress,add,cartCount,storeStatus}){const nav=useNavigate();const featured=catalog.products.filter(p=>p.featured&&p.available!==false).slice(0,6);const branch=catalog.branches.find(b=>b.id===(selectedAddress?.branch_id||destination.branchId))||catalog.branches[0];return <main><Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/>{storeStatus?.ready&&!storeStatus?.open&&<StoreClosedBanner hours={catalog.settings?.business_hours}/>}<section className="hero"><div className="hero-copy"><span className="hero-location-tag">ZÁKIA · MILENIO</span><span className="eyebrow">KYO A TU MANERA</span><h1>Tu sushi favorito,<br/><em>más cerca de ti.</em></h1><p>Pide directo, acumula KYO Points y recibe beneficios exclusivos.</p><button className="primary" onClick={()=>nav('/menu')}>Ordenar ahora <ChevronRight size={18}/></button></div><div className="hero-art"><div className="red-orb"></div><img src="/assets/menu/ebi-crispy-ramen.jpg" alt="Ramen KYO"/></div></section><section className="quick-row"><div><Bike/><span><strong>Delivery</strong><small className="quick-time">{branch?.eta||'35–50 min'}</small></span></div><div><Store/><span><strong>Pickup</strong><small className="quick-time">20–30 min</small></span></div><div><Gift/><span><strong>Rewards</strong><small>1 punto por $10</small></span></div></section><section className="section"><div className="section-head"><div><span className="eyebrow dark">LOS MÁS PEDIDOS</span><h2>Favoritos de KYO</h2></div><button className="text-btn" onClick={()=>nav('/menu')}>Ver todo <ChevronRight size={17}/></button></div><div className="product-scroller">{featured.map(p=><ProductCard key={p.id} p={p} add={add} branchId={branch?.id} storeOpen={storeStatus?.open} storeReady={storeStatus?.ready}/>)}</div></section><section className="reward-banner"><div><span className="reward-icon"><Sparkles/></span><span><small>KYO REWARDS</small><strong>Come rico. Gana puntos.<br/>Recibe más KYO.</strong></span></div><button onClick={()=>nav('/rewards')}>Ver mis beneficios</button></section><footer className="home-legal-footer home-legal-footer-rich">
  <div className="home-footer-about">
    <strong>KYO Sushi</strong>
    <p>KYO Sushi es la aplicación oficial para consultar nuestro menú, realizar pedidos de delivery o pickup, guardar direcciones, seguir el estado de tus pedidos y acumular o canjear beneficios de KYO Rewards.</p>
  </div>
  <div className="home-footer-links">
    <span>© KYO Sushi</span>
    <span className="home-legal-dot">·</span>
    <button type="button" onClick={()=>nav('/privacy')}>Política de Privacidad</button>
    <span className="home-legal-dot">·</span>
    <button type="button" onClick={()=>nav('/terms')}>Términos y Condiciones</button>
  </div>
</footer>{cartCount>0&&<button className="floating-cart" onClick={()=>nav('/cart')}><ShoppingBag size={20}/><span>Ver carrito</span><b>{cartCount}</b></button>}</main>}

function StoreClosedBanner({hours}){
  const status=storeStatusFromHours(hours)
  const dayNames={mon:'lunes',tue:'martes',wed:'miércoles',thu:'jueves',fri:'viernes',sat:'sábado',sun:'domingo'}
  const today=status.today
  const text=today?.closed?`Hoy ${dayNames[status.day]} permanecemos cerrados.`:`Hoy abrimos de ${today?.open||'--:--'} a ${today?.close||'--:--'} h (hora de CDMX).`
  return <div className="store-closed-banner"><Clock3/><span><strong>KYO está cerrado ahora</strong><small>{text}</small></span></div>
}

function productDisplayPrice(p){
  const base=Number(p.price||0)
  if(base>0) return money(base)
  const required=(p.customizations||[]).filter(t=>t.required)
  if(!required.length) return money(base)
  let extra=0
  for(const t of required){
    const prices=(t.options||[]).map(o=>Number(o.price||0)).sort((a,b)=>a-b)
    if(!prices.length) continue
    if(t.input_type==='single') extra+=prices[0]
    else {
      const min=Math.max(1,Number(t.min_select||1))
      extra+=prices.slice(0,min).reduce((a,b)=>a+b,0)
    }
  }
  return extra>0?`Desde ${money(extra)}`:money(base)
}

function LazyProductImage({src,alt}){
  const [loaded,setLoaded]=useState(false)
  return <div className={`lazy-product-image ${loaded?'loaded':''}`}>
    {!loaded&&<div className="product-image-skeleton" aria-hidden="true"/>}
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={()=>setLoaded(true)}
      onError={()=>setLoaded(true)}
    />
  </div>
}

function ProductCard({p,add,branchId,storeOpen=true,storeReady=true}){const branchUnavailable=branchId&&p.branchAvailability?.[branchId]===false;const storeClosed=storeReady&&!storeOpen;const scheduleLoading=!storeReady;return <article className={`product-card ${branchUnavailable||storeClosed?'branch-unavailable':''}`}><div className="product-img"><LazyProductImage src={p.image||p.image_url} alt={p.name}/>{p.spicy&&<span className="spicy"><Flame size={13}/> Spicy</span>}{(branchUnavailable||storeClosed)&&<span className="branch-soldout">{storeClosed?'Cerrado ahora':'No disponible aquí'}</span>}</div><div className="product-body"><small>{p.category}</small><h3>{p.name}</h3><p>{p.desc||p.description}</p><div><strong>{productDisplayPrice(p)}</strong><button className="add-btn" disabled={branchUnavailable||storeClosed||scheduleLoading} onClick={()=>!branchUnavailable&&!storeClosed&&!scheduleLoading&&add(p)} aria-label={`Agregar ${p.name}`}><Plus/></button></div></div></article>}

function MenuPage(props){
  const {auth,catalog,addressBook,destination,setDestination,selectedAddress,add,cartCount,branch,storeStatus}=props
  const nav=useNavigate();const [params]=useSearchParams();const [cat,setCat]=useState(params.get('category')||'Favoritos');const [subcat,setSubcat]=useState('Todos');const [q,setQ]=useState('')
  const categoryList=['Favoritos',...catalog.categories]
  const activeCategory=catalog.categoryObjects?.find(c=>!c.parent_id&&c.name===cat)
  const subcategories=(catalog.categoryObjects||[]).filter(c=>activeCategory&&c.parent_id===activeCategory.id).sort((a,b)=>a.sort_order-b.sort_order)
  useEffect(()=>{setSubcat('Todos')},[cat])
  const shown=useMemo(()=>catalog.products.filter(p=>p.available!==false).filter(p=>cat==='Favoritos'?p.featured:p.category===cat).filter(p=>subcat==='Todos'||p.subcategory===subcat).filter(p=>(p.name+' '+(p.desc||'')).toLowerCase().includes(q.toLowerCase())),[catalog.products,cat,subcat,q])
  return <main><Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/>{storeStatus?.ready&&!storeStatus?.open&&<StoreClosedBanner hours={catalog.settings?.business_hours}/>}<section className="menu-head"><span className="eyebrow dark">MENÚ KYO</span><h1>¿Qué se te antoja?</h1><div className="search-box"><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar ramen, rollos, entradas..."/></div></section><div className="cat-tabs">{categoryList.map(c=><button key={c} className={cat===c?'active':''} onClick={()=>setCat(c)}>{c}</button>)}</div>{subcategories.length>0&&<div className="subcat-tabs"><button className={subcat==='Todos'?'active':''} onClick={()=>setSubcat('Todos')}>Todos</button>{subcategories.map(s=><button key={s.id} className={subcat===s.name?'active':''} onClick={()=>setSubcat(s.name)}>{s.name}</button>)}</div>}{catalog.loading?<div className="loading-state"><RefreshCw className="spin"/> Cargando menú...</div>:<section className="menu-grid">{shown.map(p=><ProductCard key={p.id} p={p} add={add} branchId={branch?.id} storeOpen={storeStatus?.open} storeReady={storeStatus?.ready}/>)}</section>}{shown.length===0&&!catalog.loading&&<EmptyState icon={<Search/>} title="No encontramos productos" text="Prueba otra categoría o búsqueda." button="Ver favoritos" onClick={()=>setCat('Favoritos')}/>} {cartCount>0&&<button className="floating-cart" onClick={()=>nav('/cart')}><ShoppingBag size={20}/><span>Ver carrito</span><b>{cartCount}</b></button>}</main>
}
function ProductCustomizeModal({product,branchId,onClose,onAdd,rewardFree=false,actionLabel='Agregar al carrito'}){
  const templates=product.customizations||[]
  const [selected,setSelected]=useState({})
  const [note,setNote]=useState('')
  const [error,setError]=useState('')
  const choose=(t,opt)=>{if(branchId&&opt.branchAvailability?.[branchId]===false)return;setSelected(prev=>{
    const current=prev[t.id]||{}
    if(t.input_type==='single') return {...prev,[t.id]:{[opt.id]:1}}
    if(t.input_type==='multiple') return {...prev,[t.id]:{...current,[opt.id]:current[opt.id]?0:1}}
    return prev
  })}
  const qty=(t,opt,delta)=>{if(branchId&&opt.branchAvailability?.[branchId]===false)return;setSelected(prev=>{const current=prev[t.id]||{};return {...prev,[t.id]:{...current,[opt.id]:Math.max(0,Math.min(20,(current[opt.id]||0)+delta))}}})}
  const finish=()=>{
    const rows=[]
    for(const t of templates){
      const values=selected[t.id]||{}
      const count=Object.values(values).reduce((a,n)=>a+Number(n||0),0)
      const chosenCount=Object.values(values).filter(n=>Number(n)>0).length
      if(t.required && count<(t.min_select||1)){setError(`Completa: ${t.name}`);return}
      if(t.max_select && (t.input_type==='quantity'?count:chosenCount)>t.max_select){setError(`Máximo ${t.max_select} en ${t.name}`);return}
      for(const opt of (t.options||[])){
        const q=Number(values[opt.id]||0); if(!q)continue
        if(branchId&&opt.branchAvailability?.[branchId]===false){setError(`${opt.name} no está disponible en esta sucursal`);return}
        rows.push({template_id:t.id,template_name:t.name,option_id:opt.id,label:t.input_type==='quantity'?`${q}× ${opt.name}`:opt.name,quantity:q,price:rewardFree?0:Number(opt.price||0)*q})
      }
    }
    const extras=rows.reduce((a,r)=>a+r.price,0)
    onAdd({...product,basePrice:Number(product.price),price:rewardFree?0:Number(product.price)+extras,selectedCustomizations:rows,itemNote:note.trim(),rewardFreeCustomizations:rewardFree})
  }
  return <div className="modal-backdrop product-config-backdrop"><div className="product-config-modal"><div className="modal-head"><div><small>PERSONALIZA TU PEDIDO</small><h2>{product.name}</h2></div><button onClick={onClose}><X/></button></div><div className="config-product-head"><img src={product.image||product.image_url}/><div><p>{product.desc||product.description}</p><strong>{rewardFree?'GRATIS':productDisplayPrice(product)}</strong></div></div>{templates.map(t=><section className="config-group" key={t.id}><div className="config-group-title"><div><h3>{t.name}</h3><small>{t.required?'Obligatorio':'Opcional'} · {t.input_type==='single'?'Elige una':t.input_type==='multiple'?`Marca hasta ${t.max_select||'varias'}`:'Elige cantidades'}</small></div>{t.required&&<b>REQUERIDO</b>}</div><div className="config-options">{(t.options||[]).map(opt=>{const n=selected[t.id]?.[opt.id]||0;const unavailable=branchId&&opt.branchAvailability?.[branchId]===false;return <div className={`config-option ${n?'selected':''} ${unavailable?'option-unavailable':''}`} key={opt.id}><span><strong>{opt.name}</strong><small>{unavailable?'No disponible en esta sucursal':rewardFree?'Incluido gratis':Number(opt.price)>0?(Number(product.price||0)===0&&t.required?money(opt.price):`+ ${money(opt.price)}`):'Sin costo'}</small></span>{t.input_type==='quantity'?<div className="config-qty"><button disabled={unavailable} onClick={()=>qty(t,opt,-1)}><Minus size={15}/></button><b>{n}</b><button disabled={unavailable} onClick={()=>qty(t,opt,1)}><Plus size={15}/></button></div>:<button disabled={unavailable} className="config-check" onClick={()=>choose(t,opt)}>{n?<Check size={16}/>:null}</button>}</div>})}</div></section>)}<label className="product-note"><span>Nota para este producto <small>(opcional)</small></span><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Ej. Sin cebollín, salsa aparte..." maxLength={250}/></label>{error&&<div className="form-message">{error}</div>}<div className="product-config-footer"><button className="primary full" onClick={finish}>{actionLabel}</button></div></div></div>
}

const phoneCountries=[
  {code:'+52',flag:'🇲🇽',name:'México'},
  {code:'+1',flag:'🇺🇸',name:'Estados Unidos / Canadá'},
  {code:'+34',flag:'🇪🇸',name:'España'},
  {code:'+54',flag:'🇦🇷',name:'Argentina'},
  {code:'+57',flag:'🇨🇴',name:'Colombia'},
  {code:'+56',flag:'🇨🇱',name:'Chile'},
  {code:'+51',flag:'🇵🇪',name:'Perú'}
]

function LoginPage({auth}){
  const nav=useNavigate()
  const [mode,setMode]=useState('login')
  const [name,setName]=useState('')
  const [countryCode,setCountryCode]=useState('+52')
  const [phone,setPhone]=useState('')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [confirmPassword,setConfirmPassword]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [acceptedTerms,setAcceptedTerms]=useState(false)

  useEffect(()=>{if(auth.user)nav('/',{replace:true})},[auth.user])

  const continueWithGoogle=async()=>{
    setError('')
    if(!supabase){setError('Falta configurar Supabase.');return}

    setBusy(true)
    const redirectTo=`${window.location.origin}/complete-profile`
    const {error:e}=await supabase.auth.signInWithOAuth({
      provider:'google',
      options:{
        redirectTo,
        queryParams:{prompt:'select_account'}
      }
    })

    if(e){
      setBusy(false)
      setError(friendlyError(e,'login'))
    }
  }

  const submit=async e=>{
    e.preventDefault();setError('')
    if(!supabase){setError('Falta configurar Supabase.');return}
    if(mode==='register'){
      if(phone.length!==10){setError('Tu número de teléfono debe tener exactamente 10 dígitos.');return}
      if(password!==confirmPassword){setError('Las contraseñas no coinciden.');return}
      if(!acceptedTerms){setError('Debes aceptar los Términos y Condiciones y la Política de Privacidad.');return}
    }
    setBusy(true)
    const result=mode==='register'
      ?await supabase.auth.signUp({
        email,password,
        options:{data:{full_name:name,phone:`${countryCode}${phone}`,phone_country_code:countryCode,terms_accepted_at:new Date().toISOString(),terms_version:'2026-08-26'}}
      })
      :await supabase.auth.signInWithPassword({email,password})
    setBusy(false)
    if(result.error){
      setError(friendlyError(result.error,mode==='login'?'login':'general'))
      return
    }
    if(mode==='register'&&!result.data.session){setError('Cuenta creada. Revisa tu correo para confirmar el acceso.');return}
    nav('/')
  }

  return <main className="auth-page">
    <button className="back" onClick={()=>nav(-1)}><ArrowLeft/></button>
    <div className="auth-brand"><Brand/><p>Tu KYO. Tus rewards. Tu pedido.</p></div>
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-tabs">
        <button type="button" className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('')}}>Iniciar sesión</button>
        <button type="button" className={mode==='register'?'active':''} onClick={()=>{setMode('register');setError('')}}>Crear cuenta</button>
      </div>

      <button type="button" className="google-auth-btn" disabled={busy} onClick={continueWithGoogle}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.37Z"/>
          <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.4l-3.24-2.52c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.6A10 10 0 0 0 12 22Z"/>
          <path fill="#FBBC05" d="M6.39 13.91A6.02 6.02 0 0 1 6.07 12c0-.66.11-1.3.32-1.91v-2.6H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.51l3.35-2.6Z"/>
          <path fill="#EA4335" d="M12 5.96c1.47 0 2.78.5 3.81 1.49l2.86-2.86A9.58 9.58 0 0 0 12 2a10 10 0 0 0-8.96 5.49l3.35 2.6C7.18 7.72 9.39 5.96 12 5.96Z"/>
        </svg>
        <span>{mode==='login'?'Continuar con Google':'Registrarme con Google'}</span>
      </button>

      <div className="auth-divider"><span>o continúa con correo</span></div>

      {mode==='register'&&<>
        <label>Nombre<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre"/></label>
        <label>Número de teléfono
          <div className="phone-register-field">
            <select aria-label="Código de país" value={countryCode} onChange={e=>setCountryCode(e.target.value)}>
              {phoneCountries.map(c=><option key={`${c.code}-${c.name}`} value={c.code}>{c.flag} {c.code}</option>)}
            </select>
            <input
              required
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              pattern="[0-9]{10}"
              minLength="10"
              maxLength="10"
              value={phone}
              onChange={e=>setPhone(e.target.value.replace(/\D/g,'').slice(0,10))}
              placeholder="4421234567"
            />
          </div>
          <small className={`phone-digit-count ${phone.length===10?'complete':''}`}>{phone.length}/10 dígitos</small>
        </label>
      </>}
      <label>Correo electrónico<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="correo@ejemplo.com"/></label>
      <label>Contraseña<input type="password" minLength="6" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></label>
      {mode==='register'&&<label>Confirmar contraseña<input type="password" minLength="6" required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="••••••••"/></label>}
      {mode==='login'&&<button type="button" className="forgot-password-link" onClick={()=>nav('/reset-password')}>¿Olvidaste tu contraseña?</button>}
      {mode==='register'&&<label className="legal-consent"><input type="checkbox" checked={acceptedTerms} onChange={e=>setAcceptedTerms(e.target.checked)}/><span>Acepto los <button type="button" onClick={()=>window.open('/terms','_blank')}>Términos y Condiciones</button> y la <button type="button" onClick={()=>window.open('/privacy','_blank')}>Política de Privacidad</button>. También aplica si me registro con Google.</span></label>}
      {error&&<div className="form-message">{error}</div>}
      <button disabled={busy} className="primary full">{busy?'Procesando...':mode==='login'?'Entrar a mi cuenta':'Crear mi cuenta'}</button>
    </form>
  </main>
}


function CompleteGoogleProfilePage({auth}){
  const nav=useNavigate()
  const [name,setName]=useState('')
  const [phone,setPhone]=useState('')
  const [acceptedTerms,setAcceptedTerms]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [checking,setChecking]=useState(true)

  useEffect(()=>{
    if(auth.loading)return
    if(!auth.user){
      nav('/login',{replace:true})
      return
    }

    const profileName=auth.profile?.full_name||auth.user.user_metadata?.full_name||auth.user.user_metadata?.name||''
    const profilePhone=(auth.profile?.phone||auth.user.user_metadata?.phone||'')
      .replace(/^\+52/,'')
      .replace(/\D/g,'')
      .slice(-10)

    setName(profileName)
    setPhone(profilePhone)

    const alreadyAccepted=!!auth.user.user_metadata?.terms_accepted_at
    setAcceptedTerms(alreadyAccepted)

    // Existing Google users who already completed everything should not see this screen.
    if(profilePhone.length===10 && alreadyAccepted){
      nav('/',{replace:true})
      return
    }

    setChecking(false)
  },[
    auth.loading,
    auth.user?.id,
    auth.profile?.phone,
    auth.profile?.full_name,
    auth.user?.user_metadata?.terms_accepted_at
  ])

  const save=async e=>{
    e.preventDefault()
    setError('')

    const cleanName=name.trim()
    const digits=phone.replace(/\D/g,'')

    if(!cleanName)return setError('Escribe tu nombre.')
    if(digits.length!==10)return setError('Tu número debe tener exactamente 10 dígitos.')
    if(!acceptedTerms)return setError('Debes aceptar los Términos y Condiciones y la Política de Privacidad.')

    setBusy(true)
    const fullPhone=`+52${digits}`
    const acceptedAt=auth.user.user_metadata?.terms_accepted_at||new Date().toISOString()

    const {error:profileError}=await supabase
      .from('profiles')
      .update({
        full_name:cleanName,
        phone:fullPhone,
        updated_at:new Date().toISOString()
      })
      .eq('id',auth.user.id)

    if(profileError){
      setBusy(false)
      setError(friendlyError(profileError,'profile'))
      return
    }

    const {error:userError}=await supabase.auth.updateUser({
      data:{
        ...auth.user.user_metadata,
        full_name:cleanName,
        phone:fullPhone,
        phone_country_code:'+52',
        terms_accepted_at:acceptedAt,
        terms_version:'2026-08-26'
      }
    })

    if(userError){
      setBusy(false)
      setError(friendlyError(userError,'profile'))
      return
    }

    await auth.refreshProfile()
    setBusy(false)
    nav('/',{replace:true})
  }

  if(checking||auth.loading){
    return <main className="auth-page">
      <div className="google-complete-loading">Preparando tu cuenta KYO…</div>
    </main>
  }

  return <main className="auth-page">
    <div className="auth-brand">
      <Brand/>
      <p>Solo falta un dato para completar tu cuenta.</p>
    </div>

    <form className="auth-card google-complete-card" onSubmit={save}>
      <div className="google-complete-head">
        <span className="eyebrow dark">BIENVENIDO A KYO</span>
        <h2>Completa tu cuenta</h2>
        <p>Google ya nos compartió tu nombre y correo. Necesitamos tu teléfono para tus pedidos y entregas.</p>
      </div>

      <label>
        Nombre
        <input required value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre"/>
      </label>

      <label>
        Número de teléfono
        <div className="phone-register-field">
          <span className="google-phone-prefix">🇲🇽 +52</span>
          <input
            required
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            pattern="[0-9]{10}"
            minLength="10"
            maxLength="10"
            value={phone}
            onChange={e=>setPhone(e.target.value.replace(/\D/g,'').slice(0,10))}
            placeholder="4421234567"
          />
        </div>
        <small className={`phone-digit-count ${phone.length===10?'complete':''}`}>{phone.length}/10 dígitos</small>
      </label>

      <label className="legal-consent">
        <input type="checkbox" checked={acceptedTerms} onChange={e=>setAcceptedTerms(e.target.checked)}/>
        <span>
          Acepto los <button type="button" onClick={()=>window.open('/terms','_blank')}>Términos y Condiciones</button> y la <button type="button" onClick={()=>window.open('/privacy','_blank')}>Política de Privacidad</button>.
        </span>
      </label>

      {error&&<div className="form-message">{error}</div>}

      <button className="primary full" disabled={busy}>
        {busy?'Guardando…':'Completar mi cuenta'}
      </button>
    </form>
  </main>
}

function ResetPasswordPage({auth}){
  const nav=useNavigate()
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [recovery,setRecovery]=useState(false)
  const [busy,setBusy]=useState(false)
  const [msg,setMsg]=useState('')
  const [error,setError]=useState('')

  useEffect(()=>{
    const check=()=>setRecovery(window.location.hash.includes('type=recovery')||window.location.search.includes('type=recovery'))
    check()
    const {data}=supabase?.auth?.onAuthStateChange?.((event)=>{if(event==='PASSWORD_RECOVERY')setRecovery(true)})||{}
    return()=>data?.subscription?.unsubscribe?.()
  },[])

  const send=async e=>{
    e.preventDefault();setBusy(true);setError('');setMsg('')
    const redirectTo=`${window.location.origin}/reset-password`
    const {error:e2}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo})
    setBusy(false)
    if(e2)return setError(friendlyError(e2,'password'))
    setMsg('Te enviamos un correo. Ábrelo y sigue el enlace para crear una nueva contraseña.')
  }

  const update=async e=>{
    e.preventDefault();setError('')
    if(password.length<6)return setError('La contraseña debe tener al menos 6 caracteres.')
    if(password!==confirm)return setError('Las contraseñas no coinciden.')
    setBusy(true)
    const {error:e2}=await supabase.auth.updateUser({password})
    setBusy(false)
    if(e2)return setError(friendlyError(e2,'password'))
    setMsg('Contraseña actualizada. Ya puedes iniciar sesión.')
    setTimeout(()=>nav('/login',{replace:true}),1200)
  }

  return <main className="auth-page">
    <button className="back" onClick={()=>nav('/login')}><ArrowLeft/></button>
    <div className="auth-brand"><Brand/><p>Recupera el acceso a tu cuenta.</p></div>
    <form className="auth-card" onSubmit={recovery?update:send}>
      <div className="password-reset-title"><small>SEGURIDAD</small><h2>{recovery?'Nueva contraseña':'Recuperar contraseña'}</h2><p>{recovery?'Escribe tu nueva contraseña.':'Te enviaremos un enlace seguro a tu correo.'}</p></div>
      {!recovery?<label>Correo electrónico<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="correo@ejemplo.com"/></label>:<>
        <label>Nueva contraseña<input type="password" minLength="6" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></label>
        <label>Confirmar contraseña<input type="password" minLength="6" required value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="••••••••"/></label>
      </>}
      {msg&&<div className="form-message legal-success">{msg}</div>}
      {error&&<div className="form-message">{error}</div>}
      <button disabled={busy} className="primary full">{busy?'Procesando...':recovery?'Guardar nueva contraseña':'Enviar enlace de recuperación'}</button>
    </form>
  </main>
}

function LegalShell({title,updated,children}){
  const nav=useNavigate()
  return <main className="legal-page"><div className="legal-page-inner"><button className="legal-back" onClick={()=>nav(-1)}><ArrowLeft/> Volver</button><Brand/><span className="eyebrow dark">KYO SUSHI</span><h1>{title}</h1><p className="legal-updated">Última actualización: {updated}</p><article>{children}</article><div className="legal-bottom-links"><button onClick={()=>nav('/privacy')}>Privacidad</button><button onClick={()=>nav('/terms')}>Términos</button></div></div></main>
}

function PrivacyPage(){
  return <LegalShell title="Política de Privacidad" updated="26 de agosto de 2026">
    <h2>1. Responsable y alcance</h2><p>Esta política describe el tratamiento de información en la aplicación y servicios digitales de KYO Sushi para realizar pedidos, administrar cuentas y ofrecer el programa KYO Rewards.</p>
    <h2>2. Información que recopilamos</h2><p>Podemos recopilar nombre, correo electrónico, número de teléfono, direcciones de entrega y referencias proporcionadas por el usuario, datos de cuenta, historial y contenido de pedidos, sucursal seleccionada y datos relacionados con KYO Rewards.</p>
    <h2>3. Para qué usamos la información</h2><p>Usamos estos datos para crear y administrar tu cuenta, recibir y preparar pedidos, coordinar entrega o recolección, comunicarnos contigo sobre tu pedido, mantener tu historial, administrar puntos y beneficios, brindar soporte, prevenir abuso y mantener la seguridad del servicio.</p>
    <h2>4. Proveedores tecnológicos</h2><p>La aplicación utiliza proveedores tecnológicos necesarios para operar el servicio, incluyendo infraestructura de autenticación y base de datos. Estos proveedores procesan información únicamente en la medida necesaria para prestar sus servicios.</p>
    <h2>5. Conservación y eliminación de la cuenta</h2><p>Puedes solicitar la eliminación de tu cuenta desde Perfil → Preferencias → Eliminar cuenta. Al eliminarla se elimina tu acceso a la cuenta, perfil, direcciones guardadas y beneficios o saldo de KYO Rewards. Si tienes un pedido activo, la eliminación no podrá completarse hasta que dicho pedido haya finalizado, ya que el restaurante necesita temporalmente tus datos para prepararlo, entregarlo o tenerlo listo para recolección.</p>
    <p>Los pedidos ya finalizados pueden conservarse como registros históricos del restaurante para fines operativos, administrativos, fiscales, de seguridad o para el cumplimiento de obligaciones aplicables. Al eliminar tu cuenta, estos pedidos dejan de estar vinculados a tu cuenta y se eliminan del historial conservado la dirección de entrega, referencias y notas personales de entrega. La información que deba conservarse por una obligación legal podrá mantenerse durante el plazo que corresponda.</p>
    <h2>6. Seguridad</h2><p>Aplicamos medidas técnicas y organizativas razonables para proteger la información y limitar el acceso a los datos a las funciones necesarias para operar el servicio.</p>
    <h2>7. Tus opciones</h2><p>Desde Preferencias puedes actualizar nombre, teléfono y correo, así como solicitar la eliminación de tu cuenta.</p>
    <h2>8. Cambios</h2><p>Podemos actualizar esta política cuando cambien nuestras prácticas o requisitos aplicables. Indicaremos la fecha de la versión vigente.</p>
    <h2>9. Contacto</h2><p>Antes de publicar la aplicación deberá indicarse aquí el correo oficial de privacidad o soporte de KYO Sushi.</p>
  </LegalShell>
}

function TermsPage(){
  return <LegalShell title="Términos y Condiciones" updated="26 de agosto de 2026">
    <h2>1. Uso del servicio</h2><p>KYO Sushi permite consultar el menú, realizar pedidos, elegir entrega o recolección y utilizar beneficios disponibles en la cuenta. El usuario debe proporcionar información correcta y mantener seguras sus credenciales.</p>
    <h2>2. Pedidos y disponibilidad</h2><p>Los productos, personalizaciones, precios y disponibilidad pueden cambiar. Los pedidos solo pueden realizarse dentro del horario de servicio configurado y están sujetos a disponibilidad de la sucursal correspondiente.</p>
    <h2>3. Precios y pagos</h2><p>Antes de confirmar un pedido se mostrará su importe y, cuando corresponda, cargos de entrega. Los métodos de pago disponibles serán los indicados durante el checkout.</p>
    <h2>4. Entregas y recolección</h2><p>El usuario es responsable de proporcionar una dirección, teléfono y referencias correctas. Los tiempos mostrados son operativos y pueden variar por preparación, demanda, tránsito u otras circunstancias.</p>
    <h2>5. KYO Rewards</h2><p>Los puntos y beneficios son promocionales, personales y no equivalen a dinero. KYO puede establecer requisitos de canje, productos elegibles y reglas del programa, mostrando las condiciones vigentes en la aplicación.</p>
    <h2>6. Cuenta y eliminación</h2><p>El usuario puede modificar ciertos datos desde Preferencias y solicitar la eliminación de su cuenta desde Perfil → Preferencias → Eliminar cuenta. La eliminación no podrá completarse mientras exista un pedido activo; deberá esperarse a que el pedido haya finalizado. Al completar la eliminación se elimina el acceso a la cuenta, el perfil, las direcciones guardadas y los beneficios o saldo de KYO Rewards.</p>
    <p>Los pedidos históricos ya finalizados podrán conservarse como registros del restaurante cuando resulte necesario para fines operativos, administrativos, fiscales, de seguridad o para cumplir obligaciones aplicables. Estos registros quedarán desligados de la cuenta eliminada y se retirarán de ellos la dirección de entrega, referencias y notas personales de entrega, salvo aquella información que deba conservarse por disposición legal.</p>
    <p>El uso indebido, fraude o abuso de promociones puede ocasionar la cancelación de beneficios o restricciones de la cuenta conforme resulte aplicable.</p>
    <h2>7. Cambios</h2><p>Estos términos pueden actualizarse para reflejar cambios en el servicio. La versión vigente indicará su fecha de actualización.</p>
    <h2>8. Contacto</h2><p>Antes de publicar la aplicación deberá indicarse aquí el correo oficial de soporte de KYO Sushi y los datos legales del responsable.</p>
  </LegalShell>
}

function LegalPage(){return <Navigate to="/privacy" replace/>}

function AddressModal({auth,branches,onClose,onSaved,initial=null}){
  const [form,setForm]=useState(initial?{...emptyAddress,...initial}:{...emptyAddress})
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')

  const save=async e=>{
    e.preventDefault()
    if(!supabase||!auth.user)return
    if(!form.branch_id){setError('Elige cuál es tu sucursal más cercana.');return}
    setBusy(true);setError('')
    const payload={
      user_id:auth.user.id,
      label:form.label||'Casa',
      street:form.street,
      exterior_number:form.exterior_number,
      interior_number:form.interior_number||null,
      neighborhood:form.neighborhood,
      postal_code:form.postal_code,
      branch_id:form.branch_id,
      notes:form.notes||null,
      address_line:formatAddress(form)
    }
    const result=initial?.id
      ?await supabase.from('addresses').update(payload).eq('id',initial.id).select().single()
      :await supabase.from('addresses').insert(payload).select().single()
    setBusy(false)
    if(result.error){
      setError(friendlyError(result.error,'address'))
      return
    }
    onSaved(result.data)
  }

  return <div className="modal-backdrop">
    <form className="address-editor" onSubmit={save}>
      <div className="modal-head">
        <div><small>{initial?'EDITAR DIRECCIÓN':'NUEVA DIRECCIÓN'}</small><h2>{initial?'Edita tu dirección':'¿Dónde entregamos?'}</h2></div>
        <button type="button" onClick={onClose}><X/></button>
      </div>
      <div className="address-form-grid">
        <label className="admin-field full-span"><span>Nombre de la dirección</span><input value={form.label} onChange={e=>setForm({...form,label:e.target.value})} placeholder="Casa, Oficina..."/></label>
        <label className="admin-field full-span"><span>Dirección / calle</span><input required value={form.street} onChange={e=>setForm({...form,street:e.target.value})} placeholder="Av. Paseo de..."/></label>
        <label className="admin-field"><span>Número exterior</span><input required value={form.exterior_number} onChange={e=>setForm({...form,exterior_number:e.target.value})}/></label>
        <label className="admin-field"><span>Número interior</span><input value={form.interior_number||''} onChange={e=>setForm({...form,interior_number:e.target.value})} placeholder="Opcional"/></label>
        <label className="admin-field"><span>Colonia</span><input required value={form.neighborhood} onChange={e=>setForm({...form,neighborhood:e.target.value})}/></label>
        <label className="admin-field"><span>Código postal</span><input required inputMode="numeric" value={form.postal_code} onChange={e=>setForm({...form,postal_code:e.target.value})}/></label>

        <div className="address-branch-choice full-span">
          <span>¿Cuál es tu sucursal más cercana?</span>
          <small>Elige una para que tu pedido llegue a la cocina correcta.</small>
          <div className="address-branch-grid">
            {branches.map(b=><button
              type="button"
              key={b.id}
              className={form.branch_id===b.id?'active':''}
              onClick={()=>{setForm({...form,branch_id:b.id});setError('')}}
            >
              <Store size={18}/>
              <span><strong>{b.name}</strong><small>{b.address}</small></span>
              {form.branch_id===b.id&&<Check size={17}/>}
            </button>)}
          </div>
        </div>

        <label className="admin-field full-span"><span>Detalles o referencias</span><textarea value={form.notes||''} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Portón negro, frente al parque, tocar timbre..."/></label>
      </div>
      {error&&<div className="form-message">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={busy}>{busy?'Guardando...':'Guardar dirección'}</button>
      </div>
    </form>
  </div>
}
function ProfilePage({auth,addressBook,catalog,destination,setDestination,selectedAddress}){
  const nav=useNavigate(); const [showAddresses,setShowAddresses]=useState(false); const [showBranches,setShowBranches]=useState(false); const [adding,setAdding]=useState(false); const [editing,setEditing]=useState(null)
  if(!auth.user)return <main><Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/><section className="page-intro"><span className="eyebrow dark">MI KYO</span><h1>Tu cuenta KYO</h1><p>Inicia sesión para guardar direcciones, ver pedidos y acumular rewards.</p><button className="primary dark-btn" onClick={()=>nav('/login')}>Iniciar sesión</button></section><GuestBenefits/></main>
  return <main><Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/><section className="profile-hero"><div className="avatar">{(auth.profile?.full_name||auth.user.email||'K')[0].toUpperCase()}</div><div><small>HOLA,</small><h1>{auth.profile?.full_name||'Cliente KYO'}</h1><p>{auth.user.email}</p></div></section><section className="profile-stats"><div><strong>{auth.profile?.reward_points||0}</strong><small>KYO Points</small></div><div><strong>{addressBook.addresses.length}</strong><small>Direcciones</small></div></section><section className="profile-menu"><button onClick={()=>setShowAddresses(v=>!v)}><span><MapPin/> Mis direcciones <small className="profile-count">{addressBook.addresses.length}</small></span><ChevronRight className={showAddresses?'rotate':''}/></button>{showAddresses&&<div className="profile-address-panel"><div className="profile-address-head"><div><small>DIRECCIONES GUARDADAS</small><strong>Elige, edita o agrega una dirección</strong></div><button className="text-btn" onClick={()=>setAdding(true)}><Plus size={16}/> Agregar</button></div><div className="address-list">{addressBook.addresses.map(a=><div className="address-option" key={a.id}><MapPin/><span><strong>{a.label} · {a.branch_id==='zakia'?'Zákia':'Milenio'}</strong><small>{formatAddress(a)}</small>{a.notes&&<em>{a.notes}</em>}</span><div className="address-actions"><button onClick={()=>setEditing(a)} title="Editar"><Pencil size={16}/></button><button onClick={async()=>{const {error}=await supabase.from('addresses').delete().eq('id',a.id);if(error)return alert(friendlyError(error,'address'));addressBook.refresh()}} title="Eliminar"><Trash2 size={16}/></button></div></div>)}{!addressBook.addresses.length&&<button className="save-login" onClick={()=>setAdding(true)}>+ Agregar mi primera dirección</button>}</div></div>}
<button onClick={()=>setShowBranches(v=>!v)}><span><Store/> Sucursales <small className="profile-count">{catalog.branches.length}</small></span><ChevronRight className={showBranches?'rotate':''}/></button>
{showBranches&&<div className="profile-branches-panel">
  <div className="profile-address-head"><div><small>SUCURSALES KYO</small><strong>Encuentra tu KYO más cercano</strong></div></div>
  <div className="profile-branch-list">
    {catalog.branches.map(b=><div className="profile-branch-card" key={b.id}>
      <Store/>
      <span>
        <strong>{b.name}</strong>
        <small>{b.address}</small>
        <a href={`tel:${String(b.phone||'').replace(/\D/g,'')}`}>{b.phone}</a>
      </span>
    </div>)}
  </div>
</div>}
<button onClick={()=>nav('/support')}><span><CircleHelp/> Ayuda y soporte</span><ChevronRight/></button><button onClick={()=>nav('/profile/preferences')}><span><Settings/> Preferencias</span><ChevronRight/></button><button className="logout" onClick={()=>supabase.auth.signOut()}><span><LogOut/> Cerrar sesión</span></button></section>{adding&&<AddressModal auth={auth} branches={catalog.branches} onClose={()=>setAdding(false)} onSaved={async()=>{await addressBook.refresh();setAdding(false)}}/>}{editing&&<AddressModal auth={auth} branches={catalog.branches} initial={editing} onClose={()=>setEditing(null)} onSaved={async()=>{await addressBook.refresh();setEditing(null)}}/>}</main>
}


function SupportPage({auth,catalog,addressBook,destination,setDestination,selectedAddress,branch}){
  const nav=useNavigate()
  const [latestOrder,setLatestOrder]=useState(null)

  useEffect(()=>{
    if(!supabase||!auth?.user)return
    let alive=true
    ;(async()=>{
      const {data}=await supabase.from('orders')
        .select('order_number,branch_id,created_at')
        .eq('user_id',auth.user.id)
        .order('created_at',{ascending:false})
        .limit(1)
        .maybeSingle()
      if(alive)setLatestOrder(data||null)
    })()
    return()=>{alive=false}
  },[auth?.user?.id])

  const supportBranch=catalog.branches.find(b=>b.id===(latestOrder?.branch_id||branch?.id||destination?.branchId))||catalog.branches[0]
  const openSupport=kind=>{
    const phone=whatsappNumber(supportBranch?.phone)
    if(!phone)return alert('No encontramos el WhatsApp de esta sucursal. Intenta nuevamente más tarde.')
    const name=auth?.profile?.full_name||'Cliente KYO'
    const email=auth?.user?.email||'Sin cuenta'
    const order=latestOrder?.order_number?`#${String(latestOrder.order_number).padStart(4,'0')}`:'No especificado'
    const topic=kind==='payment'?'un problema con un cobro':'un problema con mi pedido'
    const message=`Hola KYO, necesito ayuda con ${topic}.\n\nNombre: ${name}\nCorreo: ${email}\nPedido más reciente: ${order}\nSucursal: ${supportBranch?.name||'KYO'}\n\nDetalle del problema: `
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer')
  }

  return <main>
    <Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/>
    <section className="support-page">
      <button className="preferences-back" onClick={()=>nav('/profile')}><ArrowLeft size={18}/> Volver a perfil</button>
      <div className="support-title"><span className="eyebrow dark">AYUDA KYO</span><h1>¿En qué te ayudamos?</h1><p>Te conectamos por WhatsApp con {supportBranch?.name||'KYO'}.</p></div>
      <div className="support-options">
        <button onClick={()=>openSupport('order')}><span className="support-icon"><ShoppingBag/></span><span><strong>Problemas con mi pedido</strong><small>Entrega, productos, preparación o seguimiento.</small></span><MessageCircle/></button>
        <button onClick={()=>openSupport('payment')}><span className="support-icon"><CreditCard/></span><span><strong>Problema con un cobro</strong><small>Importe incorrecto, pago o aclaración.</small></span><MessageCircle/></button>
      </div>
      <div className="support-branch-card"><Store/><span><small>CONTACTARÁS A</small><strong>{supportBranch?.name||'KYO Sushi'}</strong><em>{supportBranch?.phone||''}</em></span></div>
    </section>
  </main>
}

function PreferencesPage({auth,catalog,addressBook,destination,setDestination,selectedAddress}){
  const nav=useNavigate()
  const [name,setName]=useState(auth.profile?.full_name||'')
  const [phone,setPhone]=useState((auth.profile?.phone||'').replace(/^\+52/,'').replace(/\D/g,'').slice(-10))
  const [email,setEmail]=useState(auth.user?.email||'')
  const [busy,setBusy]=useState('')
  const [msg,setMsg]=useState('')
  const [error,setError]=useState('')
  const [confirmDelete,setConfirmDelete]=useState(false)

  useEffect(()=>{
    setName(auth.profile?.full_name||'')
    setPhone((auth.profile?.phone||'').replace(/^\+52/,'').replace(/\D/g,'').slice(-10))
    setEmail(auth.user?.email||'')
  },[auth.profile?.full_name,auth.profile?.phone,auth.user?.email])

  if(!auth.user)return <Navigate to="/login" replace/>

  const saveName=async()=>{
    const clean=name.trim()
    if(!clean)return setError('Escribe tu nombre.')
    setBusy('name');setError('');setMsg('')
    const {error:e}=await supabase.from('profiles').update({full_name:clean,updated_at:new Date().toISOString()}).eq('id',auth.user.id)
    setBusy('')
    if(e)return setError(friendlyError(e,'profile'))
    await auth.refreshProfile()
    setMsg('Nombre actualizado.')
  }

  const savePhone=async()=>{
    const digits=phone.replace(/\D/g,'')
    if(digits.length!==10)return setError('Tu número debe tener exactamente 10 dígitos.')
    setBusy('phone');setError('');setMsg('')
    const full=`+52${digits}`
    const {error:e}=await supabase.from('profiles').update({phone:full,updated_at:new Date().toISOString()}).eq('id',auth.user.id)
    if(!e)await supabase.auth.updateUser({data:{phone:full,phone_country_code:'+52'}})
    setBusy('')
    if(e)return setError(friendlyError(e,'profile'))
    await auth.refreshProfile()
    setMsg('Número actualizado.')
  }

  const saveEmail=async()=>{
    const clean=email.trim().toLowerCase()
    if(!clean)return setError('Escribe tu correo.')
    if(clean===auth.user.email)return setMsg('Ese ya es tu correo actual.')
    setBusy('email');setError('');setMsg('')
    const {error:e}=await supabase.auth.updateUser({email:clean})
    setBusy('')
    if(e)return setError(friendlyError(e,'email'))
    setMsg('Te enviamos un correo para confirmar el cambio.')
  }

  const deleteAccount=async()=>{
    setBusy('delete');setError('');setMsg('')
    const {error:e}=await supabase.rpc('delete_my_account')
    if(e){setBusy('');return setError(friendlyError(e,'account_delete'))}
    try{
      localStorage.removeItem('kyo-cart-v3')
      localStorage.removeItem('kyo-destination-v1')
    }catch{}
    await supabase.auth.signOut()
    nav('/',{replace:true})
  }

  return <main>
    <Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/>
    <section className="preferences-page">
      <button className="preferences-back" onClick={()=>nav('/profile')}><ArrowLeft size={18}/> Volver a perfil</button>
      <div className="preferences-title"><span className="eyebrow dark">MI CUENTA</span><h1>Preferencias</h1><p>Actualiza los datos de tu cuenta KYO.</p></div>

      {msg&&<div className="preferences-message success">{msg}</div>}
      {error&&<div className="preferences-message error">{error}</div>}

      <div className="preferences-card">
        <div><small>NOMBRE</small><h2>Cambiar nombre</h2><p>Así aparecerá tu nombre en KYO y en tus pedidos.</p></div>
        <div className="preferences-edit-row"><input value={name} onChange={e=>setName(e.target.value)}/><button className="primary" onClick={saveName} disabled={busy==='name'}>{busy==='name'?'Guardando...':'Guardar'}</button></div>
      </div>

      <div className="preferences-card">
        <div><small>TELÉFONO</small><h2>Cambiar número</h2><p>Lo usamos para identificarte cuando entregamos tu pedido.</p></div>
        <div className="preferences-edit-row phone-pref"><span>🇲🇽 +52</span><input type="tel" inputMode="numeric" maxLength="10" value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,'').slice(0,10))}/><button className="primary" onClick={savePhone} disabled={busy==='phone'}>{busy==='phone'?'Guardando...':'Guardar'}</button></div>
      </div>

      <div className="preferences-card">
        <div><small>CORREO</small><h2>Cambiar correo</h2><p>Por seguridad, Supabase puede pedirte confirmar el nuevo correo.</p></div>
        <div className="preferences-edit-row"><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/><button className="primary" onClick={saveEmail} disabled={busy==='email'}>{busy==='email'?'Enviando...':'Cambiar correo'}</button></div>
      </div>

      <div className="preferences-card">
        <div><small>LEGAL Y PRIVACIDAD</small><h2>Información legal</h2><p>Consulta cómo usamos tus datos y las condiciones de uso de KYO.</p></div>
        <div className="legal-preference-links"><button onClick={()=>nav('/privacy')}>Política de Privacidad <ChevronRight/></button><button onClick={()=>nav('/terms')}>Términos y Condiciones <ChevronRight/></button></div>
      </div>

      <div className="preferences-card danger-zone">
        <div><small>CUENTA</small><h2>Eliminar cuenta</h2><p>Elimina tu acceso, perfil, direcciones y rewards. Por seguridad no podrás eliminar la cuenta mientras tengas un pedido activo. Los pedidos anteriores se conservan únicamente como registro del restaurante y se eliminan de ellos tus datos de contacto y entrega.</p></div>
        {!confirmDelete
          ?<button className="delete-account-btn" onClick={()=>setConfirmDelete(true)}>Eliminar mi cuenta</button>
          :<div className="delete-confirm"><strong>¿Seguro que quieres eliminar tu cuenta?</strong><span>Esta acción no se puede deshacer.</span><div><button onClick={()=>setConfirmDelete(false)}>Cancelar</button><button className="delete-account-btn" onClick={deleteAccount} disabled={busy==='delete'}>{busy==='delete'?'Eliminando...':'Sí, eliminar cuenta'}</button></div></div>}
      </div>
    </section>
  </main>
}

function GuestBenefits(){const nav=useNavigate();return <section className="section"><div className="benefit-boxes"><div><Gift/><strong>Rewards exclusivos</strong><p>Acumula puntos en pedidos entregados.</p></div><div><MapPin/><strong>Direcciones guardadas</strong><p>Pide en menos pasos la próxima vez.</p></div><div><ShoppingBag/><strong>Historial completo</strong><p>Consulta todos tus pedidos.</p></div></div><button className="guest-support-btn" onClick={()=>nav('/support')}><CircleHelp/> Ayuda y soporte</button></section>}

function RewardsPage({auth,catalog,addressBook,destination,setDestination,selectedAddress,branch,storeStatus,cart,setCart}){
  const nav=useNavigate()
  const [busy,setBusy]=useState('')
  const [msg,setMsg]=useState('')
  const [chooseRoll,setChooseRoll]=useState(false)
  const [configRoll,setConfigRoll]=useState(null)

  const rewardVoucherIds=(cart||[]).filter(i=>i.rewardVoucherId).map(i=>i.rewardVoucherId)
  const hasSpringInCart=(cart||[]).some(i=>i.rewardType==='spring_rolls')
  const hasFreeRollInCart=(cart||[]).some(i=>i.rewardType==='free_roll')

  useEffect(()=>{
    if(!supabase||!auth.user)return
    let alive=true
    ;(async()=>{
      const {data}=await supabase.from('reward_vouchers').select('id').eq('user_id',auth.user.id).eq('status','available')
      const orphaned=(data||[]).filter(v=>!rewardVoucherIds.includes(v.id))
      for(const v of orphaned) await supabase.rpc('cancel_reward_voucher',{p_voucher_id:v.id})
      if(alive&&orphaned.length)await auth.refreshProfile()
    })()
    return()=>{alive=false}
  },[auth.user?.id,rewardVoucherIds.join('|')])

  if(!auth.user)return <main><Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/><EmptyState icon={<Gift/>} title="Tus rewards viven aquí" text="Inicia sesión para acumular KYO Points." button="Iniciar sesión" onClick={()=>nav('/login')}/></main>

  const points=auth.profile?.reward_points||0
  const stamps=Math.min(6,auth.profile?.reward_order_stamps||0)
  const branchId=branch?.id
  const pointsRewardCost=Number(catalog.settings?.points_reward_cost||250)
  const pointsRewardProduct=catalog.products.find(p=>p.id===catalog.settings?.points_reward_product_id && p.available!==false && (!branchId||p.branchAvailability?.[branchId]!==false))
  const classicRolls=catalog.products.filter(p=>
    p.available!==false &&
    (p.subcategorySlug==='clasicos'||p.subcategory?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')==='clasicos') &&
    (!branchId||p.branchAvailability?.[branchId]!==false)
  )

  const reserveSpring=async()=>{
    if(!storeStatus?.open){setMsg('KYO está cerrado. Podrás canjear y agregar productos cuando abramos.');return}
    setBusy('spring_rolls');setMsg('')
    const {data,error}=await supabase.rpc('redeem_spring_rolls_reward')
    setBusy('')
    if(error){setMsg(friendlyError(error,'rewards'));return}
    const voucherId=Array.isArray(data)?data[0]:data
    if(!pointsRewardProduct){
      await supabase.rpc('cancel_reward_voucher',{p_voucher_id:voucherId})
      await auth.refreshProfile()
      return setMsg('El producto configurado para este reward no está disponible en esta sucursal.')
    }
    setCart(prev=>[
      ...prev,
      {...pointsRewardProduct,id:`reward-${voucherId}`,productId:pointsRewardProduct.id,price:0,qty:1,reward:true,rewardType:'spring_rolls',rewardVoucherId:voucherId,name:pointsRewardProduct.name,desc:`KYO Rewards · ${pointsRewardCost} puntos`}
    ])
    await auth.refreshProfile()
    nav('/cart')
  }

  const startSixOrderReward=()=>{
    setMsg('')
    if(!storeStatus?.open)return setMsg('KYO está cerrado. Podrás canjear tu rollo cuando abramos.')
    if(stamps<6)return
    if(!classicRolls.length)return setMsg('No hay rollos clásicos disponibles en esta sucursal por el momento.')
    setChooseRoll(true)
  }

  const finishFreeRoll=async(configured)=>{
    setBusy('six_orders');setMsg('')
    const {data,error}=await supabase.rpc('redeem_six_orders_reward')
    setBusy('')
    if(error){setMsg(friendlyError(error,'rewards'));return}
    const voucherId=Array.isArray(data)?data[0]:data
    setCart(prev=>[
      ...prev,
      {...configured,id:`reward-${voucherId}`,productId:configured.id,price:0,qty:1,reward:true,rewardType:'free_roll',rewardVoucherId:voucherId,name:configured.name,desc:'Reto KYO · 6 pedidos · personalizaciones incluidas'}
    ])
    await auth.refreshProfile()
    setConfigRoll(null);setChooseRoll(false)
    nav('/cart')
  }

  return <main>
    <Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/>
    <section className="page-intro rewards-intro"><span className="eyebrow dark">KYO REWARDS</span><h1>{points} puntos</h1><p>Ganas 1 punto por cada $10 de subtotal cuando tu pedido se marca como entregado.</p></section>
    <section className="reward-banner rewards-balance"><div><span className="reward-icon"><Gift/></span><span><small>TU SALDO</small><strong>{points} KYO Points</strong></span></div></section>
    <section className="section reward-benefits">
      <div className="section-head"><div><span className="eyebrow dark">TUS BENEFICIOS</span><h2>Canjea y disfruta</h2></div></div>
      <div className="reward-grid">
        <article className="reward-card points-reward-card">
          <div className="reward-card-icon"><Gift/></div>
          <div className="reward-card-copy"><small>BENEFICIO POR PUNTOS</small><h3>{pointsRewardProduct?.name||'Reward por puntos'}</h3><p>Canjéalo por <strong>{pointsRewardCost} puntos</strong>. Se agrega directamente a tu carrito en $0.</p></div>
          <button className="primary" disabled={points<pointsRewardCost||busy==='spring_rolls'||!pointsRewardProduct||hasSpringInCart} onClick={reserveSpring}>{hasSpringInCart?'Ya está en tu carrito':busy==='spring_rolls'?'Canjeando...':!pointsRewardProduct?'Reward no disponible':points>=pointsRewardCost?'Canjear y agregar al carrito':`Te faltan ${pointsRewardCost-points} puntos`}</button>
        </article>
        <article className="reward-card stamp-card">
          <div><small>RETO KYO</small><h3>Tu 6.º pedido invita el rollo</h3><p>Completa 6 pedidos entregados y elige <strong>cualquier rollo de Clásicos</strong>. Sus personalizaciones van incluidas.</p></div>
          <div className="stamp-row">{Array.from({length:6},(_,i)=><span key={i} className={i<stamps?'done':''}>{i<stamps?<Check size={16}/>:i+1}</span>)}</div>
          <div className="stamp-progress"><strong>{stamps}/6 pedidos</strong><small>{stamps>=6?'¡Ya puedes elegir tu rollo!':`Te faltan ${6-stamps} pedidos`}</small></div>
          <button className="primary dark-btn" disabled={stamps<6||busy==='six_orders'||hasFreeRollInCart} onClick={startSixOrderReward}>{hasFreeRollInCart?'Ya está en tu carrito':stamps>=6?'Elegir mi rollo gratis':'Sigue acumulando'}</button>
        </article>
      </div>
      {msg&&<div className="reward-message">{msg}</div>}
    </section>

    {chooseRoll&&!configRoll&&<div className="modal-backdrop"><div className="reward-roll-picker">
      <div className="modal-head"><div><small>RETO KYO · 6 PEDIDOS</small><h2>Elige tu rollo gratis</h2><p>Selecciona cualquiera de los rollos de Clásicos disponibles en {branch?.name||'tu sucursal'}.</p></div><button onClick={()=>setChooseRoll(false)}><X/></button></div>
      <div className="reward-roll-grid">{classicRolls.map(p=><button key={p.id} className="reward-roll-option" onClick={()=>setConfigRoll(p)}><img src={p.image||p.image_url}/><span><small>{p.subcategory||'Clásicos'}</small><strong>{p.name}</strong><em>{productDisplayPrice(p)} · GRATIS con tu reward</em></span><ChevronRight/></button>)}</div>
    </div></div>}

    {configRoll&&<ProductCustomizeModal product={configRoll} branchId={branchId} rewardFree actionLabel={busy==='six_orders'?'Canjeando...':'Agregar rollo GRATIS al carrito'} onClose={()=>setConfigRoll(null)} onAdd={finishFreeRoll}/>}
  </main>
}
function OrdersPage({auth,catalog,addressBook,destination,setDestination,selectedAddress}){const nav=useNavigate();const [orders,setOrders]=useState([]);const [loading,setLoading]=useState(true);const load=async()=>{if(!supabase||!auth.user){setLoading(false);return}const {data}=await supabase.from('orders').select('*, order_items(*)').eq('user_id',auth.user.id).order('created_at',{ascending:false});setOrders(data||[]);setLoading(false)};useEffect(()=>{load();if(!supabase||!auth.user)return;const ch=supabase.channel(`client-orders-${auth.user.id}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`user_id=eq.${auth.user.id}`},load).subscribe();return()=>supabase.removeChannel(ch)},[auth.user?.id]);if(!auth.user)return <main><Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/><EmptyState icon={<ShoppingBag/>} title="Tus pedidos en un solo lugar" text="Inicia sesión para ver tu historial y seguimiento." button="Iniciar sesión" onClick={()=>nav('/login')}/></main>;const active=orders.filter(o=>!['delivered','cancelled'].includes(o.status));const history=orders.filter(o=>['delivered','cancelled'].includes(o.status));return <main><Header auth={auth} catalog={catalog} addressBook={addressBook} destination={destination} setDestination={setDestination} selectedAddress={selectedAddress}/><section className="page-intro compact"><span className="eyebrow dark">MIS PEDIDOS</span><h1>Tu pedido</h1></section>{loading?<div className="loading-state"><RefreshCw className="spin"/> Cargando...</div>:<section className="orders"><div className="orders-group-title">PEDIDO ACTUAL</div>{active.map(o=><OrderCard key={o.id} o={o} active/>)}{active.length===0&&<div className="no-active-order"><ShoppingBag/><div><strong>No tienes un pedido en curso</strong><small>Cuando hagas uno, podrás seguirlo aquí.</small></div><button className="primary" onClick={()=>nav('/menu')}>Hacer pedido</button></div>}{history.length>0&&<><div className="orders-group-title history-title">ANTERIORES</div>{history.map(o=><OrderCard key={o.id} o={o}/>)}</>}</section>}</main>}
function OrderCard({o,active}){const state=clientStatus(o.status,o.fulfillment_type);return <article className={active?'active-order-card':''}><div><span className={`status ${o.status==='delivered'?'completed':''}`}><Check size={15}/> {state}</span><small>{new Date(o.created_at).toLocaleString('es-MX')} · {o.branch_id==='zakia'?'KYO Zákia':'KYO Milenio'}</small></div><h3>Pedido #{String(o.order_number).padStart(4,'0')}</h3><p>{o.order_items?.map(i=>`${i.quantity}× ${i.product_name}`).join(' · ')}</p>{active&&<div className="client-progress"><div className={['preparing','ready','on_the_way','delivered'].includes(o.status)?'done':''}><i>1</i><span>Preparando</span></div><div className={(o.fulfillment_type==='pickup'?['ready','on_the_way','delivered']:['on_the_way','delivered']).includes(o.status)?'done':''}><i>2</i><span>{o.fulfillment_type==='pickup'?'Listo para recoger':'En camino'}</span></div><div className={o.status==='delivered'?'done':''}><i>3</i><span>Entregado</span></div></div>}<div><strong>{money(Number(o.total||0)+Number(o.tip_amount||0))}</strong>{Number(o.tip_amount||0)>0&&<small className="order-tip-note">Incluye {money(o.tip_amount)} de propina</small>}</div></article>}

function CartPage({cart,update,total,destination,selectedAddress,branch,catalog,storeStatus}){const nav=useNavigate();const delivery=destination.mode==='delivery';return <main><div className="simple-head"><button onClick={()=>nav(-1)}><ArrowLeft/></button><h1>Tu pedido</h1><span/></div>{cart.length===0?<EmptyState icon={<ShoppingBag/>} title="Tu carrito está vacío" text="Hay mucho KYO esperándote." button="Ver menú" onClick={()=>nav('/menu')}/>:<><section className="cart-branch"><MapPin/><div><small>{delivery?'Entregar en':'Recoger en'}</small><strong>{delivery?(selectedAddress?.label||'Dirección'):branch?.name}</strong><span>{delivery?formatAddress(selectedAddress):branch?.address}</span></div></section><section className="cart-items">{cart.map(i=><article key={i.cartLineId||i.id}><img src={i.image||i.image_url}/><div className="cart-info"><h3>{i.name}</h3>{i.selectedCustomizations?.length>0&&<div className="cart-customizations">{i.selectedCustomizations.map((c,idx)=><small key={idx}>{c.label}{c.price>0?` +${money(c.price)}`:''}</small>)}</div>}{i.itemNote&&<small className="item-note">Nota: {i.itemNote}</small>}{i.reward?<strong className="reward-free-price">GRATIS · KYO REWARDS</strong>:<strong>{money(i.price)}</strong>}</div><div className={`qty ${i.reward?'reward-qty':''}`}><button onClick={()=>update(i.cartLineId||i.id,-1)}><Trash2 size={16}/></button><b>{i.reward?'1':i.qty}</b>{!i.reward&&<button onClick={()=>update(i.cartLineId||i.id,1)}><Plus size={16}/></button>}</div></article>)}</section><section className="summary"><div><span>Subtotal</span><strong>{money(total)}</strong></div>{delivery&&<div><span>Envío</span><strong className="free-delivery">GRATIS</strong></div>}<div className="total"><span>Total</span><strong>{money(total)}</strong></div></section>{total<Number(catalog?.settings?.minimum_order||200)&&<div className="minimum-order-notice cart-minimum-notice"><strong>Pedido mínimo {money(catalog?.settings?.minimum_order||200)}</strong><span>Te faltan {money(Number(catalog?.settings?.minimum_order||200)-total)} en productos.</span></div>}{storeStatus?.ready&&!storeStatus?.open&&<div className="store-cart-closed"><Clock3/><span><strong>KYO está cerrado</strong><small>Podrás continuar tu pedido cuando abramos nuevamente.</small></span></div>}<div className="checkout-bar"><button disabled={!storeStatus?.ready||!storeStatus?.open||total<Number(catalog?.settings?.minimum_order||200)} className="primary full" onClick={()=>nav('/checkout')}>Continuar · {money(total)}</button></div></>}</main>}

function StripePaymentForm({order,fulfillmentType,chargeTotal,onPaid,onBack}){
  const stripe=useStripe();const elements=useElements();const [busy,setBusy]=useState(false);const [error,setError]=useState('')
  const pay=async()=>{
    if(!stripe||!elements||busy)return
    setBusy(true);setError('')
    const returnUrl=`${window.location.origin}/success?payment=return&order=${encodeURIComponent(order.id)}&number=${encodeURIComponent(order.order_number)}&type=${encodeURIComponent(fulfillmentType)}`
    const result=await stripe.confirmPayment({elements,confirmParams:{return_url:returnUrl},redirect:'if_required'})
    if(result.error){setError(result.error.message||'No pudimos procesar la tarjeta. Revisa los datos e intenta nuevamente.');setBusy(false);return}
    if(['succeeded','processing'].includes(result.paymentIntent?.status)){
      onPaid(order)
      return
    }
    setError('Stripe todavía no confirmó el pago. Intenta nuevamente.');setBusy(false)
  }
  return <main className="checkout-page stripe-payment-page"><div className="simple-head"><button onClick={onBack} disabled={busy}><ArrowLeft/></button><h1>Pago seguro</h1><span/></div><section className="checkout-section stripe-payment-card"><div className="stripe-secure-head"><span><CreditCard/></span><div><small>PAGO PROTEGIDO POR STRIPE</small><h2>Tarjeta o Apple Pay</h2><p>Apple Pay aparecerá automáticamente cuando esté disponible en tu dispositivo.</p></div></div><PaymentElement options={{layout:'tabs'}}/>{error&&<div className="form-message checkout-message">{error}</div>}<div className="stripe-charge-summary"><span>Total a cobrar</span><strong>{money(chargeTotal)}</strong></div><button className="primary full stripe-pay-button" disabled={!stripe||busy} onClick={pay}>{busy?'Procesando pago...':`Pagar ${money(chargeTotal)}`}</button><button className="stripe-back-button" disabled={busy} onClick={onBack}>Volver al checkout</button><p className="stripe-legal-note">KYO no recibe ni almacena los datos completos de tu tarjeta. El pago es procesado por Stripe.</p></section></main>
}

function CheckoutPage({cart,total,auth,catalog,addressBook,destination,setDestination,selectedAddress,branch,setCart,storeStatus}){
  const nav=useNavigate();const requestKeyRef=useRef(newRequestId());const [type,setType]=useState(destination.mode||'delivery');const [selected,setSelected]=useState(destination.addressId||'');const [pickupBranch,setPickupBranch]=useState(destination.branchId||'zakia');const [payment,setPayment]=useState('cash');const [saveCard,setSaveCard]=useState(false);const [notes,setNotes]=useState('');const [tipPercent,setTipPercent]=useState(0);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [adding,setAdding]=useState(false);const [stripeSession,setStripeSession]=useState(null)
  if(!auth.user)return <Navigate to="/login" replace/>
  const effectiveTipPercent=tipPercent;const tipAmount=Math.round((Number(total||0)*effectiveTipPercent/100)*100)/100;const chargeTotal=Number(total||0)+tipAmount
  const chooseAddress=a=>{setSelected(a.id);setDestination({mode:'delivery',addressId:a.id,branchId:a.branch_id})}
  const finish=async()=>{
    setError('');if(!supabase)return setError('Supabase no está configurado.');if(!cart.length)return
    if(!catalog.settings?.business_hours)return setError('Estamos cargando el horario de KYO. Intenta nuevamente en un momento.')
    if(!storeStatusFromHours(catalog.settings.business_hours).open)return setError('KYO está cerrado en este momento. Intenta nuevamente dentro de nuestro horario de servicio.')
    const minimum=Number(catalog.settings?.minimum_order||200);if(total<minimum)return setError(`El pedido mínimo es de ${money(minimum)}. Te faltan ${money(minimum-total)} en productos.`)
    const currentAddress=addressBook.addresses.find(a=>a.id===selected);if(type==='delivery'&&!currentAddress)return setError('Agrega una dirección para continuar.');if(type==='delivery'&&!currentAddress.branch_id)return setError('Elige la sucursal más cercana para tu dirección.')
    setBusy(true)
    const chosenBranch=type==='delivery'?currentAddress.branch_id:pickupBranch
    const items=cart.map(i=>({product_id:i.productId||i.id,quantity:i.reward?1:i.qty,reward_voucher_id:i.rewardVoucherId||null,customizations:i.selectedCustomizations||[],item_note:i.itemNote||''}))
    const {data,error:e1}=await supabase.rpc('create_order',{p_branch_id:chosenBranch,p_fulfillment_type:type,p_address_id:type==='delivery'?selected:null,p_delivery_notes:notes,p_payment_method:payment,p_items:items,p_idempotency_key:requestKeyRef.current,p_tip_percentage:effectiveTipPercent})
    if(e1){setBusy(false);setError(friendlyError(e1,'order'));return}
    const order=Array.isArray(data)?data[0]:data
    setDestination(type==='delivery'?{mode:'delivery',addressId:selected,branchId:chosenBranch}:{mode:'pickup',addressId:null,branchId:pickupBranch})
    if(payment!=='card'){
      setBusy(false);setCart([]);nav('/success',{state:{orderNumber:order?.order_number,fulfillmentType:type}});return
    }
    const {data:stripeData,error:stripeError}=await supabase.functions.invoke('stripe-create-payment-intent',{body:{order_id:order?.id,save_payment_method:saveCard}})
    setBusy(false)
    if(stripeError||!stripeData?.clientSecret||!stripeData?.publishableKey){setError(stripeData?.error||stripeError?.message||'No pudimos iniciar el pago con Stripe. Intenta nuevamente.');return}
    setStripeSession({order,clientSecret:stripeData.clientSecret,customerSessionClientSecret:stripeData.customerSessionClientSecret||undefined,stripePromise:loadStripe(stripeData.publishableKey),chargeTotal:Number(stripeData.amount||chargeTotal),fulfillmentType:type})
  }
  const paymentCompleted=order=>{setCart([]);nav('/success',{state:{orderNumber:order?.order_number,fulfillmentType:type,paymentProcessing:true,orderId:order?.id}})}
  if(stripeSession)return <Elements stripe={stripeSession.stripePromise} options={{clientSecret:stripeSession.clientSecret,customerSessionClientSecret:stripeSession.customerSessionClientSecret,appearance:{theme:'night',variables:{colorPrimary:'#ff6a00',colorBackground:'#171717',colorText:'#ffffff',colorDanger:'#ff5a52',borderRadius:'12px'}}}}><StripePaymentForm order={stripeSession.order} fulfillmentType={stripeSession.fulfillmentType} chargeTotal={stripeSession.chargeTotal} onPaid={paymentCompleted} onBack={()=>setStripeSession(null)}/></Elements>
  return <main className="checkout-page"><div className="simple-head"><button onClick={()=>nav(-1)}><ArrowLeft/></button><h1>Finalizar pedido</h1><span/></div><section className="checkout-section"><h2>¿Cómo quieres tu pedido?</h2><div className="type-toggle"><button onClick={()=>setType('delivery')} className={type==='delivery'?'active':''}><Bike/><span><strong>Delivery</strong><small>Entrega gratis a tu dirección</small></span></button><button onClick={()=>setType('pickup')} className={type==='pickup'?'active':''}><Store/><span><strong>Recoger</strong><small>20–30 min</small></span></button></div></section>{type==='delivery'?<section className="checkout-section"><div className="checkout-title-row"><h2>Dirección de entrega</h2><button className="text-btn" onClick={()=>setAdding(true)}><Plus size={16}/> Agregar</button></div>{addressBook.addresses.map(a=><button className={`address-option ${selected===a.id?'active':''}`} onClick={()=>chooseAddress(a)} key={a.id}><MapPin/><span><strong>{a.label} · {a.branch_id==='zakia'?'Zákia':'Milenio'}</strong><small>{formatAddress(a)}</small>{a.notes&&<em>{a.notes}</em>}</span>{selected===a.id&&<Check/>}</button>)}{addressBook.addresses.length===0&&<button className="save-login" onClick={()=>setAdding(true)}>+ Agregar dirección aquí</button>}</section>:<section className="checkout-section"><h2>¿En qué sucursal recoges?</h2>{catalog.branches.map(b=><button className={`address-option ${pickupBranch===b.id?'active':''}`} onClick={()=>setPickupBranch(b.id)} key={b.id}><Store/><span><strong>{b.name}</strong><small>{b.address}</small></span>{pickupBranch===b.id&&<Check/>}</button>)}</section>}<section className="checkout-section"><h2>Método de pago</h2><button className={`pay-option ${payment==='card'?'active':''}`} onClick={()=>setPayment('card')}><CreditCard/><span><strong>Tarjeta / Apple Pay</strong><small>Pago seguro procesado por Stripe</small></span>{payment==='card'&&<Check/>}</button><button className={`pay-option ${payment==='terminal'?'active':''}`} onClick={()=>setPayment('terminal')}><CreditCard/><span><strong>Terminal</strong><small>Paga con tu tarjeta en físico al recibir el pedido</small></span>{payment==='terminal'&&<Check/>}</button><button className={`pay-option ${payment==='cash'?'active':''}`} onClick={()=>setPayment('cash')}><Banknote/><span><strong>Efectivo</strong><small>Paga al recibir tu pedido</small></span>{payment==='cash'&&<Check/>}</button>{payment==='card'&&<label className="stripe-save-card-check"><input type="checkbox" checked={saveCard} onChange={e=>setSaveCard(e.target.checked)}/><span><strong>Guardar mi tarjeta para próximos pedidos</strong><small>Stripe la guarda de forma segura; KYO no almacena los datos de la tarjeta.</small></span></label>}<label className="admin-field"><span>Notas del pedido</span><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Sin cebolla, agregar soya..."/></label></section><section className="checkout-section tip-section"><div className="tip-title"><div><h2>Propina para el team</h2><p>La propina es opcional y es para el team KYO. No forma parte de la venta de KYO.</p></div>{tipAmount>0&&<strong>{money(tipAmount)}</strong>}</div><div className="tip-options"><button className={tipPercent===0?'active':''} onClick={()=>setTipPercent(0)}>Sin propina</button>{[5,10,20].map(v=><button key={v} className={tipPercent===v?'active':''} onClick={()=>setTipPercent(v)}><strong>{v}%</strong><small>{money(total*v/100)}</small></button>)}</div></section>{total<Number(catalog.settings?.minimum_order||200)&&<div className="minimum-order-notice"><strong>Pedido mínimo {money(catalog.settings?.minimum_order||200)}</strong><span>Agrega {money(Number(catalog.settings?.minimum_order||200)-total)} más en productos para continuar.</span></div>}{storeStatus?.ready&&!storeStatus?.open&&<div className="store-cart-closed"><Clock3/><span><strong>KYO está cerrado</strong><small>No es posible confirmar pedidos fuera del horario de servicio.</small></span></div>}{error&&<div className="form-message checkout-message">{error}</div>}<section className="summary checkout-summary"><div><span>Productos ({cart.reduce((a,i)=>a+i.qty,0)})</span><strong>{money(total)}</strong></div>{type==='delivery'&&<div><span>Envío</span><strong className="free-delivery">GRATIS</strong></div>}{tipAmount>0&&<div className="tip-summary-row"><span>Propina para el team ({effectiveTipPercent}%)</span><strong>{money(tipAmount)}</strong></div>}<div className="total"><span>{payment==='card'?'Total a cobrar':'Total a pagar'}</span><strong>{money(chargeTotal)}</strong></div>{tipAmount>0&&<small className="tip-accounting-note">Venta KYO: {money(total)} · Propina: {money(tipAmount)}</small>}</section><div className="checkout-bar"><button disabled={busy||!storeStatus?.ready||!storeStatus?.open||total<Number(catalog.settings?.minimum_order||200)} className="primary full" onClick={finish}>{busy?'Preparando...':payment==='card'?`Continuar al pago · ${money(chargeTotal)}`:`Confirmar pedido · ${money(chargeTotal)}`}</button></div>{adding&&<AddressModal auth={auth} branches={catalog.branches} onClose={()=>setAdding(false)} onSaved={async a=>{await addressBook.refresh();chooseAddress(a);setAdding(false)}}/>}</main>
}

function SuccessPage({setCart}){
  const nav=useNavigate();const loc=useLocation();const [params]=useSearchParams()
  const stateOrderId=loc.state?.orderId;const queryOrderId=params.get('order');const orderId=stateOrderId||queryOrderId
  const queryReturn=params.get('payment')==='return';const [verifying,setVerifying]=useState(Boolean(queryReturn||loc.state?.paymentProcessing));const [paymentError,setPaymentError]=useState('')
  const rawNumber=loc.state?.orderNumber||params.get('number');const orderNumber=rawNumber?String(rawNumber).padStart(4,'0'):null
  const type=loc.state?.fulfillmentType||params.get('type');const pickup=type==='pickup'
  useEffect(()=>{
    if(!orderId||!supabase){setVerifying(false);return}
    let stopped=false;let tries=0
    const check=async()=>{
      const {data,error}=await supabase.from('orders').select('payment_status,status').eq('id',orderId).maybeSingle()
      if(stopped)return
      if(error){setPaymentError('No pudimos verificar el pago todavía. Puedes revisarlo en Pedidos.');setVerifying(false);return}
      if(data?.payment_status==='paid'||data?.status==='preparing'){setCart?.([]);setVerifying(false);return}
      // Stripe puede emitir estados intermedios muy seguidos. No mostramos un rechazo
      // por un `failed` transitorio mientras el webhook definitivo todavía está llegando.
      tries+=1
      if(data?.payment_status==='failed'&&tries>=12){setPaymentError('El pago no fue aprobado. Regresa al checkout para intentarlo de nuevo.');setVerifying(false);return}
      if(tries<24)setTimeout(check,500);else{setPaymentError('Stripe está terminando de confirmar el pago. Revisa Pedidos en unos momentos.');setVerifying(false)}
    }
    check();return()=>{stopped=true}
  },[orderId,setCart])
  if(verifying)return <main className="success success-v2"><section className="success-card stripe-verifying-card"><RefreshCw className="spin" size={42}/><span className="success-kicker">VERIFICANDO PAGO</span><h1>Confirmando con Stripe…</h1><p className="success-lead">No cierres esta ventana. En cuanto Stripe confirme el cobro, enviaremos tu pedido a Cocina.</p></section></main>
  if(paymentError)return <main className="success success-v2"><section className="success-card"><div className="success-badge payment-warning"><CreditCard/></div><span className="success-kicker">ESTADO DEL PAGO</span><h1>Revisa tu pago</h1><p className="success-lead">{paymentError}</p><button className="success-home-btn" onClick={()=>nav('/orders')}>Ver mis pedidos <ChevronRight size={19}/></button><p className="success-orders-hint"><button onClick={()=>nav('/checkout')}>Volver al checkout</button></p></section></main>
  return <main className="success success-v2">
    <div className="success-glow success-glow-one"></div><div className="success-glow success-glow-two"></div><section className="success-card"><div className="success-badge"><Check/></div><span className="success-kicker">PEDIDO CONFIRMADO</span><h1>¡Ya lo estamos preparando!</h1><p className="success-lead">{pickup?'Cocina ya recibió tu pedido. Te avisaremos cuando esté listo para que pases por él.':'Gracias por pedir directo con KYO. Cocina ya recibió tu orden y empezó a trabajar en ella.'}</p>{orderNumber&&<div className="success-order-number"><small>NÚMERO DE PEDIDO</small><strong>#{orderNumber}</strong></div>}<div className="success-status-card"><div className="success-status-head"><span className="success-live-dot"></span><div><small>ESTADO ACTUAL</small><strong>Preparando</strong></div></div><div className="success-track"><div className="success-track-step active"><span><Check size={15}/></span><div><strong>Preparando</strong><small>Cocina tiene tu pedido</small></div></div><div className="success-track-line"></div><div className="success-track-step"><span>2</span><div><strong>{pickup?'Listo para recoger':'En camino'}</strong><small>{pickup?'Te avisaremos cuando esté listo':'Te avisaremos cuando salga'}</small></div></div><div className="success-track-line"></div><div className="success-track-step"><span>3</span><div><strong>Entregado</strong><small>¡A disfrutar KYO!</small></div></div></div></div><div className="success-note"><Clock3/><span><strong>Todo listo.</strong><small>{pickup?'Espera a que tu pedido cambie a “Listo para recoger”.':'No necesitas hacer nada más por ahora.'}</small></span></div><button className="success-home-btn" onClick={()=>nav('/')}>Volver a inicio <ChevronRight size={19}/></button><p className="success-orders-hint">En <button onClick={()=>nav('/orders')}>Pedidos</button> puedes rastrear tu pedido.</p></section>
  </main>
}
function EmptyState({icon,title,text,button,onClick}){return <section className="empty"><span>{icon}</span><h2>{title}</h2><p>{text}</p><button className="primary dark-btn" onClick={onClick}>{button}</button></section>}
export default App
