/* MSWQ personal flow switcher: smooth repeat navigation without polluting Back.
 * Every flow is an independently published original HTML document; keep its
 * content/attachments unchanged, but cache versioned pages and prefetch neighbors. */
(() => {
 'use strict';

 const strip=document.getElementById('mswqPersonalSwitch');
 if(!strip||!location.pathname.startsWith('/view/'))return;
 const originalTabs=document.getElementById('flowTabs');
 const currentSlug=decodeURIComponent(location.pathname.slice('/view/'.length));
 const warm=new Set();
 let signature='',inflight=null,currentFlows=[],prefetchTimer=0,leaving=false;

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

 // Use replace() instead of assign()/ordinary anchor navigation.
 // This preserves exactly one flow history entry no matter how many times
 // the user switches. The native browser Back and original 返回 button both
 // go to the page visited BEFORE the flow section.
 strip.addEventListener('click',event=>{
  const link=event.target.closest('a.mswq-personal-link');
  if(!link||event.defaultPrevented||event.button!==0||
     event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  event.preventDefault();
  if(link.getAttribute('aria-current')==='page'||leaving)return;
  leaving=true;
  // The switch is visible immediately even if the large HTML is still loading.
  link.setAttribute('aria-busy','true');
  window.location.replace(link.href);
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