/* MSWQ HTML file management: self-contained HTML, package archives and resources. */
(function(){
'use strict';
const $=q=>document.querySelector(q);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const direct=id=>'https://mswq-html.mosen6266-ms007.workers.dev/html/'+encodeURIComponent(id)+'/';
let prepared=null;
const styles=[
'.mswq-pkg-panel{border:1px solid #555;border-radius:14px;padding:18px;margin-bottom:23px;background:rgba(130,130,130,.06)}',
'.mswq-pkg-panel h3{font-size:18px;margin:0 0 10px}',
'.mswq-pkg-panel .field{margin:12px 0}',
'.mswq-pkg-note{border:1px solid #515151;border-radius:10px;padding:12px;margin:14px 0;font-size:13px;line-height:1.75;overflow-wrap:anywhere}',
'.mswq-pkg-files{max-height:340px;overflow:auto;border:1px solid #555;border-radius:10px;padding:10px;line-height:1.8;font-size:13px;overflow-wrap:anywhere}',
'.mswq-pkg-files>div{padding:3px 5px;border-bottom:1px solid #444}',
'.mswq-pkg-warning{color:#e2a185}',
'.html-manager-head{display:flex;align-items:center;gap:12px;justify-content:space-between;margin-bottom:15px;flex-wrap:wrap}',
'.html-manager-head input{width:min(100%,380px);padding:11px 13px;border-radius:10px}',
'.html-manager-list{display:grid;gap:12px}',
'.html-manager-item.asset-card{display:flex;flex-direction:column;gap:12px;padding:15px 16px;width:100%;min-width:0;text-align:left}',
'.html-manager-item-main{display:flex;align-items:center;gap:13px;min-width:0}',
'.html-manager-icon{width:44px;height:44px;flex:0 0 44px;border:1px solid #7775;border-radius:12px;display:grid;place-items:center;font-size:22px}',
'.html-manager-text{min-width:0;overflow-wrap:anywhere}',
'.html-manager-text strong{display:block;font-size:15px;margin-bottom:5px}',
'.html-manager-tag{display:inline-block;font-size:11px;padding:3px 8px;border:1px solid #7775;border-radius:99px;margin-top:7px}',
'.html-manager-buttons{margin-top:2px;gap:7px}',
'.html-manager-buttons .btn{margin:0;white-space:nowrap}',
'.mswq-pkg-panel{margin-bottom:17px}',
'.mswq-pkg-files button{margin-left:10px}',
'.html-manager-item[hidden]{display:none!important}',
'.mswq-source-preview{display:block;width:100%;height:min(56vh,600px);resize:vertical;padding:12px;border:1px solid #7775;border-radius:10px;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre;overflow:auto}'

];const style=document.createElement('style');style.textContent=styles.join('\n');document.head.append(style);
function alertPkg(message){const n=$('#mswqPkgNotice');if(n){n.textContent=message;n.classList.add('mswq-pkg-warning')}else alert(message)}
function modal(body){
 $('#mswqPkgDialog')?.remove();
 const panel=document.createElement('div');panel.id='mswqPkgDialog';panel.className='modal-backdrop';
 panel.innerHTML='<div class="modal" role="dialog" aria-modal="true" style="max-width:770px">'+body+'</div>';
 document.body.append(panel);
}
function htmlCards(){
 return [...document.querySelectorAll('.html-manager-item')].map(c=>({card:c,button:c.querySelector('[data-action="new-html-card"][data-id]')})).filter(x=>x.button);
}
function mount(){
 const host=$('#mswqHtmlPkgMount'),input=$('#assetUpload');
 if(!host||!input||host.querySelector('#mswqPkgPanel'))return;
 prepared=null;
 const html='<h3>▣ 上传完整 HTML 工具包</h3>'+
 '<p class="muted small">支持 ZIP 或文件夹，HTML、图标、图片、CSS、JavaScript 和字体都会按原目录结构保存。单独 HTML 请使用下方的独立文件上传。</p>'+
 '<div class="cols"><div class="field"><label>ZIP 压缩文件</label><input id="mswqPkgZip" type="file" accept=".zip,application/zip"></div>'+
 '<div class="field"><label>或者选择整个文件夹</label><input id="mswqPkgFolder" type="file" webkitdirectory directory multiple></div></div>'+
 '<div class="field"><label>工具名称</label><input id="mswqPkgName" maxlength="200" placeholder="例如：资金路径调查工具"></div>'+
 '<div class="field"><label>新增或覆盖已上传的 HTML 工具</label><select id="mswqPkgReplace"><option value="">新增 HTML 工具（新直达链接）</option>'+
 htmlCards().map(x=>'<option value="'+esc(x.button.dataset.id)+'">覆盖：'+esc(x.card.querySelector('strong')?.textContent||'HTML')+'（保留原链接）</option>').join('')+'</select></div>'+
 '<div class="field"><label>启动 HTML 页面</label><select id="mswqPkgEntry"><option value="">请先检查文件</option></select></div>'+
 '<div id="mswqPkgNotice" class="mswq-pkg-note">选择 ZIP 或完整文件夹，再检查内部资源及入口 HTML。</div>'+
 '<div class="flex" style="gap:10px;flex-wrap:wrap"><button class="btn" data-pkg="inspect">① 检查文件</button>'+
 '<button class="btn green" id="mswqPkgSubmit" data-pkg="upload">② 上传并保存工具</button></div>';
 const node=document.createElement('section');
 node.id='mswqPkgPanel';node.className='mswq-pkg-panel';node.innerHTML=html;host.append(node);
}
async function inspect(){
 const zip=$('#mswqPkgZip')?.files?.[0],folder=$('#mswqPkgFolder')?.files;
 if(!zip&&!folder?.length)throw Error('请选择 ZIP 压缩文件或完整文件夹');
 const area=$('#mswqPkgNotice');area.textContent='正在检查文件结构和完整性…';
 try{
  const files=zip?await window.MSWQPackage.fromZip(zip):await window.MSWQPackage.fromFolder([...folder]);
  const entries=window.MSWQPackage.entryOptions(files),entry=entries[0],warnings=window.MSWQPackage.warnings(files,entry);
  prepared={files,archive:zip||null};
  $('#mswqPkgEntry').innerHTML=entries.map(p=>'<option value="'+esc(p)+'">'+esc(p)+'</option>').join('');
  if(!$('#mswqPkgName').value.trim())$('#mswqPkgName').value=zip?zip.name.replace(/\.zip$/i,''):folder[0].webkitRelativePath.split('/')[0];
  const total=files.reduce((s,f)=>s+f.size,0);
  area.innerHTML='<strong>已识别 '+files.length+' 个文件，共 '+(total/1048576).toFixed(2)+' MB</strong>'+
   '<p>启动页面：'+esc(entry)+'</p>'+
   (warnings.length?'<p class="mswq-pkg-warning">'+warnings.map(esc).join('；')+'</p>':'<p>资源路径检查通过。</p>')+
   '<details><summary>展开文件清单</summary><div class="mswq-pkg-files">'+files.map(f=>'<div>'+esc(f.path)+'</div>').join('')+'</div></details>';
 }catch(e){prepared=null;area.textContent='检查失败：'+e.message;throw e;}
}
async function call(path,options){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 const data=await res.json().catch(()=>null);
 if(!res.ok||!data||data.ok===false)throw Error(data?.error||'服务器错误：'+res.status);
 return data;
}
async function upload(){
 if(!prepared)throw Error('请先完成工具包检查');
 const name=$('#mswqPkgName')?.value.trim(),entry=$('#mswqPkgEntry')?.value,id=$('#mswqPkgReplace')?.value||'';
 if(!name)throw Error('请填写工具包名称');if(!entry)throw Error('请选择入口 HTML');
 const button=$('#mswqPkgSubmit');button.disabled=true;button.textContent='上传中…';
 try{
  const result=await window.MSWQPackage.upload(prepared.files,entry,name,id,prepared.archive,msg=>{const n=$('#mswqPkgNotice');if(n)n.textContent=msg;});
  prepared=null;
  $('[data-action="tab"][data-id="html-files"]')?.click();
  modal('<h2>HTML 工具包保存成功</h2><p><strong>'+esc(name)+'</strong> · '+result.count+' 个文件</p>'+
   '<p class="muted">'+(id?'已经更新原 HTML，前台所有原链接保持不变。':'已经存入 HTML 文件管理，添加前台卡片即可展示。')+'</p>'+
   '<div class="flex end" style="gap:8px;flex-wrap:wrap"><a class="btn" target="_blank" rel="noopener noreferrer" href="'+direct(result.id)+'">完整页面预览</a>'+
   '<button class="btn" data-pkg="details" data-id="'+result.id+'">查看文件</button>'+
   '<button class="btn green" data-pkg="add-card" data-id="'+result.id+'">添加前台卡片</button>'+
   '<button class="btn" data-pkg="close">完成</button></div>');
 }catch(e){button.disabled=false;button.textContent='② 上传并保存工具';throw e;}
}
function fileRow(id){
 return [...document.querySelectorAll('.html-manager-item')].find(x=>x.dataset.htmlId===id);
}
function filename(id){return fileRow(id)?.querySelector('strong')?.textContent||'网页工具.html'}
async function getPackage(id){
 try{return await call('/api/admin/html-packages/'+encodeURIComponent(id))}
 catch(e){
  if(/不是多文件|不是.*工具包/.test(e.message))return null;
  throw e;
 }
}
function startDownload(url,name){
 const a=document.createElement('a');a.href=url;a.download=name||'';document.body.append(a);a.click();a.remove();
}
function saveBlob(blob,name){
 const url=URL.createObjectURL(blob);
 startDownload(url,name);
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function getBytes(url){
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});
 if(!r.ok)throw Error('下载文件失败 ('+r.status+')');
 return new Uint8Array(await r.arrayBuffer());
}
function sourceUrl(id,p){
 if(!p)return '/api/asset/'+encodeURIComponent(id)+'?download=1';
 return '/api/admin/html-packages/'+encodeURIComponent(id)+'/file?path='+encodeURIComponent(p)+'&download=1';
}
async function source(id,path=''){
 const info=path?null:await getPackage(id);
 startDownload(sourceUrl(id,path||info?.entry||''),path||info?.entry||filename(id));
}
async function previewCode(id){
 const info=await getPackage(id),path=info?.entry||filename(id);
 const bytes=await getBytes(sourceUrl(id,info?.entry||''));
 const max=2000000;
 const shown=bytes.length>max?bytes.slice(0,max):bytes;
 const content=new TextDecoder('utf-8').decode(shown);
 modal('<h2>查看原始 HTML 源码</h2><p class="muted small">'+esc(path)+' · '+Math.ceil(bytes.length/1024)+' KB'+
 (bytes.length>max?' · 文件较大，仅显示前 2 MB，下载可获得完整内容':'')+'</p>'+
 '<textarea class="mswq-source-preview" readonly spellcheck="false">'+esc(content)+'</textarea>'+
 '<div class="flex end" style="margin-top:12px"><button class="btn green" data-pkg="source" data-id="'+esc(id)+'">下载完整 HTML</button><button class="btn" data-pkg="close">关闭</button></div>');
}
async function zipDownload(id,button){
 if(button){button.disabled=true;button.textContent='正在整理文件…';}
 try{
  const info=await getPackage(id);
  if(info?.hasArchive){startDownload('/api/admin/html-packages/'+encodeURIComponent(id)+'/download',info.name+'.zip');return}
  const entries=info?.files?.length?info.files:[{path:filename(id),size:0}];
  if(!window.MSWQPackage?.zipFiles)throw Error('ZIP 打包组件未加载，请刷新后重试');
  const all=[];
  for(let i=0;i<entries.length;i++){
   const f=entries[i];
   if(button)button.textContent='打包中 '+(i+1)+'/'+entries.length;
   const bytes=await getBytes(info?sourceUrl(id,f.path):sourceUrl(id,''));
   all.push({path:f.path,data:bytes,size:bytes.length});
  }
  const blob=window.MSWQPackage.zipFiles(all);
  saveBlob(blob,(info?.name||filename(id).replace(/\.html?$/i,''))+'.zip');
 }finally{if(button){button.disabled=false;button.textContent='打包下载 ZIP';}}
}
async function rename(id){
 const old=filename(id),name=prompt('请输入新的 HTML 工具名称',old);
 if(name===null||name.trim()===old)return;
 const next=name.trim();
 if(!next)throw Error('名称不能为空');
 await call('/api/admin/assets/'+encodeURIComponent(id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name:next})});
 const btn=$('[data-action="tab"][data-id="html-files"]');btn?.click();
}
async function details(id){
 const info=await getPackage(id);
 if(!info){
  modal('<h2>独立 HTML 源文件</h2><p><strong>'+esc(filename(id))+'</strong></p>'+
   '<p class="muted">此文件作为独立 HTML 上传，没有保存关联的图片或目录；ZIP 只包含该 HTML，不会混入其他素材。</p>'+
   '<div class="flex end" style="gap:8px;flex-wrap:wrap">'+
   '<a class="btn" target="_blank" rel="noopener noreferrer" href="'+direct(id)+'">预览 HTML</a>'+
   '<button class="btn" data-pkg="source" data-id="'+esc(id)+'">下载 HTML</button>'+
   '<button class="btn green" data-pkg="download" data-id="'+esc(id)+'">打包下载 ZIP</button>'+
   '<button class="btn" data-pkg="close">关闭</button></div>');return;
 }
 const files=info.files.map(f=>'<div class="flex" style="align-items:center;justify-content:space-between;gap:12px"><span>'+esc(f.path)+
  ' <span class="muted tiny">('+Math.ceil(f.size/1024)+' KB)</span></span>'+
  '<button class="btn sm" data-pkg="file-source" data-id="'+esc(id)+'" data-file="'+esc(f.path)+'">下载</button></div>').join('');
 modal('<h2>HTML 文件包详情</h2><p><strong>'+esc(info.name)+'</strong> · 入口：'+esc(info.entry)+'</p>'+
  '<div class="mswq-pkg-files">'+files+'</div><div class="flex end" style="margin-top:16px;flex-wrap:wrap">'+
  '<a class="btn" target="_blank" rel="noopener noreferrer" href="'+direct(id)+'">预览完整网页</a>'+
  '<button class="btn" data-pkg="source" data-id="'+esc(id)+'">下载入口 HTML</button>'+
  '<button class="btn green" data-pkg="download" data-id="'+esc(id)+'">打包下载 ZIP</button>'+
  '<button class="btn" data-pkg="copy" data-id="'+esc(id)+'">复制直达链接</button>'+
  '<button class="btn" data-pkg="close">关闭</button></div>');
}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('[data-pkg]');if(!b)return;
 ev.preventDefault();ev.stopPropagation();
 try{
  const action=b.dataset.pkg,id=b.dataset.id;
  if(action==='inspect')await inspect();
  if(action==='upload')await upload();
  if(action==='details')await details(id);
  if(action==='source')await source(id);
  if(action==='code')await previewCode(id);
  if(action==='file-source')await source(id,b.dataset.file);
  if(action==='download')await zipDownload(id,b);
  if(action==='rename')await rename(id);
  if(action==='close')$('#mswqPkgDialog')?.remove();
  if(action==='copy'){await navigator.clipboard.writeText(direct(id));b.textContent='链接已复制';}
  if(action==='add-card'){
   $('#mswqPkgDialog')?.remove();
   const btn=document.querySelector('.html-manager-item [data-action="new-html-card"][data-id="'+id+'"]');
   if(btn)btn.click();else{
    $('[data-action="tab"][data-id="html-files"]')?.click();
    setTimeout(()=>document.querySelector('.html-manager-item [data-action="new-html-card"][data-id="'+id+'"]')?.click(),500);
   }
  }
 }catch(e){console.error(e);alertPkg(e.message||String(e))}
},true);
document.addEventListener('input',e=>{
 if(e.target.id!=='mswqHtmlSearch')return;
 const q=e.target.value.trim().toLocaleLowerCase();
 let visible=0;
 document.querySelectorAll('.html-manager-item').forEach(el=>{const found=el.dataset.htmlName.includes(q);el.hidden=!found;if(found)visible++});
 const label=$('#mswqHtmlCount');if(label)label.textContent='匹配 '+visible+' 个 HTML 文件';
},true);
document.addEventListener('change',e=>{
 if(e.target.id==='mswqPkgZip'||e.target.id==='mswqPkgFolder'){
  prepared=null;const other=e.target.id==='mswqPkgZip'?'#mswqPkgFolder':'#mswqPkgZip';
  if(e.target.files?.length&&$(other))$(other).value='';
  const n=$('#mswqPkgNotice');if(n)n.textContent='文件已更换，请重新点击检查文件。';
 }
},true);
function start(){const root=$('#app');if(!root)return;new MutationObserver(mount).observe(root,{childList:true,subtree:true});mount();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();