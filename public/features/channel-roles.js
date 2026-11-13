// チャンネルロール: 特定のチャンネル(またはカテゴリ)で発言したら、ロールを付ける
Dash.registerTab({
  name: 'channel-roles', title: 'チャンネルロール',
  pages: [{
    id: 'rules', title: 'ルール', icon: 'list',
    async render(el, { api, roles: getRoles, esc, ic, toast, modal, confirm, pageHeader }) {
      const [roles, targets] = await Promise.all([getRoles(), api('/targets')]);
      const rById = new Map(roles.map((r) => [r.id, r]));
      const cById = new Map([...targets.channels.map((c) => [c.id, { ...c, kind: 'channel' }]), ...targets.categories.map((c) => [c.id, { ...c, kind: 'category' }])]);
      let rules = [];
      const badge = (ro) => (ro ? `<span class="role"><span class="dot" style="background:${ro.color === '#000000' ? 'var(--mut)' : ro.color}"></span>${esc(ro.name)}</span>` : '<span class="badge warn">削除されたロール</span>');

      const draw = () => {
        const list = rules.map((r) => {
          const ro = rById.get(r.role_id), ch = cById.get(r.channel_id);
          return `<div class="rule"><div class="thr" style="min-width:0">${ch ? (r.kind === 'category' ? '📁 ' + esc(ch.name) : '#' + esc(ch.name)) : '<span class="badge warn">削除されたチャンネル</span>'}<small>${r.kind === 'category' ? 'カテゴリ内のどこかで ' : ''}${r.min_messages > 1 ? `${r.min_messages.toLocaleString()}回発言したら` : '発言したら'}</small></div><span class="arrow">→</span>
            <div class="rolebox">${badge(ro)}${ro && !ro.assignable ? '<span class="badge warn">BOTより上のため付与不可</span>' : ''}${r.repeat ? '<span class="badge mut">何回でも付与</span>' : ''}${r.include_threads ? '' : '<span class="badge mut">スレッドは対象外</span>'}</div>
            <div class="acts"><button class="btn ghost icon" type="button" data-edit="${r.id}" aria-label="編集" title="編集">${ic('edit')}</button><button class="btn danger icon" type="button" data-del="${r.id}" aria-label="削除" title="削除">${ic('trash')}</button></div></div>`;
        }).join('');
        el.innerHTML = `${pageHeader('チャンネルロール', '「このチャンネル(またはカテゴリ)で発言したら、このロールを付ける」を登録します。ふだんは1人に1回だけ付き、外したロールは付け直しません。「何回でも付与」をオンにすると、発言のたびに、持っていなければ付け直します。', `<button class="btn" type="button" id="add">${ic('plus')} ルールを追加</button>`)}
          ${rules.length ? `<div class="card flush rg">${list}</div>` : `<div class="card empty">${ic('list')}<h2>まだルールがありません</h2><p>たとえば「#自己紹介 で発言したら → メンバー」「📁 雑談カテゴリ で発言したら → 参加者」。</p><button class="btn" type="button" id="add2">${ic('plus')} ルールを追加</button></div>`}
          <div class="card"><h2>仕組み</h2><ul style="margin:0;padding-left:1.2em">
            <li>ルールを登録したあとの発言から数えます(過去の発言はさかのぼりません)</li>
            <li>カテゴリを選ぶと、そのカテゴリの中のどのチャンネル(とスレッド)の発言も、合計で数えます</li>
            <li>BOTのロールより上のロールは、付けられません</li>
            <li>BOT・Webhookの発言は、数えません</li></ul></div>`;
        el.querySelector('#add').onclick = () => edit(null);
        const a2 = el.querySelector('#add2'); if (a2) a2.onclick = () => edit(null);
        el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => edit(rules.find((r) => String(r.id) === b.dataset.edit))));
        el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
          if (!await confirm({ title: 'ルールを削除', message: 'このルールを削除します。すでに付いているロールは外れません。', ok: '削除する', danger: true })) return;
          await api('/rules/' + b.dataset.del, { method: 'DELETE' }); toast('削除しました'); load();
        }));
      };
      const load = async () => { rules = await api('/rules'); draw(); };

      function edit(rule) {
        const co = `<optgroup label="カテゴリ(中のすべてのチャンネル)">${targets.categories.map((c) => `<option value="${c.id}">📁 ${esc(c.name)}(${c.channels}チャンネル)</option>`).join('')}</optgroup>
          <optgroup label="チャンネル">${targets.channels.map((c) => `<option value="${c.id}">#${esc(c.name)}${c.category ? `(${esc(c.category)})` : ''}</option>`).join('')}</optgroup>`;
        const ro = roles.map((r) => `<option value="${r.id}" ${r.assignable ? '' : 'disabled'}>${esc(r.name)}${r.assignable ? '' : '(付与不可)'}</option>`).join('');
        const m = modal(rule ? 'ルールを編集' : 'ルールを追加', `
          <div class="field"><label class="f" for="m-ch">チャンネル / カテゴリ</label><select id="m-ch">${co}</select></div>
          <div class="field"><label class="f" for="m-min">何回発言したら</label><div class="inline"><input id="m-min" type="number" min="1" inputmode="numeric" value="1"><span class="mut">回</span></div><p class="hint">1回で付けたいときは、1のままにしてください。カテゴリを選んだときは、カテゴリ内の発言の合計で数えます。</p></div>
          <div class="field"><label class="f" for="m-role">付けるロール</label><select id="m-role">${ro}</select><p class="hint">灰色のロールは、BOTまたはあなたのロールより上にあるため、選べません。</p></div>
          <label class="sw"><input type="checkbox" id="m-rp"><i></i><span><b>何回でも付与する</b><small>オフのときは、1人に1回だけ付けます。オンにすると、条件を満たしていて、ロールを持っていない人に、発言のたびに付け直します(管理者が外しても、次の発言で戻ります)</small></span></label>
          <label class="sw"><input type="checkbox" id="m-th" checked><i></i><span><b>スレッドでの発言も数える</b><small>このチャンネルの中に作られたスレッドでの発言を、このチャンネルの発言として数えます</small></span></label>`,
          [{ label: 'キャンセル', cls: 'ghost', onClick: (c) => c() },
           { label: rule ? '更新' : '追加', onClick: async (close, box) => {
             const q = (s) => box.querySelector(s);
             const body = { channel_id: q('#m-ch').value, role_id: q('#m-role').value, min_messages: q('#m-min').value, include_threads: q('#m-th').checked, repeat: q('#m-rp').checked };
             if (!body.channel_id || !body.role_id) { toast('チャンネルとロールを選んでください', 'err'); return; }
             if (rule) await api('/rules/' + rule.id, { method: 'PUT', body }); else await api('/rules', { method: 'POST', body });
             close(); toast(rule ? '更新しました' : '追加しました'); load();
           } }]);
        if (rule) {
          const q = (s) => m.el.querySelector(s);
          if (cById.has(rule.channel_id)) q('#m-ch').value = rule.channel_id;
          q('#m-min').value = rule.min_messages;
          if ([...q('#m-role').options].some((o) => o.value === rule.role_id)) q('#m-role').value = rule.role_id;
          q('#m-th').checked = !!rule.include_threads; q('#m-rp').checked = !!rule.repeat;
        }
      }
      await load();
    },
  }],
});
