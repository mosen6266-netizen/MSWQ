/* MSWQ HTML tool package importer. All ZIP extraction happens in the browser. */
(function(){
'use strict';
const MAX_FILES=300,MAX_TOTAL=150000000,MAX_ARCHIVE=70000000,MAX_FILE=50000000;
const decoder=new TextDecoder('utf-8',{fatal:false}),encoder=new TextEncoder();
const types={html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',gif:'image/gif',webp:'image/webp',ico:'image/x-icon',avif:'image/avif',bmp:'image/bmp',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',eot:'application/vnd.ms-fontobject',wasm:'application/wasm',webmanifest:'application/manifest+json',xml:'application/xml',txt:'text/plain',map:'application/json',pdf:'application/pdf',mp3:'audio/mpeg',mp4:'video/mp4',webm:'video/webm',wav:'audio/wav',ogg:'audio/ogg',webp:'image/webp',webm:'video/webm'};
function ext(path){return (path.split('/').pop().split('.').pop()||'').toLowerCase()}
function isAllowed(path){return Object.hasOwn(types,ext(path))}
function cleanPath(raw){
 if(typeof raw!=='string'||!raw||raw.length>260||/[\u0000-\u001f\u007f?#]/.test(raw))throw Error('文件路径包含不支持的字符: '+raw);
 const p=raw.replace(/\\/g,'/');
 if(p.startsWith('/')||/^[a-z]:/i.test(p)||p.split('/').some(x=>!x||x==='.'||x==='..'||x.length>120))throw Error('不安全的文件路径: '+raw);
 return p;
}
function normalizeFiles(files){
 if(!files.length)throw Error('没有可上传的文件');
 const input=files.filter(f=>f.path&&!f.path.endsWith('/')&&!f.path.startsWith('__MACOSX/')&&!f.path.split('/').pop().startsWith('._')&&!['.DS_Store','Thumbs.db','desktop.ini'].includes(f.path.split('/').pop()));
 const common=input[0]?.path.split('/')[0];
 const removeRoot=common&&input.every(f=>f.path.startsWith(common+'/'));
 const seen=new Set(),result=[];
 let total=0;
 for(const entry of input){
  const path=cleanPath(removeRoot?entry.path.slice(common.length+1):entry.path);
  if(!isAllowed(path))throw Error('文件类型暂不支持: '+path);
  if(seen.has(path.toLowerCase()))throw Error('有重名文件（不区分大小写）: '+path);
  seen.add(path.toLowerCase());
  if(entry.data.byteLength>MAX_FILE)throw Error('单个工具文件不能超过 50MB: '+path);
  total+=entry.data.byteLength;
  if(total>MAX_TOTAL)throw Error('工具包解压后不能超过 150MB');
  result.push({path,data:entry.data,size:entry.data.byteLength});
 }
 if(result.length>MAX_FILES)throw Error('单个工具包最多 300 个文件');
 if(!result.some(f=>/\.html?$/i.test(f.path)))throw Error('工具包内至少需要一个 HTML 页面');
 return result;
}
function crc32(bytes){
 let c=-1;for(let i=0;i<bytes.length;i++){c^=bytes[i];for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)}
 return (c^-1)>>>0;
}
async function fromZip(file){
 if(file.size>MAX_ARCHIVE)throw Error('ZIP 最大 70MB，可改用整个文件夹上传');
 const data=new Uint8Array(await file.arrayBuffer()),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 let tail=-1;
 for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){tail=i;break}
 if(tail<0)throw Error('ZIP 文件结构不正确');
 const count=view.getUint16(tail+10,true),dirSize=view.getUint32(tail+12,true),dirOff=view.getUint32(tail+16,true);
 if(count===65535||dirSize===0xffffffff||dirOff===0xffffffff)throw Error('暂不支持 ZIP64 压缩包，请使用文件夹上传');
 if(count>MAX_FILES+50||dirOff+dirSize>data.length)throw Error('ZIP 文件数量或目录异常');
 const raw=[];let off=dirOff,expected=0;
 for(let i=0;i<count;i++){
  if(off+46>data.length||view.getUint32(off,true)!==0x02014b50)throw Error('ZIP 中央目录损坏');
  const flags=view.getUint16(off+8,true),method=view.getUint16(off+10,true),crc=view.getUint32(off+16,true);
  const compressed=view.getUint32(off+20,true),uncompressed=view.getUint32(off+24,true);
  const nameLen=view.getUint16(off+28,true),extraLen=view.getUint16(off+30,true),commentLen=view.getUint16(off+32,true),local=view.getUint32(off+42,true);
  if(off+46+nameLen+extraLen+commentLen>data.length)throw Error('ZIP 目录超出文件大小');
  const nameData=data.slice(off+46,off+46+nameLen);
  const name=(flags&2048)?decoder.decode(nameData):new TextDecoder('gb18030').decode(nameData);
  off+=46+nameLen+extraLen+commentLen;
  if(name.endsWith('/')||name.startsWith('__MACOSX/')||name.split('/').pop().startsWith('._'))continue;
  if(flags&1)throw Error('不支持加密的 ZIP 文件');
  if(method!==0&&method!==8)throw Error('ZIP 使用了不支持的压缩算法: '+name);
  if(uncompressed>MAX_FILE||compressed>MAX_ARCHIVE)throw Error('ZIP 内部文件过大: '+name);
  expected+=uncompressed;if(expected>MAX_TOTAL)throw Error('ZIP 解压后超过 150MB');
  if(local+30>data.length||view.getUint32(local,true)!==0x04034b50)throw Error('ZIP 文件头损坏');
  const begin=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
  if(begin+compressed>data.length)throw Error('ZIP 文件内容越界');
  let bytes=data.slice(begin,begin+compressed);
  if(method===8){
   if(typeof DecompressionStream==='undefined')throw Error('浏览器不支持 ZIP 解压，请选择文件夹上传');
   try{bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())}
   catch{throw Error('ZIP 解压失败: '+name+'。可以使用文件夹上传')}
  }
  if(bytes.length!==uncompressed||crc32(bytes)!==crc)throw Error('ZIP 文件完整性校验失败: '+name);
  raw.push({path:name,data:bytes});
 }
 return normalizeFiles(raw);
}
async function fromFolder(files){
 const raw=[];for(const f of files){
  if(!f.name||f.name.startsWith('._'))continue;
  raw.push({path:f.webkitRelativePath||f.name,data:new Uint8Array(await f.arrayBuffer())});
 }
 return normalizeFiles(raw);
}
function entryOptions(files){
 const pages=files.map(f=>f.path).filter(p=>/\.html?$/i.test(p));
 pages.sort((a,b)=>(a.toLowerCase()==='index.html'?-1:0)-(b.toLowerCase()==='index.html'?-1:0)||a.length-b.length||a.localeCompare(b));
 return pages;
}
function warnings(files,entry){
 const chosen=files.find(f=>f.path===entry);
 if(!chosen)return ['没有选择入口 HTML'];
 const source=decoder.decode(chosen.data.slice(0,200000));
 const list=[];
 if(/(?:src|href)\s*=\s*["']\/(?!\/)/i.test(source)||/url\(\s*["']?\//i.test(source))list.push('HTML 使用了根目录绝对路径（如 /images/x.png），建议改用相对路径，避免跨工具冲突');
 if(/file:\/\/|[a-z]:\\(?:users|images|assets)/i.test(source))list.push('HTML 引用了本机路径，云端无法访问这些文件');
 if(/https?:\/\/[^"'\s<>]+/i.test(source))list.push('存在外部网络资源，需要外部网站正常在线才能加载');
 return list;
}
function u16(v){return [v&255,v>>>8&255]}
function u32(v){return [v&255,v>>>8&255,v>>>16&255,v>>>24&255]}
function storeZip(files){
 const chunks=[],central=[];let offset=0;
 for(const f of files){
  const name=encoder.encode(f.path),crc=crc32(f.data),size=f.size;
  const head=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(2048),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(size),...u32(size),...u16(name.length),...u16(0)]);
  chunks.push(head,name,f.data);
  central.push(new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(2048),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(size),...u32(size),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]),name);
  offset+=head.length+name.length+f.size;
 }
 const endOffset=offset,dirSize=central.reduce((n,b)=>n+b.length,0);
 const end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(dirSize),...u32(endOffset),...u16(0)]);
 return new Blob([...chunks,...central,end],{type:'application/zip'});
}
async function postJson(path,opts){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts});
 let val;try{val=await res.json()}catch{throw Error('服务器返回异常：'+res.status)}
 if(!res.ok||val.ok===false)throw Error(val.error||'上传失败 '+res.status);
 return val;
}
async function upload(files,entry,name,replaceId,originalZip,onProgress){
 const id=replaceId||crypto.randomUUID(),version=crypto.randomUUID();
 if(!files.some(f=>f.path===entry))throw Error('请先选择入口页面');
 const manifest=[];
 for(let i=0;i<files.length;i++){
  const f=files[i];
  await postJson('/api/admin/html-packages/file',{method:'POST',headers:{
   'x-package-id':id,'x-package-version':version,'x-package-path':encodeURIComponent(f.path),
   'content-type':'application/octet-stream'},body:f.data});
  manifest.push({path:f.path,size:f.size});
  onProgress?.('正在上传 '+(i+1)+' / '+files.length+'：'+f.path);
 }
 let archive=originalZip||null;
 if(!archive){
  const total=files.reduce((s,f)=>s+f.size,0);
  if(total+files.length*180<MAX_ARCHIVE)archive=storeZip(files);
 }
 if(archive?.size<=MAX_ARCHIVE){
  await postJson('/api/admin/html-packages/archive',{method:'POST',headers:{
   'x-package-id':id,'x-package-version':version,'content-type':'application/zip'},body:archive});
 }else archive=null;
 const result=await postJson('/api/admin/html-packages/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  id,version,name,entry,files:manifest,hasArchive:!!archive
 })});
 onProgress?.('工具包上传完成');
 return result;
}
window.MSWQPackage={fromZip,fromFolder,entryOptions,warnings,upload,zipFiles:storeZip};
})();