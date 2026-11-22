/* MSWQ front end: public read-only site + authenticated content dashboard */
(function(){
'use strict';
const root=document.getElementById('app');
const $=selector=>document.querySelector(selector);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const urlOk=x=>{try{return ['http:','https:'].includes(new URL(x,location.origin).protocol)}catch{return false}};
const asset=id=>id?(S.admin?'/api/admin/assets/'+encodeURIComponent(id)+'/file':'/api/asset/'+encodeURIComponent(id)):'';
const publicAsset=id=>id?'/api/asset/'+encodeURIComponent(id):'';
const icon=id=>id?'/api/icon/'+encodeURIComponent(id):'';
const iconPreview=id=>id?'/api/admin/icons/'+encodeURIComponent(id)+'/file':'';
const coverPreview=url=>String(url||'').replace(/^\/api\/icon\/([a-f0-9-]{36})$/i,(_,id)=>iconPreview(id)).replace(/^\/api\/asset\/([a-f0-9-]{36})$/i,(_,id)=>'/api/admin/assets/'+id+'/file');
const htmlUrl=id=>/^[a-f0-9-]{36}$/i.test(String(id||''))?'https://mswq-html.mosen6266-ms007.workers.dev/html/'+id+'/':'';
const shareUrl=item=>item?.kind==='html'?htmlUrl(item.content?.htmlAssetId):location.origin+itemHref(item);
const absoluteHttpUrl=x=>{try{const v=new URL(x);return ['http:','https:'].includes(v.protocol)}catch{return false}};
const builtinTypes={personal:'个人流程',group:'群剧本',document:'DOCX 文档',page:'自定义页面',link:'外部工具',bookmarks:'网址收藏',profile:'个人名片'};
const typeNames={...builtinTypes};
function applyCustomTypes(settings){
 for(const key of Object.keys(typeNames))if(!(key in builtinTypes))delete typeNames[key];
 for(const [id,name] of Object.entries(settings?.type_labels||{}))if(Object.hasOwn(builtinTypes,id))typeNames[id]=name;
 for(const id of Object.keys(builtinTypes))if(!(id in (settings?.type_labels||{})))typeNames[id]=builtinTypes[id];
 for(const t of settings?.custom_types||[])if(/^custom_[a-f0-9]{32}$/.test(t.id))typeNames[t.id]=t.name;
}
function subgroupsFor(category,settings=S.settings){
 return (settings?.subgroups||[]).filter(g=>g.category===category);
}
function subgroupTitle(id,settings=S.settings){return (settings?.subgroups||[]).find(g=>g.id===id)?.name||'';}
function subgroupPickerHtml(item){
 const category=frontTabForItem(item),groups=subgroupsFor(category),current=item.content?.subgroupId||'';
 return '<div class="field"><label>前台子分组</label><select data-field="subgroupId">'+
  '<option value="" '+(!groups.some(g=>g.id===current)?'selected':'')+'>未分组 · 显示在其他内容区域</option>'+
  groups.map(g=>'<option value="'+esc(g.id)+'" '+(g.id===current?'selected':'')+'>'+esc(g.name)+'</option>').join('')+
  '</select><div class="muted small">在「分类管理」新增子分组后，就可以将卡片归入对应区域。</div></div>';
}
function coverPickerHtml(item){
 const cover=item.thumbnail||'';
 return '<div class="field"><label>卡片顶部封面图片 / 图标</label>'+
  (cover?'<div class="cover-editor-preview"><img src="'+esc(coverPreview(cover))+'" alt="当前卡片封面" loading="lazy"></div>':'<div class="muted small">当前使用默认 MSWQ 卡片顶部背景。</div>')+
  '<div class="flex cover-editor-actions" style="flex-wrap:wrap;margin:10px 0">'+
  '<button class="btn sm green" data-action="pick-cover">从图标库选择</button>'+
  '<label class="btn sm special-upload-label">直接上传图片<input id="coverUpload" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"></label>'+
  (cover?'<button class="btn sm danger" data-action="clear-cover">清除封面</button>':'')+'</div>'+
  '<input data-field="thumbnail" value="'+esc(cover)+'" placeholder="也可以粘贴图片链接，如 /api/asset/..." />'+
  '<div class="muted small">首页卡片顶部显示这张图片，MSWQ 品牌标识保持不变。</div></div>';
}
function orderedCategoryIds(settings){
 const keys=Object.keys(typeNames).filter(id=>!(settings?.deleted_types||[]).includes(id));
 return [...new Set([...(settings?.type_order||[]),...keys])].filter(id=>keys.includes(id));
}
const blockNames={section:'流程分段',bilingual:'双语话术',text:'纯文本',hint:'绿色提示',wait:'等待步骤',button:'链接按钮',image:'图片',file:'附件'};
const S={items:[],settings:null,admin:false,tab:'dashboard',edit:null,search:'',filter:'all',assets:[],viewer:null,picking:null,preview:false,returnTab:'library',libraryCategory:'all',bookmarkEntries:[],bookmarksLoaded:false,bookmarksPromise:null,bookmarksError:'',docxTemplates:[],docxTemplatesReady:false,docxTemplatesPromise:null,subgroupParent:'',icons:[],ipAccess:{ips:[],currentIp:'',updatedAt:''}};
let toastTimer;
// Preserve the already-painted homepage when opening lightweight public cards.
let homeSnapshot=null;
const homeTabCache=new Map();
let publicNavSeq=0;
function keepHomeDOM(){
 if(location.pathname!=='/'||!root.querySelector('.site-content'))return;
 const fragment=document.createDocumentFragment(),scrollY=window.scrollY;
 while(root.firstChild)fragment.appendChild(root.firstChild);
 homeSnapshot={fragment,scrollY};
}
function restoreHomeDOM(){
 if(!homeSnapshot)return false;
 ++publicNavSeq;
 const snapshot=homeSnapshot;homeSnapshot=null;
 root.replaceChildren(snapshot.fragment);
 document.title='MSWQ · 内容与工具中心';
 S.viewer=null;S.preview=false;
 requestAnimationFrame(()=>window.scrollTo(0,snapshot.scrollY));
 return true;
}
let draggedCategory='';
let draggedContent='';
let draggedContentGroup='';
function toast(t){const n=$('#toast');n.textContent=t;n.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.classList.remove('show'),2600)}
async function api(path,opts={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts});
 let data;try{data=await response.json()}catch{throw Error('服务器响应不是 JSON ('+response.status+')')}
 if(!response.ok||data.ok===false)throw Error(data.error||'请求失败 '+response.status);
 return data;
}
const jsonBody=data=>({headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const fmt=x=>x?new Date(x).toLocaleDateString('zh-CN'):'';
const slug=x=>(x||'').trim()||'new-page';
function typeIcon(k){return {personal:'☷',group:'☰',document:'▤',page:'▦',link:'↗',bookmarks:'▣',profile:'◈'}[k]||'▤'}
function row(title,description,contents){return '<div class="admin-panel"><div class="panel-head"><div><h2>'+esc(title)+'</h2>'+(description?'<div class="muted small">'+esc(description)+'</div>':'')+'</div></div>'+contents+'</div>'}
function controls(buttons){return '<div class="flex end">'+buttons+'</div>'}
function field(name,value,prop,placeholder='',kind='input'){
 const v=esc(value||'');
 return '<div class="field"><label>'+esc(name)+'</label>'+(kind==='textarea'?'<textarea data-field="'+prop+'" placeholder="'+esc(placeholder)+'">'+v+'</textarea>':'<input data-field="'+prop+'" value="'+v+'" placeholder="'+esc(placeholder)+'">')+'</div>';
}
function publicHeader(back=false){return '<header class="topbar'+(back?' topbar-with-back':'')+'">'+(back?'<a class="topbar-back" href="/" data-mswq-back="true" aria-label="返回">返回</a>':'')+'<div class="brand">MS<em>WQ</em></div><span class="caption">CONTENT & TOOLS</span><div class="right"><span class="pill">公开内容中心</span></div></header>'}
function itemHref(x){return '/view/'+encodeURIComponent(x.slug)}
async function showHome(reuseLoaded=false){
 ++publicNavSeq;
 if(reuseLoaded&&restoreHomeDOM())return;
 document.title='MSWQ · 内容与工具中心';S.preview=false;
 root.innerHTML=publicHeader()+'<main class="loading">加载已发布的内容…</main>';
 try{const x=(reuseLoaded&&Array.isArray(S.items)&&S.settings)?{items:S.items,settings:S.settings}:await api('/api/public');S.items=x.items;S.settings=x.settings;S.bookmarkEntries=[];S.bookmarksLoaded=false;S.bookmarksPromise=null;S.bookmarksError='';applyCustomTypes(S.settings);const visibleTypes=orderedCategoryIds(S.settings).filter(k=>!(S.settings.hidden_types||[]).includes(k));const remembered=history.state?.mswqHomeFilter;S.filter=(remembered==='all'||visibleTypes.includes(remembered))?remembered:(visibleTypes[0]||'all');if(S.filter==='bookmarks'){try{await loadPublicBookmarks();}catch(err){S.bookmarksError=err.message;}}homeRender();}
 catch(e){root.innerHTML=publicHeader()+'<div class="site-content empty">暂时无法读取公开内容：'+esc(e.message)+'</div>'}
}
async function loadPublicBookmarks(){
 if(S.bookmarksLoaded)return;
 if(S.bookmarksPromise)return S.bookmarksPromise;
 const collections=S.items.filter(item=>item.kind==='bookmarks'&&item.status==='published');
 S.bookmarksPromise=(async()=>{
  const details=await Promise.all(collections.map(item=>
   item.content?.entries?Promise.resolve({item}):api('/api/public/item/'+encodeURIComponent(item.slug))
  ));
  S.bookmarkEntries=details.flatMap(({item})=>(Array.isArray(item.content?.entries)?item.content.entries:[])
   .filter(entry=>entry&&absoluteHttpUrl(entry.url))
   .map(entry=>({...entry,collectionTitle:item.title||''})));
  S.bookmarksLoaded=true;
 })();
 try{await S.bookmarksPromise}finally{S.bookmarksPromise=null;}
}
function homeRender(){
 const c=S.settings||{},types=[...orderedCategoryIds(c).filter(k=>!((c.hidden_types||[]).includes(k))),'all'];
 if(!types.includes(S.filter))S.filter=types[0]||'all';
 const matching=text=>String(text||'').toLowerCase().includes(S.search.toLowerCase());
 const items=S.items.filter(x=>(S.filter==='all'||frontTabForItem(x)===S.filter)&&matching([x.title,x.description,x.category,subgroupTitle(x.subgroupId,c),(x.tags||[]).join(' ')].join(' ')));
 const isBookmarkTab=S.filter==='bookmarks';
 const bookmarkRows=isBookmarkTab?S.bookmarkEntries.filter(x=>matching([x.title,x.note,x.url,x.collectionTitle].join(' '))):[];
 const busy=isBookmarkTab&&!S.bookmarksLoaded&&!S.bookmarksError;
 const count=isBookmarkTab?(S.bookmarksLoaded?bookmarkRows.length+items.filter(x=>['document','html'].includes(x.kind)).length:'…'):items.length;
 const cardFor=x=>{
  const direct=x.direct_url&&absoluteHttpUrl(x.direct_url)?x.direct_url:'';
  const destination=direct?direct:itemHref(x);
  const tabAttrs=direct?' target="_blank" rel="noopener noreferrer"':'';
  return '<a class="tile" href="'+esc(destination)+'"'+tabAttrs+'><div class="tile-image'+(x.thumbnail?' tile-image--custom':'')+'">'+(x.thumbnail?'<img src="'+esc(x.thumbnail)+'" alt="" loading="lazy" decoding="async" fetchpriority="low">':'')+'<div class="tile-brand" aria-hidden="true"><span>MS</span><em>WQ</em></div></div><div class="tile-body"><span class="pill">'+typeIcon(x.kind)+' '+esc(x.kind==='html'?'HTML 文件':typeNames[x.kind]||'内容')+'</span><h3>'+esc(x.title)+'</h3><p>'+esc(x.description||typeNames[x.category]||x.category||'点击打开内容')+'</p><div class="tile-bottom"><span>'+esc(typeNames[x.category]||x.category||fmt(x.updated_at))+'</span><span>'+(direct?'打开完整页面 ↗':x.kind==='document'?'打开文档工具 →':'查看内容 →')+'</span></div></div></a>';
 };
 const cards=(isBookmarkTab?items.filter(x=>['document','html'].includes(x.kind)):items).map(cardFor).join('');
 const layoutClass=(c.layout||'grid')==='list'?'list-view':(c.layout||'grid')==='compact'?'compact-view':'';
 const cardGrid=rows=>'<div class="grid '+esc(layoutClass)+'">'+rows.map(cardFor).join('')+'</div>';
 const groupCategory=(rows,category,withMainTitle=false)=>{
  if(!rows.length)return '';
  const groups=subgroupsFor(category,c),known=new Set(groups.map(g=>g.id));
  const mainTitle=withMainTitle?'<div class="front-category-title"><h2>'+esc(typeNames[category]||category)+'</h2><span>'+rows.length+' 项</span></div>':'';
  if(!groups.length)return '<section class="front-category-section">'+mainTitle+cardGrid(rows)+'</section>';
  const parts=groups.map(g=>{
   const members=rows.filter(x=>x.subgroupId===g.id);
   if(!members.length)return '';
   return '<section class="front-subgroup"><div class="front-subgroup-head"><h3>'+esc(g.name)+'</h3><span>'+members.length+' 项</span></div>'+cardGrid(members)+'</section>';
  }).join('');
  const other=rows.filter(x=>!known.has(x.subgroupId));
  return '<section class="front-category-section">'+mainTitle+parts+
   (other.length?'<section class="front-subgroup"><div class="front-subgroup-head"><h3>其他内容</h3><span>'+other.length+' 项</span></div>'+cardGrid(other)+'</section>':'')+'</section>';
 };

 let content;
 if(isBookmarkTab){
  content=S.bookmarksError?'<div class="empty">网址收藏加载失败：'+esc(S.bookmarksError)+' <button class="btn sm" data-action="retry-bookmarks">重试</button></div>':
   busy?'<div class="loading center">正在加载收藏网址…</div>':
   (bookmarkRows.length||items.some(x=>['document','html'].includes(x.kind)))?
    (bookmarkRows.length?'<section class="bookmark-public-grid home-bookmark-grid">'+bookmarkRows.map(bookmarkCard).join('')+'</section>':'')+
    (items.some(x=>['document','html'].includes(x.kind))?'<div class="grid bookmark-docx-grid">'+cards+'</div>':''):
   '<div class="empty">'+(S.search?'没有匹配的收藏网址或文档':'尚未发布收藏网址或文档入口')+'</div>';
 }else{
  if(!items.length)content='<div class="empty">暂无匹配的已发布内容</div>';
  else if(!(c.subgroups||[]).length)content=cardGrid(items);
  else if(S.filter==='all'){
   const cats=[...new Set([...orderedCategoryIds(c),...items.map(frontTabForItem)])].filter(cat=>items.some(x=>frontTabForItem(x)===cat));
   content=cats.map(cat=>groupCategory(items.filter(x=>frontTabForItem(x)===cat),cat,true)).join('');
  }else content=groupCategory(items,S.filter,false);
 }
 // Keep the input, navbar and already-loaded images mounted on filter/search.
 const existingResults=document.getElementById('mswqHomeResults');
 if(existingResults&&location.pathname==='/'){
  const nextKey=S.search.trim()?'':S.filter;
  const lastKey=existingResults.dataset.homeCacheKey||'';
  if(lastKey!==nextKey){
   if(lastKey){
    const fragment=document.createDocumentFragment();
    while(existingResults.firstChild)fragment.appendChild(existingResults.firstChild);
    homeTabCache.set(lastKey,fragment);
    if(homeTabCache.size>10)homeTabCache.delete(homeTabCache.keys().next().value);
   }
   if(nextKey&&homeTabCache.has(nextKey)){
    existingResults.replaceChildren(homeTabCache.get(nextKey));
    homeTabCache.delete(nextKey);
   }else existingResults.innerHTML=content;
  }else existingResults.innerHTML=content;
  existingResults.dataset.homeCacheKey=nextKey;
  const counter=document.getElementById('mswqHomeCount');
  if(counter)counter.textContent=count+' 个'+(isBookmarkTab?'网址':'内容');
  document.querySelectorAll('.filters button[data-action="filter"]').forEach(button=>
   button.classList.toggle('active',button.dataset.id===S.filter));
  const search=document.getElementById('homeSearch');
  if(search)search.placeholder=isBookmarkTab?'搜索网址名称、域名、备注…':'搜索流程、剧本、文档、关键词…';
  return;
 }
 root.innerHTML=publicHeader()+'<section class="hero"><div class="hero-kicker">MSWQ DIGITAL WORKSPACE</div><h1>'+esc(c.headline||'内容与工具中心')+'</h1><p>'+esc(c.description||'打开你需要的流程或工具')+'</p><div class="search-box"><span>⌕</span><input id="homeSearch" placeholder="'+(isBookmarkTab?'搜索网址名称、域名、备注…':'搜索流程、剧本、文档、关键词…')+'" value="'+esc(S.search)+'" autocomplete="off"></div></section><main class="site-content">'+(c.announcement?'<div class="notice" style="margin-bottom:22px">'+esc(c.announcement)+'</div>':'')+'<div class="filters">'+types.map(t=>'<button class="filter '+(S.filter===t?'active':'')+'" data-action="filter" data-id="'+t+'">'+(t==='all'?'全部内容':esc(typeNames[t]))+'</button>').join('')+'<span id="mswqHomeCount" class="muted small" style="margin-left:auto">'+count+' 个'+(isBookmarkTab?'网址':'内容')+'</span></div><div id="mswqHomeResults" data-home-cache-key="'+(S.search.trim()?'':esc(S.filter))+'">'+content+'</div></main><footer class="footer">'+esc(c.footer||'© MSWQ · 内容发布平台')+'</footer>';
}
function anchorButton(label,url){
 if(!urlOk(url))return '';
 const href=new URL(url,location.origin).href;
 return '<span class="reader-link-actions"><a class="action-link" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(label||'打开链接')+' ↗</a>'+
  '<button type="button" class="btn sm" data-action="copy-link-url" data-url="'+esc(href)+'">复制链接</button></span>';
}
function memberHtml(b,item){
 const members=item.content?.members||[];
 const m=members.find(v=>String(v.id)===String(b.speakerId||b.memberId||b.actorId))||members.find(v=>v.name===b.speaker);
 if(!m)return b.speaker?'<span class="member">'+esc(b.speaker)+'</span>':'';
 const name=m.name||m.no||'成员';
 return '<span class="member"><span class="avatar">'+esc(name.charAt(0))+'</span><strong>'+esc((m.label?m.label+' · ':'')+name)+'</strong></span>';
}
function blockRender(b,index,item){
 const type=b.type||'text',title=b.title||blockNames[type]||'内容',id=esc(b.id||'b'+index);
 if(type==='section')return '<h2 id="step-'+id+'" class="section-banner">'+esc(b.title||b.text||'新分段')+'</h2>';
 const hdr='<div class="block-head"><span class="block-title">'+memberHtml(b,item)+' '+esc(title)+'</span><span class="block-type">'+esc(blockNames[type]||type)+' · '+(index+1)+'</span></div>';
 let body='';
 if(type==='bilingual'||type==='speech'){
  body='<div class="langs"><div class="lang"><div class="lang-label">中文</div><pre>'+esc(b.zh||'')+'</pre></div><div class="lang en"><div class="lang-label">English</div><pre>'+esc(b.en||'')+'</pre></div></div><div class="copy-actions"><button class="btn sm" data-action="copy-text" data-id="'+id+'" data-lang="zh">复制中文</button><button class="btn sm primary" data-action="copy-text" data-id="'+id+'" data-lang="en">复制英文</button></div>';
 }else if(type==='wait'){
  body='<div class="block-text">'+esc(b.text||'等待指定时间后继续')+'</div><div class="countdown" id="timer-'+id+'">'+Math.max(1,Number(b.seconds)||60)+' 秒</div><button class="btn sm" data-action="countdown" data-id="'+id+'" data-seconds="'+Math.max(1,Number(b.seconds)||60)+'">开始倒计时</button>';
 }else if(type==='button'||type==='link'){
  const links=Array.isArray(b.links)&&b.links.length?b.links:[{url:b.url,label:b.text||title}];
  body='<div class="block-text">'+esc(b.text||'')+'</div>'+links.map(l=>anchorButton(l.label||l.zh||l.en||'打开链接',l.url)).join('');
 }else if(type==='image'){
  body=b.assetId?'<div class="reader-image-block">'+mediaTrigger('image',b.assetId,title)+'</div>':'<div class="muted">未设置图片</div>';
  if(b.text)body+='<p class="block-text">'+esc(b.text)+'</p>';
 }else if(type==='file'||type==='attachment'){
  const files=(b.files||[]).length?b.files:(b.assetId?[{id:b.assetId,name:b.title||'下载文件'}]:[]);
  body=files.map(f=>'<a class="file-chip" href="'+asset(f.id)+'" download>▣ '+esc(f.name||'下载附件')+' ↓</a>').join('')||'<span class="muted">暂无附件</span>';
  if(b.text)body+='<div class="block-text">'+esc(b.text)+'</div>';
 }else body='<div class="block-text">'+esc(b.text||b.content||'')+'</div>';
 return '<article class="block '+(type==='hint'||type==='note'?'hint':type==='wait'?'wait':'')+'" id="step-'+id+'">'+hdr+body+'</article>';
}

function mediaTrigger(mediaType,fileId,label){
 if(!fileId)return '<div class="muted">尚未上传'+(mediaType==='video'?'视频':'图片')+'</div>';
 const id=esc(fileId),title=esc(label||'媒体文件'),video=mediaType==='video';
 return '<button class="profile-media-trigger" type="button" data-action="media-preview" data-id="'+id+'" data-media="'+(video?'video':'image')+'" data-title="'+title+'" aria-label="点击放大预览'+title+'">'+
  (video?'<video src="'+asset(fileId)+'" muted playsinline preload="none" tabindex="-1"></video><span class="profile-media-play">▶</span>':'<img src="'+asset(fileId)+'" loading="lazy" decoding="async" alt="'+title+'">')+
  '<span class="profile-media-label">点击放大预览</span></button>'+
  '<a class="profile-media-download" href="'+asset(fileId)+'?download=1" download>↓ 保存 / 下载'+(video?'视频':'图片')+'</a>';
}
function bookmarkCard(x){
 if(!x||!absoluteHttpUrl(x.url))return '';
 const url=new URL(x.url),domain=url.hostname.replace(/^www\./,'');
 return '<article class="bookmark-public-card">'+
  '<div class="bookmark-public-image">'+(x.assetId?'<button type="button" class="bookmark-cover-preview" data-action="media-preview" data-id="'+esc(x.assetId)+'" data-media="image" data-title="'+esc(x.title)+'" aria-label="放大预览网站封面"><img loading="lazy" src="'+asset(x.assetId)+'" alt="'+esc(x.title)+'"></button>':'<span>↗</span>')+'</div>'+
  '<div class="bookmark-public-info"><div class="bookmark-domain">'+esc(domain)+'</div><h2>'+esc(x.title||domain)+'</h2>'+
  (x.note?'<p>'+esc(x.note)+'</p>':'')+
  '<div class="bookmark-card-actions"><a class="bookmark-open" href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">打开网址 ↗</a>'+
  '<button class="bookmark-copy" type="button" data-action="copy-bookmark" data-id="'+esc(x.id)+'" data-url="'+esc(url.href)+'">复制链接</button></div>'+
  '</div></article>';
}
function bookmarksPublic(item,preview){
 const entries=Array.isArray(item.content?.entries)?item.content.entries:[];
 const cards=entries.filter(x=>x&&absoluteHttpUrl(x.url)).map(bookmarkCard).join('');
 return publicHeader(true)+'<main class="collection-page"><div class="collection-heading"><span class="collection-kicker">SAVED LINKS</span><h1>'+esc(item.title)+'</h1>'+
  (item.description?'<p>'+esc(item.description)+'</p>':'')+(preview?'<button class="btn sm" data-action="back-edit">← 返回编辑</button>':'')+
  '</div>'+(cards?'<section class="bookmark-public-grid">'+cards+'</section>':'<div class="empty">这个收藏夹还没有可以打开的网址</div>')+'</main>';
}
function profilePublic(item,preview){
 const fields=Array.isArray(item.content?.fields)?item.content.fields:[];
 const rows=fields.filter(f=>f&&(f.label||f.value||f.assetId)).map(f=>{
  const label=esc(f.label||'未命名项目');
  if(f.type==='image'||f.type==='video'){
   return '<section class="profile-public-field profile-image-field"><div class="profile-field-label">'+label+'</div>'+
    mediaTrigger(f.type,f.assetId,f.label)+
    (f.value?'<div class="profile-field-value profile-media-description">'+esc(f.value)+'</div>':'')+'</section>';
  }
  if(f.type==='link'){
   return '<section class="profile-public-field"><div class="profile-field-label">'+label+'</div>'+
    '<div class="profile-link-row">'+(absoluteHttpUrl(f.value)?'<a href="'+esc(new URL(f.value).href)+'" target="_blank" rel="noopener noreferrer" class="profile-field-link">'+esc(f.value)+' ↗</a>':'<div class="profile-field-value">'+esc(f.value||'')+'</div>')+
    (f.value?'<button class="profile-copy profile-link-copy" type="button" data-action="copy-profile" data-id="'+esc(f.id)+'">复制链接</button>':'')+'</div></section>';
  }
  return '<section class="profile-public-field"><div class="profile-field-label">'+label+'</div><div class="profile-field-value">'+esc(f.value||'')+'</div>'+
   (f.value?'<button class="profile-copy" type="button" data-action="copy-profile" data-id="'+esc(f.id)+'">复制内容</button>':'')+'</section>';
 }).join('');
 return publicHeader(true)+'<main class="profile-public-page"><div class="profile-public-card"><div class="profile-hero"><span>PERSONAL CARD</span><h1>'+esc(item.title||'个人名片')+'</h1>'+
  (item.description?'<p>'+esc(item.description)+'</p>':'')+(preview?'<button class="btn sm" data-action="back-edit">← 返回编辑</button>':'')+'</div>'+
  '<div class="profile-public-fields">'+(rows||'<div class="empty">这张名片还没有添加展示内容</div>')+'</div></div></main>';
}
function openMediaPreview(id,kind,label){
 if(!/^[a-f0-9-]{32,40}$/i.test(id))return toast('找不到可预览的媒体文件');
 document.getElementById('mediaPreview')?.remove();
 const video=kind==='video',url=asset(id),down=url+'?download=1';
 const wrap=document.createElement('div');
 wrap.id='mediaPreview';wrap.className='media-overlay';wrap.setAttribute('role','dialog');
 wrap.setAttribute('aria-modal','true');wrap.setAttribute('aria-label','媒体放大预览');
 wrap.innerHTML='<div class="media-preview-box"><header class="media-preview-head"><strong>'+esc(label||'媒体预览')+'</strong>'+
  '<button class="btn sm" data-action="close-media-preview">关闭 ×</button></header>'+
  '<div class="media-preview-content">'+(video?'<video controls playsinline preload="metadata" src="'+url+'">当前浏览器无法播放此视频，请尝试下载文件。</video>':
   '<img src="'+url+'" alt="'+esc(label||'图片预览')+'">')+'</div>'+
  '<footer class="media-preview-footer"><a class="btn green" href="'+down+'" download>↓ 保存 / 下载'+(video?'视频':'图片')+'</a>'+
  '<button class="btn" data-action="close-media-preview">返回</button></footer></div>';
 wrap.addEventListener('click',event=>{if(event.target===wrap)wrap.remove()});
 document.body.appendChild(wrap);
 wrap.querySelector('[data-action="close-media-preview"]')?.focus();
}

async function showReader(slugText,localItem=null,preloadedItem=null){
 const navSeq=++publicNavSeq;
 root.innerHTML=publicHeader(true)+'<main class="site-content loading center" style="padding:70px">正在打开内容…</main>';
 try{
 // DOCX template-specific share links are a virtual workspace, not D1 items.
 // A /view/docx-workspace?template=<id> link must work without an additional
 // "publish content" step in the MSWQ content dashboard.
 let item=preloadedItem||localItem;
 if(!item&&slugText==='docx-workspace'){
  const id=new URLSearchParams(location.search).get('template')||'';
  if(id&&!/^[a-f0-9-]{16,60}$/i.test(id))throw Error('DOCX 模板链接中的编号无效');
  const [catalog,siteSettings]=await Promise.all([api('/api/docx/templates'),S.settings?Promise.resolve(null):api('/api/public')]);
  if(siteSettings){S.settings=siteSettings.settings;applyCustomTypes(S.settings);}
  const templates=Array.isArray(catalog.templates)?catalog.templates:[];
  const selected=id?templates.find(t=>t.id===id):templates[0];
  if(id&&!selected)throw Error('此 DOCX 模板已不存在或暂不可访问，请向管理员确认链接');
  if(!selected)throw Error('当前 DOCX 模板库为空');
  item={kind:'document',title:selected.name||selected.title||'DOCX 模板工作台',
   status:'published',slug:'docx-workspace',
   content:{docUrl:'/docx',templateId:selected.id},description:'DOCX 模板直达'};
 }
 if(!item){
  if(!S.settings){
   const [one,site]=await Promise.all([api('/api/public/item/'+encodeURIComponent(slugText)),api('/api/public')]);
   item=one.item;S.settings=site.settings;applyCustomTypes(S.settings);
  }else item=(await api('/api/public/item/'+encodeURIComponent(slugText))).item;
 }
 if(navSeq!==publicNavSeq)return;
 S.viewer=item;S.preview=!!localItem;
 if(!S.settings){const pub=await api('/api/public');S.settings=pub.settings;applyCustomTypes(S.settings);}
 document.title=item.title+' · MSWQ';
 const content=item.content||{},blocks=content.blocks||[];
 // Sidebar navigation mirrors only green hint bubbles; full script remains in the main reader.
 const nav=blocks.map((b,i)=>({b,i})).filter(({b})=>b.type==='hint').map(({b,i},n)=>{
  const text=String(b.text||'').trim(),title=String(b.title||'').trim();
  const label=text||(title&&title!=='绿色提示'?title:'绿色提示');
  return '<button class="navlink hint" data-action="jump" data-id="'+esc(b.id||'b'+i)+'" title="'+esc(label)+'">'+(n+1)+'. '+esc(label)+'</button>';
 }).join('');
 let body='';
 if(item.kind==='bookmarks'){root.innerHTML=bookmarksPublic(item,!!localItem);return;}
 if(item.kind==='profile'){root.innerHTML=profilePublic(item,!!localItem);return;}
 if(item.kind==='document'){
  const baseDoc=content.docUrl||S.settings?.docx_url||'/docx';
  let docUrl;
  try{
   const target=new URL(baseDoc,location.origin);
   if(!['https:','http:'].includes(target.protocol))throw Error('invalid protocol');
   const selectedTemplate=new URL(location.href).searchParams.get('template')||content.templateId;
   if(selectedTemplate)target.searchParams.set('template',selectedTemplate);
   // /docx?template=... is also a public-facing link. Mark this nested document
   // instance explicitly so it doesn't render the MSWQ shell inside itself.
   if(target.origin===location.origin&&(target.pathname==='/docx'||target.pathname==='/docx/'))target.searchParams.set('embed','1');
   docUrl=target.href;
  }catch{
   root.innerHTML=publicHeader(true)+'<div class="empty">文档工作台链接无效，请在后台配置正确的地址。</div>';
   return;
  }
  if(!localItem){
   // Keep exactly the public-site navbar; let the DOCX app use everything underneath it.
   root.innerHTML=publicHeader(true)+'<main class="public-docx-workspace"><iframe class="public-docx-frame" title="'+esc(item.title)+'" sandbox="allow-forms allow-scripts allow-same-origin allow-downloads allow-popups" referrerpolicy="strict-origin-when-cross-origin" src="'+esc(docUrl)+'"></iframe></main>';
   return;
  }
  // Admin draft previews keep their own back-to-editor control.
  root.innerHTML='<div class="docx-preview-shell"><header class="docx-preview-top"><button class="btn sm" data-action="back-edit">← 返回内容编辑</button><strong>'+esc(item.title)+'</strong><span class="muted small">全屏文档工作台预览</span></header><iframe class="docx-preview-frame" title="文档在线工作台" sandbox="allow-forms allow-scripts allow-same-origin allow-downloads allow-popups" referrerpolicy="strict-origin-when-cross-origin" src="'+esc(docUrl)+'"></iframe></div>';
  return;
 }else if(item.kind==='link'){
  body='<div class="block"><h2>'+esc(item.title)+'</h2><p>'+esc(item.description||'外部链接')+'</p>'+anchorButton('打开工具',content.url)+
   (absoluteHttpUrl(content.url)?'<button class="btn sm" data-action="copy-link-url" data-url="'+esc(content.url)+'">复制链接</button>':'')+'</div>';
 }else{
  body=blocks.map((b,i)=>blockRender(b,i,item)).join('')||'<div class="empty">尚无公开内容</div>';
 }
 const showPersonalSwitch=item.kind==='personal'&&!S.preview;
 root.innerHTML='<div class="reader-shell'+(showPersonalSwitch?' reader-shell-personal':'')+'"><header class="reader-top"><a href="/" data-mswq-back="true" class="btn sm">返回</a><h1>'+esc(item.title)+'</h1><span class="pill">'+esc(typeNames[item.kind]||'内容')+'</span>'+(S.preview?'<button class="btn sm" data-action="back-edit">返回编辑</button>':'')+'</header>'+
  (showPersonalSwitch?'<nav id="mswqPersonalSwitch" aria-label="全部个人流程快速切换" hidden></nav>':'')+
  '<div class="reader-grid'+(nav?'':' reader-no-sidebar')+'"><main class="reader-main"><div class="muted small">'+esc(item.category||'MSWQ')+'　'+esc(item.description||'')+'</div><h1 style="margin:8px 0 24px;font-size:27px">'+esc(item.title)+'</h1>'+body+'</main>'+(nav?'<aside class="reader-aside"><h3>绿色提示导航</h3>'+nav+'</aside>':'')+'</div></div>';
 if(showPersonalSwitch){
  const switcher=document.createElement('script');
  switcher.src='/assets/personal-switch.js';
  switcher.defer=true;
  document.body.appendChild(switcher);
 }
 }catch(e){root.innerHTML='<div class="empty">'+esc(e.message)+'<p><a class="btn" data-mswq-back="true" href="/">返回</a></p></div>'}
}
async function openAdmin(){
 root.innerHTML='<div class="loading center" style="padding:80px">正在加载测试后台…</div>';
 try{
  await api('/api/admin/me');
  S.admin=true;
  await loadAdmin();
  const initialTab=new URLSearchParams(location.search).get('tab');
  if(['dashboard','library','categories','bookmarks','profile','html-files','icons','ip-access','assets','settings','import','legacy','legacy-docx'].includes(initialTab))S.tab=initialTab;
  if(['assets','html-files'].includes(initialTab))await loadAssets();
  if(initialTab==='icons')await loadIcons();
  if(initialTab==='ip-access')await loadIpAccess();
  adminRender();
 }catch(err){
  S.admin=false;
  root.innerHTML='<div class="login-screen"><div class="login-box"><h1>后台暂时无法打开</h1><p>'+esc(err.message)+'</p><button class="btn primary" onclick="location.reload()">重新加载</button><p style="margin-top:20px"><a href="/">返回首页</a></p></div></div>';
 }
}
async function loadAdmin(){
 const [data,settings]=await Promise.all([api('/api/admin/items'),api('/api/admin/settings')]);
 S.items=data.items;S.settings=settings.settings;applyCustomTypes(S.settings);
}
function sideNav(){
 const links=[['dashboard','◫','总览'],['library','☰','内容管理'],['categories','☷','分类管理'],['bookmarks','▣','网址收藏'],['profile','◈','个人名片'],['html-files','▣','HTML 文件管理'],['icons','▧','图标管理'],['ip-access','⛨','IP 访问限制'],['assets','▤','文件素材'],['settings','⚙','前台设置'],['import','⇧','导入与备份'],['legacy','▦','原版流程编辑器'],['legacy-docx','▣','DOCX 模板后台']];
 return '<aside class="admin-sidebar"><div class="admin-side-header"><div class="brand">MS<em>WQ</em></div><div class="muted tiny">统一内容管理系统</div></div><nav class="admin-side-menu">'+links.map(x=>'<button class="admin-nav '+(S.tab===x[0]||S.tab==='editor'&&S.returnTab===x[0]?'active':'')+'" data-action="tab" data-id="'+x[0]+'">'+x[1]+' '+x[2]+'</button>').join('')+'</nav><div class="admin-side-foot"><div>测试模式 · 免密码进入</div><div class="flex" style="margin-top:12px"><a href="/" target="_blank">打开前台 ↗</a></div></div></aside>';
}
function adminRender(){
 const heading={dashboard:'后台总览',library:'内容管理',categories:'分类管理',bookmarks:'网址收藏管理',profile:'个人名片管理',editor:'内容编辑','html-files':'HTML 文件管理',icons:'图标管理','ip-access':'IP 访问限制',assets:'素材与文件管理',settings:'公开首页设置',import:'导入 / 导出',legacy:'原版流程编辑器','legacy-docx':'DOCX 模板后台'}[S.tab]||'管理后台';
 const summary={dashboard:'统一管理流程、剧本、页面与文档入口',library:'草稿不会被公开，点击发布后用户即可查看',categories:'全部分类都能重命名、拖动排序、隐藏、删除和恢复，不影响原有内容',bookmarks:'管理网址收藏列表并发布到前台',profile:'自由添加文字、链接、图片和视频',editor:'编辑完成后可以保存草稿或直接发布','html-files':'上传和管理 HTML 网页和完整工具包；支持预览、源文件与 ZIP 下载',icons:'独立图标库：不与文件素材重复、同步或互相删除','ip-access':'只有白名单 IP 可以访问前台网站及 HTML 工具',assets:'图片与文件保存在 MSWQ 独立文件存储',settings:'更改公开页面标题、描述、布局与公告',import:'兼容群剧本和个人流程原版 JSON 备份',legacy:'你上传的完整本地编辑器，可直接同步发布到 MSWQ','legacy-docx':'仅管理员可进入原 DOCX 模板管理功能'}[S.tab];
 const action=S.tab==='library'?'<button class="btn green" data-action="new-html-card">＋ 添加 HTML 卡片</button><button class="btn green" data-action="open-docx-create">＋ 添加 DOCX 入口</button><button class="btn primary" data-action="new-item">＋ 新建其他内容</button>':S.tab==='bookmarks'||S.tab==='profile'?'<button class="btn green" data-action="new-special" data-id="'+S.tab+'">＋ 新建'+(S.tab==='profile'?'个人名片':'网址收藏夹')+'</button>':S.tab==='editor'?'<button class="btn" data-action="tab" data-id="'+esc(S.returnTab||'library')+'">← 返回列表</button>':'<a href="/" target="_blank" class="btn sm">查看前台 ↗</a>';
 // Keep MSWQ's navigation permanently visible, with the entire right pane reserved for the tool.
 if(S.tab==='legacy'||S.tab==='legacy-docx'){
  const isDocx=S.tab==='legacy-docx';
  const src=isDocx?'/admin/docx-editor':'/admin/legacy-editor';
  const label=isDocx?'DOCX 模板后台':'原版流程编辑器';
  root.innerHTML='<div class="admin-layout admin-layout--tool">'+sideNav()+'<main class="admin-main admin-main--tool"><iframe class="admin-tool-frame" title="'+label+'" src="'+src+'" loading="eager" referrerpolicy="same-origin"></iframe></main></div>';
  return;
 }
 root.innerHTML='<div class="admin-layout">'+sideNav()+'<main class="admin-main"><header class="admin-head"><div><h1>'+heading+'</h1><p>'+summary+'</p></div><div class="flex">'+action+'</div></header><div class="admin-content" id="adminPanel">'+adminPanel()+'</div></main></div>';
}
function adminPanel(){
 if(S.tab==='dashboard'){
  const published=S.items.filter(x=>x.status==='published').length;
  const draft=S.items.length-published;
  return '<div class="stats"><div class="stat"><span>全部内容</span><strong>'+S.items.length+'</strong></div><div class="stat"><span>已发布</span><strong>'+published+'</strong></div><div class="stat"><span>草稿</span><strong>'+draft+'</strong></div><div class="stat"><span>内容类型</span><strong>'+Object.keys(typeNames).length+'</strong></div></div>'+row('快捷管理','创建内容后可独立生成公开链接','<div class="flex" style="flex-wrap:wrap"><button class="btn green" data-action="open-docx-create">＋ 添加 DOCX 入口</button><button class="btn primary" data-action="new-item">＋ 新建流程 / 页面</button><button class="btn" data-action="tab" data-id="import">导入旧编辑器备份</button><button class="btn" data-action="tab" data-id="assets">上传图片或文件</button><a class="btn" href="/" target="_blank">查看公开首页</a></div>')+row('使用顺序','', '<div class="stack muted">① 在内容管理中创建个人流程、群剧本或页面 → ② 添加步骤、按钮、附件 → ③ 保存草稿并预览 → ④ 发布并复制公开链接。<br>DOCX 模块已完全使用 MSWQ 自己的模板数据库与文件存储，不依赖旧 MS_KHMB 服务。</div>');
 }
 if(S.tab==='bookmarks'||S.tab==='profile'){
  const kind=S.tab,rows=S.items.filter(x=>x.kind===kind);
  return row(kind==='profile'?'个人名片':'网址收藏夹',kind==='profile'?'不预设任何个人资料字段；标签与内容由你自己添加':'收藏多个网站，随时更改名称、网址、备注和排序',
   '<div class="flex" style="flex-wrap:wrap;margin-bottom:16px"><button class="btn green" data-action="new-special" data-id="'+kind+'">＋ 新建'+(kind==='profile'?'个人名片':'网址收藏夹')+'</button><span class="muted small">'+rows.length+' 个</span></div>'+
   (rows.length?'<div class="special-list">'+rows.map(x=>'<div class="special-list-item"><div><strong>'+esc(x.title)+'</strong><div class="muted small">'+esc(x.slug)+' · '+(x.status==='published'?'已发布':'草稿')+'</div></div><div class="flex" style="flex-wrap:wrap"><button class="btn sm" data-action="edit-item" data-id="'+x.id+'">编辑</button><button class="btn sm" data-action="copy-url" data-id="'+x.id+'">复制链接</button><button class="btn sm" data-action="quick-status" data-id="'+x.id+'">'+(x.status==='published'?'下架':'发布')+'</button></div></div>').join('')+'</div>':'<div class="empty">还没有内容，点击「新建」开始添加</div>'));
 }
 if(S.tab==='library')return libraryHtml();
 if(S.tab==='editor')return editorHtml();
 if(S.tab==='assets')return assetsHtml();
 if(S.tab==='html-files')return htmlFilesHtml();
 if(S.tab==='icons')return iconsHtml();
 if(S.tab==='ip-access')return ipAccessHtml();
 if(S.tab==='settings')return settingsHtml();
 if(S.tab==='categories')return categoryManagerHtml();
 if(S.tab==='import')return importHtml();


 return '';
}
function frontTabForItem(x){return ['document','html'].includes(x.kind)?(x.category||(x.kind==='html'?'page':'document')):x.kind;}
function libraryTabIds(){
 const tabs=orderedCategoryIds(S.settings),attached=[...new Set(S.items.map(frontTabForItem))];
 return [...new Set([...tabs,...attached])];
}
function libraryHtml(){
 const tabs=libraryTabIds();
 if(S.libraryCategory!=='all'&&!tabs.includes(S.libraryCategory))S.libraryCategory='all';
 const selected=S.libraryCategory,query=S.search.trim().toLocaleLowerCase(),sortingDisabled=!!query;
 const matches=x=>!query||[x.title,x.slug,x.description,x.category,typeNames[x.kind],typeNames[frontTabForItem(x)],subgroupTitle(x.subgroupId),(x.tags||[]).join(' ')]
  .some(value=>String(value||'').toLocaleLowerCase().includes(query));
 const counts=Object.fromEntries(tabs.map(id=>[id,S.items.filter(x=>frontTabForItem(x)===id).length]));
 const filters='<div class="library-tabs"><button type="button" class="library-tab '+(selected==='all'?'active':'')+'" data-action="library-filter" data-id="all" aria-pressed="'+(selected==='all')+'">全部分组 <span>'+S.items.length+'</span></button>'+
  tabs.map(id=>'<button type="button" class="library-tab '+(selected===id?'active':'')+'" data-action="library-filter" data-id="'+esc(id)+'" aria-pressed="'+(selected===id)+'">'+esc(typeNames[id]||id)+
   ((S.settings?.deleted_types||[]).includes(id)?'（已移除）':(S.settings?.hidden_types||[]).includes(id)?'（已隐藏）':'')+' <span>'+counts[id]+'</span></button>').join('')+'</div>';
 const groups=tabs.filter(id=>selected==='all'||id===selected).map(id=>{
  const all=S.items.filter(item=>frontTabForItem(item)===id),visible=all.filter(matches);
  if(!visible.length&&selected==='all')return '';
  const subgroups=subgroupsFor(id),known=new Set(subgroups.map(g=>g.id));
  const scopeFor=item=>known.has(item.subgroupId)?item.subgroupId:'';
  const renderRows=members=>{
   return members.map(x=>{
    const scope=scopeFor(x),scopeItems=all.filter(it=>scopeFor(it)===scope),index=scopeItems.findIndex(it=>it.id===x.id);
    const canSort=!sortingDisabled&&scopeItems.length>1,canDrag=!sortingDisabled&&(canSort||subgroups.length>0);
    return '<tr class="library-sort-row" draggable="'+canDrag+'" data-content-row="'+esc(x.id)+'" data-content-group="'+esc(id)+'" data-content-subgroup="'+esc(scope)+'">'+
     '<td class="library-sort-cell"><span class="library-grip" title="拖动到目标子分组或同组其他位置">⠿</span><span class="library-index">'+(index+1)+'</span></td>'+
     '<td><strong>'+esc(x.title)+'</strong><div class="tiny muted truncate">/view/'+esc(x.slug)+'</div></td>'+
     '<td><span class="library-tab-label">'+esc(typeNames[id]||id)+'</span></td>'+
     '<td class="small muted">'+esc(x.kind==='html'?'HTML 文件':(typeNames[x.kind]||x.kind))+'</td>'+
     '<td><span class="pill '+esc(x.status)+'">'+(x.status==='published'?'已发布':'草稿')+'</span></td>'+
     '<td class="library-row-actions"><div class="actions">'+
      '<button class="btn sm" data-action="move-content" data-id="'+esc(x.id)+'" data-dir="-1" title="上移" '+(!canSort||index===0?'disabled':'')+'>↑</button>'+
      '<button class="btn sm" data-action="move-content" data-id="'+esc(x.id)+'" data-dir="1" title="下移" '+(!canSort||index===scopeItems.length-1?'disabled':'')+'>↓</button>'+
      '<button class="btn sm" data-action="edit-item" data-id="'+esc(x.id)+'">编辑</button>'+
      '<button class="btn sm" data-action="copy-url" data-id="'+esc(x.id)+'">链接</button>'+
      '<button class="btn sm" data-action="quick-status" data-id="'+esc(x.id)+'">'+(x.status==='published'?'下架':'发布')+'</button>'+
     '</div></td></tr>';
   }).join('');
  };
  const table=rows=>'<div class="library-table-wrap"><table class="admin-table library-table"><thead><tr><th>拖动</th><th>标题 / 路径</th><th>所在标签页</th><th>内容形式</th><th>状态</th><th class="library-action-heading">排序 / 操作</th></tr></thead><tbody>'+renderRows(rows)+'</tbody></table></div>';
  const bySubgroups=subgroups.length?
   [...subgroups.map(g=>({id:g.id,name:g.name})),{id:'',name:'其他内容（未分组）'}].map(g=>{
    const groupAll=all.filter(x=>scopeFor(x)===g.id),groupVisible=groupAll.filter(matches);
    return '<section class="library-subgroup-zone" data-subgroup-zone data-zone-category="'+esc(id)+'" data-zone-subgroup="'+esc(g.id)+'">'+
     '<div class="library-subgroup-title"><div><span class="library-subgroup-folder">▤</span><strong>'+esc(g.name)+'</strong>'+
     '<span class="library-subgroup-number">'+groupAll.length+' 个工具</span></div>'+
     (!sortingDisabled?'<span class="library-subgroup-hint">拖到这里自动归入此组</span>':'')+'</div>'+
     (groupVisible.length?table(groupVisible):'<div class="library-subgroup-empty">'+(sortingDisabled?'当前没有匹配内容':'拖拽工具到这里，即可移动到「'+esc(g.name)+'」')+'</div>')+
     '</section>';
   }).join(''):(visible.length?table(visible):'<div class="empty">该标签下没有匹配的内容</div>');
  const published=all.filter(x=>x.status==='published').length;
  return '<section class="library-group" data-library-group="'+esc(id)+'">'+
   '<div class="library-group-head"><div><h3>'+esc(typeNames[id]||id)+'</h3><p>前台标签页 · '+published+' 条已发布 / 共 '+all.length+' 条'+
   ((S.settings?.deleted_types||[]).includes(id)?' · 分类已删除，原内容保留':(S.settings?.hidden_types||[]).includes(id)?' · 前台已隐藏':'')+'</p></div>'+
   '<span class="library-group-count">'+all.length+' 条</span></div>'+
   (subgroups.length?'<p class="library-group-help">子分组支持直接拖拽：拖动任意一行到下方分区，不用进入编辑。</p>':'')+
   bySubgroups+'</section>';
 }).join('');
 return row('按前台标签页管理内容','在主分类下直接拖拽工具到任何子分组，松手自动保存；也可拖动同组工具调整先后顺序。',
  '<div class="library-toolbar"><input id="adminSearch" class="input" placeholder="搜索内容名称、子分组、标签页、路径…" value="'+esc(S.search)+'" autocomplete="off">'+
  '<span class="muted small">拖动行首 ⠿ 到目标区域，不修改工具的原始内容和分享链接。</span></div>'+
  filters+
  (sortingDisabled?'<p class="library-sort-note">搜索时暂时禁止拖拽，清空搜索后可以移动到任意子分组。</p>':
   '<p class="library-sort-note">直接拖拽即可移动工具到子分组，包括空分组；组内也可拖动排序。需要新增分组请到「分类管理」。</p>')+
  (groups||'<div class="empty">暂无内容</div>'));
}
async function loadDocxTemplates(force=false){
 if(S.docxTemplatesReady&&!force)return S.docxTemplates;
 if(S.docxTemplatesPromise)return S.docxTemplatesPromise;
 S.docxTemplatesPromise=(async()=>{
  const result=await api('/api/docx/templates');
  if(!Array.isArray(result.templates))throw Error('DOCX 模板列表返回格式不正确');
  S.docxTemplates=result.templates.filter(t=>t&&/^[a-f0-9-]{36}$/i.test(t.id)&&typeof t.name==='string');
  S.docxTemplatesReady=true;
  return S.docxTemplates;
 })();
 try{return await S.docxTemplatesPromise}
 finally{S.docxTemplatesPromise=null}
}
function docxSelectOptions(selected=''){
 return '<option value="">请选择现有 DOCX 模板…</option>'+S.docxTemplates.map(t=>
  '<option value="'+esc(t.id)+'" '+(selected===t.id?'selected':'')+'>'+esc(t.name||t.filename||'未命名模板')+'</option>'
 ).join('');
}
function docxDisplayCategoryOptions(selected=''){
 const visible=orderedCategoryIds(S.settings).filter(id=>!(S.settings?.hidden_types||[]).includes(id));
 const options=visible.map(id=>'<option value="'+esc(id)+'" '+(id===selected?'selected':'')+'>'+esc(typeNames[id]||id)+'</option>').join('');
 const legacy=selected&&!visible.includes(selected)?'<option value="'+esc(selected)+'" selected>原有分类（已隐藏或删除），请更换</option>':'';
 return '<option value="">请选择前台显示的分类…</option>'+legacy+options+'<option value="__new_category__">＋ 新建分类…</option>';
}
function htmlCategoryOptions(selected=''){
 const ids=orderedCategoryIds(S.settings).filter(id=>!(S.settings?.hidden_types||[]).includes(id));
 const legacy=selected&&!ids.includes(selected)?'<option value="'+esc(selected)+'" selected>原分类（已隐藏）</option>':'';
 return '<option value="">请选择前台显示分类…</option>'+legacy+ids.map(id=>'<option value="'+esc(id)+'" '+(id===selected?'selected':'')+'>'+esc(typeNames[id]||id)+'</option>').join('');
}
function htmlAssetOptions(selected=''){
 return '<option value="">请选择已经上传的 HTML 文件…</option>'+S.assets.filter(a=>a.mime==='text/html').map(a=>'<option value="'+esc(a.id)+'" '+(a.id===selected?'selected':'')+'>'+esc(a.name)+'</option>').join('');
}
async function showQuickHtmlCreate(chosen=''){
 await loadAssets();
 const files=S.assets.filter(a=>a.mime==='text/html'),file=files.find(a=>a.id===chosen)||files[0];
 const active=orderedCategoryIds(S.settings).filter(id=>!(S.settings?.hidden_types||[]).includes(id));
 const category=active.includes(S.libraryCategory)?S.libraryCategory:active.includes('page')?'page':active[0]||'';
 openModal('<h2>＋ 发布 HTML 页面卡片</h2><p class="muted small">选择已上传的完整 HTML 文件，放在任意前台分类；点击卡片直接新标签页打开原始完整界面。</p>'+
  '<div class="field"><label>关联 HTML 文件</label><select id="quickHtmlAsset">'+htmlAssetOptions(chosen||file?.id||'')+'</select></div>'+
  '<div class="field"><label>卡片标题</label><input id="quickHtmlTitle" maxlength="160" value="'+esc(file?.name?.replace(/\.html?$/i,'')||'')+'" placeholder="例如：调查工具"></div>'+
  '<div class="field"><label>显示在哪个分类</label><select id="quickHtmlCategory">'+htmlCategoryOptions(category)+'</select></div>'+
  '<div class="field"><label>简介（可选）</label><textarea id="quickHtmlDescription" placeholder="在首页卡片下方显示"></textarea></div>'+
  (files.length?'':'<p class="muted">文件库暂无 HTML，请先到「HTML 文件管理」上传 HTML。</p>')+
  '<div class="flex end"><button class="btn" data-action="close-modal">取消</button>'+
  (files.length?'<button class="btn green" data-action="publish-html-quick">保存并发布</button>':'<button class="btn primary" data-action="go-html-upload">前往上传文件</button>')+'</div>');
}
function htmlEditorHtml(item){
 const content=item.content||(item.content={});
 return row('HTML 文件卡片','原文件保留在文件库。可更换 HTML 文件、卡片标题和显示分类，不改变文件自身内容。',
  field('卡片标题',item.title,'title','例如：调查工具')+
  '<div class="field"><label>关联的 HTML 文件</label><select data-field="htmlAssetId">'+htmlAssetOptions(content.htmlAssetId||'')+'</select></div>'+
  '<div class="field"><label>直接上传新 HTML 替换</label><input id="htmlEditorUpload" type="file" accept=".html,.htm,text/html"></div>'+
  '<div class="field"><label>前台分类</label><select data-field="category">'+htmlCategoryOptions(item.category||'page')+'</select></div>'+
  field('简介',item.description,'description','可选','textarea')+
  field('首页排序',item.sort_order,'sort_order','数字越小越靠前')+
  subgroupPickerHtml(item)+coverPickerHtml(item)+
  '<div class="flex" style="flex-wrap:wrap;margin-top:16px"><button class="btn" data-action="save-item">保存修改</button>'+
  '<button class="btn green" data-action="publish-item">'+(item.status==='published'?'保存并继续发布':'保存并发布')+'</button>'+
  (item.id?'<button class="btn" data-action="copy-current">复制直达链接</button><button class="btn" data-action="preview-item">打开完整 HTML</button><button class="btn danger" data-action="delete-item">删除卡片</button>':'')+'</div>');
}
function defaultDocxCategory(){
 const active=orderedCategoryIds(S.settings).filter(id=>!(S.settings?.hidden_types||[]).includes(id));
 return active.includes('document')?'document':active[0]||'';
}
async function showQuickDocxCreate(){
 await loadDocxTemplates(true);
 const templateSelect=S.docxTemplates.length?
  '<select id="quickDocxTemplate" required>'+docxSelectOptions()+'</select>':
  '<div class="muted">目前还没有 DOCX 模板，请先在「DOCX 模板后台」上传模板。</div>';
 openModal('<h2>＋ 添加 DOCX 文件入口</h2>'+
  '<p class="muted small">直接从现有模板库选择，不需要填写模板 ID、公开路径或工作台地址。</p>'+
  '<div class="field"><label for="quickDocxTitle">前台显示名称</label><input id="quickDocxTitle" maxlength="160" placeholder="例如：制作文件" autocomplete="off"></div>'+
  '<div class="field"><label for="quickDocxTemplate">选择要直达的 DOCX 模板</label>'+templateSelect+'</div>'+
  '<div class="field"><label for="quickDocxCategory">前台显示在哪个分类</label><select id="quickDocxCategory">'+docxDisplayCategoryOptions(defaultDocxCategory())+'</select><div class="muted small">会显示在选定的前台标签页和「全部内容」中。</div></div>'+
  '<div class="field" id="quickDocxNewCategoryBox" style="display:none"><label for="quickDocxNewCategoryName">新分类名称</label><input id="quickDocxNewCategoryName" maxlength="30" placeholder="例如：制作文件"></div>'+
  '<div class="flex end" style="margin-top:20px"><button class="btn" data-action="close-modal">取消</button>'+
  (S.docxTemplates.length?'<button class="btn green" data-action="publish-docx-quick">保存并发布</button>':
   '<button class="btn" data-action="close-modal">关闭</button>')+'</div>');
 $('#quickDocxTitle')?.focus();
}
function documentEditorHtml(x){
 const c=x.content||(x.content={});
 const choices=docxSelectOptions(c.templateId||'');
 const missing=c.templateId&&!S.docxTemplates.some(t=>t.id===c.templateId);
 const legacy=missing?'<option value="'+esc(c.templateId)+'" selected>原关联模板（当前模板库里未找到）</option>':'';
 const templateSelect=S.docxTemplatesReady?
  '<select data-field="templateId" id="docxEditorTemplate">'+legacy+choices+'</select>':
  '<p class="muted small">正在读取 DOCX 模板列表…</p>';
 return row('DOCX 直达入口','只需修改前台名称、选择模板，访问地址由系统自动管理。'+(x.status==='published'?' 当前已发布。':' 当前为草稿。'),
  field('前台显示名称',x.title,'title','例如：制作文件')+
  '<div class="field"><label for="docxEditorTemplate">对应 DOCX 模板</label>'+templateSelect+'</div>'+
  '<div class="field"><label for="docxEditorCategory">前台显示分类</label><select id="docxEditorCategory" data-field="category">'+docxDisplayCategoryOptions(x.category||'document')+'</select></div>'+
  '<p class="muted small">点击这个入口将直接打开选定模板的填写与导出页面。</p>'+
  '<details class="special-meta-details"><summary>高级设置（通常不用修改）</summary><div class="special-meta-inside">'+
  field('公开路径',x.slug,'slug','系统自动生成')+
  field('文档工作台地址',c.docUrl||'/docx','docUrl','/docx')+
  field('内容简介',x.description,'description','','textarea')+
  field('排序数字',x.sort_order,'sort_order','1000')+
  '</div></details>'+subgroupPickerHtml(x)+coverPickerHtml(x)+
  '<div class="flex" style="flex-wrap:wrap;margin-top:18px"><button class="btn" data-action="save-item">保存修改</button>'+
  '<button class="btn green" data-action="publish-item">'+(x.status==='published'?'保存并继续发布':'保存并发布')+'</button>'+
  (x.id?'<button class="btn" data-action="copy-current">复制前台链接</button><button class="btn danger" data-action="delete-item">删除入口</button>':'')+
  '</div>');
}
function blankBlock(type){
 return {id:crypto.randomUUID(),type,title:blockNames[type]||'新步骤',text:'',zh:'',en:'',seconds:60,speakerId:'',url:'',links:[],assetId:'',files:[]};
}
function newItem(kind='personal'){
 S.returnTab=kind==='bookmarks'?'bookmarks':kind==='profile'?'profile':'library';
 const label=kind==='bookmarks'?'我的网址收藏':kind==='profile'?'个人名片':'新建个人流程';
 const unique=['bookmarks','profile'].includes(kind)?kind+'-'+crypto.randomUUID().slice(0,8):'';
 S.edit={id:null,version:0,kind,status:'draft',title:label,slug:unique,description:'',category:'',tags:[],sort_order:1000,thumbnail:'',content:{blocks:[],members:[],keywords:[],entries:[],fields:[]}};
 S.tab='editor';adminRender();
}

function specialImagePicker(collection,index,assetId,media='image'){
 const id=Number(index),video=media==='video',name=video?'名片视频':collection==='fields'?'名片图片':'网站图标';
 const accept=video?'.mp4,.webm,video/mp4,video/webm':'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
 const thumbnail=video?'<video muted playsinline preload="metadata" src="'+asset(assetId)+'"></video>':'<img loading="lazy" alt="'+name+'" src="'+asset(assetId)+'">';
 return '<div class="special-image-tools">'+(assetId?'<div class="special-image-preview">'+thumbnail+'</div>':'')+
  '<label class="btn sm special-upload-label">直接上传'+(video?'视频':'图片')+'<input type="file" accept="'+accept+'" data-media-upload="'+collection+'" data-media-kind="'+media+'" data-index="'+id+'"></label>'+
  '<button class="btn sm" data-action="pick-special-image" data-collection="'+collection+'" data-media="'+media+'" data-id="'+id+'">从素材库选择</button>'+
  (assetId?'<button class="btn sm danger" data-action="clear-special-image" data-collection="'+collection+'" data-id="'+id+'">移除'+(video?'视频':'图片')+'</button>':'')+
  (video?'<span class="muted small">MP4 / WebM，单个不超过 50MB</span>':'')+'</div>';
}
function specialMoveButtons(action,index,length,removeAction){
 return '<div class="special-row-controls"><button class="btn sm" data-action="'+action+'" data-id="'+index+'" data-dir="-1" '+(!index?'disabled':'')+'>↑</button>'+
  '<button class="btn sm" data-action="'+action+'" data-id="'+index+'" data-dir="1" '+(index>=length-1?'disabled':'')+'>↓</button>'+
  '<button class="btn sm danger" data-action="'+removeAction+'" data-id="'+index+'">删除</button></div>';
}
function bookmarkEditorRows(entries){
 return entries.map((e,i)=>'<div class="special-edit-row"><div class="special-row-heading"><strong>网址 '+(i+1)+'</strong>'+specialMoveButtons('move-bookmark',i,entries.length,'remove-bookmark')+'</div>'+
  '<div class="two"><div class="field"><label>网站名称</label><input maxlength="140" placeholder="例如：常用工作网站" data-bookmark-index="'+i+'" data-prop="title" value="'+esc(e.title||'')+'"></div>'+
  '<div class="field"><label>完整网址（https://）</label><input type="url" placeholder="https://example.com" data-bookmark-index="'+i+'" data-prop="url" value="'+esc(e.url||'')+'"></div></div>'+
  '<div class="field"><label>说明 / 备注（可选）</label><textarea data-bookmark-index="'+i+'" data-prop="note" placeholder="写一段简短的网站说明">'+esc(e.note||'')+'</textarea></div>'+
  '<div class="field"><label>网站封面图 / 图标（可选）</label>'+specialImagePicker('entries',i,e.assetId)+'</div></div>').join('')||
  '<div class="empty">暂时没有收藏的网址，点击下方「＋ 添加网址」开始</div>';
}
function profileEditorRows(fields){
 const labels={text:'文字内容',link:'网址链接',image:'图片',video:'视频'};
 return fields.map((f,i)=>'<div class="special-edit-row"><div class="special-row-heading"><strong>自定义项目 '+(i+1)+'</strong>'+specialMoveButtons('move-profile',i,fields.length,'remove-profile')+'</div>'+
  '<div class="two"><div class="field"><label>标签名称（你自己命名）</label><input maxlength="120" placeholder="例如：姓名、联系方式、作品图、任何名称" data-profile-index="'+i+'" data-prop="label" value="'+esc(f.label||'')+'"></div>'+
  '<div class="field"><label>内容形式</label><select data-profile-index="'+i+'" data-prop="type">'+Object.keys(labels).map(k=>'<option value="'+k+'" '+(f.type===k?'selected':'')+'>'+labels[k]+'</option>').join('')+'</select></div></div>'+
  (f.type==='image'||f.type==='video'?'<div class="field"><label>上传'+(f.type==='video'?'视频':'图片')+'或从已有素材选择</label>'+specialImagePicker('fields',i,f.assetId,f.type)+'</div>'+
    '<div class="field"><label>'+(f.type==='video'?'视频':'图片')+'描述（可留空）</label><textarea data-profile-index="'+i+'" data-prop="value" placeholder="媒体下方显示的说明文字">'+esc(f.value||'')+'</textarea></div>':
    f.type==='link'?'<div class="field"><label>标签内容 · 网址</label><input type="url" maxlength="2048" data-profile-index="'+i+'" data-prop="value" placeholder="https://example.com" value="'+esc(f.value||'')+'"></div>':
    '<div class="field"><label>标签内容 · 自由填写</label><textarea data-profile-index="'+i+'" data-prop="value" maxlength="3500" placeholder="例如：迈克；也可以输入多行文字">'+esc(f.value||'')+'</textarea></div>')+
  '</div>').join('')||'<div class="empty">名片还没有任何资料项。点击下方按钮，自己建立标签和内容。</div>';
}
function specialEditorActions(x){
 return '<div class="admin-panel"><div class="flex" style="flex-wrap:wrap"><button class="btn primary" data-action="save-item">保存草稿 / 修改</button>'+
  '<button class="btn green" data-action="publish-item">'+(x.status==='published'?'保存并继续发布':'保存并发布到前台')+'</button>'+
  '<button class="btn" data-action="preview-item">预览前台</button>'+
  (x.id?'<button class="btn" data-action="copy-current">复制公开链接</button><button class="btn" data-action="revisions">历史版本</button><button class="btn danger" data-action="delete-item">删除内容</button>':'')+
  '</div></div>';
}
function profileEditorHtml(x){
 const c=x.content||(x.content={});const fields=c.fields||(c.fields=[]);
 const items=row('名片项目 · 完全自定义','不预设姓名、电话、邮箱等信息；每项标签和内容都由你自己创建，图片和视频也可以作为单独项目',
  profileEditorRows(fields)+'<div class="editor-add"><button class="btn green" data-action="add-profile" data-id="text">＋ 文字标签</button>'+
  '<button class="btn" data-action="add-profile" data-id="link">＋ 网址标签</button><button class="btn" data-action="add-profile" data-id="image">＋ 图片标签</button><button class="btn" data-action="add-profile" data-id="video">＋ 视频标签</button></div>');
 const meta=row('名片页面设置','这里只控制前台显示标题和公开网址，不会在名片中自动添加个人资料字段',
  '<details class="special-meta-details"><summary>修改名片页面标题、路径和展示设置</summary><div class="special-meta-inside">'+
   field('名片在首页显示的标题',x.title,'title','个人名片')+
   field('公开路径（slug）',x.slug,'slug','profile-xxx')+
   field('页面简介（可选）',x.description,'description','','textarea')+
   field('首页排序数字',x.sort_order,'sort_order','1000')+
  '</div></details>')+row('首页卡片图标与子分组','在这里直接选择展示图片，以及首页中所属的子分区。',subgroupPickerHtml(x)+coverPickerHtml(x));
 const aside='<aside class="editor-side"><strong>个人名片状态</strong><p class="small muted">'+(x.status==='published'?'已发布':'仅后台可见草稿')+'</p><p class="small muted">项目数：'+fields.length+'</p><p class="small muted">版本：'+x.version+'</p><p class="small muted wrap">/view/'+esc(x.slug||'保存后生成')+'</p></aside>';
 return '<div class="editor-grid"><div>'+items+meta+specialEditorActions(x)+'</div>'+aside+'</div>';
}

function editorHtml(){
 const x=S.edit;if(!x)return '<div class="empty">请先从列表中选择需要编辑的内容</div>';
 if(x.kind==='profile')return profileEditorHtml(x);
 if(x.kind==='document')return documentEditorHtml(x);
 if(x.kind==='html')return htmlEditorHtml(x);
 const c=x.content||(x.content={blocks:[],members:[]});
 const availableTypes=orderedCategoryIds(S.settings);if(!availableTypes.includes(x.kind))availableTypes.push(x.kind);
  const select='<select data-field="kind">'+availableTypes.map(t=>'<option '+(x.kind===t?'selected':'')+' value="'+esc(t)+'">'+esc(typeNames[t]||'原分类')+((S.settings?.deleted_types||[]).includes(t)?'（已删除，保留原内容）':'')+'</option>').join('')+'<option disabled>──────────</option><option value="__create_type__">＋ 新增分类…</option></select>';
 let main='<div class="admin-panel" style="margin-top:0"><div class="panel-head"><h2>基本信息</h2><span class="pill '+x.status+'">'+(x.status==='published'?'已发布':'草稿')+'</span></div><div class="two">'+field('标题',x.title,'title','例如：个人沟通流程')+'<div class="field"><label>内容类型</label>'+select+'</div></div>'+field('公开路径（slug）',x.slug,'slug','不填写时自动生成')+field('简介',x.description,'description','一句话介绍此内容','textarea')+'<div class="three">'+field('分类',x.category,'category','例如：客服')+field('标签（逗号分隔）',(x.tags||[]).join(', '),'tags','标签1, 标签2')+field('首页排序数字',x.sort_order,'sort_order','数字越小越靠前')+'</div>'+coverPickerHtml(x)+subgroupPickerHtml(x)+'</div>';
 if(x.kind==='bookmarks'){
  const entries=c.entries||(c.entries=[]);
  main+=row('网址收藏 · 可随时编辑和排序','新增网站、修改名称或网址、上传图标。发布后前台会显示为可点击的网站卡片',bookmarkEditorRows(entries)+'<div class="editor-add"><button class="btn green" data-action="add-bookmark">＋ 添加网址</button></div>');
 }else if(x.kind==='document'){
  main+=row('文档模板入口','可以填写完整旧工具链接，或在这里配置模板 ID',field('文档工作台 URL',c.docUrl||S.settings?.docx_url||'/docx','docUrl','/docx')+field('指定模板 ID（可选）',c.templateId||'','templateId','原工具 template 参数'));
 }else if(x.kind==='link'){
  main+=row('外部工具跳转','只支持 http/https 链接',field('目标网址',c.url||'','url','https://example.com'));
 }else{
  if(x.kind==='group')main+=row('剧本成员','用英文逗号或换行分隔；保持你原始导入的成员名称',field('成员名单（每行一个）',(c.members||[]).map(m=>m.name).join('\n'),'memberNames','成员1\n成员2','textarea'));
  main+=row('流程步骤','可以自由插入、修改、删除或调整顺序，编辑不会立即公开',
   '<div class="flex space"><strong>共 '+(c.blocks||[]).length+' 个步骤</strong><span class="tiny muted">每个步骤可以包含文本、双语、链接或附件</span></div>'+(c.blocks||[]).map((b,i)=>blockEditor(b,i,c.members||[])).join('')+
   '<div class="editor-add">'+Object.entries(blockNames).map(x=>'<button class="btn sm" data-action="add-block" data-id="'+x[0]+'">＋ '+x[1]+'</button>').join('')+'</div>');
 }
 main+='<div class="admin-panel"><div class="flex" style="flex-wrap:wrap"><button class="btn primary" data-action="save-item">保存草稿 / 修改</button><button class="btn green" data-action="publish-item">'+(x.status==='published'?'保存并继续发布':'保存并发布')+'</button><button class="btn" data-action="preview-item">预览</button>'+(x.id?'<button class="btn" data-action="revisions">历史版本</button><button class="btn danger" data-action="delete-item">删除内容</button>':'')+'</div></div>';
 const aside='<aside class="editor-side"><strong>内容设置</strong><div class="stack small muted" style="margin-top:15px"><div>状态：'+(x.status==='published'?'已公开':'未公开草稿')+'</div><div>步骤数：'+(c.blocks||[]).length+'</div><div>版本：'+x.version+'</div><div>公开地址：</div><div class="wrap">/view/'+esc(x.slug||'保存后生成')+'</div></div><div class="stack" style="margin-top:18px">'+(x.id?'<button class="btn sm" data-action="copy-current">复制访问链接</button>':'')+'<button class="btn sm" data-action="tab" data-id="assets">素材库</button></div></aside>';
 return '<div class="editor-grid"><div>'+main+'</div>'+aside+'</div>';
}
function blockEditor(b,i,members){
 const attr=(key,placeholder='',type='text')=>type==='textarea'?'<textarea data-block="'+i+'" data-bfield="'+key+'" placeholder="'+esc(placeholder)+'">'+esc(b[key]||'')+'</textarea>':'<input type="'+type+'" data-block="'+i+'" data-bfield="'+key+'" placeholder="'+esc(placeholder)+'" value="'+esc(b[key]??'')+'">';
 let fields='<div class="field"><label>步骤标题</label>'+attr('title','步骤名称')+'</div>';
 if(b.type==='bilingual'){
  fields+='<div class="cols"><div class="field"><label>中文话术</label>'+attr('zh','中文内容','textarea')+'</div><div class="field"><label>English</label>'+attr('en','English text','textarea')+'</div></div>';
 } else if(b.type==='wait'){
  fields+='<div class="cols"><div class="field"><label>等待秒数</label>'+attr('seconds','60','number')+'</div><div class="field"><label>备注</label>'+attr('text','操作说明')+'</div></div>';
 }else if(b.type==='button'){
  fields+='<div class="field"><label>按钮名称（使用步骤标题）</label></div><div class="field"><label>目标地址（https://）</label>'+attr('url','https://example.com')+'</div>'+fieldMiniText(b,i);
 }else if(b.type==='image'||b.type==='file'){
  fields+='<div class="field"><label>已选素材</label><input readonly value="'+esc(b.assetId||'未选择')+'"></div><button class="btn sm" data-action="pick-asset" data-id="'+i+'">从素材库选择图片 / 文件</button> '+(b.assetId?'<button class="btn sm" data-action="clear-asset" data-id="'+i+'">清除</button>':'')+fieldMiniText(b,i);
 }else fields+=fieldMiniText(b,i);
 if(members.length && ['bilingual','text'].includes(b.type))fields+='<div class="field"><label>说话成员</label><select data-block="'+i+'" data-bfield="speakerId"><option value="">无指定成员</option>'+members.map(m=>'<option value="'+esc(m.id)+'" '+(b.speakerId===m.id?'selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></div>';
 return '<div class="editor-row"><div class="body"><div class="kind">'+(i+1)+' · '+esc(blockNames[b.type]||b.type)+'</div>'+fields+'</div><div class="controls"><button class="icon-btn" data-action="move-block" data-dir="-1" data-id="'+i+'" title="上移">↑</button><button class="icon-btn" data-action="move-block" data-dir="1" data-id="'+i+'" title="下移">↓</button><button class="icon-btn" data-action="remove-block" data-id="'+i+'" title="删除">×</button></div></div>';
}
function fieldMiniText(b,i){return '<div class="field" style="margin-top:9px"><label>内容 / 说明</label><textarea data-block="'+i+'" data-bfield="text">'+esc(b.text||'')+'</textarea></div>'}

function htmlFilesHtml(){
 const files=S.assets.filter(a=>a.mime==='text/html');
 const used=id=>S.items.filter(x=>x.kind==='html'&&x.content?.htmlAssetId===id);
 const cards=files.map(a=>{
  const inUse=used(a.id),published=inUse.filter(x=>x.status==='published').length;
  const linked=inUse.length?'<span class="html-manager-tag">已关联 '+inUse.length+' 个卡片'+(published?' · 已发布 '+published+' 个':'')+'</span>':'<span class="html-manager-tag muted">尚未关联卡片</span>';
  return '<div class="html-manager-item asset-card" data-html-name="'+esc(a.name.toLocaleLowerCase())+'" data-html-id="'+esc(a.id)+'">'+
    '<div class="html-manager-item-main"><div class="html-manager-icon">▤</div><div class="html-manager-text"><strong title="'+esc(a.name)+'">'+esc(a.name)+'</strong>'+
    '<div class="muted tiny">'+Math.ceil(a.size/1024)+' KB · 上传于 '+esc(fmt(a.created_at)||'未知日期')+'</div><div>'+linked+'</div></div></div>'+
    '<div class="flex html-manager-buttons" style="flex-wrap:wrap">'+
    '<button class="btn sm" data-pkg="details" data-id="'+esc(a.id)+'">查看文件</button>'+
    '<button class="btn sm" data-pkg="code" data-id="'+esc(a.id)+'">查看源码</button>'+
    '<a class="btn sm" target="_blank" rel="noopener noreferrer" href="'+htmlUrl(a.id)+'">预览网页 ↗</a>'+
    '<button class="btn sm" data-pkg="source" data-id="'+esc(a.id)+'">下载 HTML</button>'+
    '<button class="btn sm green" data-pkg="download" data-id="'+esc(a.id)+'">打包下载 ZIP</button>'+
    '<button class="btn sm" data-pkg="rename" data-id="'+esc(a.id)+'">重命名</button>'+
    '<button class="btn sm" data-action="new-html-card" data-id="'+esc(a.id)+'">添加前台卡片</button>'+
    '<button class="btn sm" data-action="copy-html-asset" data-id="'+esc(a.id)+'">复制链接</button>'+
    '<button class="btn sm danger" data-action="delete-asset" data-id="'+esc(a.id)+'">删除</button></div></div>';
 }).join('');
 return '<div class="html-manager-page"><div id="mswqHtmlPkgMount"></div>'+
 row('上传独立 HTML','如果网页还有外部图标、图片、JS 或 CSS，请优先使用上方的 ZIP / 文件夹上传工具，避免缺少资源。',
  '<div class="field"><label>选择单独的 .html / .htm 文件（单文件最大 35MB）</label><input type="file" id="assetUpload" accept=".html,.htm,text/html" multiple></div>'+
  '<div class="flex" style="flex-wrap:wrap"><button class="btn primary" data-action="upload-assets">上传 HTML</button><span class="muted small">所有文件仍保存在原 MSWQ 文件库，不影响前台已发布的卡片。</span></div>')+
 row('已上传的 HTML 文件','包含以前上传的独立 HTML 和 ZIP / 文件夹工具包；下载 ZIP 会保留配套文件和相对目录结构。',
  '<div class="html-manager-head"><input id="mswqHtmlSearch" type="search" placeholder="搜索 HTML 文件名…" autocomplete="off" aria-label="搜索 HTML 文件"><span class="muted small" id="mswqHtmlCount">共 '+files.length+' 个 HTML 文件</span></div>'+
  '<div class="html-manager-list">'+(cards||'<div class="empty">还没有上传 HTML 文件，可在上方添加。</div>')+'</div>')+
 '</div>';
}
function iconsHtml(){
 const imgs=S.icons;
 return row('独立图标库','这里仅显示主动上传或从「文件素材」复制添加的图片。两边的新增和删除互不影响。',
  '<div class="field"><label>上传独立图片：PNG / JPG / WebP / GIF（单张最多12MB）</label>'+
  '<input type="file" id="iconUpload" accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" multiple></div>'+
  '<div class="flex" style="flex-wrap:wrap"><button class="btn green" data-action="upload-icons">上传到图标库</button>'+
   '<button class="btn" data-action="open-icon-import">＋ 从文件素材选择添加</button>'+
   '<span class="muted small">从素材库添加时复制出一个新文件，不共享删除操作。</span></div>')+
  row('我添加的图标','共 '+imgs.length+' 张 · 文件素材中的其他图片不会自动出现。',
   imgs.length?'<div class="icon-library-grid">'+imgs.map(a=>'<div class="icon-library-card">'+
     '<img src="'+iconPreview(a.id)+'" loading="lazy" alt="'+esc(a.name)+'">'+
     '<strong title="'+esc(a.name)+'">'+esc(a.name)+'</strong><div class="muted tiny">'+Math.ceil(a.size/1024)+' KB</div>'+
     '<div class="flex" style="flex-wrap:wrap;gap:6px">'+
     '<button class="btn sm" data-action="copy-icon-url" data-id="'+a.id+'">复制图片链接</button>'+
     '<a class="btn sm" href="'+iconPreview(a.id)+'?download=1" download>下载</a>'+
     '<button class="btn sm danger" data-action="delete-icon" data-id="'+a.id+'">删除</button></div></div>').join('')+'</div>':
    '<div class="empty">图标库还没有图片，上传新图片或者主动从文件素材复制一张。</div>');
}
function ipAccessHtml(){
 const data=S.ipAccess||{},ips=data.ips||[];
 return row('前端网站 IP 白名单','只有已添加 IP 能访问 MSWQ 前端及本站独立 HTML 工具，其他访问统一返回 403。',
  '<div class="notice"><strong>当前访问 IP：</strong><code>'+esc(data.currentIp||'无法识别')+'</code> '+
  '<button class="btn sm green" data-action="allow-my-ip" '+(!data.currentIp||ips.includes(data.currentIp)?'disabled':'')+'>＋ 将当前 IP 加入</button></div>'+
  '<div class="notice" style="margin-top:12px">白名单现有 '+ips.length+' 个 IP。'+(!ips.length?'当前尚无获准 IP，所有前端访问都会被拒绝。':'保存后立即生效，请先保留自己的 IP。')+
  ' 后台入口不受限制。当前后台为免密码模式，建议配置管理员登录验证。</div>'+
  '<div class="subgroup-add-row"><input id="allowedIpEntry" placeholder="输入 IPv4 或 IPv6，例如 203.0.113.10" spellcheck="false" autocomplete="off">'+
  '<button class="btn green" data-action="allow-ip">＋ 添加允许的 IP</button></div>'+
  '<div class="ip-allow-list">'+(ips.length?ips.map((ip,i)=>
   '<div class="ip-allow-row"><span class="ip-allow-count">'+(i+1)+'</span><code>'+esc(ip)+'</code>'+
   (ip===data.currentIp?'<span class="muted small">当前 IP</span>':'')+
   '<button class="btn sm danger" data-action="remove-ip" data-id="'+esc(ip)+'">移除</button></div>').join(''):
   '<div class="empty">目前没有允许访问的 IP，请先加入你的当前 IP。</div>')+'</div>')+
  row('规则说明','仅允许精确 IP；IPv4 和 IPv6 都支持。IP 改变时需要重新加入。',
   '<p class="small muted">拦截范围包括首页、内容页、DOCX 前端、公开 API、公开附件及独立 HTML 文件服务。后台与管理 API 可以继续使用。</p>');
}
function assetsHtml(){
 return row('素材库','此处管理一般图片、视频和附件；HTML 文件请进入左侧「HTML 文件管理」','<div class="field"><label>添加图片和文件（视频 50MB，其他 12MB）</label><input type="file" id="assetUpload" accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.pdf,.docx,.xlsx,.pptx,.txt,.zip" multiple></div><div class="flex"><button class="btn primary" data-action="upload-assets">上传文件</button><span class="muted small">文件保存在独立 R2 空间</span></div><hr style="border:0;border-top:1px solid #454648;margin:20px 0"><div class="asset-grid">'+S.assets.filter(a=>a.mime!=='text/html').map(a=>assetCard(a)).join('')+'</div>'+(S.assets.length?'':'<div class="empty">还没有上传素材</div>'));
}
function assetCard(a,picker=false){
 return '<div class="asset-card"><div class="asset-thumb">'+(a.mime?.startsWith('image/')?'<img loading="lazy" alt="" src="'+asset(a.id)+'">':a.mime?.startsWith('video/')?'<video muted playsinline preload="metadata" src="'+asset(a.id)+'"></video>':'<div style="font-size:32px">▤</div>')+'</div><strong title="'+esc(a.name)+'">'+esc(a.name)+'</strong><div class="tiny muted">'+Math.ceil(a.size/1024)+' KB</div><div class="flex" style="flex-wrap:wrap">'+(picker?'<button class="btn sm primary" data-action="select-asset" data-id="'+a.id+'">选择</button>':a.mime==='text/html'?'<button class="btn sm green" data-action="new-html-card" data-id="'+a.id+'">添加前台卡片</button><a class="btn sm" target="_blank" rel="noopener noreferrer" href="'+htmlUrl(a.id)+'">打开HTML</a><button class="btn sm" data-action="copy-html-asset" data-id="'+a.id+'">复制直达链接</button><button class="btn sm danger" data-action="delete-asset" data-id="'+a.id+'">删除</button>':'<button class="btn sm" data-action="copy-asset" data-id="'+a.id+'">复制链接</button><button class="btn sm danger" data-action="delete-asset" data-id="'+a.id+'">删除</button>')+'</div></div>';
}
function subgroupManagerHtml(){
 const types=orderedCategoryIds(S.settings).filter(id=>!(S.settings?.deleted_types||[]).includes(id));
 if(!types.includes(S.subgroupParent))S.subgroupParent=types[0]||'';
 const parent=S.subgroupParent,groups=subgroupsFor(parent);
 const rows=groups.map((g,i)=>{
  const count=S.items.filter(x=>frontTabForItem(x)===parent&&x.content?.subgroupId===g.id).length;
  return '<div class="subgroup-manage-row"><div class="subgroup-position">'+(i+1)+'</div><div class="subgroup-name">'+
   '<strong>'+esc(g.name)+'</strong><div class="muted tiny">'+count+' 个关联内容 · '+esc(typeNames[parent]||parent)+'</div></div>'+
   '<div class="flex" style="flex-wrap:wrap;gap:6px">'+
   '<button class="btn sm" data-action="move-subgroup" data-id="'+g.id+'" data-dir="-1" '+(!i?'disabled':'')+'>↑</button>'+
   '<button class="btn sm" data-action="move-subgroup" data-id="'+g.id+'" data-dir="1" '+(i===groups.length-1?'disabled':'')+'>↓</button>'+
   '<button class="btn sm" data-action="rename-subgroup" data-id="'+g.id+'">改名</button>'+
   '<button class="btn sm danger" data-action="delete-subgroup" data-id="'+g.id+'">删除</button></div></div>';
 }).join('');
 return row('子分组管理','每个主分类都可新增子分组。例如「制作文件」下面按调查报告、地址查询等区域显示，每个区域独立排列卡片。',
  '<div class="field"><label>选择主分类</label><select id="subgroupParent">'+
  types.map(t=>'<option value="'+esc(t)+'" '+(t===parent?'selected':'')+'>'+esc(typeNames[t]||t)+'</option>').join('')+'</select></div>'+
  '<div class="subgroup-add-row"><input id="subgroupNewName" maxlength="40" placeholder="新子分组名称，例如：资金调查报告">'+
  '<button class="btn green" data-action="add-subgroup" '+(parent?'':'disabled')+'>＋ 新建子分组</button></div>'+
  '<div class="subgroup-manage-list">'+(rows||'<div class="empty">暂时没有子分组。创建后到对应卡片编辑页选择其归属。</div>')+'</div>'+
  '<div class="muted small" style="margin-top:12px">删除子分组不会删除已有卡片，原卡片会归入未分组区域。</div>');
}
function categoryManagerHtml(){
 const hidden=new Set(S.settings?.hidden_types||[]),active=orderedCategoryIds(S.settings);
 const deleted=(S.settings?.deleted_types||[]).filter(id=>Object.hasOwn(typeNames,id));
 const rows=active.map((id,index)=>{
  const label=typeNames[id]||id,isCustom=id.startsWith('custom_'),count=S.items.filter(x=>x.kind===id).length,off=hidden.has(id);
  return '<div class="category-manage-row category-sortable" draggable="true" data-category-row="'+esc(id)+'">'+
   '<span class="category-drag-handle" title="按住拖动，调整分类顺序" aria-hidden="true">⠿</span>'+
   '<div class="category-manage-label"><strong>'+esc(label)+'</strong><div class="muted small">'+(isCustom?'自定义分类':'系统分类')+' · '+count+' 个内容 · '+(off?'前台已隐藏':'在前台显示')+'</div></div>'+
   '<div class="category-manage-actions">'+
   '<button class="btn sm" data-action="move-category" data-id="'+esc(id)+'" data-dir="-1" '+(index===0?'disabled':'')+' title="上移分类">↑</button>'+
   '<button class="btn sm" data-action="move-category" data-id="'+esc(id)+'" data-dir="1" '+(index===active.length-1?'disabled':'')+' title="下移分类">↓</button>'+
   '<button class="btn sm" data-action="rename-category" data-id="'+esc(id)+'">编辑名称</button>'+
   '<button class="btn sm '+(off?'green':'')+'" data-action="toggle-category-visibility" data-id="'+esc(id)+'" data-hidden="'+(off?'0':'1')+'">'+(off?'恢复显示':'隐藏前台')+'</button>'+
   '<button class="btn sm danger" data-action="delete-category" data-id="'+esc(id)+'">删除分类</button>'+
   '</div></div>';
 }).join('');
 const removed=deleted.map(id=>'<div class="category-manage-row category-deleted-row"><div class="category-manage-label"><strong>'+esc(typeNames[id])+'</strong><div class="muted small">已从筛选栏和新建分类选项移除 · 原有内容仍可通过“全部内容”访问</div></div><div class="category-manage-actions">'+
 '<button class="btn sm" data-action="rename-category" data-id="'+esc(id)+'">编辑名称</button>'+
 '<button class="btn sm green" data-action="restore-category" data-id="'+esc(id)+'">恢复分类</button></div></div>').join('');
 return row('自由分类管理','支持所有分类拖动排序、上移、下移、改名、隐藏和删除，变更后前台立即更新。',
  '<div class="category-manage-top"><button class="btn green" data-action="new-category">＋ 新增分类</button><span class="muted small">拖动左侧 ⠿ 图标所在行即可重新排列，顺序同步到前台筛选栏。</span></div>'+
  '<div class="notice">删除分类只移除分类入口，不会删除名片、DOCX、流程等原有内容或已分享链接。已删除分类可在下方随时恢复；“全部内容”始终保留。</div>'+
  '<div class="category-manager-list">'+(rows||'<div class="empty">暂无启用分类，可从下方恢复或新增。</div>')+'</div>'+
  '<details class="category-restore-panel"><summary>已删除分类（'+deleted.length+'） · 点击展开恢复</summary>'+
  '<div class="category-manager-list">'+(removed||'<div class="muted small">还没有删除的分类</div>')+'</div></details>')+subgroupManagerHtml();
}
function settingsHtml(){
 const s=S.settings||{};
 return row('首页文案与展示','只影响本站的公开首页，不会覆盖任何旧系统',
  field('网站名称',s.brand,'brand')+field('首页大标题',s.headline,'headline')+field('首页说明',s.description,'description','','textarea')+field('公告（可留空）',s.announcement,'announcement','','textarea')+field('页脚版权文字',s.footer,'footer')+'<div class="field"><label>公开首页布局</label><select data-field="layout"><option value="grid" '+(s.layout==='grid'?'selected':'')+'>标准卡片</option><option value="compact" '+(s.layout==='compact'?'selected':'')+'>紧凑四列</option><option value="list" '+(s.layout==='list'?'selected':'')+'>横向列表</option></select></div>'+field('DOCX 公开工作台路径',s.docx_url,'docx_url')+'<button class="btn" data-action="tab" data-id="categories">管理首页分类筛选栏 →</button><div class="notice">MSWQ 的 DOCX 公开页面已去除管理员按钮，并通过只读接口加载原模板。模板增删、原文编辑仍需在原有文档后台操作，后续可完整迁移到 MSWQ。</div><button class="btn green" data-action="save-settings">保存网站设置</button>');
}
function importHtml(){
 return row('导入旧版流程','从上传的原始编辑器导出「编辑备份 JSON」，再上传到这里',
 '<div class="notice">支持「群剧本」和「个人流程」两种 JSON。导入后默认是草稿，不会直接对外公开。包含的附件会尽可能导入到本站文件库。</div><div class="field" style="margin-top:15px"><label>选择 .json 备份文件</label><input type="file" id="importFile" accept=".json,application/json"></div><button class="btn primary" data-action="import-json">导入到草稿库</button><hr style="border:0;border-top:1px solid #444;margin:25px 0"><h3>平台数据备份</h3><p class="small muted">导出内容、设置和页面结构为 JSON。媒体文件需要另外保留，导出的 JSON 不含媒体二进制内容。</p><button class="btn" data-action="export-all">导出本站完整 JSON</button><p style="margin-top:20px" class="small muted">目前支持的直接导入格式为原版流程备份；本站 JSON 主要用于恢复依据，不提供一键整体恢复。</p>');
}
async function refreshPanel(){if(!S.admin)return;await loadAdmin();adminRender()}
async function loadAssets(){const x=await api('/api/admin/assets');S.assets=x.assets}
async function loadIcons(){const x=await api('/api/admin/icons');S.icons=x.icons||[]}
async function loadIpAccess(){const x=await api('/api/admin/ip-access');S.ipAccess=x}
async function reorderCategory(source,target,step=0){
 const order=orderedCategoryIds(S.settings),from=order.indexOf(source);
 const to=target?order.indexOf(target):from+step;
 if(from<0||to<0||to>=order.length||from===to)return;
 order.splice(from,1);order.splice(to,0,source);
 const result=await api('/api/admin/types/order',{method:'PUT',...jsonBody({order})});
 S.settings.type_order=result.type_order;adminRender();toast('分类顺序已保存，前台已同步');
}

async function reorderContent(source,target,step=0){
 if(S.search.trim())return toast('请先清空搜索，再调整完整顺序');
 const current=S.items.find(item=>item.id===source);
 if(!current)return toast('内容已更新，请刷新后重试');
 const category=frontTabForItem(current),items=S.items.filter(item=>frontTabForItem(item)===category);
 const allowed=new Set(subgroupsFor(category).map(g=>g.id));
 const scopeFor=x=>allowed.has(x.subgroupId)?x.subgroupId:'';
 const scope=scopeFor(current),subset=items.filter(x=>scopeFor(x)===scope);
 const groupIds=subset.map(x=>x.id),from=groupIds.indexOf(source),to=target?groupIds.indexOf(target):from+step;
 if(from<0||to<0||to>=groupIds.length||from===to)return;
 groupIds.splice(from,1);groupIds.splice(to,0,source);
 // Preserve other subgroups' slots; only reorder within the chosen group.
 const order=items.map(item=>item.id);
 const targetSlots=items.map((item,i)=>scopeFor(item)===scope?i:-1).filter(i=>i>=0);
 targetSlots.forEach((index,i)=>{order[index]=groupIds[i]});
 const versions=Object.fromEntries(items.map(item=>[item.id,item.version]));
 await api('/api/admin/items/order',{method:'PUT',...jsonBody({category,order,versions})});
 await loadAdmin();
 const panel=$('#adminPanel');if(panel)panel.innerHTML=adminPanel();else adminRender();
 toast('组内排序已保存，前台已同步');
}
async function assignContentSubgroup(id,category,targetSubgroup){
 if(S.search.trim())return toast('请先清空搜索后移动工具');
 const current=S.items.find(item=>item.id===id);
 if(!current||frontTabForItem(current)!==category)throw Error('只能在同一主分类内移动工具');
 const allowed=new Set(subgroupsFor(category).map(g=>g.id));
 if(targetSubgroup&&!allowed.has(targetSubgroup))throw Error('目标子分组已不存在，请刷新页面');
 const existing=current.subgroupId||'';
 if(existing===targetSubgroup)return;
 await api('/api/admin/items/subgroup',{method:'PUT',...jsonBody({
  itemId:id,subgroupId:targetSubgroup,expectedSubgroupId:existing
 })});
 // Replace only the content area; keep the current tab, page position and links.
 const scroller=document.querySelector('.admin-main'),scrollTop=scroller?.scrollTop||0;
 await loadAdmin();
 const panel=$('#adminPanel');if(panel)panel.innerHTML=adminPanel();else adminRender();
 if(scroller)scroller.scrollTop=scrollTop;
 toast('工具已移入'+(targetSubgroup?'「'+subgroupTitle(targetSubgroup)+'」':'「其他内容」')+'，前台同步更新');
}
async function perform(action,id,el){
 switch(action){
 case 'filter':{
 S.filter=id;
 history.replaceState({...history.state,mswqHomeFilter:id},'',location.href);
 if(id==='bookmarks'&&!S.bookmarksLoaded){
  S.bookmarksError='';homeRender();
  try{await loadPublicBookmarks();}catch(err){S.bookmarksError=err.message;}
 }
 homeRender();break;
}
case 'retry-bookmarks':{
 S.bookmarksError='';homeRender();
 try{await loadPublicBookmarks();}catch(err){S.bookmarksError=err.message;}
 homeRender();break;
}
 case 'jump':document.getElementById('step-'+id)?.scrollIntoView({behavior:'smooth'});break;
 case 'copy-text':{
  const block=(S.viewer?.content?.blocks||[]).find(b=>b.id===id);
  await navigator.clipboard.writeText(String(block?.[el.dataset.lang]||''));toast('已复制');break;
 }
 case 'countdown':{
  const display=$('#timer-'+id),btn=el;let sec=Number(btn.dataset.seconds)||60;
  if(btn._interval){clearInterval(btn._interval);btn._interval=null;btn.textContent='重新开始';break}
  btn.textContent='停止';display.textContent=sec+' 秒';
  btn._interval=setInterval(()=>{sec--;if(display)display.textContent=(sec>0?sec:0)+' 秒';if(sec<=0){clearInterval(btn._interval);btn._interval=null;btn.textContent='重新开始';toast('等待结束')}},1000);break;
 }
 case 'back-edit':S.tab='editor';S.preview=false;adminRender();break;
 case 'library-filter':{
  S.libraryCategory=id;
  const panel=$('#adminPanel');if(panel)panel.innerHTML=adminPanel();else adminRender();
  break;
 }
 case 'add-subgroup':{
  const name=($('#subgroupNewName')?.value||'').trim(),category=S.subgroupParent;
  if(!name)return toast('请输入子分组名称');
  if(name.length>40)return toast('名称不能超过 40 字');
  await saveSubgroups([...(S.settings.subgroups||[]),{id:crypto.randomUUID(),category,name}],'子分组已创建');break;
 }
 case 'rename-subgroup':{
  const list=S.settings.subgroups||[],old=list.find(g=>g.id===id);
  if(!old)break;
  const name=prompt('修改子分组名称',old.name)?.trim();
  if(!name||name===old.name)break;
  await saveSubgroups(list.map(g=>g.id===id?{...g,name}:g),'子分组名称已更新');break;
 }
 case 'delete-subgroup':{
  const list=S.settings.subgroups||[],old=list.find(g=>g.id===id);
  if(!old||!confirm('删除子分组「'+old.name+'」？组内卡片不会删除，会进入未分组区域。'))break;
  await saveSubgroups(list.filter(g=>g.id!==id),'子分组已删除，原卡片保留');break;
 }
 case 'move-subgroup':{
  const all=[...(S.settings.subgroups||[])],idx=all.findIndex(g=>g.id===id);
  if(idx<0)break;
  const same=all.map((g,i)=>({g,i})).filter(x=>x.g.category===all[idx].category),pos=same.findIndex(x=>x.i===idx),target=same[pos+Number(el.dataset.dir)];
  if(!target)break;
  [all[idx],all[target.i]]=[all[target.i],all[idx]];
  await saveSubgroups(all,'子分组顺序已保存');break;
 }
 case 'move-content':await reorderContent(id,null,Number(el.dataset.dir));break;
 case 'tab':{
  S.tab=id;S.edit=null;
  if(location.pathname==='/admin')history.replaceState(null,'',id==='dashboard'?'/admin':'/admin?tab='+encodeURIComponent(id));
  if(['assets','html-files'].includes(id))await loadAssets();
  if(id==='icons')await loadIcons();
  if(id==='ip-access')await loadIpAccess();
  adminRender();break;
 }
 case 'go-html-upload':closeModal();S.tab='html-files';await loadAssets();history.replaceState(null,'','/admin?tab=html-files');adminRender();break;
 case 'new-html-card':await showQuickHtmlCreate(id||'');break;
 case 'publish-html-quick':{
  const htmlAssetId=$('#quickHtmlAsset')?.value||'',title=($('#quickHtmlTitle')?.value||'').trim(),category=$('#quickHtmlCategory')?.value||'';
  if(!S.assets.some(a=>a.id===htmlAssetId&&a.mime==='text/html'))return toast('请选择文件库中已上传的 HTML');
  if(!title)return toast('请填写卡片名称');
  if(!category)return toast('请选择前台分类');
  el.disabled=true;
  try{
   const body={kind:'html',status:'published',title,category,description:($('#quickHtmlDescription')?.value||'').trim(),sort_order:1000,
    slug:'html-'+crypto.randomUUID().replace(/-/g,'').slice(0,16),content:{htmlAssetId},tags:[]};
   const result=await api('/api/admin/items',{method:'POST',...jsonBody(body)});
   closeModal();await loadAdmin();S.tab='library';adminRender();
   openModal('<h2>HTML 卡片已发布</h2><p>「'+esc(title)+'」已经放在「'+esc(typeNames[category]||category)+'」分类。点击卡片会在新标签页打开完整 HTML 页面。</p><div class="flex end"><button class="btn" data-action="copy-html-asset" data-id="'+esc(htmlAssetId)+'">复制直达链接</button><a class="btn green" href="'+esc(shareUrl(result.item))+'" target="_blank" rel="noopener noreferrer">打开完整页面</a><button class="btn" data-action="close-modal">完成</button></div>');
  }finally{el.disabled=false;}
  break;
 }
 case 'open-docx-create':await showQuickDocxCreate();break;
 case 'publish-docx-quick':{
  const name=($('#quickDocxTitle')?.value||'').trim(),templateId=$('#quickDocxTemplate')?.value||'';
  if(!name)return toast('请填写前台名称，例如：制作文件');
  if(!S.docxTemplates.some(t=>t.id===templateId))return toast('请从现有模板中选择一个文件');
  let category=$('#quickDocxCategory')?.value||'';
  if(category==='__new_category__'&&!($('#quickDocxNewCategoryName')?.value||'').trim())return toast('请填写新分类名称');
  if(category!=='__new_category__'&&(!orderedCategoryIds(S.settings).includes(category)||(S.settings?.hidden_types||[]).includes(category)))return toast('请选择前台可显示的分类');
  const btn=el;btn.disabled=true;btn.textContent='正在发布…';
  try{
   if(category==='__new_category__'){
    const createdType=await api('/api/admin/types',{method:'POST',...jsonBody({name:$('#quickDocxNewCategoryName').value.trim()})});
    S.settings.custom_types=createdType.custom_types;S.settings.type_order=createdType.type_order;applyCustomTypes(S.settings);
    category=createdType.type.id;
   }
   const item={kind:'document',status:'published',title:name,slug:'docx-'+crypto.randomUUID().replace(/-/g,'').slice(0,16),
    description:'',category,tags:[],sort_order:1000,thumbnail:'',
    content:{docUrl:'/docx',templateId,blocks:[],members:[]}};
   const created=await api('/api/admin/items',{method:'POST',...jsonBody(item)});
   await loadAdmin();S.tab='library';adminRender();
   const fullUrl=location.origin+itemHref(created.item);
   openModal('<h2>DOCX 入口已发布</h2><p>「'+esc(name)+'」已出现在前台「'+esc(typeNames[category]||'所选分类')+'」标签中，点击即可直达选中的模板。</p>'+
    '<div class="field"><label>自动生成的前台链接</label><input readonly value="'+esc(fullUrl)+'"></div>'+
    '<div class="flex end"><button class="btn" data-action="close-modal">关闭</button>'+
    '<button class="btn primary" data-action="copy-link-url" data-url="'+esc(fullUrl)+'">复制链接</button>'+
    '<a class="btn green" href="'+esc(fullUrl)+'" target="_blank" rel="noopener noreferrer">打开前台</a></div>');
   toast('DOCX 入口「'+name+'」已发布');
  }finally{btn.disabled=false;btn.textContent='保存并发布';}
  break;
 }
 case 'new-item':newItem();break;
 case 'new-special':newItem(id);break;
 case 'edit-item':S.returnTab=S.tab;S.edit=structuredClone(S.items.find(x=>x.id===id));S.tab='editor';if(S.edit?.kind==='document'){await loadDocxTemplates();S.edit.category=S.edit.category||defaultDocxCategory();}if(S.edit?.kind==='html')await loadAssets();adminRender();break;
 case 'add-block':S.edit.content.blocks.push(blankBlock(id));adminRender();break;
 case 'remove-block':S.edit.content.blocks.splice(Number(id),1);adminRender();break;
 case 'move-block':{
  const i=Number(id),j=i+Number(el.dataset.dir),arr=S.edit.content.blocks;
  if(j>=0&&j<arr.length){[arr[i],arr[j]]=[arr[j],arr[i]];adminRender();}break;
 }
 case 'clear-asset':S.edit.content.blocks[Number(id)].assetId='';adminRender();break;
 case 'add-bookmark':(S.edit.content.entries||(S.edit.content.entries=[])).push({id:crypto.randomUUID(),title:'',url:'',note:'',assetId:''});adminRender();break;
 case 'remove-bookmark':S.edit.content.entries.splice(Number(id),1);adminRender();break;
 case 'move-bookmark':{
  const arr=S.edit.content.entries,i=Number(id),j=i+Number(el.dataset.dir);
  if(j>=0&&j<arr.length)[arr[i],arr[j]]=[arr[j],arr[i]];
  adminRender();break;
 }
 case 'add-profile':
  (S.edit.content.fields||(S.edit.content.fields=[])).push({id:crypto.randomUUID(),type:['text','link','image','video'].includes(id)?id:'text',label:'',value:'',assetId:''});
  adminRender();break;
 case 'remove-profile':S.edit.content.fields.splice(Number(id),1);adminRender();break;
 case 'move-profile':{
  const arr=S.edit.content.fields,i=Number(id),j=i+Number(el.dataset.dir);
  if(j>=0&&j<arr.length)[arr[i],arr[j]]=[arr[j],arr[i]];
  adminRender();break;
 }
 case 'pick-special-image':{
  const collection=el.dataset.collection,media=el.dataset.media==='video'?'video':'image';
  if(!['entries','fields'].includes(collection))break;
  S.picking={collection,index:Number(id),media};await loadAssets();
  const candidates=S.assets.filter(a=>a.mime?.startsWith(media+'/'));
  openModal('<h2>选择'+(media==='video'?'视频':'图片')+'</h2><p class="muted small">从已经上传的文件中选择。</p>'+
   (candidates.length?'<div class="asset-grid">'+candidates.map(a=>assetCard(a,true)).join('')+'</div>':'<div class="empty">素材库还没有'+(media==='video'?'视频':'图片')+'，可以在编辑区直接上传。</div>')+
   '<div class="flex" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-action="close-modal">取消</button></div>');
  break;
 }
 case 'clear-special-image':{
  const collection=el.dataset.collection,index=Number(id);
  if(['entries','fields'].includes(collection)&&S.edit.content[collection]?.[index])S.edit.content[collection][index].assetId='';
  adminRender();break;
 }
 case 'media-preview':openMediaPreview(id,el.dataset.media,el.dataset.title);break;
 case 'close-media-preview':document.getElementById('mediaPreview')?.remove();break;
 case 'copy-bookmark':{
  const url=el.dataset.url||S.viewer?.content?.entries?.find(e=>e.id===id)?.url||'';
  if(!absoluteHttpUrl(url))return toast('没有可复制的有效网址');
  await navigator.clipboard.writeText(url);toast('网址已复制');break;
 }
 case 'copy-link-url':await navigator.clipboard.writeText(el.dataset.url||'');toast('链接已复制');break;
 case 'copy-profile':{
  const f=S.viewer?.content?.fields?.find(f=>f.id===id);
  if(f){await navigator.clipboard.writeText(String(f.value||''));toast('内容已复制');}break;
 }
 case 'toggle-category-visibility':{
  const hidden=el.dataset.hidden==='1',label=typeNames[id]||id;
  const updated=await api('/api/admin/types/visibility',{method:'PUT',...jsonBody({id,hidden})});
  S.settings.hidden_types=updated.hidden_types;
  adminRender();toast(hidden?'已隐藏「'+label+'」的前台分类按钮':'已恢复「'+label+'」的分类按钮');
  break;
 }
 case 'new-category':
  openModal('<h2>＋ 新增分类</h2><div class="field"><label>分类名称</label><input id="customTypeName" maxlength="30" placeholder="输入新分类名称"></div><div class="flex end"><button class="btn" data-action="close-modal">取消</button><button class="btn green" data-action="create-custom-type">保存分类</button></div>');
  $('#customTypeName')?.focus();break;
 case 'move-category':
  await reorderCategory(id,null,Number(el.dataset.dir));break;
 case 'rename-category':{
  if(!Object.hasOwn(typeNames,id))return toast('分类不存在');
  openModal('<h2>编辑分类名称</h2><p class="muted small">修改后会同步更新前台筛选名称，不改变内容类型和已有链接。</p><div class="field"><label>分类名称</label><input id="categoryRenameInput" maxlength="30" value="'+esc(typeNames[id])+'"></div><div class="flex end"><button class="btn" data-action="close-modal">取消</button><button class="btn green" data-action="save-category-name" data-id="'+esc(id)+'">保存名称</button></div>');
  $('#categoryRenameInput')?.focus();$('#categoryRenameInput')?.select();break;
 }
 case 'save-category-name':{
  const name=($('#categoryRenameInput')?.value||'').trim();
  if(!name||name.length>30)return toast('分类名称须为1至30个字符');
  const result=await api('/api/admin/types/name',{method:'PUT',...jsonBody({id,name})});
  S.settings.custom_types=result.custom_types;
  S.settings.type_labels=result.type_labels;
  applyCustomTypes(S.settings);
  closeModal();adminRender();toast('分类名称已保存');break;
 }
 case 'delete-category':{
  const count=S.items.filter(x=>x.kind===id).length;
  if(!Object.hasOwn(typeNames,id))return toast('分类不存在');
  if(!confirm('确定删除分类「'+typeNames[id]+'」吗？\n\n该分类会从前台筛选栏和新建分类菜单移除。'+(count?'已有的 '+count+' 个内容':'')+'不会被删除，已分享的链接继续有效，可从“已删除分类”恢复。'))break;
  const result=await api('/api/admin/types/'+encodeURIComponent(id),{method:'DELETE'});
  S.settings.deleted_types=result.deleted_types;
  S.settings.type_order=result.type_order;
  adminRender();toast('分类已删除，原有内容保留');break;
 }
 case 'restore-category':{
  const result=await api('/api/admin/types/restore',{method:'PUT',...jsonBody({id})});
  S.settings.deleted_types=result.deleted_types;
  S.settings.hidden_types=result.hidden_types;
  S.settings.type_order=result.type_order;
  adminRender();toast('分类已恢复并显示在前台');break;
 }
 case 'create-custom-type':{
  const name=($('#customTypeName')?.value||'').trim();
  if(!name||name.length>30)return toast('分类名称须为1至30个字符');
  const result=await api('/api/admin/types',{method:'POST',...jsonBody({name})});
  S.settings.custom_types=result.custom_types;
  S.settings.type_order=result.type_order;
  applyCustomTypes(S.settings);
  if(S.edit)S.edit.kind=result.type.id;
  closeModal();adminRender();toast('分类「'+name+'」已新增');break;
 }
 case 'save-item':await saveCurrent(false);break;
 case 'publish-item':await saveCurrent(true);break;
 case 'quick-status':{
  const original=S.items.find(x=>x.id===id),item=structuredClone(original);item.status=item.status==='published'?'draft':'published';
  await api('/api/admin/items/'+id,{method:'PUT',...jsonBody(item)});await refreshPanel();toast(item.status==='published'?'内容已发布':'内容已下架');break;
 }
 case 'copy-url':
  await navigator.clipboard.writeText(shareUrl(S.items.find(x=>x.id===id)));toast('公开链接已复制');break;
 case 'copy-current':{
  await navigator.clipboard.writeText(shareUrl(S.edit));toast('链接已复制');break;
 }
 case 'preview-item':
  if(!S.edit)return;
  if(S.edit.kind==='html'){const direct=shareUrl(S.edit);if(direct)window.open(direct,'_blank','noopener,noreferrer');else toast('请选择 HTML 文件');break;}
  await showReader(S.edit.slug,S.edit);break;
 case 'delete-item':{
  if(!S.edit?.id||!confirm('确定永久删除「'+S.edit.title+'」？删除后公开链接将失效。'))return;
  await api('/api/admin/items/'+S.edit.id,{method:'DELETE'});S.edit=null;S.tab=S.returnTab||'library';await refreshPanel();toast('已删除');break;
 }
 case 'revisions':{
  const data=await api('/api/admin/revisions?id='+encodeURIComponent(S.edit.id));
  openModal('<h2>历史版本</h2><p>最近的30次修改记录。恢复会创建一个新版本。</p>'+data.revisions.map(v=>'<div class="flex space" style="margin:10px 0"><span>v'+v.version+' · '+fmt(v.created_at)+'</span><button class="btn sm" data-action="restore" data-id="'+v.id+'">恢复此版本</button></div>').join('')+'<button class="btn" data-action="close-modal">关闭</button>');break;
 }
 case 'restore':{
  if(!confirm('恢复历史版本将覆盖当前内容，继续吗？'))return;
  const v=await api('/api/admin/restore',{method:'POST',...jsonBody({id})});
  S.edit=v.item;closeModal();await loadAdmin();adminRender();toast('已恢复历史版本');break;
 }
 case 'pick-asset':S.picking=Number(id);await loadAssets();openModal('<h2>选择文件</h2><p>从已上传的素材库选择</p><div class="asset-grid">'+S.assets.map(a=>assetCard(a,true)).join('')+'</div><div style="margin-top:15px"><button class="btn" data-action="close-modal">取消</button></div>');break;
 case 'select-asset':
  if(S.picking&&typeof S.picking==='object'){
   const item=S.edit?.content?.[S.picking.collection]?.[S.picking.index];
   if(item)item.assetId=id;
  }else S.edit.content.blocks[S.picking].assetId=id;
  S.picking=null;closeModal();adminRender();break;
 case 'close-modal':closeModal();break;
 case 'copy-asset':await navigator.clipboard.writeText(location.origin+publicAsset(id));toast('素材链接已复制');break;
 case 'pick-cover':{
  await loadIcons();
  const imgs=S.icons;
  openModal('<h2>选择卡片封面 / 图标</h2><p class="muted small">选择之后请保存卡片，前台会使用这张图片。</p>'+
    (imgs.length?'<div class="icon-picker-grid">'+imgs.map(a=>'<button type="button" class="icon-picker-item" data-action="select-cover" data-id="'+a.id+'"><img src="'+iconPreview(a.id)+'" loading="lazy" alt=""><span>'+esc(a.name)+'</span></button>').join('')+'</div>':'<div class="empty">图标库还没有图片。可以在编辑页面直接上传，或去左侧「图标管理」。</div>')+
    '<div class="flex end" style="margin-top:12px"><button class="btn" data-action="close-modal">取消</button></div>');
  break;
 }
 case 'select-cover':if(S.edit){S.edit.thumbnail=icon(id);closeModal();adminRender();toast('封面已选择，请点击保存');}break;
 case 'clear-cover':if(S.edit){S.edit.thumbnail='';adminRender();}break;
 case 'copy-html-asset':await navigator.clipboard.writeText(htmlUrl(id));toast('HTML 直达链接已复制');break;
 case 'delete-asset':
  if(!confirm('确认删除这个文件？'))return;
  await api('/api/admin/assets/'+id,{method:'DELETE'});await loadAssets();adminRender();toast('文件已删除');break;
 case 'copy-icon-url':await navigator.clipboard.writeText(location.origin+icon(id));toast('独立图标链接已复制');break;
 case 'delete-icon':
  if(!confirm('确认删除这张独立图标？「文件素材」中的任何图片都不会受影响。'))break;
  await api('/api/admin/icons/'+encodeURIComponent(id),{method:'DELETE'});
  await loadIcons();adminRender();toast('仅从独立图标库删除');break;
 case 'open-icon-import':{
  await loadAssets();const imgs=S.assets.filter(a=>a.mime?.startsWith('image/'));
  openModal('<h2>从文件素材复制到图标库</h2><p class="muted small">选中的图片会独立复制一份，两个库删除操作互不影响。</p>'+
   (imgs.length?'<div class="icon-picker-grid">'+imgs.map(a=>'<button class="icon-picker-item" data-action="import-icon" data-id="'+a.id+'"><img src="'+asset(a.id)+'" loading="lazy" alt=""><span>'+esc(a.name)+'</span></button>').join('')+'</div>':'<div class="empty">文件素材中没有图片。</div>')+
   '<div class="flex end" style="margin-top:10px"><button class="btn" data-action="close-modal">取消</button></div>');break;
 }
 case 'import-icon':
  el.disabled=true;
  try{
   await api('/api/admin/icons/import',{method:'POST',...jsonBody({assetId:id})});
   closeModal();await loadIcons();adminRender();toast('已复制到独立图标库，原文件素材未修改');
  }finally{el.disabled=false;}
  break;
 case 'allow-my-ip':
  if(S.ipAccess.currentIp)await saveAllowedIps([...(S.ipAccess.ips||[]),S.ipAccess.currentIp]);
  break;
 case 'allow-ip':{
  const ip=$('#allowedIpEntry')?.value?.trim();
  if(!ip)return toast('请输入允许的 IP');
  if((S.ipAccess.ips||[]).includes(ip))return toast('该 IP 已在白名单中');
  await saveAllowedIps([...(S.ipAccess.ips||[]),ip]);break;
 }
 case 'remove-ip':
  if(!confirm('确认移除 '+id+'？该 IP 将立即失去前端访问权限。'))break;
  await saveAllowedIps((S.ipAccess.ips||[]).filter(ip=>ip!==id));break;
 case 'upload-assets':await uploadAssets();break;
 case 'upload-icons':await uploadIcons();break;
 case 'save-settings':{
  const data=await api('/api/admin/settings',{method:'PUT',...jsonBody(S.settings)});
  S.settings=data.settings;adminRender();toast('首页设置已保存');break;
 }
 case 'import-json':await importJSON();break;
 case 'export-all':{
  const data=await api('/api/admin/export');
  download('MSWQ-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(data,null,2),'application/json');break;
 }
 default:break;
 }
}
async function saveCurrent(publish){
 if(!S.edit)return;
 const item=structuredClone(S.edit);if(publish)item.status='published';
 if(!item.title.trim())return toast('请填写标题');
 if(['link','document'].includes(item.kind)){
  const link=item.kind==='link'?item.content.url:item.content.docUrl;
  if(link&&!urlOk(link))return toast('链接地址必须以 https:// 或 http:// 开头');
 }
 if(item.kind==='html'){
   if(!htmlUrl(item.content?.htmlAssetId))return toast('请先选择已上传 HTML 文件');
   if(!orderedCategoryIds(S.settings).includes(item.category)||(S.settings?.hidden_types||[]).includes(item.category))return toast('请选择有效且未隐藏的前台分类');
  }
  if(item.kind==='document'){
  if(!S.docxTemplatesReady)await loadDocxTemplates();
  if(!S.docxTemplates.some(t=>t.id===item.content?.templateId))return toast('请选择一个现有 DOCX 模板');
  item.content.docUrl=item.content.docUrl||'/docx';
  if(!orderedCategoryIds(S.settings).includes(item.category)||(S.settings?.hidden_types||[]).includes(item.category))return toast('请选择前台可显示的分类');
 }
 if(item.kind==='bookmarks'){
  const entries=item.content.entries||[];
  if(publish&&!entries.length)return toast('请先添加至少一个收藏网址');
  for(const e of entries){
   if(e.url&&!absoluteHttpUrl(e.url))return toast('网址必须包含 https:// 或 http://');
   if(publish&&(!e.title?.trim()||!e.url?.trim()))return toast('发布前请填写每条网址的名称和完整链接');
  }
 }
 if(item.kind==='profile'){
  for(const f of item.content.fields||[])if(f.type==='link'&&f.value&&!absoluteHttpUrl(f.value))return toast('名片中的链接必须包含 https:// 或 http://');
 }
 const isUpdate=!!item.id;
 const opts={method:isUpdate?'PUT':'POST',...jsonBody(item)};
 const res=await api('/api/admin/items'+(isUpdate?'/'+item.id:''),opts);
 S.edit=res.item;await loadAdmin();adminRender();toast(publish?'已发布，公开页面立即生效':'内容已保存');
}
async function saveSubgroups(next,message){
 const data=await api('/api/admin/settings',{method:'PUT',...jsonBody({subgroups:next})});
 S.settings=data.settings;adminRender();toast(message||'子分组已保存，前台已同步');
}
async function uploadIcons(){
 const files=[...($('#iconUpload')?.files||[])];
 if(!files.length)return toast('请先选择图片');
 const allowed={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'};
 let count=0;
 for(const f of files){
  const mime=allowed[f.name.split('.').pop().toLowerCase()];
  if(!mime||f.size>12000000||!f.size){toast('跳过不支持或超过12MB的图片：'+f.name);continue}
  await api('/api/admin/icons',{method:'POST',headers:{'content-type':mime,'x-file-name':encodeURIComponent(f.name)},body:await f.arrayBuffer()});
  count++;
 }
 await loadIcons();adminRender();toast('图标库新增 '+count+' 张图片，文件素材未改变');
}
async function saveAllowedIps(ips){
 const next=await api('/api/admin/ip-access',{method:'PUT',...jsonBody({ips})});
 S.ipAccess=next;adminRender();toast('IP 白名单已生效');
}
async function uploadAssets(){
 const input=$('#assetUpload'),files=[...(input?.files||[])];
 if(!files.length)return toast('请先选择文件');
 let success=0;
 for(const file of files){
  const limit=/\.(?:mp4|webm)$/i.test(file.name)||file.type.startsWith('video/')?50000000:/\.html?$/i.test(file.name)?35000000:12000000;
  if(file.size>limit){toast('文件超过'+(limit===50000000?'50MB':limit===35000000?'35MB':'12MB')+': '+file.name);continue}
  let mime=file.type;
  if(!mime){const ext=file.name.split('.').pop().toLowerCase();mime={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',mp4:'video/mp4',webm:'video/webm',txt:'text/plain',zip:'application/zip',html:'text/html',htm:'text/html'}[ext]||'application/octet-stream'}
  await api('/api/admin/assets',{method:'POST',headers:{'content-type':/\.html?$/i.test(file.name)?'text/html':mime,'x-file-name':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
  success++;
 }
 await loadAssets();adminRender();toast('成功上传 '+success+' 个文件');
}
async function importJSON(){
 const file=$('#importFile')?.files?.[0];if(!file)return toast('请选择 JSON 文件');
 if(file.size>9000000)return toast('备份文件超过限制');
 let data;try{data=JSON.parse(await file.text())}catch{return toast('不是有效的 JSON')}
 const response=await api('/api/admin/import',{method:'POST',...jsonBody({payload:data})});
 S.tab='library';await refreshPanel();toast('已导入 '+response.count+' 个草稿'+(response.warnings?.length?'，部分附件需重新上传':''));
}
function openModal(content){closeModal();const wrap=document.createElement('div');wrap.id='currentModal';wrap.className='modal-backdrop';wrap.innerHTML='<div class="modal" role="dialog" aria-modal="true">'+content+'</div>';document.body.appendChild(wrap)}
function closeModal(){$('#currentModal')?.remove()}
function download(name,content,type){const u=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
// Lightweight public cards navigate inside the existing shell.
// Personal/group pages still use their original exported standalone HTML.
window.addEventListener('popstate',()=>{
 if(S.admin)return;
 if(location.pathname==='/'&&!location.search){
  if(!restoreHomeDOM())showHome(true);
  return;
 }
 if(location.pathname.startsWith('/view/')){
  const slug=decodeURIComponent(location.pathname.slice(6));
  const item=(S.items||[]).find(x=>x.slug===slug&&
   !['personal','group','html'].includes(x.kind)&&x.content);
  showReader(slug,null,item||null);return;
 }
 if((location.pathname==='/docx'||location.pathname==='/docx/')&&
   /^[a-f0-9-]{16,60}$/i.test(new URLSearchParams(location.search).get('template')||'')){
  showReader('docx-workspace');
 }
});
document.addEventListener('click',async e=>{
 if(!e.defaultPrevented&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&
    !S.admin&&location.pathname==='/'&&!location.search){
  const anchor=e.target.closest('a.tile[href]');
  if(anchor&&!anchor.hasAttribute('download')&&!anchor.hasAttribute('target')){
   const dest=new URL(anchor.href,location.origin);
   const item=(S.items||[]).find(x=>itemHref(x)===dest.pathname&&
    !['personal','group','html'].includes(x.kind));
   if(item&&dest.origin===location.origin){
    e.preventDefault();
    keepHomeDOM();
    history.pushState({mswqQuickRoute:true},'',dest.pathname+dest.search);
    showReader(item.slug,null,item.content?item:null);
    return;
   }
  }
 }
 const back=e.target.closest('a[data-mswq-back="true"]');
 if(back&&(history.state?.mswqQuickRoute||history.state?.mswqFastDocx)&&!e.defaultPrevented&&e.button===0&&
    !e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){
  e.preventDefault();
  history.back();
  return;
 }
 if(back&&!e.defaultPrevented&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){
  if(document.referrer){
   if(history.length>1){e.preventDefault();history.back();return;}
   try{const r=new URL(document.referrer);if(r.origin===location.origin&&r.href!==location.href){e.preventDefault();location.assign(r.href);return;}}catch{}
  }
  // A directly opened link has no preceding MSWQ page; href="/" is the fallback.
 }
 const b=e.target.closest('[data-action]');if(!b)return;
 try{await perform(b.dataset.action,b.dataset.id,b)}catch(err){console.error(err);toast('操作失败：'+err.message)}
});
document.addEventListener('dragstart',e=>{
 const row=e.target.closest('[data-content-row]');
 if(S.tab!=='library'||!row||!row.draggable||e.target.closest('button,input,a,select'))return;
 draggedContent=row.dataset.contentRow;draggedContentGroup=row.dataset.contentGroup;
 if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedContent)}
 row.classList.add('library-dragging');
 document.body.classList.add('library-is-dragging');
});
document.addEventListener('dragover',e=>{
 if(S.tab!=='library'||!draggedContent)return;
 const row=e.target.closest('[data-content-row]'),zone=e.target.closest('[data-subgroup-zone]');
 const category=zone?.dataset.zoneCategory||row?.dataset.contentGroup;
 if(!category||category!==draggedContentGroup)return;
 e.preventDefault();
 if(e.dataTransfer)e.dataTransfer.dropEffect='move';
 document.querySelectorAll('.library-drop-target,.library-zone-drop-target').forEach(el=>
  el.classList.remove('library-drop-target','library-zone-drop-target'));
 const source=S.items.find(x=>x.id===draggedContent),sourceScope=source?.subgroupId||'';
 const targetScope=zone?.dataset.zoneSubgroup??row?.dataset.contentSubgroup??'';
 if(zone&&sourceScope!==targetScope)zone.classList.add('library-zone-drop-target');
 else if(row&&row.dataset.contentRow!==draggedContent)row.classList.add('library-drop-target');
 else if(zone)zone.classList.add('library-zone-drop-target');
});
document.addEventListener('drop',async e=>{
 if(S.tab!=='library'||!draggedContent)return;
 const row=e.target.closest('[data-content-row]'),zone=e.target.closest('[data-subgroup-zone]');
 const source=draggedContent,category=draggedContentGroup;
 const destinationCategory=zone?.dataset.zoneCategory||row?.dataset.contentGroup;
 const targetSubgroup=zone?.dataset.zoneSubgroup??row?.dataset.contentSubgroup??'';
 draggedContent='';draggedContentGroup='';
 document.body.classList.remove('library-is-dragging');
 document.querySelectorAll('.library-drop-target,.library-zone-drop-target,.library-dragging').forEach(x=>
  x.classList.remove('library-drop-target','library-zone-drop-target','library-dragging'));
 if(!destinationCategory||destinationCategory!==category)return;
 e.preventDefault();
 const current=S.items.find(x=>x.id===source),allowed=new Set(subgroupsFor(category).map(g=>g.id));
 const sourceScope=current&&allowed.has(current.subgroupId)?current.subgroupId:'';
 try{
  if(sourceScope!==targetSubgroup)await assignContentSubgroup(source,category,targetSubgroup);
  else if(row&&row.dataset.contentRow!==source)await reorderContent(source,row.dataset.contentRow);
 }catch(err){console.error(err);toast('移动失败：'+err.message)}
});
document.addEventListener('dragend',()=>{
 draggedContent='';draggedContentGroup='';
 document.body.classList.remove('library-is-dragging');
 document.querySelectorAll('.library-drop-target,.library-zone-drop-target,.library-dragging').forEach(x=>
  x.classList.remove('library-drop-target','library-zone-drop-target','library-dragging'));
});
document.addEventListener('dragstart',e=>{
 const row=e.target.closest('[data-category-row]');
 if(S.tab!=='categories'||!row||e.target.closest('button,input'))return;
 draggedCategory=row.dataset.categoryRow;
 if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedCategory);}
 row.classList.add('category-dragging');
});
document.addEventListener('dragover',e=>{
 const row=e.target.closest('[data-category-row]');
 if(S.tab!=='categories'||!draggedCategory||!row)return;
 e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';
 document.querySelectorAll('.category-drag-target').forEach(x=>x.classList.remove('category-drag-target'));
 if(row.dataset.categoryRow!==draggedCategory)row.classList.add('category-drag-target');
});
document.addEventListener('drop',async e=>{
 const row=e.target.closest('[data-category-row]'),source=draggedCategory;
 draggedCategory='';
 document.querySelectorAll('.category-drag-target,.category-dragging').forEach(x=>x.classList.remove('category-drag-target','category-dragging'));
 if(S.tab!=='categories'||!source||!row)return;
 e.preventDefault();
 try{await reorderCategory(source,row.dataset.categoryRow);}catch(err){toast('排序失败：'+err.message);}
});
document.addEventListener('dragend',()=>{
 draggedCategory='';
 document.querySelectorAll('.category-drag-target,.category-dragging').forEach(x=>x.classList.remove('category-drag-target','category-dragging'));
});
document.addEventListener('input',e=>{
 const t=e.target;
 if(t.id==='homeSearch'){
  S.search=t.value;homeRender();return;
 }
 if(t.id==='adminSearch'){S.search=t.value;const caret=t.selectionStart;const panel=$('#adminPanel');if(panel)panel.innerHTML=adminPanel();else adminRender();const n=$('#adminSearch');n?.focus();n?.setSelectionRange(caret,caret);return;}
 if(t.dataset.bookmarkIndex!==undefined&&S.edit?.kind==='bookmarks'){
  const entry=S.edit.content.entries?.[Number(t.dataset.bookmarkIndex)];
  if(entry)entry[t.dataset.prop]=t.value;
  return;
 }
 if(t.dataset.profileIndex!==undefined&&S.edit?.kind==='profile'){
  const entry=S.edit.content.fields?.[Number(t.dataset.profileIndex)];
  if(entry)entry[t.dataset.prop]=t.value;
  return;
 }
 if(t.dataset.field){
  const key=t.dataset.field;
  if(key==='kind'||key==='category'&&t.value==='__new_category__')return;
  if(S.tab==='settings'){S.settings[key]=t.value;return}
  if(!S.edit)return;
  if(key==='tags')S.edit.tags=t.value.split(',').map(x=>x.trim()).filter(Boolean);
  else if(key==='sort_order')S.edit.sort_order=Number(t.value)||0;
  else if(key==='memberNames'){
   const names=t.value.split(/[\n,，]/).map(x=>x.trim()).filter(Boolean);
   S.edit.content.members=names.map((name,i)=>({id:S.edit.content.members.find(m=>m.name===name)?.id||crypto.randomUUID(),name,label:(i+1)+'号'}));
  }else if(['docUrl','templateId','url','htmlAssetId','subgroupId'].includes(key))S.edit.content[key]=t.value;
  else S.edit[key]=t.value;
 }
 if(t.dataset.block!==undefined&&S.edit){
  const block=S.edit.content.blocks[Number(t.dataset.block)];
  if(block)block[t.dataset.bfield]=t.dataset.bfield==='seconds'?Number(t.value):t.value;
 }
});
document.addEventListener('change',async e=>{
 const t=e.target;
 if(t.id==='subgroupParent'){S.subgroupParent=t.value;adminRender();return;}
 if(t.id==='quickDocxCategory'){
  const box=$('#quickDocxNewCategoryBox');
  if(box){box.style.display=t.value==='__new_category__'?'block':'none';if(t.value==='__new_category__')$('#quickDocxNewCategoryName')?.focus()}
  return;
 }
 if(t.id==='docxEditorCategory'&&t.value==='__new_category__'){
  const previous=S.edit?.category||'';
  const name=prompt('输入新的前台分类名称（最多30字）');
  if(!name?.trim()){t.value=previous;return}
  const created=await api('/api/admin/types',{method:'POST',...jsonBody({name:name.trim()})});
  S.settings.custom_types=created.custom_types;S.settings.type_order=created.type_order;applyCustomTypes(S.settings);
  S.edit.category=created.type.id;
  adminRender();return;
 }
 if(t.id==='coverUpload'&&S.edit){
  const file=t.files?.[0];if(!file)return;
  const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[file.name.split('.').pop().toLowerCase()];
  if(!mime||!file.size||file.size>12000000)return toast('封面只支持 PNG、JPG、WebP、GIF，最大12MB');
  t.disabled=true;
  try{
   const res=await api('/api/admin/icons',{method:'POST',headers:{'content-type':mime,'x-file-name':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
   S.edit.thumbnail=icon(res.icon.id);await loadIcons();adminRender();toast('已上传到独立图标库，请保存内容');
  }catch(err){t.disabled=false;toast('封面上传失败：'+err.message)}
  return;
 }
 if(t.dataset.mediaUpload){
  const collection=t.dataset.mediaUpload,media=t.dataset.mediaKind==='video'?'video':'image',index=Number(t.dataset.index),file=t.files?.[0];
  if(!file||!S.edit||!['entries','fields'].includes(collection))return;
  const allowed=media==='video'?['video/mp4','video/webm']:['image/jpeg','image/png','image/gif','image/webp'];
  const ext=file.name.split('.').pop()?.toLowerCase();
  const mime=allowed.includes(file.type)?file.type:({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'}[ext]||'');
  if(!allowed.includes(mime)){toast(media==='video'?'仅支持 MP4 / WebM 视频':'仅支持 JPG、PNG、WEBP、GIF 图片');return;}
  const limit=media==='video'?50000000:12000000;
  if(file.size>limit){toast(media==='video'?'视频不能超过 50MB':'图片不得超过 12MB');return;}
  t.disabled=true;toast('正在上传'+(media==='video'?'视频':'图片')+'…');
  try{
   const data=await api('/api/admin/assets',{method:'POST',headers:{'content-type':mime,'x-file-name':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
   const entry=S.edit.content[collection]?.[index];
   if(entry){entry.assetId=data.asset.id;adminRender();toast((media==='video'?'视频':'图片')+'已上传并选用');}
  }catch(err){console.error(err);t.disabled=false;toast((media==='video'?'视频':'图片')+'上传失败：'+err.message)}
  return;
 }
 if(t.id==='htmlEditorUpload'&&S.edit?.kind==='html'){
  const file=t.files?.[0];if(!file)return;
  if(!/\.html?$/i.test(file.name)||!file.size||file.size>35000000)return toast('仅支持完整 .html/.htm 文件，最大 35MB');
  t.disabled=true;
  try{
   const data=await api('/api/admin/assets',{method:'POST',headers:{'content-type':'text/html','x-file-name':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
   S.edit.content.htmlAssetId=data.asset.id;await loadAssets();adminRender();toast('HTML 上传成功，请保存并发布');
  }catch(err){t.disabled=false;toast('HTML 上传失败：'+err.message);}
  return;
 }
 if(t.dataset.field==='category'&&S.edit&&t.tagName==='SELECT'&&t.value!=='__new_category__'){
  S.edit.category=t.value;
  if(!subgroupsFor(frontTabForItem(S.edit)).some(g=>g.id===S.edit.content?.subgroupId))S.edit.content.subgroupId='';
  adminRender();return;
 }
 if(t.dataset.field==='htmlAssetId'&&S.edit?.kind==='html'){S.edit.content.htmlAssetId=t.value;return;}
 if(t.dataset.profileIndex!==undefined&&t.dataset.prop==='type'&&S.edit?.kind==='profile'){
  const entry=S.edit.content.fields?.[Number(t.dataset.profileIndex)];
  if(entry){if(entry.type!==t.value&&['image','video'].includes(entry.type))entry.assetId='';entry.type=t.value;adminRender();}
  return;
 }
 if(t.dataset.field==='kind'&&S.edit){
  if(t.value==='__create_type__'){
   t.value=S.edit.kind;
   openModal('<h2>＋ 新增分类</h2><p class="muted small">创建后将出现在所有内容的类型菜单和前台筛选栏中。</p><div class="field"><label>分类名称</label><input id="customTypeName" maxlength="30" placeholder="例如：法律文档、教程、资料库" autocomplete="off"></div><div class="flex" style="justify-content:flex-end"><button class="btn" data-action="close-modal">取消</button><button class="btn green" data-action="create-custom-type">确认新增分类</button></div>');
   $('#customTypeName')?.focus();
   return;
  }
  S.edit.kind=t.value;S.edit.content.blocks=S.edit.content.blocks||[];
  if(!subgroupsFor(frontTabForItem(S.edit)).some(g=>g.id===S.edit.content.subgroupId))S.edit.content.subgroupId='';
  if(t.value==='document'){await loadDocxTemplates();S.edit.category=S.edit.category||defaultDocxCategory();}
  adminRender();
 }
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape')document.getElementById('mediaPreview')?.remove();
 if(e.key==='Enter'&&(e.target.id==='customTypeName'||e.target.id==='categoryRenameInput')){
  e.preventDefault();document.querySelector(e.target.id==='customTypeName'?'[data-action="create-custom-type"]':'[data-action="save-category-name"]')?.click();
 }
});
async function boot(){
 if(location.pathname==='/admin')return openAdmin();
 if(location.pathname.startsWith('/view/'))return showReader(decodeURIComponent(location.pathname.slice(6)));
 // Previously shared /docx?template=... and /?template=... should now have
 // the same MSWQ navigation + back button as newly copied document links.
 if((location.pathname==='/docx'||location.pathname==='/docx/'||location.pathname==='/')&&/^[a-f0-9-]{16,60}$/i.test(new URLSearchParams(location.search).get('template')||''))return showReader('docx-workspace');
 await showHome();
}
boot();
})();