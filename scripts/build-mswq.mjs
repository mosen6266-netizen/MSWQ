// Reproducible MSWQ compiler. Run from repository root with Node.js 20+.
// It embeds original UI files verbatim, adds the dedicated DOCX backend and
// streaming migration exporter, and never includes account credentials.
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const sourceFile=relative=>readFile(path.join(root,relative),'utf8');
const manifest={
 html:'public/index.html',
 js:'public/app.js',
 css:'public/app.css',
 personalSwitch:'public/personal-switch.js',
 bridge:'public/legacy-bridge.js',
 legacy:'legacy/flow-editor.html',
 docx:'legacy/docx-public.html',
 packageUpload:'public/package-upload.js',
 packageUI:'public/html-package-ui.js'
};
const assetEntries=await Promise.all(Object.entries(manifest).map(async([name,filepath])=>[name,await sourceFile(filepath)]));
const assets=Object.fromEntries(assetEntries);
const [worker,docxBackend,backup]=await Promise.all([
 sourceFile('src/worker.js'),sourceFile('src/docx-admin-backend.js'),sourceFile('src/backup-export.js')
]);
if(!worker.includes('const ASSETS = __MSWQ_ASSETS__;')||!worker.includes('const DOCX_ADMIN_BACKEND = __MSWQ_DOCX_API__;'))throw Error('MSWQ build placeholders missing');
let compiled=worker
 .replace('__MSWQ_ASSETS__',()=>JSON.stringify(assets))
 .replace('__MSWQ_DOCX_API__',()=>docxBackend.trim());
const destinationHost=process.env.MSWQ_HTML_ORIGIN;
if(destinationHost){
 const url=new URL(destinationHost);
 if(url.protocol!=='https:')throw Error('MSWQ_HTML_ORIGIN must use HTTPS');
 const re=/const HTML_VIEW_ORIGIN = 'https:\/\/[^']+';/;
 if(!re.test(compiled))throw Error('HTML host constant missing');
 compiled=compiled.replace(re,'const HTML_VIEW_ORIGIN = '+JSON.stringify(url.origin)+';');
}
compiled+='\n'+backup+'\n';
// Include every project source file not already embedded in ASSETS.
// Exclude local credentials, build outputs, dependency caches and backups.
const frontend=new Set(Object.values(manifest));
const skipDirectories=new Set(['.git','.wrangler','node_modules','dist','__pycache__']);
const allowedExtensions=new Set(['.md','.js','.mjs','.html','.css','.sql','.json','.jsonc','.toml','.py','.txt','.gitignore']);
const extras={};
async function scan(relative=''){
 const current=path.join(root,relative);
 for(const item of await readdir(current,{withFileTypes:true})){
  if(item.name.startsWith('.env')||item.name.startsWith('.dev.vars')||item.name.endsWith('.zip')||item.name.endsWith('.bak'))continue;
  const file=relative?relative+'/'+item.name:item.name;
  if(item.isDirectory()){
   if(!skipDirectories.has(item.name))await scan(file);
   continue;
  }
  if(!item.isFile()||frontend.has(file))continue;
  if(!allowedExtensions.has(path.extname(item.name).toLowerCase())&&item.name!=='.gitignore')continue;
  const bytes=await readFile(path.join(root,file));
  if(bytes.length>3000000)throw Error('Project source file too large for embedded snapshot: '+file);
  extras[file]=bytes.toString('utf8');
 }
}
await scan();
if(Object.keys(extras).length<8)throw Error('Source file snapshot appears incomplete');
compiled+='\nconst MSWQ_BACKUP_SOURCE_EXTRAS = '+JSON.stringify(extras)+';\n';
if(compiled.includes('const ASSETS = __MSWQ_ASSETS__')||compiled.includes('const DOCX_ADMIN_BACKEND = __MSWQ_DOCX_API__'))throw Error('Unreplaced placeholders');
await mkdir(path.join(root,'dist'),{recursive:true});
await writeFile(path.join(root,'dist/mswq-worker.mjs'),compiled);
console.log('Created dist/mswq-worker.mjs ('+Buffer.byteLength(compiled)+' bytes)');
console.log('Files '+Object.keys(assets).join(', '));
console.log('HTML origin '+(destinationHost||'existing source default; set MSWQ_HTML_ORIGIN for a new account'));
