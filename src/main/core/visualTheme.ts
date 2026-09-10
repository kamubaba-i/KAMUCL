import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { getSettings, saveSettings } from './settings'
import { ensureGlobalImage, importGlobalImage } from './appearanceAssets'
import { sniffImageFormat } from './imageAssetPolicy'
import { cleanDesign } from '../../shared/visualDesign'
import { DEFAULT_CUSTOM_THEME, DEFAULT_BACKGROUND, DEFAULT_LAUNCH_THUMBNAIL, DEFAULT_HOME_LAYOUT, type Settings } from '../../shared/types'
const MAX=64*1024*1024
export function exportVisualTheme():string {
 const s=getSettings(),assets:Record<string,string>={}
 function image(file:string,purpose:'background'|'launch-thumbnail'){
  if(!file)return '';const managed=ensureGlobalImage(file,purpose);if(!managed)return ''
  const bytes=fs.readFileSync(managed);const id='image-'+crypto.createHash('sha256').update(bytes).digest('hex')
  assets[id]=bytes.toString('base64');return id
 }
 const background={...s.background},launchThumbnail={...s.launchThumbnail}
 background.image=image(background.image,'background');if(background.images)background.images=background.images.map(p=>image(p,'background'))
 launchThumbnail.image=image(launchThumbnail.image,'launch-thumbnail');launchThumbnail.images=(launchThumbnail.images || []).map(p=>image(p,'launch-thumbnail'))
 if(launchThumbnail.durations)launchThumbnail.durations=Object.fromEntries(Object.entries(launchThumbnail.durations).map(([p,d])=>[image(p,'launch-thumbnail'),d]))
 const payload=JSON.stringify({format:2,theme:s.theme,custom:s.custom,homeLayout:s.homeLayout,background,launchThumbnail,visualDesign:cleanDesign(s.visualDesign),assets})
 if(Buffer.byteLength(payload)>MAX)throw new Error('主题图片过大，请减少图片后导出（上限64MiB）')
 return 'KAMUCL2.'+gzipSync(payload).toString('base64')
}
export async function importVisualTheme(code:string):Promise<Settings>{
 if(typeof code!=='string'||code.length>MAX*2)throw new Error('主题码无效或过大')
 const value=code.trim();let p:any
 if(value.startsWith('KAMUCL2.'))p=JSON.parse(gunzipSync(Buffer.from(value.slice(8),'base64'),{maxOutputLength:MAX}).toString('utf8'))
 else if(value.startsWith('KAMUCL.'))p={format:2,theme:'custom',custom:{colors:JSON.parse(Buffer.from(value.slice(7),'base64').toString('utf8')).colors}}
 else throw new Error('请粘贴完整的 KAMUCL 主题码')
 if(p.format!==2||!['custom','blue-white','black-orange','white-pink','black-pink','transparent'].includes(p.theme))throw new Error('不支持的主题格式')
 const colors={...DEFAULT_CUSTOM_THEME.colors};for(const key of Object.keys(colors) as (keyof typeof colors)[])if(/^#[a-f0-9]{6}$/i.test(p.custom?.colors?.[key]))colors[key]=p.custom.colors[key]
 const current=getSettings(),temp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'kamucl-theme-'))
 const imported=new Map<string,string>()
 try{
  async function image(id:unknown,purpose:'background'|'launch-thumbnail'){
   if(!id)return '';if(typeof id!=='string'||!/^image-[a-f0-9]{64}$/.test(id)||typeof p.assets?.[id]!=='string')throw new Error('主题图片资源缺失')
   const key=purpose+id;if(imported.has(key))return imported.get(key)!
   const bytes=Buffer.from(p.assets[id],'base64');if(bytes.length>16*1024*1024||'image-'+crypto.createHash('sha256').update(bytes).digest('hex')!==id)throw new Error('主题图片校验失败')
   const format=sniffImageFormat(bytes);if(!format)throw new Error('主题图片格式无效');const source=path.join(temp,id+'.'+format);await fs.promises.writeFile(source,bytes);const result=await importGlobalImage(source,purpose);imported.set(key,result.path);return result.path
  }
  const patch:Partial<Settings>={theme:p.theme,custom:{colors,layout:{...DEFAULT_CUSTOM_THEME.layout,...p.custom?.layout}},visualDesign:cleanDesign(p.visualDesign)}
  if(p.homeLayout){const layout=structuredClone(DEFAULT_HOME_LAYOUT);for(const group of ['main','side'] as const){const valid=new Set(layout[group].map(x=>x.key));const seen=new Set();if(Array.isArray(p.homeLayout[group])){const rows=p.homeLayout[group].filter((x:any)=>valid.has(x?.key)&&!seen.has(x.key)&&(seen.add(x.key),true)).map((x:any)=>({key:x.key,visible:x.visible!==false}));layout[group]=[...rows,...layout[group].filter(x=>!seen.has(x.key))]}}patch.homeLayout=layout}
  if(p.background){const b={...current.background,...p.background};b.image=await image(b.image,'background');b.images=await Promise.all((Array.isArray(b.images)?b.images:[]).slice(0,12).map((id:string)=>image(id,'background')));patch.background=b}
  if(p.launchThumbnail){const b={...current.launchThumbnail,...p.launchThumbnail};b.image=await image(b.image,'launch-thumbnail');b.images=await Promise.all((Array.isArray(b.images)?b.images:[]).slice(0,12).map((id:string)=>image(id,'launch-thumbnail')));if(b.durations)b.durations=Object.fromEntries(await Promise.all(Object.entries(b.durations).slice(0,12).map(async([id,d])=>[await image(id,'launch-thumbnail'),d])));patch.launchThumbnail=b}
  return saveSettings(patch)
 }finally{await fs.promises.rm(temp,{recursive:true,force:true})}
}

export function resetVisualTheme():Settings{return saveSettings({theme:'transparent',custom:structuredClone(DEFAULT_CUSTOM_THEME),background:structuredClone(DEFAULT_BACKGROUND),launchThumbnail:structuredClone(DEFAULT_LAUNCH_THUMBNAIL),homeLayout:structuredClone(DEFAULT_HOME_LAYOUT),visualDesign:cleanDesign(null)})}
