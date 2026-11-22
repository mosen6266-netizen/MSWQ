/* Complete HTML tool packages; preserves the original MSWQ assets screen. */
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
'.mswq-pkg-warning{color:#e2a185}'
];const style=document.createElement('style');style.textContent=styles.join('\n');document.head.append(style);
function alertPkg(message){const n=$('#mswqPkgNotice');if(n){n.textContent=message;n.classList.add('mswq-pkg-warning')}else alert(message)}
function modal(body){
 $('#mswqPkgDialog')?.remove();
 const panel=document.createElement('div');panel.id='mswqPkgDialog';panel.className='modal-backdrop';
 panel.innerHTML='<div class="modal" role="dialog" aria-modal="true" style="max-width:770px">'+body+'</div>';
 document.body.append(panel);
}
function htmlCards(){
 return [...document.querySelectorAll('.asset-card')].map(c=>({card:c,button:c.querySelector('[data-action="new-html-card"][data-id]')})).filter(x=>x.button);
}
function mount(){
 const input=$('#assetUpload');if(!input)return;
 if(!$('#mswqPkgPanel')){
  prepared=null;
  const html='<h3>▣ 上传完整 HTML 工具包</h3>'+
  '<p class="muted small">支持 ZIP 或整个文件夹，HTML、图片、图标、CSS、JavaScript、字体全部按原文件结构保存。上传后可预览，再添加到任意前台分类。</p>'+
  '<div class="cols"><div class="field"><label>ZIP 压缩文件</label><input id="mswqPkgZip" type="file" accept=".zip,application/zip"></div>'+
  '<div class="field"><label>或者直接选择整个文件夹</label><input id="mswqPkgFolder" type="file" webkitdirectory directory multiple></div></div>'+
  '<div class="field"><label>工具名称</label><input id="mswqPkgName" maxlength="200" placeholder="例如：资金路径调查工具"></div>'+
  '<div class="field"><label>新建或覆盖已有工具</label><select id="mswqPkgReplace"><option value="">新增 HTML 工具（新直达链接）</option>'+
  htmlCards().map(x=>'<option value="'+esc(x.button.dataset.id)+'">覆盖：'+esc(x.card.querySelector('strong')?.textContent||'HTML')+'（保留原链接）</option>').join('')+'</select></div>'+
  '<div class="field"><label>启动 HTML 页面</label><select id="mswqPkgEntry"><option value="">请先点击检查文件</option></select></div>'+
  '<div id="mswqPkgNotice" class="mswq-pkg-note">选择 ZIP 或文件夹后，先检查内部文件。</div>'+
  '<div class="flex" style="gap:10px;flex-wrap:wrap"><button class="btn" data-pkg="inspect">① 检查文件</button>'+
  '<button class="btn green" id="mswqPkgSubmit" data-pkg="upload">② 上传并保存工具</button></div>';
  const node=document.createElement('section');node.id='mswqPkgPanel';node.className='mswq-pkg-panel';node.innerHTML=html;
  (input.closest('.field')||input).before(node);
 }
 for(const {card,button} of htmlCards()){
  if(card.querySelector('[data-pkg="details"]'))continue;
  const b=document.createElement('button');b.className='btn sm';b.textContent='查看工具文件';b.dataset.pkg='details';b.dataset.id=button.dataset.id;
  button.parentElement?.append(b);
 }
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
  $('[data-action="tab"][data-id="assets"]')?.click();
  modal('<h2>HTML 工具包保存成功</h2><p><strong>'+esc(name)+'</strong> · '+result.count+' 个文件</p>'+
   '<p class="muted">'+(id?'已经更新原 HTML，前台所有原链接保持不变。':'已经存入素材库，添加前台卡片即可展示。')+'</p>'+
   '<div class="flex end" style="gap:8px;flex-wrap:wrap"><a class="btn" target="_blank" rel="noopener noreferrer" href="'+direct(result.id)+'">完整页面预览</a>'+
   '<button class="btn" data-pkg="details" data-id="'+result.id+'">查看文件</button>'+
   '<button class="btn green" data-pkg="add-card" data-id="'+result.id+'">添加前台卡片</button>'+
   '<button class="btn" data-pkg="close">完成</button></div>');
 }catch(e){button.disabled=false;button.textContent='② 上传并保存工具';throw e;}
}
async function details(id){
 let data;try{data=await call('/api/admin/html-packages/'+encodeURIComponent(id));}catch(e){
  return modal('<h2>HTML 文件</h2><p>'+esc(e.message.includes('不是多文件')?'这是旧版单 HTML 文件，没有关联的文件夹资源。':e.message)+'</p><div class="flex end"><button class="btn" data-pkg="close">关闭</button></div>');
 }
 const files=data.files.map(f=>'<div>'+esc(f.path)+' <span class="muted tiny">('+Math.ceil(f.size/1024)+'KB)</span></div>').join('');
 modal('<h2>HTML 工具包文件管理</h2><p><strong>'+esc(data.name)+'</strong> · 启动页面：'+esc(data.entry)+'</p>'+
  '<div class="mswq-pkg-files">'+files+'</div><div class="flex end" style="margin-top:16px;flex-wrap:wrap">'+
  '<a class="btn" target="_blank" rel="noopener noreferrer" href="'+direct(id)+'">打开完整工具</a>'+
  (data.hasArchive?'<a class="btn" href="/api/admin/html-packages/'+encodeURIComponent(id)+'/download">下载 ZIP</a>':'')+
  '<button class="btn" data-pkg="copy" data-id="'+id+'">复制直达链接</button><button class="btn" data-pkg="close">关闭</button></div>');
}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('[data-pkg]');if(!b)return;
 ev.preventDefault();ev.stopPropagation();
 try{
  const action=b.dataset.pkg,id=b.dataset.id;
  if(action==='inspect')await inspect();
  if(action==='upload')await upload();
  if(action==='details')await details(id);
  if(action==='close')$('#mswqPkgDialog')?.remove();
  if(action==='copy'){await navigator.clipboard.writeText(direct(id));b.textContent='链接已复制';}
  if(action==='add-card'){
   $('#mswqPkgDialog')?.remove();
   const btn=document.querySelector('.asset-card [data-action="new-html-card"][data-id="'+id+'"]');
   if(btn)btn.click();else{
    $('[data-action="tab"][data-id="assets"]')?.click();
    setTimeout(()=>document.querySelector('.asset-card [data-action="new-html-card"][data-id="'+id+'"]')?.click(),500);
   }
  }
 }catch(e){console.error(e);alertPkg(e.message||String(e))}
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