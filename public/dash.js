// ダッシュボード本体。機能タブは Dash.registerTab({name,title,render(el, ctx)}) で追加する
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tabs = {};
window.Dash = { registerTab: (t) => { tabs[t.name] = t; }, esc, $ };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 2500); }
async function req(path, opts = {}) {
  const r = await fetch('/api' + path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
  if (r.status === 401) { location.reload(); throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || `エラー (${r.status})`); throw new Error(j.error); }
  return j;
}
window.Dash.toast = toast;

const app = $('#app');
let features = [];

async function main() {
  const me = await fetch('/api/me');
  if (me.status === 401) { app.innerHTML = '<div class="card"><h2>ログイン</h2><p>管理するサーバーを選ぶためにDiscordでログインしてください。</p><a href="/auth/login"><button>Discordでログイン</button></a></div>'; return; }
  const { user } = await me.json();
  $('#who').textContent = user.name;
  $('#out').hidden = false;
  $('#out').onclick = async () => { await fetch('/auth/logout', { method: 'POST' }); location.reload(); };
  features = await req('/features');
  await Promise.all(features.filter((f) => f.ui).map((f) => new Promise((ok) => { const s = document.createElement('script'); s.src = f.ui; s.onload = s.onerror = ok; document.head.append(s); })));
  const gid = location.hash.slice(1);
  gid ? guildView(gid) : guildList();
}
window.onhashchange = () => location.reload();

async function guildList() {
  const { guilds: all, invite } = await req('/guilds');
  const guilds = [...all].sort((a, b) => b.botIn - a.botIn || a.name.localeCompare(b.name, 'ja')); // BOT導入済みを上に
  app.innerHTML = `<div class="card"><h2>サーバーを選択</h2>${guilds.map((g) => `<div class="guild"><span>${esc(g.name)}</span>${g.botIn ? `<a href="#${g.id}"><button>設定</button></a>` : `<a href="${invite}&guild_id=${g.id}&disable_guild_select=true" target="_blank"><button class="sec">BOTを招待</button></a>`}</div>`).join('') || '<p class="mut">管理権限のあるサーバーがありません</p>'}</div>`;
}

async function guildView(gid) {
  const { guilds } = await req('/guilds');
  const g = guilds.find((x) => x.id === gid);
  if (!g || !g.botIn) { location.hash = ''; return; }
  $('#title').innerHTML = `<a href="#" style="color:inherit;text-decoration:none">←</a> ${esc(g.name)}`;
  const ctx = {
    gid, toast, esc,
    api: (p, o) => req(`/guilds/${gid}${p}`, o),
    feature: (name) => (p, o) => req(`/guilds/${gid}/f/${name}${p}`, o),
    roles: () => (ctx._roles ??= req(`/guilds/${gid}/roles`)),
    channels: () => (ctx._ch ??= req(`/guilds/${gid}/channels`)),
  };
  const list = features.filter((f) => tabs[f.name]);
  app.innerHTML = '<div class="tabs"></div><div id="tab"></div>';
  const open = (name) => {
    for (const b of app.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.n === name);
    const el = $('#tab'); el.innerHTML = '';
    tabs[name].render(el, { ...ctx, api: ctx.feature(name) });
  };
  $('.tabs').innerHTML = list.map((f) => `<button data-n="${f.name}">${esc(f.title)}</button>`).join('');
  $('.tabs').onclick = (e) => e.target.dataset.n && open(e.target.dataset.n);
  if (list[0]) open(list[0].name); else $('#tab').textContent = '利用可能な機能がありません';
}
main();
