// 外のサイトとの連携: 相手が送ってきた「使いたい機能」から、設定の画面を、自動で作る
Dash.registerTab({
  name: 'integrations', title: '連携',
  pages: [{
    id: 'list', title: '連携', icon: 'inbox',
    async render(el, { api, esc, toast, pageHeader, channels: getChannels, roles: getRoles }) {
      const st = await api('/');
      const [chans, roles] = await Promise.all([getChannels(), getRoles()]);
      const when = (t) => (t ? new Date(t).toLocaleString('ja-JP') : 'まだありません');
      const opts = (list, sel, blank) => `<option value="">${blank}</option>${list.map((x) => `<option value="${x.id}" ${sel === x.id ? 'selected' : ''}>${x.name ? (list === chans ? '#' : '') + esc(x.name) : x.id}</option>`).join('')}`;
      const field = (it, f) => {
        const v = it.config.values?.[f.key], id = `${it.id}__${f.key}`;
        const input = f.type === 'channel' ? `<select data-k="${f.key}" data-t="channel">${opts(chans, v, 'チャンネルを選ぶ')}</select>`
          : f.type === 'role' ? `<select data-k="${f.key}" data-t="role">${opts(roles.filter((r) => r.assignable), v, 'ロールを選ぶ')}</select>`
          : f.type === 'toggle' ? `<label class="sw"><input type="checkbox" data-k="${f.key}" data-t="toggle" ${v ? 'checked' : ''}><i></i><span><b>オン</b></span></label>`
          : `<input data-k="${f.key}" data-t="${f.type}" type="${f.type === 'number' ? 'number' : 'text'}" value="${esc(v ?? '')}">`;
        return `<div class="field"><label class="f" for="${id}">${esc(f.label)}</label>${input}${f.help ? `<div class="mut small">${esc(f.help)}</div>` : ''}</div>`;
      };
      const card = (it) => {
        if (it.status === 'waiting') return `<div class="card" data-id="${it.id}"><h2>${esc(it.name)} <span class="mut small">(接続待ち)</span></h2>
          <p class="mut">${it.pairExp > Date.now() ? `相手の接続を、待っています(${new Date(it.pairExp).toLocaleTimeString('ja-JP')} まで)。` : '接続用トークンの期限が切れました。削除して、もう一度、発行してください。'}</p>
          <div class="acts"><button class="btn danger del" type="button">削除</button></div></div>`;
        const m = it.manifest;
        return `<div class="card" data-id="${it.id}"><h2>${esc(it.name)}</h2>
          <p class="mut">${esc(m.description || '')}<br>最後の通信: ${when(it.lastSeen)} ・ ID <code>${it.id}</code></p>
          <p class="mut small">相手が、使いたいと言っている機能です。<b>オンにした機能だけ</b>、動きます。</p>
          ${m.capabilities.map((c) => { const cap = st.caps[c], f = cap.field; return `<div class="card" style="margin:8px 0"><label class="sw"><input type="checkbox" data-cap="${c}" ${it.config.enabled?.[c] ? 'checked' : ''}><i></i><span><b>${esc(cap.label)}</b><small>${esc(cap.help)}</small></span></label>${f ? field(it, f) : ''}</div>`; }).join('') || '<p class="mut">相手は、機能を求めていません。</p>'}
          ${m.settings.length ? `<h3>そのほかの設定</h3>${m.settings.map((f) => field(it, f)).join('')}` : ''}
          <div class="acts"><button class="btn save" type="button">保存</button><button class="btn danger del" type="button">連携を削除</button></div></div>`;
      };
      el.innerHTML = `${pageHeader('連携', '外のサイトと連携します。接続用トークンを発行して、相手のサイトに貼ると、相手が使いたい機能が届き、<b>設定の画面が、自動でできます</b>。')}
        <div class="card"><h2>接続用トークンを発行</h2>
          <div class="field"><label class="f" for="pn">連携の名前</label><input id="pn" maxlength="30" placeholder="例: めし帖"></div>
          <div class="acts"><button class="btn" id="pair" type="button">発行する</button></div>
          <p class="mut small">相手には、「接続先: <code>${esc(st.base || location.origin)}/internal/register</code>」と、トークンを渡します。トークンは、1回だけ表示され、${st.ttlMin}分で使えなくなります。コマンドでも、<code>/integration create</code> で発行できます。</p></div>
        ${st.items.map(card).join('') || '<div class="card"><p class="mut">まだ、連携はありません。</p></div>'}`;
      el.querySelector('#pair').onclick = async () => {
        const name = el.querySelector('#pn').value.trim(); if (!name) return toast('名前を入れてください');
        try {
          const r = await api('/pair', { method: 'POST', body: { name } });
          Dash.modal('接続用トークン', `<p class="mut">この1回しか、表示されません。${st.ttlMin}分で使えなくなります。</p><input readonly style="width:100%" value="${esc(r.token)}" onclick="this.select()"><p class="mut small">接続先: <code>${esc(st.base || location.origin)}/internal/register</code></p>`, [{ label: '閉じる', primary: true, onClick: () => location.reload() }]);
        } catch (e) { toast(e.message); }
      };
      el.querySelectorAll('.card[data-id]').forEach((c) => {
        const id = c.dataset.id;
        c.querySelector('.del')?.addEventListener('click', async () => { if (!(await Dash.confirm({ title: '連携を削除', message: 'この連携を削除しますか?(相手は、使えなくなります)', ok: '削除', danger: true }))) return; await api(`/${id}`, { method: 'DELETE' }); toast('削除しました'); location.reload(); });
        c.querySelector('.save')?.addEventListener('click', async () => {
          const enabled = {}, values = {};
          c.querySelectorAll('[data-cap]').forEach((x) => { enabled[x.dataset.cap] = x.checked; });
          c.querySelectorAll('[data-k]').forEach((x) => { values[x.dataset.k] = x.dataset.t === 'toggle' ? x.checked : x.value; });
          try { await api(`/${id}`, { method: 'PUT', body: { enabled, values } }); toast('保存しました'); } catch (e) { toast(e.message); }
        });
      });
    },
  }],
});
