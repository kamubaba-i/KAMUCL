<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { store, exitEditMode, toast, type ViewName } from '../store'
import { flushDesign, designTargets, designSelected, designSelection, selectedDesign, designScope, changeComponent, checkpoint, resetComponent, resetPage, undoDesign, designHistory, designFuture } from '../visualDesign'
import { snapped, type ComponentDesign } from '@shared/visualDesign'
import { copyText } from '../api'
const browse=ref(false),collapsed=ref(false),snap=ref(true),filter=ref(''),guideX=ref<number>(),guideY=ref<number>()
const box=ref({x:0,y:0,width:0,height:0})
const pages: {value:ViewName;label:string}[]=[{value:'home',label:'首页'},{value:'game',label:'游戏版本'},{value:'mods',label:'模组'},{value:'packs',label:'材质包'},{value:'shaders',label:'光影包'},{value:'keys',label:'默认配置'},{value:'skins',label:'皮肤'},{value:'community',label:'社区资源'},{value:'servers',label:'服务器'},{value:'friends',label:'联机'},{value:'settings',label:'设置'},{value:'accounts',label:'账户'},{value:'bridge',label:'MOD 面板'}]
const layers=computed(()=>designTargets.value.filter(t=>t.label.toLowerCase().includes(filter.value.toLowerCase())))
const fields: {key:keyof ComponentDesign;label:string;min:number;max:number;step?:number}[]=[{key:'x',label:'横向位移',min:-10000,max:10000},{key:'y',label:'纵向位移',min:-10000,max:10000},{key:'width',label:'宽度',min:8,max:10000},{key:'height',label:'高度',min:8,max:10000},{key:'opacity',label:'透明度',min:0,max:1,step:.05},{key:'radius',label:'圆角',min:0,max:300},{key:'blur',label:'毛玻璃',min:0,max:80},{key:'fontSize',label:'字号',min:6,max:200},{key:'fontWeight',label:'字重',min:100,max:900,step:100},{key:'order',label:'排列顺序',min:-10000,max:10000}]
function numeric(key:keyof ComponentDesign,event:Event){const value=(event.target as HTMLInputElement).value;changeComponent({[key]:value===''?undefined:Number(value)})}
function reset(whole=false){if(confirm(whole?'恢复所有页面的组件布局与样式？':'恢复当前页面的组件布局与样式？'))resetPage(whole)}
async function done(){try{await flushDesign();exitEditMode()}catch{toast('保存失败，请重试','error')}}
function align(axis:'x'|'y',edge:number){const el=designSelected.value?.element,p=el?.parentElement;if(!el||!p)return;const r=el.getBoundingClientRect(),b=p.getBoundingClientRect();changeComponent(axis==='x'?{x:(selectedDesign.value.x||0)+b.left+(b.width-r.width)*edge-r.left}:{y:(selectedDesign.value.y||0)+b.top+(b.height-r.height)*edge-r.top})}
let raf=0
function measure(){const r=designSelected.value?.element.getBoundingClientRect();if(r)box.value={x:r.x,y:r.y,width:r.width,height:r.height};raf=requestAnimationFrame(measure)}
function tools(event:Event){return(event.target as Element)?.closest?.('[data-design-tools]')}
let drag:null|{x:number;y:number;ox:number;oy:number;width:number;height:number;resize:boolean;left:number;top:number;changed:boolean}=null
function down(event:PointerEvent,resize=false){
 if(browse.value||event.button!==0||(!resize&&tools(event)))return
 if(!resize){const hit=(event.target as Element).closest<HTMLElement>('[data-ui]');const target=designTargets.value.find(t=>t.element===hit);if(!target)return;designSelection.value=target.scope+'|'+target.key}
 const target=designSelected.value;if(!target)return
 event.preventDefault();event.stopImmediatePropagation()
 const r=target.element.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,ox:selectedDesign.value.x||0,oy:selectedDesign.value.y||0,width:r.width,height:r.height,resize,left:r.left,top:r.top,changed:false}
}
function move(event:PointerEvent){if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!drag.changed&&Math.abs(dx)+Math.abs(dy)<3)return;if(!drag.changed){checkpoint();drag.changed=true}
 const others=designTargets.value.filter(t=>t.element!==designSelected.value?.element&&!designSelected.value?.element.contains(t.element)).map(t=>t.element.getBoundingClientRect()).filter(r=>r.width&&r.height)
 const xs=[0,window.innerWidth/2,window.innerWidth,...others.flatMap(r=>[r.left,r.right,r.left+r.width/2])],ys=[0,window.innerHeight/2,window.innerHeight,...others.flatMap(r=>[r.top,r.bottom,r.top+r.height/2])]
 if(drag.resize){const x=snapped(drag.left+drag.width+dx,xs,snap.value&&!event.altKey),y=snapped(drag.top+drag.height+dy,ys,snap.value&&!event.altKey);guideX.value=x.guide;guideY.value=y.guide;changeComponent({width:Math.max(8,x.value-drag.left),height:Math.max(8,y.value-drag.top)},false)}
 else{const x=snapped(drag.left+dx,xs,snap.value&&!event.altKey),y=snapped(drag.top+dy,ys,snap.value&&!event.altKey);guideX.value=x.guide;guideY.value=y.guide;changeComponent({x:drag.ox+x.value-drag.left,y:drag.oy+y.value-drag.top},false)}
}
function up(){drag=null;guideX.value=undefined;guideY.value=undefined}
function click(event:MouseEvent){if(!browse.value&&!tools(event)){event.preventDefault();event.stopImmediatePropagation()}}
function keys(event:KeyboardEvent){if(tools(event))return;if(event.key==='Escape'){exitEditMode();return}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undoDesign(event.shiftKey)}if(designSelected.value&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const step=event.shiftKey?10:1;changeComponent({x:(selectedDesign.value.x||0)+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:(selectedDesign.value.y||0)+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)})}}
async function exportTheme(){try{await flushDesign();const code=await window.kamucl.invoke('appearance:exportTheme');await copyText(String(code));toast('完整主题码已复制，包含图片与所有页面布局','success')}catch{toast('主题导出失败','error')}}
const code=ref(''),sharing=ref(false)
async function restoreDefault(){if(confirm('恢复启动器默认外观？游戏、账户和下载设置不会改变。')){try{await flushDesign();store.settings=await window.kamucl.invoke('appearance:resetTheme') as any}catch{toast('恢复失败','error')}}}
async function importTheme(){try{await flushDesign();const result=await window.kamucl.invoke('appearance:importTheme',code.value);store.settings=result as any;code.value='';sharing.value=false;toast('主题已导入','success')}catch(e){toast(String(e),'error')}}
onMounted(()=>{raf=requestAnimationFrame(measure);document.addEventListener('pointerdown',down,true);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('click',click,true);document.addEventListener('keydown',keys,true)})
onUnmounted(()=>{cancelAnimationFrame(raf);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',keys,true)})
</script>
<template>
<Teleport to="body">
 <div class="designer-toolbar" data-design-tools>
  <strong>外观工作台</strong><select v-model="store.currentView" aria-label="编辑页面"><option v-for="p in pages" :value="p.value">{{p.label}}</option></select>
  <button :class="{on:!browse}" @click="browse=!browse">{{browse?'浏览页面':'选取与拖拽'}}</button><label><input v-model="snap" type="checkbox">吸附</label>
  <button @click="undoDesign()" :disabled="!designHistory.length">撤销</button><button @click="undoDesign(true)" :disabled="!designFuture.length">重做</button>
  <button @click="collapsed=!collapsed">{{collapsed?'显示面板':'收起面板'}}</button><button class="done" @click="done">完成</button>
 </div>
 <div v-if="designSelected&&!browse" class="designer-outline" data-design-tools :style="{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'}"><span>{{Math.round(box.width)}} × {{Math.round(box.height)}}</span><button aria-label="拖拽调整尺寸" @pointerdown.stop="down($event,true)" /></div>
 <div v-if="guideX!==undefined" class="designer-guide vertical" :style="{left:guideX+'px'}" data-design-tools></div><div v-if="guideY!==undefined" class="designer-guide horizontal" :style="{top:guideY+'px'}" data-design-tools></div>
 <aside v-if="!collapsed" class="designer-panel" data-design-tools>
  <header><strong>{{designSelected?.label||'点选想修改的组件'}}</strong><small>{{designSelected?.tag||'卡片、按钮、文字均可独立编辑'}} · {{designSelected?.scope||designScope}}</small></header>
  <template v-if="designSelected">
   <div class="designer-actions"><button @click="resetComponent">单项重置</button><label><input type="checkbox" :checked="selectedDesign.hidden" @change="changeComponent({hidden:($event.target as HTMLInputElement).checked})">隐藏组件</label></div>
   <details open><summary>位置与外观</summary><div class="designer-actions"><button @click="align('x',0)">左对齐</button><button @click="align('x',.5)">水平居中</button><button @click="align('x',1)">右对齐</button><button @click="align('y',0)">顶部对齐</button><button @click="align('y',.5)">垂直居中</button><button @click="align('y',1)">底部对齐</button></div><div class="designer-grid"><label v-for="field in fields" :key="field.key">{{field.label}}<input type="number" :aria-label="field.label" :min="field.min" :max="field.max" :step="field.step||1" :value="selectedDesign[field.key]" placeholder="默认" @change="numeric(field.key,$event)"></label></div>
    <label class="designer-color">文字颜色<input type="color" :value="selectedDesign.color||'#ffffff'" @input="changeComponent({color:($event.target as HTMLInputElement).value})"><input aria-label="文字颜色值" placeholder="#ffffff / rgba" :value="selectedDesign.color" @change="changeComponent({color:($event.target as HTMLInputElement).value})"></label>
    <label class="designer-color">背景颜色<input type="color" :value="selectedDesign.background||'#ffffff'" @input="changeComponent({background:($event.target as HTMLInputElement).value})"><input aria-label="背景颜色值" placeholder="transparent / rgba" :value="selectedDesign.background" @change="changeComponent({background:($event.target as HTMLInputElement).value})"></label>
   </details>
   <details><summary>文字与字体</summary><label>外显文字<textarea aria-label="外显文字" :value="selectedDesign.text" placeholder="选择文字层后输入；留空可隐藏文案" @change="changeComponent({text:($event.target as HTMLTextAreaElement).value})" /></label><label>字体<input aria-label="字体" list="design-fonts" :value="selectedDesign.fontFamily" placeholder="跟随主题" @change="changeComponent({fontFamily:($event.target as HTMLInputElement).value})"><datalist id="design-fonts"><option>Microsoft YaHei</option><option>Segoe UI</option><option>SimHei</option><option>Arial</option><option>sans-serif</option></datalist></label><small>先点文字可直接修改；复杂卡片请在图层中选择其文字组件。</small></details>
  </template>
  <details :open="!designSelected"><summary>页面图层 · 找回隐藏组件</summary><input v-model="filter" placeholder="搜索卡片、按钮、文字"><div class="designer-layers"><button v-for="t in layers" :key="t.scope+t.key" :class="{on:designSelection===t.scope+'|'+t.key}" @click="designSelection=t.scope+'|'+t.key"><small>{{t.tag}}</small> {{t.label}}</button></div></details>
  <details><summary>主题与恢复</summary><div class="designer-actions"><button @click="exportTheme">复制完整主题码</button><button @click="sharing=!sharing">导入主题码</button></div><textarea v-if="sharing" v-model="code" aria-label="主题码" placeholder="粘贴主题码"/><button v-if="sharing" @click="importTheme">应用主题</button><div class="designer-actions"><button @click="reset()">重置当前页面</button><button @click="reset(true)">重置所有组件</button><button @click="restoreDefault">恢复默认外观</button></div></details>
  <footer>修改自动保存 · Alt 暂停吸附 · 方向键微调<br>Ctrl+Shift+E 随时重新打开工作台</footer>
 </aside>
</Teleport>
</template>
<style scoped>
.designer-toolbar,.designer-panel{position:fixed;z-index:100100;background:#19232df5;color:#edf4ff;border:1px solid #70859e66;box-shadow:0 12px 40px #0006;font:13px/1.5 'Segoe UI','Microsoft YaHei',sans-serif;backdrop-filter:blur(18px)}
.designer-toolbar{top:10px;left:50%;transform:translateX(-50%);border-radius:14px;padding:10px;display:flex;gap:8px;align-items:center;max-width:calc(100vw - 20px);flex-wrap:wrap}.designer-toolbar strong{white-space:nowrap}.designer-panel{right:12px;top:78px;bottom:12px;width:310px;border-radius:16px;padding:16px;overflow:auto}.designer-panel header{display:flex;flex-direction:column;margin-bottom:16px}.designer-panel header strong{max-height:48px;overflow:hidden}.designer-panel small,.designer-panel footer{color:#afbed1}.designer-panel footer{font-size:11px;margin-top:18px}.designer-panel details{border-top:1px solid #62768c55;padding:12px 0}.designer-panel summary{cursor:pointer;font-weight:600;margin-bottom:10px}.designer-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.designer-panel label{display:flex;flex-direction:column;gap:4px;margin:5px 0}.designer-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.designer-actions label{flex-direction:row}.designer-toolbar button,.designer-panel button,.designer-toolbar select,.designer-panel input,.designer-panel textarea{background:#263646;color:inherit;border:1px solid #70859e66;border-radius:7px;padding:6px 8px;font:inherit;min-width:0;max-width:100%;box-sizing:border-box}.designer-panel input:not([type=checkbox]):not([type=color]),.designer-panel textarea{width:100%}.designer-toolbar button,.designer-panel button{cursor:pointer}.designer-toolbar button.on,.designer-panel button.on,.designer-toolbar button.done{background:#3a70d7}.designer-toolbar button:disabled{opacity:.4}.designer-panel textarea{min-height:70px;resize:vertical}.designer-color{display:flex!important;flex-direction:row!important;align-items:center}.designer-color input[type=color]{width:34px;padding:1px;flex-shrink:0}.designer-color input:last-child{width:110px!important}.designer-layers{max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:4px}.designer-layers button{text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.designer-outline{position:fixed;z-index:100090;pointer-events:none;border:2px solid #61a0ff;box-sizing:border-box}.designer-outline span{position:absolute;top:-24px;left:0;background:#2865cb;color:white;font:11px/20px sans-serif;white-space:nowrap;padding:0 5px}.designer-outline button{pointer-events:auto;position:absolute;bottom:-6px;right:-6px;width:12px;height:12px;background:white;border:2px solid #2865cb;cursor:nwse-resize}.designer-guide{position:fixed;z-index:100095;pointer-events:none;background:#fb66ad}.designer-guide.vertical{width:1px;top:0;bottom:0}.designer-guide.horizontal{height:1px;left:0;right:0}
</style>
