/* MSWQ published personal-flow navigation.
 * Use the exact standalone page entry as the homepage card. Each click
 * replaces the current document (and history entry) instead of mounting
 * multiple heavyweight readers in iframes.
 */
(() => {
 'use strict';

 const strip=document.getElementById('mswqPersonalSwitch');
 if(!strip||!location.pathname.startsWith('/view/'))return;

 const originalTabs=document.getElementById('flowTabs');
 const currentSlug=decodeURIComponent(location.pathname.slice('/view/'.length));
 let currentFlows=[],signature='',inflight=null;

 function flowHref(item){
  // Identical to clicking a personal-flow card on the homepage.
  return '/view/'+encodeURIComponent(item.slug);
 }

 async function sync(){
  if(inflight)return inflight;
  inflight=(async()=>{
   const res=await fetch('/api/public',{credentials:'same-origin',cache:'no-store'});
   if(!res.ok)throw Error('个人流程列表暂时不可用');
   const data=await res.json();
   if(!Array.isArray(data.items))throw Error('个人流程列表数据无效');

   // /api/public already follows the homepage order; do not re-sort.
   const flows=data.items.filter(item=>
    item&&item.kind==='personal'&&item.status==='published'&&
    typeof item.slug==='string'&&item.slug&&typeof item.title==='string'
   );
   currentFlows=flows;
   const next=JSON.stringify(flows.map(x=>[x.id,x.slug,x.title,x.version]));
   if(next===signature)return;

   const children=document.createDocumentFragment();
   for(const item of flows){
    const link=document.createElement('a');
    link.className='mswq-personal-link';
    link.href=flowHref(item);
    link.textContent=item.title||'未命名个人流程';
    link.title=item.title||'个人流程';
    if(item.slug===currentSlug)link.setAttribute('aria-current','page');
    children.appendChild(link);
   }
   strip.replaceChildren(children);
   strip.hidden=!flows.length;
   if(originalTabs){
    const count=originalTabs.querySelectorAll('[data-flow-index],a.reader-flow-tab').length;
    originalTabs.classList.toggle('mswq-personal-hide-local',count<=1);
   }
   signature=next;
  })().catch(error=>{
   console.warn('MSWQ personal flow navigation:',error.message);
  }).finally(()=>{inflight=null});
  return inflight;
 }

 strip.addEventListener('click',event=>{
  const link=event.target.closest('a.mswq-personal-link');
  if(!link||event.defaultPrevented||event.button!==0||
     event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  const target=new URL(link.href,location.href);
  if(target.origin!==location.origin)return;
  event.preventDefault();
  if(target.pathname===location.pathname)return;

  // Native top-level page navigation, matching the homepage card.
  // replace() keeps all internal switches in one history entry, so Back
  // returns to the page visited before the personal-flow reader.
  // Old heavy readers are released instead of kept alive in iframes.
  location.replace(target.href);
 });

 void sync();
 window.addEventListener('focus',()=>{if(!document.hidden)void sync()});
 window.addEventListener('pageshow',()=>{if(!document.hidden)void sync()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync()});
 window.setInterval(()=>{if(!document.hidden)void sync()},30000);
})();
