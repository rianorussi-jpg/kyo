import React, {useEffect,useState} from 'react'
import { AdminPanel, AdminGate } from './AdminPanel.jsx'
import { supabase, supabaseConfigured } from './supabase'
import { fallbackProducts, fallbackCategories, branches as fallbackBranches } from './data'

const defaultDeliveryRiders={
  zakia:[{name:'Pau',phone:'525623449135'},{name:'Rodri',phone:'525542641224'}],
  milenio:[{name:'Pau',phone:'525623449135'},{name:'Rodri',phone:'525542641224'}]
}

const defaultBusinessHours={
  mon:{closed:true,open:'13:00',close:'21:00'},tue:{closed:false,open:'13:00',close:'21:00'},
  wed:{closed:false,open:'13:00',close:'21:00'},thu:{closed:false,open:'13:00',close:'22:00'},
  fri:{closed:false,open:'13:00',close:'22:00'},sat:{closed:false,open:'13:00',close:'22:00'},
  sun:{closed:false,open:'13:00',close:'22:00'}
}

function useAuth(){
  const [session,setSession]=useState(null)
  const [profile,setProfile]=useState(null)
  const [loading,setLoading]=useState(supabaseConfigured)
  const loadProfile=async user=>{
    if(!supabase||!user){setProfile(null);return}
    const {data}=await supabase.from('profiles').select('*').eq('id',user.id).maybeSingle()
    setProfile(data||null)
  }
  useEffect(()=>{
    if(!supabase){setLoading(false);return}
    supabase.auth.getSession().then(async({data})=>{setSession(data.session);await loadProfile(data.session?.user);setLoading(false)})
    const {data:{subscription}}=supabase.auth.onAuthStateChange(async(_event,next)=>{setSession(next);await loadProfile(next?.user);setLoading(false)})
    return()=>subscription.unsubscribe()
  },[])
  return {session,user:session?.user||null,profile,loading,refreshProfile:()=>loadProfile(session?.user)}
}

function useCatalog(){
  const [products,setProducts]=useState(fallbackProducts.map((p,i)=>({...p,id:p.slug,sort_order:(i+1)*10,available:true})))
  const [categories,setCategories]=useState(fallbackCategories.filter(c=>c!=='Favoritos'))
  const [categoryObjects,setCategoryObjects]=useState([])
  const [branches,setBranches]=useState(fallbackBranches)
  const [settings,setSettings]=useState({minimum_order:200,points_reward_cost:250,points_reward_product_id:null,business_hours:null,delivery_riders:defaultDeliveryRiders})
  const refresh=async()=>{
    if(!supabase)return
    const [{data:p,error:pe},{data:c},{data:b},{data:s}]=await Promise.all([
      supabase.from('products').select('*, category:categories!products_category_id_fkey(id,name,slug), subcategory:categories!products_subcategory_id_fkey(id,name,slug,parent_id,sort_order), product_branch_availability(branch_id,available), product_customizations(sort_order, customization_templates(id,name,input_type,required,min_select,max_select,options, customization_option_branch_availability(option_id,branch_id,available)))').order('sort_order'),
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('branches').select('*').eq('active',true),
      supabase.from('app_settings').select('*').eq('id','main').maybeSingle()
    ])
    if(!pe&&p?.length)setProducts(p.map(x=>({...x,price:Number(x.price),category:x.category?.name||'Otros',categorySlug:x.category?.slug||'',subcategory:x.subcategory?.name||null,subcategorySlug:x.subcategory?.slug||null,desc:x.description,image:x.image_url||'/assets/kyo-logo.jpg',branchAvailability:Object.fromEntries((x.product_branch_availability||[]).map(r=>[r.branch_id,r.available])),customizations:(x.product_customizations||[]).sort((a,b)=>a.sort_order-b.sort_order).map(pc=>{const t=pc.customization_templates;if(!t)return null;const rows=t.customization_option_branch_availability||[];return {...t,sort_order:pc.sort_order,options:(t.options||[]).map(o=>({...o,branchAvailability:Object.fromEntries(rows.filter(r=>r.option_id===o.id).map(r=>[r.branch_id,r.available]))}))}}).filter(Boolean)})))
    if(c?.length){setCategoryObjects(c);setCategories(c.filter(x=>!x.parent_id&&x.active!==false).map(x=>x.name))}
    if(b?.length)setBranches(b.map(x=>({id:x.id,name:x.name,short:x.short_name,address:x.address,phone:x.phone,eta:x.eta})))
    if(s)setSettings({minimum_order:Number(s.minimum_order||200),points_reward_cost:Number(s.points_reward_cost||250),points_reward_product_id:s.points_reward_product_id||null,business_hours:s.business_hours||defaultBusinessHours,delivery_riders:s.delivery_riders||defaultDeliveryRiders})
  }
  useEffect(()=>{refresh()},[])
  return {products,categories,categoryObjects,branches,settings,refresh,setProducts}
}

export default function App(){
  const auth=useAuth()
  const catalog=useCatalog()
  return <AdminGate auth={auth}><AdminPanel auth={auth} catalog={catalog}/></AdminGate>
}
