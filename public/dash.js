/* Lumi ダッシュボード本体。
 * 機能は Dash.registerTab({ name, title, pages: [{ id, title, icon, render(el, ctx) }] }) でメニューに追加する。
 * (render だけを持つ単一ページの書き方も使える。core: true なら、サーバー直下のAPIを ctx.api で受け取る) */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVEL = { operator: '運営', owner: 'オーナー', admin: '管理者', role: '管理ロール' };

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
  download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16zM13 7l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 8v5M12 17h.01M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] ?? ''}</svg>`;

const tabs = {};
function toast(msg, kind = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 2800);
}
async function req(path, opts = {}) {
  const r = await fetch('/api' + path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
  if (r.status === 401) { location.reload(); throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || `エラーが発生しました (${r.status})`, 'err'); throw new Error(j.error || r.status); }
  return j;
}

/** モーダル。buttons: [{ label, cls, onClick(close, el) }] */
function modal(title, bodyHtml, buttons = []) {
  const bg = document.createElement('div'); bg.className = 'mbg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2></header><div class="mb">${bodyHtml}</div><footer></footer></div>`;
  const foot = $('footer', bg), prev = document.activeElement;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  buttons.forEach((b) => { const el = document.createElement('button'); el.type = 'button'; el.className = `btn ${b.cls ?? ''}`; el.textContent = b.label; el.onclick = () => b.onClick?.(close, bg); foot.append(el); });
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey); document.body.append(bg);
  ($('input:not([type=checkbox]), select, textarea, footer button:last-child', bg))?.focus();
  return { el: bg, close };
}
const confirmDialog = ({ title, message, ok = 'OK', danger = false }) => new Promise((resolve) => {
  let done = false, obs; const fin = (v, close) => { if (!done) { done = true; obs?.disconnect(); resolve(v); close?.(); } };
  const m = modal(title, `<p>${message}</p>`, [
    { label: 'キャンセル', cls: 'ghost', onClick: (c) => fin(false, c) },
    { label: ok, cls: danger ? 'danger' : '', onClick: (c) => fin(true, c) }]);
  obs = new MutationObserver(() => { if (!m.el.isConnected) fin(false); }); obs.observe(document.body, { childList: true });
});
const pageHeader = (title, sub = '', actions = '') => `<div class="ph"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="acts">${actions}</div></div>`;

window.Dash = { registerTab: (t) => { tabs[t.name] = t; }, esc, $, $$, ic, toast, modal, confirm: confirmDialog, pageHeader, LEVEL };

/* ---------- テーマ ---------- */
const THEMES = ['auto', 'light', 'dark'];
const themeNow = () => { try { return localStorage.getItem('lumi-theme') || 'auto'; } catch { return 'auto'; } };
function paintTheme() {
  const t = themeNow(), b = $('#theme');
  b.innerHTML = ic(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'auto');
  b.title = `表示テーマ: ${{ auto: '自動', light: 'ライト', dark: 'ダーク' }[t]}`;
}
$('#theme').onclick = () => {
  const n = THEMES[(THEMES.indexOf(themeNow()) + 1) % 3];
  try { n === 'auto' ? localStorage.removeItem('lumi-theme') : localStorage.setItem('lumi-theme', n); } catch { /* 保存できなくても動く */ }
  n === 'auto' ? delete document.documentElement.dataset.theme : (document.documentElement.dataset.theme = n);
  paintTheme();
};
paintTheme();

/* ---------- 画面 ---------- */
const app = $('#app');
const state = { user: null, features: [], guilds: null, invite: '', gid: null, ctx: null };
const iconUrl = (g) => (g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith('a_') ? 'gif' : 'png'}?size=96` : '');
const gicon = (g) => `<div class="gicon">${g.icon ? `<img src="${iconUrl(g)}" alt="" loading="lazy">` : esc([...g.name][0] ?? '?')}</div>`;

async function main() {
  const me = await fetch('/api/me');
  if (me.status === 401) {
    app.innerHTML = `<div class="login"><img src="icon.svg" alt=""><h1>Lumi ダッシュボード</h1><p>管理するサーバーを選ぶために、Discordでログインしてください。</p><a class="btn" href="/auth/login">Discordでログイン</a></div>`;
    return;
  }
  state.user = (await me.json()).user;
  $('#who').textContent = state.user.name; $('#who').hidden = false;
  $('#out').hidden = false;
  $('#out').onclick = async () => { await fetch('/auth/logout', { method: 'POST' }); location.hash = ''; location.reload(); };
  state.features = await req('/features');
  await Promise.all(state.features.filter((f) => f.ui).map((f) => new Promise((ok) => { const s = document.createElement('script'); s.src = f.ui; s.onload = s.onerror = ok; document.head.append(s); })));
  window.addEventListener('hashchange', route);
  route();
}

async function loadGuilds() {
  const r = await req('/guilds'); state.guilds = r.guilds; state.invite = r.invite; state.operator = r.operator;
}

async function route() {
  const [gid, page] = location.hash.slice(1).split('/');
  if (!gid) { state.gid = null; return guildList(); }
  if (!state.guilds) await loadGuilds();
  const g = state.guilds.find((x) => x.id === gid && x.botIn);
  if (!g) { location.hash = ''; return; }
  guildView(g, page);
}

async function guildList() {
  document.title = 'Lumi ダッシュボード';
  app.innerHTML = '<div class="wrap"><div class="skeleton"></div></div>';
  await loadGuilds();
  const on = state.guilds.filter((g) => g.botIn).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const off = state.guilds.filter((g) => !g.botIn).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  app.innerHTML = `<div class="wrap">
    <div class="h-row"><div><h1>サーバーを選択</h1><p class="mut" style="margin:4px 0 0">設定するサーバーを選んでください。${state.operator ? '運営として、BOTが入っているすべてのサーバーを操作できます。' : ''}</p></div></div>
    ${on.length ? `<div class="guilds">${on.map((g) => `<a class="gcard link" href="#${g.id}">${gicon(g)}<div class="gmeta"><div class="gname">${esc(g.name)}</div><span class="badge">${esc(LEVEL[g.level] ?? '')}</span></div>${ic('back', '')}</a>`).join('')}</div>`
      : `<div class="card empty">${ic('inbox')}<h2>操作できるサーバーがありません</h2><p>BOTが入っていて、あなたがオーナー・管理者・管理ロールのどれかに当てはまるサーバーが、ここに並びます。管理ロールは、サーバーのオーナーか管理者が、ダッシュボードの「アクセス権限」で選びます。</p></div>`}
    ${off.length ? `<div class="sec-t">BOTを招待できるサーバー</div><div class="guilds">${off.map((g) => `<div class="gcard">${gicon(g)}<div class="gmeta"><div class="gname">${esc(g.name)}</div><span class="badge mut">未導入</span></div><a class="btn ghost sm" href="${state.invite}&guild_id=${g.id}&disable_guild_select=true" target="_blank" rel="noopener">招待</a></div>`).join('')}</div>` : ''}
  </div>`;
  $$('.gcard.link svg').forEach((s) => (s.style.transform = 'rotate(180deg)'));
}

const pageList = (t) => (t.pages ?? [{ id: '', title: t.title, icon: t.icon, render: t.render }]);
const keyOf = (t, p) => (p.id ? `${t.name}.${p.id}` : t.name);

function guildView(g, pageKey) {
  const list = [...state.features.filter((f) => tabs[f.name]).map((f) => tabs[f.name]), ...Object.values(tabs).filter((t) => t.core)];
  const all = list.flatMap((t) => pageList(t).map((p) => ({ t, p, key: keyOf(t, p) })));
  const cur = all.find((x) => x.key === pageKey) ?? all[0];
  if (!cur) { app.innerHTML = '<div class="wrap"><p class="mut">利用できる機能がありません</p></div>'; return; }

  if (state.gid !== g.id || !$('.shell', app)) { // サーバーが変わったときだけ枠を作り直す
    state.gid = g.id;
    const ctx = state.ctx = {
      gid: g.id, level: g.level, guild: g, toast, esc, ic, modal, confirm: confirmDialog, pageHeader,
      api: (p, o) => req(`/guilds/${g.id}${p}`, o),
      feature: (name) => (p, o) => req(`/guilds/${g.id}/f/${name}${p}`, o),
      roles: () => (ctx._roles ??= req(`/guilds/${g.id}/roles`)),
      channels: () => (ctx._ch ??= req(`/guilds/${g.id}/channels`)),
    };
    const groups = list.map((t) => `<div class="nav-g">${esc(t.title)}</div>` + pageList(t).map((p) => `<a href="#${g.id}/${keyOf(t, p)}" data-k="${keyOf(t, p)}">${ic(p.icon ?? 'list')}${esc(p.title)}</a>`).join('')).join('');
    app.innerHTML = `<div class="shell"><aside class="side"><a class="back" href="#">${ic('back')} サーバー一覧</a>
      <div class="gh">${gicon(g)}<div class="gmeta"><div class="gname">${esc(g.name)}</div><span class="badge">${esc(LEVEL[g.level] ?? '')}</span></div></div>
      <nav class="nav" aria-label="メニュー">${groups}</nav></aside><section class="main"><div class="page" id="page"></div></section></div>`;
  }
  $$('.nav a').forEach((a) => (a.dataset.k === cur.key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `${cur.p.title} | ${g.name} | Lumi`;
  // ページごとに専用の入れ物を作る(前のページの非同期処理が、新しいページを書き換えないように)
  const box = document.createElement('div'); box.innerHTML = '<div class="skeleton"></div>';
  $('#page').replaceChildren(box); window.scrollTo({ top: 0 });
  const ctx = { ...state.ctx, api: cur.t.core ? state.ctx.api : state.ctx.feature(cur.t.feature ?? cur.t.name) };
  Promise.resolve(cur.p.render(box, ctx)).catch((e) => {
    if (e.message === 'login') return;
    box.innerHTML = `<div class="card empty">${ic('alert')}<h2>読み込めませんでした</h2><p>${esc(e.message)}</p><button class="btn ghost" type="button" onclick="location.reload()">再読み込み</button></div>`;
  });
}
main();
