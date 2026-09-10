import { computed, ref, shallowRef, watch } from 'vue'
import { store, toast } from './store'
import { updateSettings } from './settingsUpdates'
import { emptyDesign, cleanDesign, type ComponentDesign, type VisualDesign } from '@shared/visualDesign'
export interface DesignTarget { key:string; scope:string; label:string; tag:string; depth:number; element:HTMLElement }
export const designTargets=shallowRef<DesignTarget[]>([])
export const designSelection=ref('')
export const designScope=ref('home')
export const designHistory=ref<VisualDesign[]>([]),designFuture=ref<VisualDesign[]>([])
export const designSelected=computed(()=>designTargets.value.find(t=>t.scope+'|'+t.key===designSelection.value))
export const selectedDesign=computed(()=>{const t=designSelected.value;return t?store.settings?.visualDesign?.pages[t.scope]?.components[t.key]||{}:{}})
let refresh=()=>{},saveTimer:ReturnType<typeof setTimeout>|undefined
const copy=()=>JSON.parse(JSON.stringify(store.settings?.visualDesign||emptyDesign())) as VisualDesign
export function checkpoint(){designHistory.value.push(copy());if(designHistory.value.length>50)designHistory.value.shift();designFuture.value=[]}
export async function flushDesign(){clearTimeout(saveTimer);saveTimer=undefined;if(store.settings)await updateSettings({visualDesign:copy()})}
function persist(design:VisualDesign){if(!store.settings)return;store.settings.visualDesign=design;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void updateSettings({visualDesign:copy()}).catch(()=>toast('布局保存失败，请重试','error'))},180);refresh()}
export function changeComponent(patch:Partial<ComponentDesign>,record=true){const t=designSelected.value;if(!t)return;if(record)checkpoint();const d=copy();const page=d.pages[t.scope]??={width:window.innerWidth,height:window.innerHeight,components:{}};page.components[t.key]={...page.components[t.key],...patch};persist(cleanDesign(d))}
export function resetComponent(){const t=designSelected.value;if(!t)return;checkpoint();const d=copy();if(d.pages[t.scope])delete d.pages[t.scope].components[t.key];persist(d)}
export function resetPage(all=false){checkpoint();const d=copy();if(all)d.pages={};else delete d.pages[designScope.value];persist(d)}
export function undoDesign(redo=false){const from=redo?designFuture:designHistory,to=redo?designHistory:designFuture;const d=from.value.pop();if(!d)return;to.value.push(copy());persist(d)}
export function installVisualDesign(){
 let frame=0
 const originals=new Map<HTMLElement,{styles:Map<string,string>;text:Map<Text,string>}>()
 const original=(el:HTMLElement)=>{let o=originals.get(el);if(!o){o={styles:new Map(),text:new Map()};originals.set(el,o)}return o}
 function set(el:HTMLElement,key:string,value:string){const o=original(el);if(!o.styles.has(key))o.styles.set(key,el.style.getPropertyValue(key));if(el.style.getPropertyValue(key)!==value)el.style.setProperty(key,value,'important')}
 function restore(){for(const [el,o]of originals){for(const[k,v]of o.styles){if(v)el.style.setProperty(k,v);else el.style.removeProperty(k)}for(const[n,v]of o.text)if(n.isConnected&&n.nodeValue!==v)n.nodeValue=v}originals.clear()}
 const update=()=>{
  frame=0
  const suffix=Array.from(document.querySelectorAll<HTMLElement>('.content [data-design-page]')).filter(e=>e.getClientRects().length).map(e=>e.dataset.designPage).join('/')
  designScope.value=store.currentView+(suffix?'/'+suffix:'')
  const d=store.settings?.visualDesign||emptyDesign()
  if(!store.editMode&&!Object.keys(d.pages).length){restore();designTargets.value=[];return}
  // Restore only when an override is removed; keep original values independent of our previous write.
  for(const[el,o]of originals)if(!el.isConnected)originals.delete(el)
  const targets:DesignTarget[]=[],counts=new Map<string,number>(),seen=new Set<HTMLElement>()
  for(const el of document.querySelectorAll<HTMLElement>('[data-ui]')){
   if(el.closest('[data-design-tools]')||el.closest('.edit-tip')||el.classList.contains('app-bg'))continue
   const content=el.closest('.content')
   const scope=el.closest('.sidebar, .topbar') || el.classList.contains('shell') ? 'global' : designScope.value
   const ancestors:string[]=[];let parent:HTMLElement|null=el
   while(parent){if(parent.dataset.ui)ancestors.unshift(parent.dataset.ui);parent=parent.parentElement}
   let key=ancestors.join('/');const duplicate=counts.get(key)||0;counts.set(key,duplicate+1);key+='~'+duplicate
   const label=(el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent||el.tagName).trim().replace(/\s+/g,' ').slice(0,50)
   targets.push({key,scope,label,tag:el.tagName.toLowerCase(),depth:ancestors.length,element:el})
   const style=d.pages[scope]?.components[key]
   const o=originals.get(el)
   if(!style){if(o){for(const[k,v]of o.styles){if(v)el.style.setProperty(k,v);else el.style.removeProperty(k)}for(const[n,v]of o.text)if(n.isConnected)n.nodeValue=v;originals.delete(el)}continue}
   seen.add(el)
   // Pixel geometry is retained at the original window size; CSS layout continues adapting around it.
   const properties:Record<string,string>={}
   if(style.x!==undefined||style.y!==undefined)properties.translate=`${style.x||0}px ${style.y||0}px`
   if(style.width!==undefined){properties.width=style.width+'px';properties['max-width']='none';properties['flex-shrink']='0'}
   if(style.height!==undefined){properties.height=style.height+'px';properties['max-height']='none'}
   if(style.color)properties.color=style.color
   if(style.background)properties.background=style.background
   if(style.opacity!==undefined)properties.opacity=String(style.opacity)
   if(style.radius!==undefined)properties['border-radius']=style.radius+'px'
   if(style.blur!==undefined)properties['backdrop-filter']=`blur(${style.blur}px)`
   if(style.fontSize!==undefined)properties['font-size']=style.fontSize+'px'
   if(style.fontFamily)properties['font-family']=style.fontFamily
   if(style.fontWeight!==undefined)properties['font-weight']=String(style.fontWeight)
   if(style.hidden){if(store.editMode){properties.opacity='0.25';properties.outline='1px dashed #ff9e52'}else properties.display='none'}
   if(style.order!==undefined){properties.order=String(style.order);const p=el.parentElement;if(p&&!['flex','inline-flex','grid','inline-grid'].includes(getComputedStyle(p).display)){set(p,'display','flex');set(p,'flex-direction','column');seen.add(p)}}
   if(o)for(const[k,v]of o.styles)if(!(k in properties)){if(v)el.style.setProperty(k,v);else el.style.removeProperty(k);o.styles.delete(k)}
   for(const[k,v]of Object.entries(properties))set(el,k,v)
   const texts=Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim()) as Text[]
   if(style.text!==undefined&&texts.length){const base=original(el);texts.forEach((n,i)=>{if(!base.text.has(n))base.text.set(n,n.nodeValue||'');const value=i===0?style.text!:'';if(n.nodeValue!==value)n.nodeValue=value})}
   else if(o?.text.size){for(const[n,v]of o.text)if(n.isConnected)n.nodeValue=v;o.text.clear()}
  }
  designTargets.value=targets
 }
 refresh=()=>{if(!frame)frame=requestAnimationFrame(update)}
 const observer=new MutationObserver(records=>{if(records.every(r=>(r.target instanceof Element?r.target:r.target.parentElement)?.closest('[data-design-tools]')))return;refresh()})
 observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-design-page']})
 const stop=watch(()=>[store.currentView,store.editMode,store.settings?.visualDesign],refresh,{deep:true})
 window.addEventListener('resize',refresh);refresh()
 return()=>{stop();observer.disconnect();cancelAnimationFrame(frame);restore();window.removeEventListener('resize',refresh)}
}
