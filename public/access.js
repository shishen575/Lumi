// コアのタブ: アクセス権限(ダッシュボードを操作できるロールを選ぶ)
Dash.registerTab({
  name: 'access', title: 'アクセス権限', core: true,
  async render(el, { api, roles: getRoles, esc, toast }) {
    const [acc, roles] = await Promise.all([api('/access'), getRoles()]);
    const who = { operator: '運営', owner: 'サーバーのオーナー', admin: '管理者', role: '管理ロール' }[acc.level];
    const picked = new Set(acc.roles);
    el.innerHTML = `
      <div class="card"><h2>ダッシュボードを操作できる人</h2>
        <p>次の人は、いつでもこのサーバーを操作できます。</p>
        <ul><li>サーバーのオーナー</li><li>管理者権限を持つ人</li><li>下で選んだロールを持つ人</li></ul>
        <p class="mut">「ロールの管理」権限だけでは、操作できません。あなたの立場: <b>${esc(who)}</b></p>
        <p class="mut">管理ロールを持つ人は、自分の最上位ロールより<b>上</b>のロールを、ルールに設定できません。</p>
      </div>
      <div class="card"><h2>管理ロール</h2>
        ${acc.canEdit ? '' : '<p class="mut">変更できるのは、サーバーのオーナー・管理者・運営だけです。</p>'}
        <div id="rl">${roles.length ? roles.map((r) => `<label style="display:flex;gap:8px;align-items:center;padding:6px 0"><input type="checkbox" value="${r.id}" ${picked.has(r.id) ? 'checked' : ''} ${acc.canEdit ? '' : 'disabled'}><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</label>`).join('') : '<p class="mut">選べるロールがありません</p>'}</div>
        ${acc.canEdit ? '<div class="row" style="margin-top:12px"><button id="save">保存</button><span class="mut">選んだロールを持つ人が、ダッシュボードを操作できるようになります(最大25個)</span></div>' : ''}
      </div>`;
    const save = el.querySelector('#save');
    if (save) save.onclick = async () => {
      const ids = [...el.querySelectorAll('#rl input:checked')].map((i) => i.value);
      await api('/access', { method: 'PUT', body: { roles: ids } }); toast('保存しました');
    };
  },
});
