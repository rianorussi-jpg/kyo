import React, { useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck, LayoutDashboard, Utensils, LogOut, Plus, Package, MapPin, Clock3, Pencil, X, Upload, Trash2, Save, ClipboardList, DollarSign, RotateCcw, RotateCw, ZoomIn, ZoomOut, Settings, Gift } from 'lucide-react'
import { supabase, MENU_BUCKET } from './supabase'

const money = n => `$${Number(n || 0).toLocaleString('es-MX', {maximumFractionDigits: 2})}`
const statusLabels = {
  preparing:'Preparando', ready:'Listo', on_the_way:'En camino', delivered:'Entregado', cancelled:'Cancelado'
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
const businessDayLabels=[
  ['mon','Lunes'],['tue','Martes'],['wed','Miércoles'],['thu','Jueves'],
  ['fri','Viernes'],['sat','Sábado'],['sun','Domingo']
]

function Brand(){return <div className="brand"><span className="brand-mark">KYO</span><span className="brand-sub">JAPANESE SOUL FOOD</span></div>}

export function AdminGate({auth,children}){
  if(auth.loading)return <main className="admin-login"><RefreshCw className="spin"/><p>Comprobando sesión...</p></main>
  if(!auth.user)return <AdminLogin/>
  if(!auth.profile?.is_admin)return <main className="admin-login"><ShieldCheck size={44}/><h1>Cuenta sin acceso al panel</h1><p>Este usuario existe, pero no está marcado como administrador.</p><button className="primary dark-btn" onClick={()=>supabase?.auth.signOut()}>Cerrar sesión</button></main>
  return children
}

function AdminLogin(){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false)
  const submit=async e=>{e.preventDefault();if(!supabase)return setError('Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en Vercel.');setBusy(true);const {error}=await supabase.auth.signInWithPassword({email,password});setBusy(false);if(error)setError(error.message)}
  return <main className="admin-login"><div className="admin-login-card"><Brand/><span className="admin-pill">PANEL ADMINISTRATIVO</span><h1>Control de KYO</h1><p>Ingresa con el correo y contraseña de administración.</p><form onSubmit={submit}><label>Correo<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Contraseña<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="form-message">{error}</div>}<button className="primary full" disabled={busy}>{busy?'Entrando...':'Entrar al panel'}</button></form></div></main>
}

export function AdminPanel({auth,catalog}){
  const [tab,setTab]=useState('orders')
  const [orders,setOrders]=useState([])
  const [editing,setEditing]=useState(null)
  const [creating,setCreating]=useState(false)

  const loadOrders=async()=>{
    if(!supabase)return
    const {data}=await supabase.from('orders').select('*, order_items(*), profiles(full_name,phone)').order('created_at',{ascending:false}).limit(1000)
    setOrders(data||[])
  }

  useEffect(()=>{
    loadOrders()
    if(!supabase)return
    const ch=supabase.channel('admin-orders').on('postgres_changes',{event:'*',schema:'public',table:'orders'},loadOrders).subscribe()
    return()=>{supabase.removeChannel(ch)}
  },[])

  const updateStatus=async(id,status)=>{
    await supabase.from('orders').update({status}).eq('id',id)
    loadOrders()
    if(status==='delivered')auth.refreshProfile()
  }

  const title=tab==='orders'?'Pedidos':tab==='records'?'Registros':tab==='settings'?'Configuración':'Menú'

  return <main className="admin-shell">
    <aside className="admin-side">
      <Brand/>
      <div className="admin-user"><div>{(auth.profile?.full_name||'A')[0]}</div><span><strong>{auth.profile?.full_name||'Administrador'}</strong><small>{auth.user.email}</small></span></div>
      <nav>
        <button className={tab==='orders'?'active':''} onClick={()=>setTab('orders')}><LayoutDashboard/> Pedidos</button>
        <button className={tab==='records'?'active':''} onClick={()=>setTab('records')}><ClipboardList/> Registros</button>
        <button className={tab==='menu'?'active':''} onClick={()=>setTab('menu')}><Utensils/> Menú</button>
        <button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><Settings/> Configuración</button>
      </nav>
      <button className="admin-logout" onClick={()=>supabase.auth.signOut()}><LogOut/> Cerrar sesión</button>
    </aside>
    <section className="admin-main">
      <header><div><span>KYO CONTROL</span><h1>{title}</h1></div>{tab==='menu'&&<button className="primary" onClick={()=>setCreating(true)}><Plus/> Nuevo producto</button>}</header>
      {tab==='orders'
        ?<AdminOrders orders={orders} updateStatus={updateStatus}/>
        :tab==='records'
          ?<AdminRecords orders={orders}/>
          :tab==='settings'
            ?<AdminSettings catalog={catalog}/>
            :<AdminMenuManager catalog={catalog} onEdit={setEditing}/>}
    </section>
    {(editing||creating)&&<ProductEditor product={editing} catalog={catalog} onClose={()=>{setEditing(null);setCreating(false)}} onSaved={()=>{setEditing(null);setCreating(false);catalog.refresh()}}/>}
  </main>
}

function AdminSettings({catalog}){
  const [minimum,setMinimum]=useState(catalog.settings?.minimum_order||200)
  const [rewardPoints,setRewardPoints]=useState(catalog.settings?.points_reward_cost||250)
  const [rewardProduct,setRewardProduct]=useState(catalog.settings?.points_reward_product_id||'')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [pointsEmail,setPointsEmail]=useState('')
  const [pointsAmount,setPointsAmount]=useState('')
  const [pointsBusy,setPointsBusy]=useState(false)
  const [pointsMessage,setPointsMessage]=useState('')
  const [businessHours,setBusinessHours]=useState(catalog.settings?.business_hours||defaultBusinessHours)

  useEffect(()=>{
    setMinimum(catalog.settings?.minimum_order||200)
    setRewardPoints(catalog.settings?.points_reward_cost||250)
    setRewardProduct(catalog.settings?.points_reward_product_id||'')
    setBusinessHours(catalog.settings?.business_hours||defaultBusinessHours)
  },[catalog.settings?.minimum_order,catalog.settings?.points_reward_cost,catalog.settings?.points_reward_product_id,catalog.settings?.business_hours])

  const save=async()=>{
    setBusy(true);setMessage('')
    const payload={
      id:'main',
      minimum_order:Math.max(0,Number(minimum||0)),
      points_reward_cost:Math.max(1,Math.round(Number(rewardPoints||1))),
      points_reward_product_id:rewardProduct||null,
      business_hours:businessHours,
      updated_at:new Date().toISOString()
    }
    const {error}=await supabase.from('app_settings').upsert(payload,{onConflict:'id'})
    setBusy(false)
    if(error)return setMessage(error.message)
    await catalog.refresh()
    setMessage('Configuración guardada.')
  }

  const addPointsToUser=async()=>{
    const email=pointsEmail.trim().toLowerCase()
    const amount=Math.floor(Number(pointsAmount||0))
    setPointsMessage('')
    if(!email)return setPointsMessage('Escribe el correo del usuario.')
    if(!Number.isFinite(amount)||amount<=0)return setPointsMessage('Pon una cantidad de puntos mayor a 0.')
    setPointsBusy(true)
    const {data,error}=await supabase.rpc('admin_add_reward_points',{p_email:email,p_points:amount})
    setPointsBusy(false)
    if(error)return setPointsMessage(error.message)
    const row=Array.isArray(data)?data[0]:data
    setPointsMessage(`${amount} puntos agregados a ${row?.email||email}. Nuevo saldo: ${row?.reward_points??'actualizado'} puntos.`)
    setPointsAmount('')
  }

  const updateBusinessDay=(day,field,value)=>{
    setBusinessHours(prev=>({...prev,[day]:{...(prev[day]||defaultBusinessHours[day]),[field]:value}}))
  }

  const grouped=(catalog.categoryObjects||[]).filter(c=>!c.parent_id).sort((a,b)=>a.sort_order-b.sort_order)

  return <div className="admin-settings-page">
    <section className="admin-settings-card">
      <div className="settings-card-head"><span><DollarSign/></span><div><small>PEDIDOS</small><h2>Pedido mínimo</h2><p>El subtotal de productos debe alcanzar esta cantidad antes de confirmar.</p></div></div>
      <label className="admin-field settings-number-field"><span>Monto mínimo</span><div className="settings-money-input"><b>$</b><input type="number" min="0" step="1" value={minimum} onChange={e=>setMinimum(e.target.value)}/></div></label>
    </section>

    <section className="admin-settings-card">
      <div className="settings-card-head"><span><Clock3/></span><div><small>HORARIOS</small><h2>Horario de pedidos</h2><p>La app usa siempre la hora de Ciudad de México. Fuera de este horario los clientes no pueden agregar productos al carrito.</p></div></div>
      <div className="business-hours-editor">
        {businessDayLabels.map(([day,label])=>{const h=businessHours?.[day]||defaultBusinessHours[day];return <div className={`business-day-row ${h.closed?'closed':''}`} key={day}>
          <strong>{label}</strong>
          <button type="button" className={`business-closed-toggle ${h.closed?'closed':''}`} onClick={()=>updateBusinessDay(day,'closed',!h.closed)}>{h.closed?'Cerrado':'Abierto'}</button>
          <label><span>Abre</span><input type="time" disabled={h.closed} value={h.open||'13:00'} onChange={e=>updateBusinessDay(day,'open',e.target.value)}/></label>
          <label><span>Cierra</span><input type="time" disabled={h.closed} value={h.close||'21:00'} onChange={e=>updateBusinessDay(day,'close',e.target.value)}/></label>
        </div>})}
      </div>
      <small className="business-timezone-note">Zona horaria fija: America/Mexico_City (CDMX)</small>
    </section>

    <section className="admin-settings-card">
      <div className="settings-card-head"><span><Package/></span><div><small>KYO REWARDS</small><h2>Reward por puntos</h2><p>Escoge el producto que se regalará y cuántos puntos necesita el cliente para canjearlo.</p></div></div>
      <div className="settings-two-columns">
        <label className="admin-field"><span>Costo en puntos</span><input type="number" min="1" step="1" value={rewardPoints} onChange={e=>setRewardPoints(e.target.value)}/></label>
        <label className="admin-field"><span>Producto gratis</span><select value={rewardProduct} onChange={e=>setRewardProduct(e.target.value)}><option value="">Selecciona un producto</option>{grouped.map(cat=><optgroup key={cat.id} label={cat.name}>{catalog.products.filter(p=>p.category===cat.name).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</select></label>
      </div>
      {rewardProduct&&<div className="settings-reward-preview">{(()=>{const p=catalog.products.find(x=>x.id===rewardProduct);return p?<><img src={p.image||p.image_url}/><span><small>REWARD ACTUAL</small><strong>{p.name}</strong><em>{rewardPoints} KYO Points</em></span></>:null})()}</div>}
    </section>

    <section className="admin-settings-card">
      <div className="settings-card-head"><span><Gift/></span><div><small>KYO POINTS</small><h2>Agregar puntos a un usuario</h2><p>Busca la cuenta por correo y suma puntos manualmente a su saldo.</p></div></div>
      <div className="admin-points-form">
        <label className="admin-field"><span>Correo del usuario</span><input type="email" value={pointsEmail} onChange={e=>setPointsEmail(e.target.value)} placeholder="cliente@correo.com"/></label>
        <label className="admin-field"><span>Puntos a agregar</span><input type="number" min="1" step="1" value={pointsAmount} onChange={e=>setPointsAmount(e.target.value)} placeholder="100"/></label>
        <button className="primary admin-add-points-btn" disabled={pointsBusy} onClick={addPointsToUser}>{pointsBusy?'Agregando...':'Agregar puntos'}</button>
      </div>
      {pointsMessage&&<div className="admin-points-message">{pointsMessage}</div>}
    </section>

    {message&&<div className="form-message">{message}</div>}
    <div className="settings-save-bar"><button className="primary" disabled={busy||!rewardProduct} onClick={save}><Save/> {busy?'Guardando...':'Guardar configuración'}</button></div>
  </div>
}
function BranchFilter({value,onChange}){return <div className="admin-filter-row"><button className={value==='all'?'active':''} onClick={()=>onChange('all')}>Todas</button><button className={value==='zakia'?'active':''} onClick={()=>onChange('zakia')}>Zákia</button><button className={value==='milenio'?'active':''} onClick={()=>onChange('milenio')}>Milenio</button></div>}

function AdminOrders({orders,updateStatus}){
  const [branch,setBranch]=useState('all'); const filtered=orders.filter(o=>branch==='all'||o.branch_id===branch)
  return <><div className="admin-section-toolbar"><div><small>FILTRAR SUCURSAL</small><BranchFilter value={branch} onChange={setBranch}/></div></div><div className="admin-orders">{filtered.length===0?<div className="admin-empty"><Package/><h3>No hay pedidos</h3><p>No hay pedidos para este filtro.</p></div>:filtered.map(o=><article key={o.id}><div className="admin-order-top"><span><small>PEDIDO</small><strong>#{String(o.order_number).padStart(4,'0')}</strong></span><span className={`branch-pill ${o.branch_id}`}>{o.branch_id==='zakia'?'ZÁKIA':'MILENIO'}</span><span className={`admin-status ${o.status}`}>{statusLabels[o.status]}</span><span className="admin-client-detail"><small>CLIENTE</small><strong>{o.profiles?.full_name||'Cliente KYO'}</strong>{o.profiles?.phone&&<em>{o.profiles.phone}</em>}</span><span><small>TOTAL</small><strong>{money(o.total)}</strong></span></div><div className="admin-order-items-detail">{o.order_items?.map(i=><div key={i.id}><strong>{i.quantity}× {i.product_name}</strong>{i.customizations?.length>0&&<div className="admin-item-customizations">{Object.entries(i.customizations.reduce((g,c)=>{const title=c.template_name||c.group_name||c.customization_name||c.title||'Personalización';(g[title]??=[]).push(c);return g},{})).map(([title,rows])=><span key={title}><b>{title}:</b> {rows.map(c=>c.label||c.option_name||c.name).join(', ')}</span>)}</div>}{i.item_note&&<em><b>Nota:</b> {i.item_note}</em>}</div>)}</div><div className="admin-order-meta"><span><MapPin/> {o.branch_id==='zakia'?'KYO Zákia':'KYO Milenio'} · {o.fulfillment_type==='delivery'?'Delivery':'Pickup'}{o.delivery_address?` · ${o.delivery_address}`:''}</span><span><Clock3/> {new Date(o.created_at).toLocaleString('es-MX')}</span></div><div className="status-actions">{(o.fulfillment_type==='pickup'?['preparing','ready','delivered','cancelled']:['preparing','ready','on_the_way','delivered','cancelled']).map(s=><button key={s} className={o.status===s?'active':''} onClick={()=>updateStatus(o.id,s)}>{o.fulfillment_type==='pickup'&&s==='ready'?'Listo para recoger':statusLabels[s]}</button>)}</div></article>)}</div></>
}

function AdminRecords({orders}){
  const [branch,setBranch]=useState('all'); const [period,setPeriod]=useState('1')
  const cutoff=period==='all'?null:new Date(Date.now()-Number(period)*86400000)
  const filtered=orders.filter(o=>o.status!=='cancelled').filter(o=>branch==='all'||o.branch_id===branch).filter(o=>!cutoff||new Date(o.created_at)>=cutoff)
  const total=filtered.reduce((a,o)=>a+Number(o.total||0),0); const delivered=filtered.filter(o=>o.status==='delivered').length
  return <div className="admin-records"><div className="records-toolbar"><div><small>SUCURSAL</small><BranchFilter value={branch} onChange={setBranch}/></div><div><small>PERIODO</small><div className="admin-filter-row">{[['1','1 día'],['7','7 días'],['30','30 días'],['all','Toda la vida']].map(([v,l])=><button key={v} className={period===v?'active':''} onClick={()=>setPeriod(v)}>{l}</button>)}</div></div></div><div className="record-summary"><article><DollarSign/><span><small>VENTAS</small><strong>{money(total)}</strong></span></article><article><Package/><span><small>PEDIDOS</small><strong>{filtered.length}</strong></span></article><article><ClipboardList/><span><small>ENTREGADOS</small><strong>{delivered}</strong></span></article></div><div className="records-table"><div className="records-head"><span>Pedido</span><span>Fecha</span><span>Sucursal</span><span>Cliente</span><span>Estado</span><span>Total</span></div>{filtered.map(o=><div className="records-row" key={o.id}><strong>#{String(o.order_number).padStart(4,'0')}</strong><span>{new Date(o.created_at).toLocaleString('es-MX')}</span><span><b className={`branch-pill small ${o.branch_id}`}>{o.branch_id==='zakia'?'Zákia':'Milenio'}</b></span><span>{o.profiles?.full_name||'Cliente KYO'}</span><span>{statusLabels[o.status]}</span><strong>{money(o.total)}</strong></div>)}{!filtered.length&&<div className="records-empty">No hay registros para este periodo.</div>}</div></div>
}

function AdminMenuManager({catalog,onEdit}){
  const [view,setView]=useState('products')
  const [saving,setSaving]=useState('')
  const branches=catalog.branches||[]

  const setProductBranch=async(product,branchId,available)=>{
    const key=`${product.id}:${branchId}`;setSaving(key)
    const {error}=await supabase.from('product_branch_availability').upsert(
      {product_id:product.id,branch_id:branchId,available},
      {onConflict:'product_id,branch_id'}
    )
    setSaving('')
    if(error)return alert(error.message)
    await catalog.refresh()
  }

  const parents=(catalog.categoryObjects||[]).filter(c=>!c.parent_id).sort((a,b)=>a.sort_order-b.sort_order)
  const groups=parents.map(cat=>({
    cat,
    products:catalog.products.filter(p=>p.category===cat.name),
    subs:(catalog.categoryObjects||[]).filter(s=>s.parent_id===cat.id).sort((a,b)=>a.sort_order-b.sort_order)
  }))

  return <>
    <div className="menu-admin-tabs">
      <button className={view==='products'?'active':''} onClick={()=>setView('products')}>Productos por categoría</button>
      <button className={view==='categories'?'active':''} onClick={()=>setView('categories')}>Categorías y subcategorías</button>
    </div>
    {view==='products'
      ?<div className="admin-menu-by-category">
        {groups.map(({cat,products,subs})=><section className="admin-menu-category" key={cat.id}>
          <div className="admin-menu-category-head"><div><small>CATEGORÍA</small><h2>{cat.name}</h2></div><span>{products.length} producto{products.length===1?'':'s'}</span></div>
          {subs.length>0
            ?<>
              {subs.map(sub=>{const items=products.filter(p=>p.subcategory===sub.name);return items.length?<div className="admin-subcategory-block" key={sub.id}><h3>{sub.name}</h3><div className="admin-product-grid">{items.map(product=><AdminProductCard key={product.id} product={product} branches={branches} saving={saving} setProductBranch={setProductBranch} onEdit={onEdit}/>)}</div></div>:null})}
              {products.some(p=>!p.subcategory)&&<div className="admin-subcategory-block"><h3>Sin subcategoría</h3><div className="admin-product-grid">{products.filter(p=>!p.subcategory).map(product=><AdminProductCard key={product.id} product={product} branches={branches} saving={saving} setProductBranch={setProductBranch} onEdit={onEdit}/>)}</div></div>}
            </>
            :<div className="admin-product-grid">{products.map(product=><AdminProductCard key={product.id} product={product} branches={branches} saving={saving} setProductBranch={setProductBranch} onEdit={onEdit}/>)}</div>}
        </section>)}
      </div>
      :<CategoryManager catalog={catalog}/>}
  </>
}

function AdminProductCard({product,branches,saving,setProductBranch,onEdit}){
  return <article className={`admin-product-card-branch ${!product.available?'disabled':''}`}>
    <img src={product.image||product.image_url}/>
    <div className="admin-product-card-info">
      <small>{product.subcategory||product.category}</small>
      <h3>{product.name}</h3>
      <strong>{money(product.price)}</strong>
      <span>{product.available?'Disponible en menú':'Agotado globalmente'}</span>
      <div className="branch-availability-row">
        {branches.map(b=>{const available=product.branchAvailability?.[b.id]!==false;const key=`${product.id}:${b.id}`;return <button type="button" key={b.id} disabled={saving===key||!product.available} className={available?'available':'unavailable'} onClick={()=>setProductBranch(product,b.id,!available)}><span>{b.short||b.name}</span><b>{available?'Disponible':'No disponible'}</b></button>})}
      </div>
    </div>
    <button className="admin-edit-product" onClick={()=>onEdit(product)}><Pencil/></button>
  </article>
}

function slugify(value){return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')}

function CategoryManager({catalog}){
  const [rows,setRows]=useState([]);const [name,setName]=useState('');const [parentId,setParentId]=useState('');const [sortOrder,setSortOrder]=useState(10);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('')
  const load=async()=>{const {data}=await supabase.from('categories').select('*').order('parent_id',{ascending:true,nullsFirst:true}).order('sort_order');setRows(data||[])}
  useEffect(()=>{load()},[])
  const parents=rows.filter(r=>!r.parent_id)
  const create=async()=>{if(!name.trim())return;setBusy(true);setMessage('');const {error}=await supabase.from('categories').insert({name:name.trim(),slug:slugify(name),parent_id:parentId||null,sort_order:Number(sortOrder||0),active:true});setBusy(false);if(error)return setMessage(error.message);setName('');setParentId('');setSortOrder(10);await load();await catalog.refresh()}
  const update=(id,key,value)=>setRows(x=>x.map(r=>r.id===id?{...r,[key]:value}:r))
  const save=async row=>{setMessage('');const payload={name:row.name.trim(),slug:slugify(row.name),parent_id:row.parent_id||null,sort_order:Number(row.sort_order||0),active:!!row.active};const {error}=await supabase.from('categories').update(payload).eq('id',row.id);if(error)return setMessage(error.message);await load();await catalog.refresh()}
  const remove=async row=>{if(!confirm(`¿Eliminar ${row.name}? Los productos conservarán su categoría principal cuando sea posible.`))return;const {error}=await supabase.from('categories').delete().eq('id',row.id);if(error)return setMessage(error.message);await load();await catalog.refresh()}
  return <div className="category-manager"><section className="category-create-card"><div><small>NUEVA CATEGORÍA</small><h3>Organiza el menú</h3><p>Sin categoría padre se mostrará arriba en el menú. Si eliges una categoría padre, se mostrará como subcategoría.</p></div><div className="category-create-grid"><label className="admin-field"><span>Nombre</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Bebidas"/></label><label className="admin-field"><span>Dentro de</span><select value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">Categoría principal</option>{parents.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="admin-field"><span>Orden</span><input type="number" value={sortOrder} onChange={e=>setSortOrder(e.target.value)}/></label><button className="primary" disabled={busy} onClick={create}><Plus/> Crear</button></div></section>{message&&<div className="form-message">{message}</div>}<div className="category-admin-list">{parents.map(parent=><section className="category-parent-card" key={parent.id}><CategoryEditRow row={parent} parents={parents} update={update} save={save} remove={remove}/><div className="subcategory-admin-list">{rows.filter(r=>r.parent_id===parent.id).sort((a,b)=>a.sort_order-b.sort_order).map(child=><CategoryEditRow key={child.id} row={child} parents={parents.filter(p=>p.id!==child.id)} update={update} save={save} remove={remove} child/>)}</div></section>)}</div></div>
}

function CategoryEditRow({row,parents,update,save,remove,child=false}){return <div className={`category-edit-row ${child?'child':''}`}><div className="category-level">{child?'SUBCATEGORÍA':'CATEGORÍA'}</div><input className="category-name-input" value={row.name} onChange={e=>update(row.id,'name',e.target.value)}/>{child&&<select value={row.parent_id||''} onChange={e=>update(row.id,'parent_id',e.target.value||null)}>{parents.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}<label className="category-order">Orden <input type="number" value={row.sort_order} onChange={e=>update(row.id,'sort_order',e.target.value)}/></label><label className="category-active"><input type="checkbox" checked={row.active} onChange={e=>update(row.id,'active',e.target.checked)}/> Visible</label><button className="secondary-btn compact" onClick={()=>save(row)}><Save size={15}/> Guardar</button><button className="icon-danger" onClick={()=>remove(row)}><Trash2 size={16}/></button></div>}

async function processProductImage(file,degrees,zoomPercent){
  const normalized=((degrees%360)+360)%360
  const zoom=Math.max(.6,Math.min(1.8,Number(zoomPercent||100)/100))
  if(!normalized && Math.abs(zoom-1)<.001)return file

  const bitmap=await createImageBitmap(file)
  const swap=normalized===90||normalized===270
  const canvas=document.createElement('canvas')
  canvas.width=swap?bitmap.height:bitmap.width
  canvas.height=swap?bitmap.width:bitmap.height
  const ctx=canvas.getContext('2d')

  // White background keeps zoom-out exports clean for the restaurant's studio photos.
  ctx.fillStyle='#ffffff'
  ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.translate(canvas.width/2,canvas.height/2)
  ctx.rotate(normalized*Math.PI/180)
  ctx.scale(zoom,zoom)
  ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2)
  bitmap.close?.()

  const type=['image/jpeg','image/png','image/webp'].includes(file.type)?file.type:'image/jpeg'
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(
    b=>b?resolve(b):reject(new Error('No se pudo procesar la imagen.')),
    type,
    type==='image/png'?undefined:.92
  ))
  const ext=type==='image/png'?'png':type==='image/webp'?'webp':'jpg'
  const base=(file.name||'producto').replace(/\.[^.]+$/,'')
  return new File([blob],`${base}-editada.${ext}`,{type,lastModified:Date.now()})
}

function ProductEditor({product,catalog,onClose,onSaved}){
  const categories=catalog.categories;const categoryObjects=catalog.categoryObjects||[]
  const [form,setForm]=useState({name:product?.name||'',description:product?.description||product?.desc||'',price:product?.price||'',category:product?.category||categories[0]||'Entradas',image_url:product?.image_url||product?.image||'',featured:!!product?.featured,spicy:!!product?.spicy,available:product?.available!==false,subcategory:product?.subcategory||''})
  const [file,setFile]=useState(null); const [imageRotation,setImageRotation]=useState(0); const [imageZoom,setImageZoom]=useState(100); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  const [templates,setTemplates]=useState([]); const [assigned,setAssigned]=useState((product?.customizations||[]).map(x=>x.id)); const [assignedOrder,setAssignedOrder]=useState((product?.customizations||[]).map(x=>x.id)); const [showTemplate,setShowTemplate]=useState(false)
  const [template,setTemplate]=useState({name:'',input_type:'single',required:false,min_select:0,max_select:1,options:[{id:crypto.randomUUID(),name:'',price:0,branchAvailability:{zakia:true,milenio:true}}]}); const [editingTemplateId,setEditingTemplateId]=useState(null)
  const loadTemplates=async()=>{
    const {data}=await supabase
      .from('customization_templates')
      .select('*, customization_option_branch_availability(option_id,branch_id,available)')
      .order('name')

    setTemplates((data||[]).map(t=>{
      const availabilityRows=t.customization_option_branch_availability||[]
      return {
        ...t,
        options:(t.options||[]).map(o=>({
          ...o,
          branchAvailability:Object.fromEntries(
            availabilityRows
              .filter(r=>r.option_id===o.id)
              .map(r=>[r.branch_id,r.available])
          )
        }))
      }
    }))
  }
  useEffect(()=>{loadTemplates()},[])
  const addOption=()=>setTemplate(t=>({...t,options:[...t.options,{id:crypto.randomUUID(),name:'',price:0,branchAvailability:{zakia:true,milenio:true}}]}))
  const updateOption=(id,key,value)=>setTemplate(t=>({...t,options:t.options.map(o=>o.id===id?{...o,[key]:value}:o)}))
  const removeOption=id=>setTemplate(t=>({...t,options:t.options.filter(o=>o.id!==id)}))
  const resetTemplate=()=>{setEditingTemplateId(null);setShowTemplate(false);setTemplate({name:'',input_type:'single',required:false,min_select:0,max_select:1,options:[{id:crypto.randomUUID(),name:'',price:0,branchAvailability:{zakia:true,milenio:true}}]})}
  const editTemplate=t=>{setEditingTemplateId(t.id);setTemplate({...t,options:(t.options||[]).map(o=>({...o}))});setShowTemplate(true)}
  const saveTemplate=async()=>{
    if(!template.name.trim()||!template.options.some(o=>o.name.trim()))return setError('Pon nombre a la personalización y al menos una opción.')
    const validOptions=template.options.filter(o=>o.name.trim())
    const clean={name:template.name.trim(),input_type:template.input_type,required:!!template.required,min_select:Number(template.min_select||0),max_select:Number(template.max_select||0),options:validOptions.map(o=>({id:o.id,name:o.name.trim(),price:Number(o.price||0)}))}
    let saved
    if(editingTemplateId){
      const {data,error:e}=await supabase.from('customization_templates').update(clean).eq('id',editingTemplateId).select().single()
      if(e)return setError(e.message);saved=data
    }else{
      const {data,error:e}=await supabase.from('customization_templates').insert(clean).select().single()
      if(e)return setError(e.message);saved=data
    }
    await supabase.from('customization_option_branch_availability').delete().eq('template_id',saved.id)
    const availabilityRows=validOptions.flatMap(o=>(catalog.branches||[]).map(b=>({
      template_id:saved.id,option_id:o.id,branch_id:b.id,available:o.branchAvailability?.[b.id]!==false
    })))
    if(availabilityRows.length){
      const {error:aerr}=await supabase.from('customization_option_branch_availability').insert(availabilityRows)
      if(aerr)return setError(aerr.message)
    }
    if(!editingTemplateId){setAssigned(x=>[...x,saved.id]);setAssignedOrder(x=>[...x,saved.id])}
    await loadTemplates();resetTemplate();await catalog.refresh()
  }
  const save=async()=>{setBusy(true);setError('');let imageUrl=form.image_url
    if(file){let uploadFile=file;try{uploadFile=await processProductImage(file,imageRotation,imageZoom)}catch(e){setError(e.message||'No se pudo girar la imagen.');setBusy(false);return}const ext=uploadFile.name.split('.').pop();const path=`products/${crypto.randomUUID()}.${ext}`;const {error:up}=await supabase.storage.from(MENU_BUCKET).upload(path,uploadFile,{upsert:false,contentType:uploadFile.type||undefined});if(up){setError(up.message);setBusy(false);return} imageUrl=supabase.storage.from(MENU_BUCKET).getPublicUrl(path).data.publicUrl}
    const {data:cat}=await supabase.from('categories').select('id').eq('name',form.category).is('parent_id',null).single();
    let subId=null;if(form.subcategory){const {data:sub}=await supabase.from('categories').select('id').eq('name',form.subcategory).eq('parent_id',cat?.id).maybeSingle();subId=sub?.id||null}
    const payload={name:form.name,slug:product?.slug||form.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''),description:form.description,price:Number(form.price),category_id:cat?.id||null,subcategory_id:subId,image_url:imageUrl,featured:form.featured,spicy:form.spicy,available:form.available}
    let savedId=product?.id
    if(product?.id){const result=await supabase.from('products').update(payload).eq('id',product.id);if(result.error){setBusy(false);return setError(result.error.message)}}
    else {const result=await supabase.from('products').insert(payload).select('id').single();if(result.error){setBusy(false);return setError(result.error.message)}savedId=result.data.id}
    await supabase.from('product_customizations').delete().eq('product_id',savedId)
    if(assigned.length){const ordered=[...assignedOrder.filter(id=>assigned.includes(id)),...assigned.filter(id=>!assignedOrder.includes(id))];const links=ordered.map((id,i)=>({product_id:savedId,template_id:id,sort_order:(i+1)*10}));const {error:e}=await supabase.from('product_customizations').insert(links);if(e){setBusy(false);return setError(e.message)}}
    setBusy(false);onSaved()
  }
  const remove=async()=>{if(!product?.id||!confirm('¿Eliminar este producto?'))return;await supabase.from('products').delete().eq('id',product.id);onSaved()}
  return <div className="modal-backdrop"><div className="product-editor product-editor-wide"><div className="modal-head"><div><small>{product?'EDITAR PRODUCTO':'NUEVO PRODUCTO'}</small><h2>{product?.name||'Agregar al menú'}</h2></div><button onClick={onClose}><X/></button></div><div className="editor-grid"><label className="admin-field"><span>Nombre</span><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label className="admin-field"><span>Precio base</span><input type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/></label><label className="admin-field"><span>Categoría</span><select value={form.category} onChange={e=>setForm({...form,category:e.target.value,subcategory:''})}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>{(()=>{const parent=categoryObjects.find(c=>!c.parent_id&&c.name===form.category);const subs=categoryObjects.filter(c=>parent&&c.parent_id===parent.id);return subs.length?<label className="admin-field"><span>Subcategoría</span><select value={form.subcategory} onChange={e=>setForm({...form,subcategory:e.target.value})}><option value="">Sin subcategoría</option>{subs.map(s=><option key={s.id}>{s.name}</option>)}</select></label>:null})()}<label className="admin-field full-span"><span>Descripción</span><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><label className="image-upload full-span"><Upload/><span><strong>Subir nueva foto</strong><small>JPG, PNG o WebP. Puedes girarla antes de guardar.</small></span><input type="file" accept="image/*" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);setImageRotation(0);setImageZoom(100)}}/></label>{(file||form.image_url)&&<div className="image-editor-preview full-span"><div className="image-preview-stage"><img className="editor-preview" src={file?URL.createObjectURL(file):form.image_url} style={file?{transform:`rotate(${imageRotation}deg) scale(${imageZoom/100})`}:undefined}/></div>{file&&<div className="image-edit-controls"><div className="image-rotate-controls"><button type="button" onClick={()=>setImageRotation(r=>(r+270)%360)}><RotateCcw size={18}/><span>Girar izquierda</span></button><b>{imageRotation}°</b><button type="button" onClick={()=>setImageRotation(r=>(r+90)%360)}><RotateCw size={18}/><span>Girar derecha</span></button></div><div className="image-zoom-controls"><button type="button" disabled={imageZoom<=60} onClick={()=>setImageZoom(z=>Math.max(60,z-10))}><ZoomOut size={18}/><span>Alejar</span></button><div><strong>{imageZoom}%</strong><input aria-label="Zoom de imagen" type="range" min="60" max="180" step="5" value={imageZoom} onChange={e=>setImageZoom(Number(e.target.value))}/></div><button type="button" disabled={imageZoom>=180} onClick={()=>setImageZoom(z=>Math.min(180,z+10))}><ZoomIn size={18}/><span>Acercar</span></button></div><button type="button" className="image-reset-btn" disabled={imageRotation===0&&imageZoom===100} onClick={()=>{setImageRotation(0);setImageZoom(100)}}>Restablecer imagen</button></div>}</div>}<div className="editor-toggles full-span"><label><input type="checkbox" checked={form.available} onChange={e=>setForm({...form,available:e.target.checked})}/> Disponible</label><label><input type="checkbox" checked={form.featured} onChange={e=>setForm({...form,featured:e.target.checked})}/> Favorito</label><label><input type="checkbox" checked={form.spicy} onChange={e=>setForm({...form,spicy:e.target.checked})}/> Spicy</label></div>
    <section className="custom-admin-section full-span"><div className="custom-admin-head"><div><small>PERSONALIZACIÓN DEL PRODUCTO</small><h3>Opciones para el cliente</h3><p>Asigna plantillas guardadas o crea una nueva para reutilizarla en otros productos.</p></div><button className="secondary-btn" onClick={()=>{if(showTemplate){resetTemplate()}else{setEditingTemplateId(null);setShowTemplate(true)}}}><Plus/> Nueva plantilla</button></div>
      {showTemplate&&<div className="template-builder"><div className="template-builder-grid"><label className="admin-field"><span>Nombre</span><input value={template.name} onChange={e=>setTemplate({...template,name:e.target.value})} placeholder="Ej. Salsas"/></label><label className="admin-field"><span>Tipo</span><select value={template.input_type} onChange={e=>setTemplate({...template,input_type:e.target.value,max_select:e.target.value==='single'?1:template.max_select})}><option value="single">Elegir una</option><option value="multiple">Marcar opciones</option><option value="quantity">Elegir cantidad</option></select></label><label className="admin-check"><input type="checkbox" checked={template.required} onChange={e=>setTemplate({...template,required:e.target.checked,min_select:e.target.checked?Math.max(1,Number(template.min_select||0)):0})}/> Obligatoria</label><label className="admin-field"><span>Mínimo</span><input type="number" min="0" value={template.min_select} onChange={e=>setTemplate({...template,min_select:e.target.value})}/></label><label className="admin-field"><span>Máximo</span><input type="number" min="1" value={template.max_select} onChange={e=>setTemplate({...template,max_select:e.target.value})}/></label></div><div className="template-options"><div className="template-options-head"><strong>Opciones</strong><small>El costo puede ser $0.</small></div>{template.options.map(o=><div className="template-option-row template-option-branch-row" key={o.id}><input value={o.name} onChange={e=>updateOption(o.id,'name',e.target.value)} placeholder="Nombre de opción"/><div className="price-input"><span>$</span><input type="number" min="0" step="1" value={o.price} onChange={e=>updateOption(o.id,'price',e.target.value)}/></div><div className="option-branch-toggles">{(catalog.branches||[]).map(b=>{const available=o.branchAvailability?.[b.id]!==false;return <button type="button" key={b.id} className={available?'available':'unavailable'} onClick={()=>setTemplate(t=>({...t,options:t.options.map(x=>x.id===o.id?{...x,branchAvailability:{...(x.branchAvailability||{}),[b.id]:!available}}:x)}))}><span>{b.short||b.name}</span><b>{available?'✓':'×'}</b></button>})}</div><button onClick={()=>removeOption(o.id)}><Trash2 size={16}/></button></div>)}<button className="text-btn" onClick={addOption}><Plus size={16}/> Agregar opción</button></div><div className="template-builder-actions"><button className="secondary-btn" onClick={resetTemplate}>Cancelar</button><button className="primary" onClick={saveTemplate}><Save size={16}/> {editingTemplateId?'Guardar cambios':'Guardar plantilla y asignar'}</button></div></div>}
      <div className="template-library">{templates.length===0?<p className="template-empty">Todavía no hay plantillas guardadas.</p>:templates.map(t=>{const active=assigned.includes(t.id);const pos=assignedOrder.filter(id=>assigned.includes(id)).indexOf(t.id);const activeCount=assignedOrder.filter(id=>assigned.includes(id)).length;const move=(dir)=>setAssignedOrder(order=>{const a=order.filter(id=>assigned.includes(id));const rest=order.filter(id=>!assigned.includes(id));const i=a.indexOf(t.id);if(i<0)return order;const j=i+dir;if(j<0||j>=a.length)return order;[a[i],a[j]]=[a[j],a[i]];return [...a,...rest]});return <div className={`template-card template-card-order ${active?'active':''}`} key={t.id}><label><input type="checkbox" checked={active} onChange={e=>{setAssigned(x=>e.target.checked?[...x,t.id]:x.filter(id=>id!==t.id));if(e.target.checked)setAssignedOrder(x=>x.includes(t.id)?x:[...x,t.id])}}/><div><strong>{t.name}</strong><small>{t.input_type==='single'?'Elegir una':t.input_type==='multiple'?'Marcar opciones':'Por cantidad'} · {t.required?'Obligatoria':'Opcional'}</small><span>{(t.options||[]).map(o=>`${o.name}${Number(o.price)>0?` (+$${o.price})`:''}`).join(' · ')}</span></div></label><button type="button" className="template-edit-btn" onClick={()=>editTemplate(t)}><Pencil size={15}/> Editar</button>{active&&<div className="template-order-controls"><b>{pos+1}</b><button type="button" disabled={pos<=0} onClick={()=>move(-1)} aria-label="Subir personalización">↑</button><button type="button" disabled={pos<0||pos>=activeCount-1} onClick={()=>move(1)} aria-label="Bajar personalización">↓</button></div>}</div>})}</div>
    </section></div>{error&&<div className="form-message">{error}</div>}<div className="modal-actions">{product&&<button className="danger-btn" onClick={remove}><Trash2/> Eliminar</button>}<button className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy} onClick={save}><Save/> {busy?'Guardando...':'Guardar producto'}</button></div></div></div>
}
