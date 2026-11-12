// コアのタブ: アクセス権限(ダッシュボードを操作できるロールを選ぶ)
Dash.registerTab({
  name: 'access', title: '管理', core: true,
  pages: [{
    id: '', title: 'アクセス権限', icon: 'shield',
    async render(el, { api, roles: getRoles, esc, toast, level, ic, pageHeader }) {
      const [acc, roles] = await Promise.all([api('/access'), getRoles()]);
      const picked = new Set(acc.roles);
      el.innerHTML = `${pageHeader('アクセス権限', 'このサーバーのダッシュボードを操作できる人を決めます。')}
        <div class="card"><h2>いつでも操作できる人</h2>
          <ul style="margin:8px 0 0;padding-left:1.2em"><li>サーバーのオーナー</li><li>管理者権限を持つ人</li><li>下で選んだ「管理ロール」を持つ人</li></ul>
          <p class="hint" style="margin-top:10px">「ロールの管理」権限だけでは、操作できません。あなたの立場: <span class="badge">${esc(Dash.LEVEL[level] ?? level)}</span></p></div>
        <div class="card"><h2>管理ロール</h2>
          <p class="sub">選んだロールを持つ人が、ダッシュボードを操作できます(最大25個)。管理ロールの人は、自分の最上位ロールより上のロールを、ルールに設定できません。</p>
          ${acc.canEdit ? '' : '<p class="badge warn" style="margin-bottom:12px">変更できるのは、オーナー・管理者・運営だけです</p>'}
          <div class="rolegrid" id="rl">${roles.length ? roles.map((r) => `<label class="rolepick"><input type="checkbox" value="${r.id}" ${picked.has(r.id) ? 'checked' : ''} ${acc.canEdit ? '' : 'disabled'}><span class="dot" style="background:${r.color}"></span><span class="t">${esc(r.name)}</span></label>`).join('') : '<p class="mut">選べるロールがありません</p>'}</div>
          ${acc.canEdit ? '<div class="acts" style="margin-top:16px"><button class="btn" id="save" type="button">保存</button></div>' : ''}
        </div>`;
      const save = el.querySelector('#save');
      if (save) save.onclick = async () => {
        const ids = [...el.querySelectorAll('#rl input:checked')].map((i) => i.value);
        await api('/access', { method: 'PUT', body: { roles: ids } }); toast('保存しました');
      };
    },
  }],
});
