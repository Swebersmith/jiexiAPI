export const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>jiexiAPI · 服务管理</title><link rel="stylesheet" href="/admin/style.css"><script src="/admin/app.js" defer></script></head>
<body>
<div id="login-view" class="login-shell">
  <form id="login-form" class="login-card"><div class="brand-mark">j<span>·</span></div><p class="eyebrow">CRAYON / JIEXI API</p><h1>管理你的解析服务</h1><p class="muted">采集源、解析线路与接口测试。</p><label for="password">管理密码</label><input id="password" type="password" required autocomplete="current-password" maxlength="256" placeholder="输入管理员密码"><button class="primary" type="submit">登录后台 <span>↗</span></button><p id="login-status" role="status"></p></form>
</div>
<div id="app-view" class="app-shell" hidden>
  <aside class="sidebar"><a class="wordmark" href="/admin/">jiexi<span>API</span><i></i></a><p class="sidebar-caption">CRAYON PLAYER</p><nav aria-label="管理导航"><button class="nav-item active" data-section="overview"><span>◉</span>服务概览</button><button class="nav-item" data-section="sources"><span>▤</span>采集源管理</button><button class="nav-item" data-section="parsers"><span>⇄</span>解析接口</button><button class="nav-item" data-section="ai"><span>✧</span>AI 搜索</button><button class="nav-item" data-section="test"><span>⌘</span>解析测试</button></nav><div class="sidebar-bottom"><span class="status-dot"></span> Cloudflare Workers<button id="logout" class="text-button">退出登录 ↗</button></div></aside>
  <main><header class="topbar"><span>工作空间 <span class="slash">/</span> 解析服务</span><a id="player-link" href="https://crap.webber.qzz.io" target="_blank" rel="noopener">打开播放器 ↗</a></header>
  <div class="content"><div class="page-heading"><div><p class="eyebrow">SERVICE CONSOLE</p><h1 id="section-title">服务概览</h1><p id="section-description" class="muted">查看请求处理路径与当前部署配置。</p></div><button id="refresh" class="secondary">↻ 刷新配置</button></div>
  <div id="message" class="notice" role="status" hidden></div>
  <section data-page="overview">
    <div class="summary-grid"><article class="summary"><span class="metric-label">统一接口</span><h2>jiexiAPI<span class="small-dot"></span></h2><p>由你的 Cloudflare Worker 接收请求</p></article><article class="summary"><span class="metric-label">已启用采集源</span><h2 id="source-count">—</h2><p id="source-summary">读取配置中</p></article><article class="summary"><span class="metric-label">已启用解析接口</span><h2 id="parser-count">—</h2><p id="parser-summary">读取配置中</p></article><article class="summary"><span class="metric-label">网页资源解析</span><h2>解析 <span id="page-status" class="tag">读取中</span></h2><p>采集源匹配与已配置解析接口</p></article></div>
    <article class="panel"><div class="panel-heading"><div><h2>一个入口，三条处理路径</h2><p>播放器 → 你的 jiexiAPI → 对应处理服务</p></div><span class="tag">当前架构</span></div><div class="route-list"><div class="route-row"><span class="route-icon">文</span><div><h3>影片名称</h3><p>搜索采集源，读取播放线路与分集</p></div><span class="route-destination">苹果 CMS 采集 API <span>↗</span></span></div><div class="route-row"><span class="route-icon">▷</span><div><h3>视频媒体直链</h3><p>M3U8 / MP4 / WebM / M4V</p></div><span class="route-destination">Crayon 播放器 <span>↗</span></span></div><div class="route-row"><span class="route-icon">↗</span><div><h3>视频网站播放页</h3><p>腾讯、优酷、爱奇艺、芒果 TV、B 站</p></div><span class="route-destination">采集站与解析接口 <span>↗</span></span></div></div></article>
    <article class="panel configuration"><div><h2>部署信息</h2><p>采集源、解析接口与网页解析开关保存后用于后续请求。</p></div><dl><div><dt>运行环境</dt><dd>Cloudflare Workers</dd></div><div><dt>配置存储</dt><dd id="storage">—</dd></div><div><dt>配置版本</dt><dd id="revision">—</dd></div><div><dt>最近保存</dt><dd id="updated">—</dd></div><div><dt>媒体公开域名</dt><dd id="public-origin">—</dd></div></dl></article>
  </section>
  <section data-page="sources" hidden><form id="config-form"><article class="panel"><div class="panel-heading"><div><h2>苹果 CMS 采集源</h2><p>支持 JSON 采集 API，最多配置 8 个源。</p></div><button id="add-source" class="secondary" type="button">＋ 添加采集源</button></div><div id="source-list"></div></article><article class="panel switch-panel"><div><h2>网页资源解析</h2><p>启用后，按采集源与解析接口策略处理视频网页。</p></div><label class="toggle-label"><input id="page-enabled" type="checkbox">启用网页解析</label></article><div class="save-bar"><span id="save-hint" class="muted">保存后生效</span><button id="save" type="submit" class="primary">保存配置 ↗</button></div></form></section>
  <section data-page="parsers" hidden><form id="parser-form"><article class="panel"><div class="panel-heading"><div><h2>解析接口服务</h2><p>接入 JSON 接口或 QL 内置适配器，最多配置 8 个。</p></div><button id="add-parser" type="button" class="secondary">＋ 添加解析接口</button></div><div id="parser-list"></div></article><article class="panel switch-panel"><div><h2>调用策略</h2><p>采集优先会在采集失败后按接口顺序尝试；合并比选会检测各接口结果并按清晰度、连接速度排序。</p></div><label for="parser-mode">解析策略<select id="parser-mode"><option value="fallback">采集优先，接口顺序回退</option><option value="combined">采集与接口合并比选</option></select></label></article><div class="save-bar"><span id="parser-save-hint" class="muted">保存并启用后，可在解析测试中选择接口。</span><button id="save-parsers" type="submit" class="primary">保存全部配置 ↗</button></div></form></section>
  <section data-page="ai" hidden>
    <form id="ai-form"><article class="panel switch-panel"><div><h2>AI 搜索筛选</h2><p>对采集站候选进行相关性判断，支持片名片段和少量错字，并校验片名相似度。</p></div><label class="toggle-label"><input id="ai-enabled" type="checkbox">启用 AI 筛选</label></article>
    <article class="panel ai-fields"><label for="ai-model">模型名称<input id="ai-model" required maxlength="100" placeholder="glm-4-flash-250414"></label><label for="ai-key">GLM API Key<input id="ai-key" type="password" maxlength="2048" autocomplete="off" placeholder="留空保留现有密钥"><span id="ai-key-status" class="muted"></span></label><label id="ai-clear-key-label" class="toggle-label" hidden><input id="ai-clear-key" type="checkbox">清除自定义密钥，使用部署密钥</label><p class="muted">自定义密钥加密保存，页面仅显示配置状态。AI 服务异常时会显示采集站原始结果和状态提示。</p></article>
    <div class="save-bar"><span id="ai-save-hint" class="muted">保存后生效</span><button type="submit" class="primary">保存 AI 配置 ↗</button></div></form>
    <article class="panel"><div class="panel-heading"><div><h2>测试搜索筛选</h2><p>测试使用已保存配置，查看筛选数量和保留片名。</p></div></div><form id="ai-test-form" class="ai-test-form"><label for="ai-test-input">搜索词</label><div class="test-controls"><input id="ai-test-input" required maxlength="80" value="走马上任"><button id="ai-run-test" type="submit" class="primary">测试筛选 ↗</button></div><p id="ai-test-status" role="status" class="muted"></p><ul id="ai-test-results" class="ai-results-list"></ul></form></article>
  </section>
  <section data-page="test" hidden><article class="panel"><div class="panel-heading"><div><h2>测试统一接口</h2><p>输入片名、媒体直链或视频网站播放页，查看真实接口响应。</p></div><code>POST /api/resolve</code></div><form id="test-form"><label for="test-parser">调用方式</label><select id="test-parser"><option value="auto">自动，使用已保存策略</option><option value="cms">仅采集源</option></select><label for="test-input">测试内容</label><div class="test-controls"><input id="test-input" required maxlength="8192" placeholder="例如 熊出没，或 https://…/video.m3u8"><button id="run-test" type="submit" class="primary">发起请求 ↗</button></div></form><div id="test-result" hidden><div class="test-meta"><span id="test-state"></span><span id="test-time" class="muted"></span></div><pre id="test-output"></pre></div></article></section>
  <footer><span>jiexiAPI <span class="slash">/</span> Crayon Player</span><span>配置管理与在线调试</span></footer>
  </div></main>
</div></body></html>`;

const baseStyles = `
*{box-sizing:border-box} [hidden]{display:none!important} :root{font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif;color:#e9edf2;background:#0b1017;font-synthesis:none}body{margin:0;font-size:14px;line-height:1.6}button,input{font:inherit}button,a,input{ -webkit-tap-highlight-color:transparent}a{color:inherit;text-decoration:none}button{cursor:pointer;transition:background .18s,border-color .18s}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible{outline:2px solid #ade9d5;outline-offset:4px}input{width:100%;background:#0c131d;border:1px solid #293442;border-radius:9px;color:#e9edf2;padding:11px 13px;outline:none;min-width:0}input:focus{border-color:#94cbb9;box-shadow:0 0 0 3px #a1e6d011}input[type=checkbox]{width:17px;height:17px;accent-color:#a1e6d0}label{display:block;color:#aab6c7;font-size:12px;margin-bottom:7px}.primary,.secondary{border-radius:9px;padding:10px 17px;white-space:nowrap}.primary{background:#a1e6d0;color:#10271f;border:1px solid #a1e6d0;font-weight:600}.primary:hover{background:#bdf2e1}.secondary{background:#151e2a;color:#bdc9d8;border:1px solid #2a3543}.secondary:hover{background:#1d2938}.muted{color:#8190a4}.eyebrow{font-size:10px;letter-spacing:.16em;color:#8ebdab;font-weight:600;margin:0 0 10px}h1{font-size:30px;letter-spacing:-.04em;line-height:1.3;font-weight:600;margin:0 0 9px}h2{font-size:15px;font-weight:550;margin:0}h3{font-size:14px;font-weight:500;margin:0}p{margin:5px 0}code{color:#93b6ab;font-size:12px}.app-shell{display:flex;min-height:100vh}.sidebar{width:234px;position:fixed;inset:0 auto 0 0;border-right:1px solid #202936;background:#0d141e;display:flex;flex-direction:column;padding:35px 20px 24px}.wordmark{display:flex;align-items:center;font-size:25px;font-weight:650;letter-spacing:-.05em;padding:0 13px}.wordmark span{color:#a1e6d0;font-weight:400}.wordmark i{display:inline-block;width:6px;height:6px;background:#a1e6d0;border-radius:50%;margin:10px 0 0 6px}.sidebar-caption{font-size:9px;letter-spacing:.16em;color:#67788d;padding:0 13px;margin-top:7px}.sidebar nav{margin-top:48px;display:grid;gap:7px}.nav-item{display:flex;align-items:center;gap:13px;width:100%;padding:12px 15px;text-align:left;background:none;color:#8d9caf;border:1px solid transparent;border-radius:9px}.nav-item span{font-size:17px;width:18px}.nav-item.active{background:#a1e6d00c;color:#b1e6d6;border-color:#a1e6d01e}.sidebar-bottom{margin-top:auto;font-size:11px;color:#728399;padding:10px 13px}.status-dot,.small-dot{display:inline-block;width:6px;height:6px;background:#a1e6d0;border-radius:50%;vertical-align:middle;margin-right:5px}.text-button{display:block;border:0;background:none;padding:18px 0 0;color:#9aabbd;font-size:12px}.app-shell main{margin-left:234px;flex:1;min-width:0}.topbar{height:75px;border-bottom:1px solid #1c2531;display:flex;align-items:center;justify-content:space-between;padding:0 45px;font-size:12px;color:#7e8da2}.topbar a{color:#b5c4d4}.slash{padding:0 10px;color:#3e5066}.content{padding:39px 45px 0;max-width:1500px;margin:auto}.page-heading{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:31px}.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-bottom:24px}.summary{padding:23px 24px;border:1px solid #24303e;background:linear-gradient(140deg,#151e2b,#101823);border-radius:13px}.metric-label{font-size:12px;color:#8e9db0}.summary h2{font-size:29px;letter-spacing:-.04em;margin:14px 0 8px;font-weight:500}.summary p{font-size:11px;color:#7e8fa6}.summary .small-dot{margin-left:10px;box-shadow:0 0 14px #a1e6d040}.tag{display:inline-block;vertical-align:middle;font-size:10px;letter-spacing:0;border:1px solid #a1e6d026;border-radius:5px;background:#a1e6d00a;color:#a4d8c7;padding:3px 8px}.panel{background:#101823;border:1px solid #24303e;border-radius:13px;margin-bottom:23px;overflow:hidden}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:23px 25px;border-bottom:1px solid #222d3b}.panel-heading p,.configuration p,.switch-panel p{font-size:12px;color:#7e8da3;margin-top:5px}.route-list{padding:0 25px}.route-row{display:flex;align-items:center;gap:16px;min-height:100px;border-bottom:1px solid #212b38}.route-row:last-child{border:0}.route-icon{display:grid;place-items:center;width:37px;height:37px;background:#192535;color:#a9bece;border:1px solid #2a3849;border-radius:10px;font-size:16px;flex-shrink:0}.route-row p{font-size:12px;color:#7f8fa4;margin-top:4px}.route-destination{margin-left:auto;font-size:12px;color:#b8c9d7}.route-destination span{color:#77968b;padding-left:20px}.configuration{padding:25px;display:grid;grid-template-columns:1fr 1.35fr;gap:25px}dl{margin:0}dl div{display:flex;justify-content:space-between;gap:20px;padding:7px 0;font-size:12px}dt{color:#7e8fa5}dd{margin:0;word-break:break-all;text-align:right}.notice{padding:12px 16px;border:1px solid #8fc5b34d;background:#a1e6d00b;color:#b4e1d3;border-radius:9px;margin-bottom:20px;overflow-wrap:anywhere}.notice.error{border-color:#ec9f9f44;color:#edb0b0;background:#ed999909}footer{padding:26px 0;display:flex;justify-content:space-between;color:#51667c;font-size:10px;margin-top:26px;border-top:1px solid #1c2734}.source-row{padding:20px 25px;border-bottom:1px solid #222d3b}.source-row:last-child{border:0}.source-row-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.source-fields{display:grid;grid-template-columns:150px 180px minmax(150px,1fr);gap:14px}.source-fields label{margin:0}.source-fields input{margin-top:7px}.toggle-label{white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:9px;margin:0;color:#c0cddd}.remove-source{color:#cb9999;background:none;border:0;padding:3px 0;font-size:12px}.switch-panel{display:flex;justify-content:space-between;align-items:center;padding:23px 25px;gap:20px}.save-bar{display:flex;justify-content:space-between;align-items:center;font-size:12px}.test-controls{display:flex;gap:12px}#test-form{padding:25px}#test-result{padding:0 25px 25px}.test-meta{display:flex;justify-content:space-between;margin-bottom:10px;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0a111b;border:1px solid #253143;padding:18px;border-radius:9px;color:#a9c4bb;font:12px/1.8 "Cascadia Code",Consolas,monospace;max-height:560px;overflow:auto;margin:0}.login-shell{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 0,#18283a 0,transparent 60%)}.login-card{width:min(100%,420px);background:#111b28;border:1px solid #2b384a;border-radius:18px;padding:38px}.brand-mark{font-size:50px;line-height:1;letter-spacing:-.1em;color:#e1eee8;margin-bottom:29px}.brand-mark span{color:#a1e6d0}.login-card h1{font-size:26px}.login-card label{margin-top:30px}.login-card .primary{display:flex;justify-content:space-between;width:100%;margin-top:16px}.login-card p[role=status]{font-size:12px;color:#e6b0b0;min-height:20px;margin-top:14px}
@media(min-width:1500px){.content{padding-top:50px}}@media(max-width:1100px){.sidebar{width:198px}.app-shell main{margin-left:198px}.content{padding:30px 25px 0}.topbar{padding:0 25px}.source-fields{grid-template-columns:1fr 1fr}.source-fields label:last-child{grid-column:1/-1}.configuration{grid-template-columns:1fr}}@media(max-width:760px){.sidebar{position:static;width:auto;padding:18px 20px 10px;border-right:0;border-bottom:1px solid #24303e}.app-shell{display:block}.wordmark{padding:0;font-size:22px}.sidebar-caption{display:none}.sidebar-bottom{display:block;position:absolute;right:20px;top:11px;padding:0;font-size:0}.sidebar-bottom .status-dot{display:none}.sidebar-bottom .text-button{padding:5px 0}.sidebar nav{display:flex;margin-top:17px;gap:4px}.nav-item{padding:9px 10px;font-size:12px;justify-content:center}.nav-item span{display:none}.app-shell main{margin-left:0}.topbar{height:55px;padding:0 20px}.content{padding:26px 18px 0}.page-heading{align-items:flex-start;gap:12px;margin-bottom:22px}h1{font-size:25px}.page-heading p.muted{font-size:12px}.page-heading .secondary{font-size:11px;padding:8px 10px}.summary-grid{grid-template-columns:1fr;gap:11px}.summary{padding:17px 20px}.summary h2{font-size:25px;margin:6px 0}.panel-heading{padding:20px;align-items:flex-start}.route-list{padding:0 20px}.route-row{flex-wrap:wrap;gap:12px;padding:18px 0}.route-destination{width:100%;padding-left:49px}.configuration{padding:20px}.source-fields{grid-template-columns:1fr}.source-fields label:last-child{grid-column:auto}.source-row{padding:20px}.switch-panel{padding:20px}.test-controls{flex-direction:column}.topbar a{font-size:11px}footer span:last-child{display:none}}`;

export const styles = baseStyles + `
select, textarea { font: inherit; color: #e9edf2; background: #0c131d; border: 1px solid #293442; border-radius: 9px; padding: 10px 12px; width: 100%; min-width: 0; }
select:focus, textarea:focus { outline: 2px solid #94cbb9; outline-offset: 2px; }
textarea { resize: vertical; min-height: 108px; font: 12px/1.6 Consolas, monospace; }
.summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.parser-fields { display: grid; grid-template-columns: 140px 1fr 1.5fr; gap: 14px; margin-top: 16px; }
.parser-fields input, .parser-fields select, #parser-mode { margin-top: 7px; }
#ai-form { margin-bottom:24px; }
.ai-fields,.ai-test-form { padding: 24px; }
.ai-fields label { margin-bottom: 18px; }
.ai-fields .muted { display:block; font-size:12px; margin-top:8px; }
#ai-test-status { margin:16px 0; font-size:13px; }
.ai-results-list { padding-left:20px; line-height:2; overflow-wrap:anywhere; }
#ai-form .switch-panel { flex-wrap:wrap; }
.parser-actions { display: flex; align-items: center; gap: 10px; }
.parser-actions .secondary { padding: 3px 11px; }
.parser-row details { margin-top: 14px; }
.parser-row summary { cursor: pointer; color: #9bafc2; font-size: 12px; }
.parser-json-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; }
.parser-json-fields textarea { margin-top: 7px; }
#parser-form .switch-panel > label { min-width: 220px; margin-bottom: 0; }
#test-parser { margin-bottom: 18px; }
@media (max-width: 1250px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) {
  .sidebar nav { flex-wrap: wrap; }
  .nav-item { width: auto; flex: 1; white-space: nowrap; }
  .parser-fields, .parser-json-fields { grid-template-columns: 1fr; }
  #parser-form .switch-panel { flex-direction: column; align-items: stretch; }
  #parser-form .switch-panel > label { min-width: 0; }
}
@media (max-width: 420px) { .summary-grid { grid-template-columns: 1fr; } .panel-heading { flex-wrap: wrap; } }
`;

export const client = String.raw`
const $ = selector => document.querySelector(selector);
let config;
let dirty = false;
const sections = { overview: ['服务概览','查看请求处理路径与当前部署配置。'], sources: ['采集源管理','配置片名搜索的数据来源与网页解析线路。'], parsers: ['解析接口','添加解析服务，配置请求格式与调用顺序。'], ai: ['AI 搜索','配置搜索结果筛选，减少采集站模糊匹配带来的无关影片。'], test: ['解析测试','使用当前保存配置，检查接口实际响应。'] };
function notify(message, failed = false) { $('#message').hidden = false; $('#message').textContent = message; $('#message').classList.toggle('error', failed); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401) showLogin(); throw new Error(data.error?.message || '请求失败'); }
  return data;
}
function showLogin() { $('#login-view').hidden = false; $('#app-view').hidden = true; $('#password').value = ''; }
function sourceRow(source = { id: '', name: '', url: '', enabled: true }) {
  const row = document.createElement('div'); row.className = 'source-row';
  row.innerHTML = '<div class="source-row-top"><label class="toggle-label"><input type="checkbox" data-field="enabled">启用采集源</label><button type="button" class="remove-source">移除</button></div><div class="source-fields"><label>唯一标识<input data-field="id" required maxlength="32" pattern="[a-z0-9_-]{1,32}" placeholder="例如 ruyi"></label><label>显示名称<input data-field="name" required maxlength="60" placeholder="例如 如意资源"></label><label>JSON 采集 API<input data-field="url" type="url" required maxlength="2048" placeholder="https://…/api.php/provide/vod"></label></div>';
  for (const field of ['id','name','url']) row.querySelector('[data-field="' + field + '"]').value = source[field];
  row.querySelector('[data-field="enabled"]').checked = source.enabled;
  row.querySelector('.remove-source').onclick = () => { row.remove(); markDirty(); };
  row.addEventListener('input', markDirty);
  $('#source-list').append(row);
}
function markDirty() { dirty = true; $('#save-hint').textContent = '有未保存的更改'; $('#parser-save-hint').textContent = '有未保存的更改'; $('#ai-save-hint').textContent = '有未保存的更改'; }
function parserOrder() {
  const rows = Array.from($('#parser-list').children);
  rows.forEach((row, index) => { row.querySelector('[data-move=up]').disabled = index === 0; row.querySelector('[data-move=down]').disabled = index === rows.length - 1; });
}
function parserRow(parser = { id: '', name: '', url: '', enabled: true, method: 'GET', urlParam: 'url', responsePath: '', headers: {}, params: {} }) {
  const row = document.createElement('div'); row.className = 'source-row parser-row';
  row.innerHTML = '<div class="source-row-top"><label class="toggle-label"><input type="checkbox" data-field="enabled">启用解析接口</label><div class="parser-actions"><button type="button" class="secondary" data-move="up" aria-label="上移接口">↑</button><button type="button" class="secondary" data-move="down" aria-label="下移接口">↓</button><button type="button" class="remove-source">移除</button></div></div><div class="source-fields"><label>唯一标识<input data-field="id" required maxlength="32" pattern="[a-z0-9_-]{1,32}" placeholder="例如 parser1"></label><label>显示名称<input data-field="name" required maxlength="60" placeholder="例如 自用解析"></label><label>解析接口地址<input data-field="url" type="url" required maxlength="2048" autocomplete="off" placeholder="https://…/api?key=…"></label></div><div class="parser-fields"><label>请求方式<select data-field="method"><option value="GET">GET</option><option value="POST">POST JSON</option><option value="QL">QL · 麒麟适配器</option></select></label><label>视频 URL 参数名<input data-field="urlParam" required maxlength="64" placeholder="url"></label><label>返回地址字段<input data-field="responsePath" maxlength="160" placeholder="留空自动识别，例如 data.url"></label></div><details><summary>请求头与额外参数</summary><div class="parser-json-fields"><label>接口请求头 JSON<textarea data-field="headers" spellcheck="false" autocomplete="off" placeholder="{}"></textarea></label><label>额外请求参数 JSON<textarea data-field="params" spellcheck="false" autocomplete="off" placeholder="{}"></textarea></label></div></details>';
  for (const field of ['id', 'name', 'url', 'method', 'urlParam', 'responsePath']) row.querySelector('[data-field="' + field + '"]').value = parser[field] ?? '';
  row.querySelector('[data-field=method]').addEventListener('change', () => { if (row.querySelector('[data-field=method]').value === 'QL') { row.querySelector('[data-field=url]').value = 'https://svip.qlplayer.cyou/'; if (!row.querySelector('[data-field=name]').value) row.querySelector('[data-field=name]').value = 'QL · 麒麟'; } });
  for (const field of ['headers', 'params']) row.querySelector('[data-field="' + field + '"]').value = JSON.stringify(parser[field] || {}, null, 2);
  row.querySelector('[data-field=enabled]').checked = parser.enabled;
  row.querySelector('[data-move=up]').onclick = () => { if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); parserOrder(); markDirty(); };
  row.querySelector('[data-move=down]').onclick = () => { if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); parserOrder(); markDirty(); };
  row.querySelector('.remove-source').onclick = () => { row.remove(); parserOrder(); markDirty(); };
  row.addEventListener('input', markDirty); row.addEventListener('change', markDirty);
  $('#parser-list').append(row); parserOrder();
}
function render(data) {
  config = data; dirty = false;
  $('#source-list').replaceChildren(); data.sources.forEach(sourceRow);
  const ai = data.aiSearch || { enabled: false, model: 'glm-4-flash-250414' };
  $('#ai-enabled').checked = ai.enabled; $('#ai-model').value = ai.model;
  $('#ai-key').value = ''; $('#ai-clear-key').checked = false;
  $('#ai-clear-key-label').hidden = ai.keySource !== 'custom';
  $('#ai-key-status').textContent = ai.keyConfigured ? ai.keySource === 'custom' ? '已配置自定义密钥，留空保留' : '已配置 Cloudflare 部署密钥，留空使用' : '尚未配置 API Key';
  $('#ai-save-hint').textContent = '保存后生效';
  $('#parser-list').replaceChildren(); (data.parsers || []).forEach(parserRow);
  $('#parser-mode').value = data.parserMode || 'fallback';
  $('#parser-count').textContent = String((data.parsers || []).filter(parser => parser.enabled).length);
  $('#parser-summary').textContent = '共 ' + (data.parsers || []).length + ' 个接口 · ' + (data.parserMode === 'combined' ? '合并比选' : '采集优先');
  const selected = $('#test-parser').value;
  $('#test-parser').replaceChildren(...[{ id: 'auto', name: '自动，使用已保存策略' }, { id: 'cms', name: '仅采集源' }, ...((data.parsers || []).some(parser => parser.id === 'ql') ? [] : [{ id: 'ql', name: 'QL · 麒麟（内置）' }]), ...(data.parsers || []).filter(parser => parser.enabled)].map(parser => { const option = document.createElement('option'); option.value = parser.id; option.textContent = parser.name; return option; }));
  $('#test-parser').value = Array.from($('#test-parser').options).some(option => option.value === selected) ? selected : 'auto';
  $('#page-enabled').checked = data.pageEnabled;
  const count = data.sources.filter(source => source.enabled).length;
  $('#source-count').textContent = String(count);
  $('#source-summary').textContent = '共 ' + data.sources.length + ' 个源 · 苹果 CMS JSON';
  $('#page-status').textContent = data.pageEnabled ? '已启用' : '已停用';
  $('#storage').textContent = data.storage === 'D1' ? 'D1 数据库' : '部署环境默认值';
  $('#revision').textContent = 'v' + data.revision;
  $('#updated').textContent = data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN') : '尚未在后台保存';
  $('#public-origin').textContent = data.publicOrigin || $('#public-origin').textContent;
  $('#save-hint').textContent = '保存后生效';
  $('#parser-save-hint').textContent = '保存并启用后，可在解析测试中选择接口。';
  $('#login-view').hidden = true; $('#app-view').hidden = false;
}
async function refresh() {
  if (dirty && !confirm('刷新将重新载入已保存配置，继续吗？')) return;
  try { render(await api('/admin/api/config')); } catch (err) { if ($('#app-view').hidden) $('#login-status').textContent = err.message; else notify(err.message, true); }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await api('/admin/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); $('#password').value = ''; $('#login-status').textContent = ''; await refresh(); }
  catch (err) { $('#login-status').textContent = err.message; }
  finally { button.disabled = false; }
});
document.querySelectorAll('[data-section]').forEach(button => button.onclick = () => {
  const name = button.dataset.section;
  document.querySelectorAll('[data-page]').forEach(page => page.hidden = page.dataset.page !== name);
  document.querySelectorAll('[data-section]').forEach(item => item.classList.toggle('active', item === button));
  $('#section-title').textContent = sections[name][0]; $('#section-description').textContent = sections[name][1];
});
$('#refresh').onclick = refresh;
$('#logout').onclick = async () => { if (dirty && !confirm('退出后未保存的更改将丢失，继续吗？')) return; try { await api('/admin/api/logout', { method: 'POST' }); dirty = false; showLogin(); } catch (err) { notify(err.message, true); } };
$('#add-source').onclick = () => { if ($('#source-list').children.length >= 8) return notify('最多支持 8 个采集源', true); sourceRow(); markDirty(); };
$('#page-enabled').onchange = markDirty;
$('#parser-mode').onchange = markDirty;
$('#add-parser').onclick = () => { if ($('#parser-list').children.length >= 8) return notify('最多支持 8 个解析接口', true); parserRow(); markDirty(); };
async function saveConfiguration(event) {
  event.preventDefault();
  const sources = Array.from($('#source-list').children, row => ({ id: row.querySelector('[data-field=id]').value.trim(), name: row.querySelector('[data-field=name]').value.trim(), url: row.querySelector('[data-field=url]').value.trim(), enabled: row.querySelector('[data-field=enabled]').checked }));
  const controls = Array.from(document.querySelectorAll('#config-form input,#config-form button,#parser-form input,#parser-form button,#parser-form select,#parser-form textarea,#ai-form input,#ai-form button'));
  const disabled = controls.map(control => control.disabled);
  try {
    const parsers = Array.from($('#parser-list').children, row => {
      const parser = {};
      for (const field of ['id', 'name', 'url', 'method', 'urlParam', 'responsePath']) parser[field] = row.querySelector('[data-field="' + field + '"]').value.trim();
      parser.enabled = row.querySelector('[data-field=enabled]').checked;
      for (const field of ['headers', 'params']) {
        try { parser[field] = JSON.parse(row.querySelector('[data-field="' + field + '"]').value || '{}'); }
        catch { throw new Error('请检查接口“' + parser.name + '”的请求头或额外参数 JSON'); }
      }
      return parser;
    });
    const payload = { sources, parsers, parserMode: $('#parser-mode').value, pageEnabled: $('#page-enabled').checked, aiSearch: { enabled: $('#ai-enabled').checked, model: $('#ai-model').value.trim(), apiKey: $('#ai-key').value.trim(), clearKey: $('#ai-clear-key').checked }, revision: config.revision };
    controls.forEach(control => control.disabled = true);
    const saved = await api('/admin/api/config', { method: 'PUT', body: JSON.stringify(payload) });
    render(saved); notify('配置已保存，后续请求使用新配置。');
  }
  catch (err) { notify(err.message, true); }
  finally { controls.forEach((control, index) => control.disabled = disabled[index]); }
}
$('#config-form').addEventListener('submit', saveConfiguration);
$('#parser-form').addEventListener('submit', saveConfiguration);
$('#ai-form').addEventListener('submit', saveConfiguration);
$('#ai-form').addEventListener('input', markDirty);
$('#ai-form').addEventListener('change', markDirty);
$('#ai-test-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#ai-run-test').disabled = true;
  $('#ai-test-status').textContent = '正在搜索采集站并筛选…'; $('#ai-test-results').replaceChildren();
  try {
    const data = await api('/api/player/search?' + new URLSearchParams({ q: $('#ai-test-input').value.trim() }), { signal: AbortSignal.timeout(35000) });
    const filter = data.aiFilter;
    $('#ai-test-status').textContent = filter?.status === 'filtered'
      ? filter.model + ' · ' + filter.inputCount + ' 条采集记录 → ' + filter.outputCount + ' 条相关记录 · ' + (filter.cacheHit ? '命中缓存' : '实时 AI 筛选')
      : filter?.status === 'empty' ? '采集站没有返回候选，无需筛选' : filter?.status === 'unavailable' ? data.warning : 'AI 筛选已关闭 · ' + data.items.length + ' 条采集记录';
    for (const item of data.items) { const row = document.createElement('li'); row.textContent = item.title + ' · ' + item.sourceName; $('#ai-test-results').append(row); }
  } catch (error) { $('#ai-test-status').textContent = error.message; }
  finally { $('#ai-run-test').disabled = false; }
});
$('#test-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#run-test').disabled = true; $('#test-result').hidden = false; $('#test-state').textContent = '请求中…'; $('#test-output').textContent = ''; $('#test-time').textContent = '';
  const started = performance.now();
  try {
    const response = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: $('#test-input').value.trim(), parser: $('#test-parser').value }), signal: AbortSignal.timeout(120000) });
    const data = await response.json(); $('#test-state').textContent = 'HTTP ' + response.status + ' · ' + (response.ok ? data.kind === 'search' ? '片名搜索 / 苹果 CMS' : data.provider === 'cms' ? '网页解析 / 采集源' : data.provider === 'external' ? '网页解析 / ' + data.parserName : '媒体直链 / Crayon' : '请求失败');
    $('#test-output').textContent = JSON.stringify(data, null, 2);
  } catch (err) { $('#test-state').textContent = '请求失败'; $('#test-output').textContent = err.message; }
  finally { $('#test-time').textContent = ((performance.now() - started) / 1000).toFixed(2) + ' 秒'; $('#run-test').disabled = false; }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
api('/admin/api/config').then(render).catch(err => { showLogin(); if (!err.message.includes('请先登录')) $('#login-status').textContent = err.message; });
`;
