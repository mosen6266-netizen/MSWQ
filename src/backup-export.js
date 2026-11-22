/* MSWQ lossless tenant backup (ZIP STORE streaming, not a JSON-only export).
 * This module is appended to the compiled Worker, and its export endpoint is
 * available solely after the existing password + TOTP authenticated admin gate.
 * The ZIP contains all user objects and their exact bytes, D1 rows/schema,
 * KV values, and a GitHub source snapshot. No credentials are exported.
 */
const MSWQ_BACKUP_ENCODER=new TextEncoder();
const mswqB=(text)=>MSWQ_BACKUP_ENCODER.encode(String(text));
function mswqZipDate(){
 const d=new Date();
 const date=((Math.max(1980,d.getUTCFullYear())-1980)<<9)|((d.getUTCMonth()+1)<<5)|d.getUTCDate();
 const time=(d.getUTCHours()<<11)|(d.getUTCMinutes()<<5)|Math.floor(d.getUTCSeconds()/2);
 return {date,time};
}
function mswqCrc32(crc,bytes){
 for(const byte of bytes){
  crc^=byte;
  for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return crc>>>0;
}
async function* mswqReadable(readable){
 if(!readable)throw Error('备份数据流缺失');
 const reader=readable.getReader();
 try{
  for(;;){
   const part=await reader.read();
   if(part.done)break;
   yield part.value;
  }
 }finally{reader.releaseLock();}
}
function mswqJsonEntry(name,value){
 return {name,parts:async function*(){yield mswqB(JSON.stringify(value,null,2)+'\n');}};
}
function mswqTextEntry(name,value){
 return {name,parts:async function*(){yield mswqB(value);}};
}
function mswqZipHeader(name,clock){
 const n=mswqB(name),h=new Uint8Array(30+n.length),v=new DataView(h.buffer);
 v.setUint32(0,0x04034b50,true);
 v.setUint16(4,20,true);v.setUint16(6,0x808,true); // UTF-8 + descriptor
 v.setUint16(8,0,true);v.setUint16(10,clock.time,true);v.setUint16(12,clock.date,true);
 v.setUint16(26,n.length,true);h.set(n,30);return h;
}
function mswqZipCentral(name,clock,crc,size,offset){
 const n=mswqB(name),h=new Uint8Array(46+n.length),v=new DataView(h.buffer);
 v.setUint32(0,0x02014b50,true);
 v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x808,true);
 v.setUint16(10,0,true);v.setUint16(12,clock.time,true);v.setUint16(14,clock.date,true);
 v.setUint32(16,crc,true);v.setUint32(20,size,true);v.setUint32(24,size,true);
 v.setUint16(28,n.length,true);v.setUint32(42,offset,true);
 h.set(n,46);return h;
}
async function* mswqZipEntries(entries){
 let total=0;
 const central=[],clock=mswqZipDate();
 for(const entry of entries){
  const head=mswqZipHeader(entry.name,clock),at=total;
  yield head;total+=head.byteLength;
  let crc=0xffffffff,size=0;
  for await(const part of entry.parts()){
   const bytes=part instanceof Uint8Array?part:new Uint8Array(part);
   if(!bytes.byteLength)continue;
   crc=mswqCrc32(crc,bytes);
   size+=bytes.byteLength;
   if(size>=0xffffffff)throw Error('单个备份对象超过 ZIP32 限制');
   yield bytes;total+=bytes.byteLength;
  }
  crc=(crc^0xffffffff)>>>0;
  const d=new Uint8Array(16),v=new DataView(d.buffer);
  v.setUint32(0,0x08074b50,true);
  v.setUint32(4,crc,true);v.setUint32(8,size,true);v.setUint32(12,size,true);
  yield d;total+=16;
  central.push(mswqZipCentral(entry.name,clock,crc,size,at));
  if(central.length>=65535)throw Error('ZIP 文件条目数量过多');
 }
 const offset=total;
 for(const chunk of central){yield chunk;total+=chunk.byteLength;}
 const dirBytes=total-offset;
 if(total>=0xffffffff)throw Error('完整备份超过 ZIP32 4GB 限制');
 const end=new Uint8Array(22),v=new DataView(end.buffer);
 v.setUint32(0,0x06054b50,true);
 v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);
 v.setUint32(12,dirBytes,true);v.setUint32(16,offset,true);
 yield end;
}
async function mswqBackupDB(db){
 const info=await db.prepare(
  "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name"
 ).all();
 const definitions=info.results||[];
 const tables=definitions.filter(row=>row.type==='table');
 return {schema:definitions,tables};
}
async function* mswqBackupRows(db,tableName){
 const name='"'+String(tableName).replace(/"/g,'""')+'"';
 // Each page is bounded so large workflow JSON rows do not allocate the
 // entire site history in one Worker invocation.
 const limit=12;
 for(let offset=0;;offset+=limit){
  const page=await db.prepare('SELECT * FROM '+name+' LIMIT ? OFFSET ?')
   .bind(limit,offset).all();
  const rows=page.results||[];
  for(const row of rows)yield mswqB(JSON.stringify(row,(key,value)=>
   value instanceof Uint8Array?{__mswq_blob:Array.from(value)}:value
  )+'\n');
  if(rows.length<limit)break;
 }
}
async function mswqBackupObjects(env){
 let cursor,objects=[];
 do{
  const result=await env.FILES.list({
   limit:1000,cursor,include:['customMetadata','httpMetadata']
  });
  objects.push(...(result.objects||[]));
  cursor=result.truncated?result.cursor:null;
  if(objects.length>100000)throw Error('云文件数量超过备份上限');
 }while(cursor);
 // Identical R2 bytes often exist under several different keys. ZIP each
 // unique immutable body only once, keeping a separate metadata entry for
 // *every* original object/key so a new account recreates all originals.
 // R2 ETags and size are used only as a deduplication hint. All object keys
 // and per-key metadata remain in the index.
 const stored=new Map();
 return objects.map(obj=>{
  const fingerprint=String(obj.etag||'')+':'+String(obj.size);
  let zipPath=stored.get(fingerprint);
  if(!zipPath){
   zipPath='r2/objects/'+String(stored.size+1).padStart(6,'0')+'.bin';
   stored.set(fingerprint,zipPath);
  }
  return {
   key:obj.key,size:obj.size,etag:obj.etag,
   uploaded:obj.uploaded?.toISOString?.()||String(obj.uploaded||''),
   httpMetadata:obj.httpMetadata||{},
   customMetadata:obj.customMetadata||{},
   zipPath
  };
 });
}
async function mswqBackupKvKeys(env){
 let cursor,keys=[];
 do{
  const result=await env.DOCX_KV.list({limit:1000,cursor});
  keys.push(...result.keys);
  cursor=result.list_complete?null:result.cursor;
  if(keys.length>100000)throw Error('KV 文件数量超过备份上限');
 }while(cursor);
 return keys.map((item,index)=>({
  name:item.name,expiration:item.expiration||null,
  metadata:item.metadata||null,
  zipPath:'kv/values/'+String(index+1).padStart(6,'0')+'.bin'
 }));
}
function mswqBackupInstructions(repo){
 return [
 'MSWQ COMPLETE MIGRATION ARCHIVE / 完整迁移说明',
 '',
 '本压缩包包含：GitHub 源码压缩包、两套 D1 数据库结构与全部用户数据、',
 '全部 R2 对象及其 metadata、DOCX KV 所有原始值（包括历史版本）。',
 '',
 '新账号恢复顺序：',
 '1. 创建全新 GitHub 仓库并导入 sources/MSWQ-github.zip 内的源文件。',
 '2. 新 Cloudflare 创建 2 个 D1、1 个 R2、1 个 KV。',
 '3. 按 manifest.json 中的数据恢复 D1 schema + 行记录，恢复 KV 二进制值，',
 '   恢复 R2 对象的原始 key、字节、httpMetadata、customMetadata（签名必须保留）。',
 '4. 部署 GitHub 源码，绑定 DB、DOCX_DB、DOCX_KV、FILES（名称必须一致）。',
 '5. 重新创建 ADMIN_PASSWORD、ADMIN_TOTP_SECRET 两个 Secret。',
 '6. 检查白名单 IP、访问网址、原版个人流程、附件、DOCX 文档、后台菜单、',
 '   原版 HTML 文件包；成功验收前不要停用旧账号服务。',
 '',
 '⚠ 本 ZIP 不包含无法提取的 Cloudflare/GitHub/Google 登录凭据或动态验证码密钥。',
 '⚠ 新账号 Worker 地址及资源 ID 会改变；自定义域名需要重新绑定。',
 '⚠ 内含私有内容、DOCX、IP 白名单和历史版本，请勿上传公开仓库。',
 '⚠ 为防止备份期间变更造成不一致，请在不编辑发布的状态下下载。',
 '',
 'GitHub source repository: '+repo,
 '生成时间 UTC: '+new Date().toISOString(),
 ''
 ].join('\n');
}
async function mswqBackupInventory(env){
 if(!env.DB||!env.DOCX_DB||!env.DOCX_KV||!env.FILES)throw Error('备份所需的数据库、文件存储绑定缺失');
 const [main,docx,r2,kv]=await Promise.all([
  mswqBackupDB(env.DB),mswqBackupDB(env.DOCX_DB),
  mswqBackupObjects(env),mswqBackupKvKeys(env)
 ]);
 return {main,docx,r2,kv};
}
async function mswqFullBackupResponse(env){
 const all=await mswqBackupInventory(env);
 const sourceRepo=/^[\w.-]+\/[\w.-]+$/.test(String(env.MSWQ_BACKUP_GITHUB_REPO||''))
  ?String(env.MSWQ_BACKUP_GITHUB_REPO):'mosen6266-netizen/MSWQ';
 // Bundle the exact deployed source files, avoiding an outbound GitHub request.
 // The complete source snapshot is updated in private R2 on every release.
 const sourceSnapshot=await env.FILES.get('mswq-private/source-snapshot-v1.json');
 if(!sourceSnapshot)throw Error('完整源码快照尚未上传，本次备份已取消');
 const sourceFiles=JSON.parse(await sourceSnapshot.text());
 const assetPaths={
  html:'public/index.html',js:'public/app.js',css:'public/app.css',
  personalSwitch:'public/personal-switch.js',bridge:'public/legacy-bridge.js',
  legacy:'legacy/flow-editor.html',docx:'legacy/docx-public.html',
  packageUpload:'public/package-upload.js',packageUI:'public/html-package-ui.js'
 };
 for(const [asset,path] of Object.entries(assetPaths)){
  if(typeof ASSETS[asset]!=='string')throw Error('源码资产缺失：'+asset);
  sourceFiles[path]=ASSETS[asset];
 }
 const sourceArchiveEntries=Object.entries(sourceFiles)
  .sort(([a],[b])=>a.localeCompare(b))
  .map(([name,content])=>mswqTextEntry(name,content));
 if(sourceArchiveEntries.length<15)throw Error('源码文件列表不完整，本次备份已取消');
 const today=new Date().toISOString();
 const manifest={
  format:'mswq-full-migration-v1',createdAt:today,
  repo:sourceRepo,
  content:{d1:{main:all.main.tables.map(t=>t.name),docx:all.docx.tables.map(t=>t.name)},
   r2Objects:all.r2.length,r2Bytes:all.r2.reduce((a,x)=>a+(x.size||0),0),
   kvKeys:all.kv.length},
  sourceArchive:'sources/MSWQ-github.zip',
  r2DeduplicatedObjects:new Set(all.r2.map(x=>x.zipPath)).size,
  security:'Excluded account credentials and secret values; regenerate in destination'
 };
 const entries=[
  mswqJsonEntry('manifest.json',manifest),
  mswqTextEntry('READ-FIRST.txt',mswqBackupInstructions(sourceRepo)),
  mswqJsonEntry('d1/main/schema.json',all.main.schema),
  mswqJsonEntry('d1/docx/schema.json',all.docx.schema),
  mswqJsonEntry('r2/index.json',all.r2),
  mswqJsonEntry('kv/index.json',all.kv),
  {name:'sources/MSWQ-github.zip',parts:()=>mswqZipEntries(sourceArchiveEntries)}
 ];
 for(const [dbName,db,info] of [
  ['main',env.DB,all.main],['docx',env.DOCX_DB,all.docx]
 ]){
  for(const table of info.tables){
   entries.push({
    name:'d1/'+dbName+'/rows/'+encodeURIComponent(table.name)+'.jsonl',
    parts:()=>mswqBackupRows(db,table.name)
   });
  }
 }
 const storedObjects=new Set();
 for(const file of all.r2){
  if(storedObjects.has(file.zipPath))continue;
  storedObjects.add(file.zipPath);
  entries.push({
   name:file.zipPath,
   parts:async function*(){
    const object=await env.FILES.get(file.key);
    if(!object)throw Error('备份中对象丢失: '+file.key);
    if(object.etag!==file.etag||object.size!==file.size)
     throw Error('备份期间文件发生变化，请在停止编辑后重新打包：'+file.key);
    yield* mswqReadable(object.body);
   }
  });
 }
 for(const item of all.kv){
  entries.push({
   name:item.zipPath,
   parts:async function*(){
    const bytes=await env.DOCX_KV.get(item.name,'arrayBuffer');
    if(bytes===null)throw Error('备份中 KV 数据丢失: '+item.name);
    yield new Uint8Array(bytes);
   }
  });
 }
 const generator=mswqZipEntries(entries);
 const body=new ReadableStream({
  async pull(controller){
   try{
    const next=await generator.next();
    if(next.done)controller.close();
    else controller.enqueue(next.value);
   }catch(error){console.error('MSWQ full export error:',error);controller.error(error);}
  },
  cancel(){return generator.return?.();}
 });
 const stamp=today.slice(0,19).replace(/[T:]/g,'-');
 return new Response(body,{status:200,headers:{
  'Content-Type':'application/zip',
  'Content-Disposition':'attachment; filename="MSWQ-complete-'+stamp+'.zip"',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff',
  'X-MSWQ-Backup-Format':'mswq-full-migration-v1'
 }});
}
async function mswqBackupInventoryResponse(env){
 const data=await mswqBackupInventory(env);
 const counts=async(db,info)=>{
  const list=[];
  for(const t of info.tables){
   const name='"'+t.name.replace(/"/g,'""')+'"';
   const result=await db.prepare('SELECT COUNT(*) AS count FROM '+name).first();
   list.push({table:t.name,rows:Number(result?.count||0)});
  }
  return list;
 };
 const [main,docx]=await Promise.all([counts(env.DB,data.main),counts(env.DOCX_DB,data.docx)]);
 return out({
  ok:true,format:'mswq-full-migration-v1',
  tables:{main,docx},r2Objects:data.r2.length,
  r2Bytes:data.r2.reduce((a,x)=>a+(x.size||0),0),docxKvKeys:data.kv.length,
  sourceRepo:String(env.MSWQ_BACKUP_GITHUB_REPO||'mosen6266-netizen/MSWQ')
 });
}
