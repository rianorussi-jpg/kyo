import React,{useEffect,useState} from 'react'
import {KitchenGate,KitchenMode} from './KitchenMode.jsx'
import {supabase,supabaseConfigured} from './supabase'

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
  return {session,user:session?.user||null,profile,loading}
}

export default function App(){
  const auth=useAuth()
  return <KitchenGate auth={auth}><KitchenMode auth={auth}/></KitchenGate>
}
