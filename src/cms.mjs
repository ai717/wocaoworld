import { createServer } from 'node:http';
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ROOT, loadConfig, distDir } from './config.mjs';
import { openStore, listSourcesWithCounts, deletePostsForSource, saveStore } from './store.mjs';
import { runBuild } from './build.mjs';
import { runSync } from './sync.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const execFileAsync = promisify(execFile);
const HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>wocao.world CMS</title>
<style>:root{color-scheme:light;--bg:#f6f7f9;--card:#fff;--line:#d9dee7;--muted:#667085;--accent:#2563eb;--text:#182230}*{box-sizing:border-box}body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);margin:0;color:var(--text)}main{max-width:980px;margin:0 auto;padding:28px 18px 60px}h1{margin:0 0 4px;font-size:26px;color:#101828}h2{margin:28px 0 12px;font-size:19px;color:#182230}.sub{margin:0;color:var(--muted)}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0 12px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 2px 8px #1018280a}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{display:flex;flex-direction:column;gap:5px}.field.full{grid-column:1/-1}label{font-weight:600;font-size:13px;color:#344054}input,select,textarea{font:inherit;padding:9px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#182230;width:100%}textarea{min-height:72px;resize:vertical}button{font:inherit;border:1px solid var(--line);border-radius:7px;background:#fff;color:#182230;padding:8px 12px;cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:#b42318}.status{white-space:pre-wrap;background:#eef2f7;border-radius:8px;padding:10px;color:#344054;min-height:42px}.source{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start}.source-main{min-width:0}.source-url{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.source-actions{display:flex;flex-wrap:wrap;gap:6px}.source-edit{display:grid;grid-template-columns:minmax(0,1fr) 130px auto;gap:8px;margin-top:10px}.hint{color:var(--muted);font-size:13px}@media(max-width:640px){main{padding:20px 12px 40px}.grid,.source{grid-template-columns:1fr}.field.full{grid-column:auto}.source-actions{justify-content:flex-start}.source-edit{grid-template-columns:1fr}.toolbar button{flex:1 1 45%}}
</style><main><h1>wocao.world CMS</h1><p class=sub>仅供本机使用 · 移除订阅源不会删除历史文章</p>
<div class=toolbar><button onclick="act('sync')">同步订阅源</button><button onclick="act('build')">构建站点</button><button onclick="act('preview')" class=primary>构建并预览前台</button><button onclick="act('publish')">构建并发布</button></div>
<div id=status class=status>准备就绪</div><h2>站点设置</h2><form id=settings class=card><div class=grid><div class=field><label for=title>站点标题</label><input id=title required></div><div class=field><label for=lang>语言</label><input id=lang required placeholder="zh-CN"></div><div class="field full"><label for=description>站点描述</label><textarea id=description></textarea></div><div class="field full"><label for=footer>页面底部文案</label><textarea id=footer placeholder="留空则使用默认文案"></textarea></div><div class="field full"><label for=siteUrl>站点地址（决定 GitHub Pages 路径）</label><input id=siteUrl type=url required></div><div class=field><label for=postsPerPage>每页文章数（1-100）</label><input id=postsPerPage type=number min=1 max=100 required></div><div class=field><label><input id=noindex type=checkbox> 禁止搜索引擎索引</label><span class=hint>输出 noindex,follow</span></div></div><p><button class=primary>保存站点设置</button></p></form>
<h2>订阅源</h2><form id=form class="card source-edit"><input id=url type=url required placeholder="https://example.com/feed.xml"><select id=mode><option value=excerpt>仅摘要（推荐）</option><option value=full>全文镜像</option></select><button class=primary>新增订阅源</button></form><div id=list></div></main>
<script>
const $=id=>document.getElementById(id); const status=t=>$('status').textContent=t;
async function load(){const r=await fetch('/api/state');const d=await r.json();const s=d.site;$('title').value=s.title;$('description').value=s.description;$('footer').value=s.footer||'';$('siteUrl').value=s.url;$('lang').value=s.lang;$('postsPerPage').value=s.postsPerPage;$('noindex').checked=s.noindex;$('list').innerHTML=d.sources.map(s=>'<div class="card source"><div class=source-main><b>#'+s.id+' '+esc(s.title||s.url)+'</b><div class=source-url>'+esc(s.url)+'</div><span class=hint>'+s.post_count+' 篇 · '+(s.active?'启用':'已停用')+' · '+esc(s.mode==='excerpt'?'仅摘要':'全文')+'</span></div><div class=source-actions><button onclick="edit('+s.id+')">编辑</button><button class=danger onclick="removeSource('+s.id+')">移除（保留文章）</button></div><div id=e'+s.id+' hidden class="source-edit"><input id="u'+s.id+'" value="'+esc(s.url)+'"><select id="m'+s.id+'"><option value="excerpt" '+(s.mode==='excerpt'?'selected':'')+'>仅摘要</option><option value="full" '+(s.mode==='full'?'selected':'')+'>全文</option></select><button class=primary onclick="save('+s.id+')">保存</button></div></div>').join('')||'<div class=card>暂无订阅源</div>';}
function esc(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function edit(id){$('e'+id).hidden=!$('e'+id).hidden;}
async function save(id){const r=await fetch('/api/sources/'+id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({url:$('u'+id).value,mode:$('m'+id).value})});status(await r.text());load();}
async function removeSource(id){if(!confirm('移除该订阅源？历史文章会保留。'))return;const r=await fetch('/api/sources/'+id,{method:'DELETE'});status(await r.text());load();}
async function removeAndDelete(id){if(!confirm('危险操作：移除订阅源并删除该源全部历史文章？'))return;if(!confirm('再次确认：文章将永久删除。'))return;const r=await fetch('/api/sources/'+id+'?deletePosts=1',{method:'DELETE'});status(await r.text());load();}
async function act(name){status('执行中…');const r=await fetch('/api/actions/'+name,{method:'POST'});status(await r.text());if(name==='build'||name==='preview'||name==='sync')load();}
$('form').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:$('url').value,mode:$('mode').value})});status(await r.text());if(r.ok)$('url').value='';load();};$('settings').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/site',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:$('title').value,description:$('description').value,footer:$('footer').value,url:$('siteUrl').value,lang:$('lang').value,postsPerPage:Number($('postsPerPage').value),noindex:$('noindex').checked})});status(await r.text());load();};function addDeleteButtons(){document.querySelectorAll('.source-actions').forEach(a=>{if(a.querySelector('.delete-all'))return;const b=document.createElement('button');b.className='danger delete-all';b.textContent='移除并删除文章';b.onclick=()=>removeAndDelete(Number(a.querySelector('button').getAttribute('onclick').match(/\\d+/)[0]));a.appendChild(b);});}load().then(addDeleteButtons);setInterval(addDeleteButtons,500);
</script>`;

function json(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function atomicConfig(file, value) {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}

async function body(req) {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function startCms({ port = 65354, host = '127.0.0.1', log = console.log } = {}) {
  const configFile = path.join(ROOT, 'config.json');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://cms.local');
      if (req.method === 'GET' && (url.pathname === '/cms/' || url.pathname === '/cms')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML); return; }
      const staticConfig = loadConfig(configFile); const base = staticConfig.site.basePath;
      if (req.method === 'GET' && url.pathname === '/') {
        const target = path.join(distDir(), 'index.html');
        if (!existsSync(target)) { res.writeHead(404); res.end('请先执行构建'); return; }
        const file = readFileSync(target); res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': file.byteLength }); res.end(file); return;
      }
      if (req.method === 'GET' && ((!base && !url.pathname.startsWith('/api/') && url.pathname !== '/cms' && url.pathname !== '/cms/') || (base && (url.pathname === base || url.pathname.startsWith(`${base}/`))))) {
        const rel = decodeURIComponent(base ? url.pathname.slice(base.length) : url.pathname).replace(/^\/+/, '');
        let target = path.normalize(path.join(distDir(), rel));
        if (!target.startsWith(distDir() + path.sep) && target !== distDir()) { res.writeHead(404); res.end(); return; }
        if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'index.html');
        if (!existsSync(target) || !statSync(target).isFile()) { res.writeHead(404); res.end(); return; }
        const file = readFileSync(target); res.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream', 'content-length': file.byteLength }); res.end(file); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') { const store = openStore(); try { const config = loadConfig(configFile); json(res, { site: config.site, sources: listSourcesWithCounts(store) }); } finally { store.close(); } return; }
      if (req.method === 'PUT' && url.pathname === '/api/site') {
        const input = await body(req); const raw = JSON.parse(readFileSync(configFile, 'utf8')); const site = raw.site ?? {};
        if (!input.title || !input.url || !input.lang) throw new Error('标题、地址、语言不能为空');
        const parsed = new URL(input.url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('站点地址只支持 http/https');
        if (!Number.isInteger(input.postsPerPage) || input.postsPerPage < 1 || input.postsPerPage > 100) throw new Error('每页文章数必须是 1-100 的整数');
        raw.site = { ...site, title: String(input.title), description: String(input.description ?? ''), footer: String(input.footer ?? ''), url: input.url, lang: String(input.lang), postsPerPage: input.postsPerPage, noindex: input.noindex !== false };
        atomicConfig(configFile, raw); loadConfig(configFile); json(res, { ok: true }); return;
      }
      if (url.pathname === '/api/sources' && req.method === 'POST') {
        const input = await body(req); const config = loadConfig(configFile); if (!input.url) throw new Error('缺少 Feed URL');
        if (config.sources.some(s => s.url === input.url)) throw new Error('该 URL 已存在');
        config.sources.push({ url: input.url, mode: input.mode === 'full' ? 'full' : 'excerpt' }); atomicConfig(configFile, { ...JSON.parse(readFileSync(configFile, 'utf8')), sources: config.sources }); json(res, { ok: true }); return;
      }
      const match = /^\/api\/sources\/(\d+)$/.exec(url.pathname);
      if (match && (req.method === 'PUT' || req.method === 'DELETE')) {
        const id = Number(match[1]); const store = openStore(); const source = store.sources.find(s => s.id === id); store.close(); if (!source) throw new Error('订阅源不存在');
        const raw = JSON.parse(readFileSync(configFile, 'utf8')); const current = raw.sources ?? [];
        if (req.method === 'DELETE') { raw.sources = current.filter(s => s.url !== source.url); atomicConfig(configFile, raw); if (url.searchParams.get('deletePosts') === '1') { const clean = openStore(); const deleted = deletePostsForSource(clean, id); const row = clean.sources.find(s => s.id === id); if (row) { row.active = false; clean.sourcesDirty = true; } saveStore(clean); clean.close(); json(res, { ok: true, message: `已移除配置并删除 ${deleted} 篇历史文章` }); } else { json(res, { ok: true, message: '已移除配置，历史文章保留' }); } return; }
        const input = await body(req); const duplicate = current.some(s => s.url === input.url && s.url !== source.url); if (duplicate) throw new Error('该 URL 已存在');
        raw.sources = current.map(s => s.url === source.url ? { url: input.url, mode: input.mode === 'full' ? 'full' : 'excerpt' } : s); atomicConfig(configFile, raw); json(res, { ok: true }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/actions/build') { const config = loadConfig(); const store = openStore(); try { json(res, runBuild(config, store)); } finally { store.close(); } return; }
      if (req.method === 'POST' && url.pathname === '/api/actions/sync') { const config = loadConfig(); const store = openStore(); try { const failed = await runSync(store, config, (m) => log(`[sync] ${m}`)); json(res, { failed }); } finally { store.close(); } return; }
      if (req.method === 'POST' && url.pathname === '/api/actions/preview') { const config = loadConfig(); const store = openStore(); try { runBuild(config, store); } finally { store.close(); } json(res, { url: `http://${host}:65354/` }); return; }
      if (req.method === 'POST' && url.pathname === '/api/actions/publish') { const config = loadConfig(); const store = openStore(); try { runBuild(config, store); } finally { store.close(); } try { const { stdout, stderr } = await execFileAsync('bash', ['deploy/publish-github.sh'], { cwd: ROOT }); json(res, { stdout, stderr }); } catch (err) { json(res, { error: err.stderr?.trim() || err.message, stdout: err.stdout?.trim() || '' }, 400); } return; }
      res.writeHead(404); res.end('Not found');
    } catch (err) { json(res, { error: err.message }, 400); }
  });
  server.listen(port, host, () => { log(`CMS 管理台: http://${host}:${server.address().port}/`); });
  return server;
}
