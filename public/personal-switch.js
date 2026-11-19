/* MSWQ personal flow switcher: smooth repeat navigation without polluting Back.
 * Every flow is an independently published original HTML document; keep its
 * content/attachments unchanged, but cache versioned pages and prefetch neighbors. */
(() => {
 'use strict';

 const strip=document.getElementById('mswqPersonalSwitch');
 if(!strip||!location.pathname.startsWith('/view/'))return;
 const embedded=new URLSearchParams(location.search).get('embedded')==='1'&&window.parent!==window;
 const originalTabs=document.getElementById('flowTabs');
 const currentSlug=decodeURIComponent(location.pathname.slice('/view/'.length));
 const warm=new Set();
 let signature='',inflight=null,currentFlows=[],prefetchTimer=0,leaving=false;
 // The top-level reader remains alive; at most two other full readers stay
 // mounted in same-origin frames, eliminating costly HTML/JS re-parsing when
 // the user alternates between their three frequent flows.
 const frames=new Map();
 let activeSlug=currentSlug,frameClock=0;
 let switchNotice=null;

 function notice(show){
  if(!show){switchNotice?.remove();switchNotice=null;return;}
  if(!switchNotice){
   const node=document.createElement('div');
   node.setAttribute('role','status');
   node.textContent='正在打开个人流程…';
   node.style.cssText='position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;background:rgba(17,18,20,.83);color:#efefed;font:700 15px system-ui,"Microsoft YaHei",sans-serif';
   switchNotice=node;
   document.body.appendChild(node);
  }
 }

 function reveal(slug){
  if(embedded)return;
  for(const [key,entry] of frames){
   entry.iframe.style.display=key===slug&&entry.loaded?'block':'none';
   if(key===slug)entry.lastUsed=++frameClock;
  }
  const showFrame=slug!==currentSlug;
  const pane=frames.get(slug);
  notice(showFrame&&!pane?.loaded);
 }

 function trimFrames(){
  if(frames.size<=2)return;
  const candidates=[...frames.entries()].filter(([slug])=>slug!==activeSlug)
   .sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
  while(frames.size>2&&candidates.length){
   const [slug,entry]=candidates.shift();
   entry.iframe.remove();frames.delete(slug);
  }
 }

 function showFlow(item){
  if(embedded||!item||!item.slug||item.slug===activeSlug)return;
  const href=flowHref(item);
  const next=item.slug;
  activeSlug=next;
  // replaceState only changes this existing entry, never pushes another
  // "flow" into the user's Back history.
  window.history.replaceState(history.state,'',href);
  if(next!==currentSlug){
   let entry=frames.get(next);
   if(entry&&entry.href!==href){
    entry.iframe.remove();frames.delete(next);entry=null;
   }
   if(!entry){
    const frame=document.createElement('iframe');
    frame.title=item.title||'个人流程';
    frame.setAttribute('aria-label',item.title||'个人流程');
    frame.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;z-index:2147483000;border:0;display:none;background:#121315';
    const src=new URL(href,location.origin);
    src.searchParams.set('embedded','1');
    entry={iframe:frame,href,loaded:false,lastUsed:++frameClock};
    frames.set(next,entry);
    frame.addEventListener('load',()=>{
     try{
      // Ignore the iframe's first empty about:blank load.
      if(frame.contentWindow.location.pathname!==src.pathname)return;
      if(new URL(frame.contentWindow.location.href).searchParams.get('embedded')!=='1')return;
      entry.loaded=true;
      if(activeSlug===next)reveal(next);
      trimFrames();
     }catch(error){console.warn('MSWQ frame load:',error.message)}
    });
    document.body.appendChild(frame);
    // Replace the initial about:blank frame history entry so that subframe
    // loading cannot become a browser Back destination.
    frame.contentWindow.location.replace(src.href);
   }
  }
  reveal(next);
  trimFrames();
 }

 if(embedded){
  // The parent owns browser history and retains the already loaded readers.
  // Prevent a child frame's 返回 button from navigating iframe history.
  document.addEventListener('click',event=>{
   const a=event.target.closest('[data-mswq-home="true"],[data-mswq-back="true"]');
   if(!a)return;
   event.preventDefault();event.stopImmediatePropagation();
   window.parent.postMessage({type:'MSWQ_PERSONAL_RETURN'},location.origin);
  },true);
 }else{
  window.addEventListener('message',event=>{
   if(event.origin!==location.origin)return;
   if(![...frames.values()].some(entry=>entry.iframe.contentWindow===event.source))return;
   if(event.data?.type==='MSWQ_PERSONAL_RETURN'){
    if(window.history.length>1)window.history.back();
    else window.location.assign('/');
    return;
   }
   if(event.data?.type==='MSWQ_PERSONAL_SWITCH'){
    const item=currentFlows.find(x=>x.slug===event.data.slug);
    if(item)showFlow(item);
   }
  });
 }

 function flowHref(item){
  // The item version changes whenever the published item is saved.
  // A versioned page can be safely cached without pinning an outdated version.
  const path='/view/'+encodeURIComponent(item.slug);
  return Number.isSafeInteger(Number(item.version))&&Number(item.version)>0
   ?path+'?v='+encodeURIComponent(String(item.version))+'&fast=1'
   :path+'?fast=1';
 }

 function warmLink(item){
  if(!item||item.slug===currentSlug||document.hidden||navigator.connection?.saveData)return;
  const url=flowHref(item);
  if(warm.has(url))return;
  warm.add(url);
  // The browser fetches this into its navigation cache without executing any
  // of the (sometimes 30 MB) HTML or creating a history entry.
  const hint=document.createElement('link');
  hint.rel='prefetch';
  hint.as='document';
  hint.href=url;
  document.head.appendChild(hint);
 }

 function warmNeighbors(){
  if(document.hidden)return;
  const i=currentFlows.findIndex(x=>x.slug===currentSlug);
  const others=currentFlows.filter(x=>x.slug!==currentSlug);
  if(!others.length)return;
  // Preload the nearest flow first; reserve the background network budget for
  // just two other published documents, not the entire library.
  others.sort((a,b)=>
   Math.abs(currentFlows.indexOf(a)-i)-Math.abs(currentFlows.indexOf(b)-i)
  );
  others.slice(0,2).forEach(warmLink);
 }

 function schedulePrefetch(){
  if(prefetchTimer)clearTimeout(prefetchTimer);
  prefetchTimer=setTimeout(()=>{
   if('requestIdleCallback' in window){
    requestIdleCallback(warmNeighbors,{timeout:3000});
   }else warmNeighbors();
  },1200);
 }

 async function sync(){
  if(inflight)return inflight;
  inflight=(async()=>{
   const res=await fetch('/api/public',{credentials:'same-origin',cache:'no-store'});
   if(!res.ok)throw Error('个人流程列表暂时不可用');
   const data=await res.json();
   if(!Array.isArray(data.items))throw Error('个人流程列表数据无效');
   // Exactly match homepage ordering from /api/public:
   // sort_order ASC, updated_at DESC; never alphabetically re-sort.
   const flows=data.items.filter(x=>
    x&&x.kind==='personal'&&x.status==='published'&&
    typeof x.slug==='string'&&x.slug&&typeof x.title==='string'
   );
   if(!flows.length)return;
   currentFlows=flows;
   const next=JSON.stringify(flows.map(x=>[x.id,x.slug,x.title,x.version]));
   if(signature===next)return;

   const children=document.createDocumentFragment();
   for(const item of flows){
    const a=document.createElement('a');
    a.className='mswq-personal-link';
    a.href=flowHref(item);
    a.textContent=item.title||'未命名个人流程';
    a.title=item.title||'个人流程';
    if(item.slug===currentSlug)a.setAttribute('aria-current','page');
    children.appendChild(a);
   }
   strip.replaceChildren(children);
   strip.hidden=false;
   if(originalTabs){
    const count=originalTabs.querySelectorAll('[data-flow-index],a.reader-flow-tab').length;
    originalTabs.classList.toggle('mswq-personal-hide-local',count<=1);
   }
   signature=next;
   schedulePrefetch();
  })().catch(error=>{
   console.warn('MSWQ personal flow switcher:',error.message);
  }).finally(()=>{inflight=null});
  return inflight;
 }

 // Keep browser history untouched. Parent switches cached complete readers
 // instantly, while a reader inside an iframe delegates its clicks upward.
 strip.addEventListener('click',event=>{
  const link=event.target.closest('a.mswq-personal-link');
  if(!link||event.defaultPrevented||event.button!==0||
     event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  event.preventDefault();
  const clicked=new URL(link.href);
  const slug=decodeURIComponent(clicked.pathname.slice('/view/'.length));
  if(embedded){
   if(slug!==currentSlug)window.parent.postMessage({type:'MSWQ_PERSONAL_SWITCH',slug},location.origin);
   return;
  }
  const item=currentFlows.find(x=>x.slug===slug);
  if(item)showFlow(item);
 });

 // Fetch sooner on actual pointer intent, even if the background prefetch
 // hasn't started. It never navigates, so it cannot affect Back.
 strip.addEventListener('pointerover',event=>{
  const link=event.target.closest('a.mswq-personal-link');
  if(!link)return;
  const target=currentFlows.find(x=>flowHref(x)===link.getAttribute('href'));
  if(target)warmLink(target);
 });

 void sync();
 window.addEventListener('focus',()=>{if(!document.hidden)void sync()});
 window.addEventListener('pageshow',()=>{if(!document.hidden)void sync()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync()});
 window.setInterval(()=>{if(!document.hidden)void sync()},30000);
})();