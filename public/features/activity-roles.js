Dash.registerTab({
  name: 'activity-roles',
  async render(el, { api, roles: getRoles, channels: getChannels, esc, toast }) {
    const [{ metrics, botJoinedAt }, roles] = await Promise.all([api('/meta'), getRoles()]);
    const roleName = (id) => roles.find((r) => r.id === id);
    el.innerHTML = `
      <div class="card"><h2>ルール追加</h2>
        <div class="row" id="add">
          <select id="m">${Object.entries(metrics).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          <input id="t" type="number" min="1" placeholder="回数/分">
          <span>以上で</span>
          <select id="r">${roles.map((r) => `<option value="${r.id}" ${r.assignable ? '' : 'disabled'}>${esc(r.name)}${r.assignable ? '' : ' (BOTより上のため不可)'}</option>`).join('')}</select>
          <label class="mut"><input type="checkbox" id="rl"> 下位ランクのロールを外す</label>
          <button id="go">追加</button>
        </div>
        <p class="mut">同じ条件で複数登録すると段階(ランク)になります。例: 発言100→Lv1、500→Lv2、1000→Lv3</p>
      </div>
      <div class="card"><h2>登録済みルール</h2><div id="rules"></div>
        <div class="row" style="margin-top:12px"><button class="sec" id="sync">全メンバーに今すぐ適用</button><span class="mut">※通常は活動時に自動判定されます</span></div></div>
      <div class="card"><h2>過去の発言数を取り込む</h2>
        <p class="mut">BOT導入前のメッセージも数えます(発言数のみ)。全チャンネルを遡るため、メッセージ数が多いと時間がかかります。<b>現在の発言数は取り込んだ結果で上書き</b>され、完了後に全員へロールを適用します。BOTが閲覧できないチャンネルは対象外です。</p>
        <div class="row"><label>期間 <input type="date" id="bff"> 〜 <input type="date" id="bft"></label><span class="mut">(開始日の初期値はBOTを入れた日。空欄=全期間 / 終了日を含む)</span></div>
        <div class="row" style="margin-top:8px"><button id="bf">取り込み開始</button><span id="bfs" class="mut"></span></div>
        <div id="bfbar" style="display:none;margin-top:10px;height:10px;border-radius:5px;background:var(--line);overflow:hidden"><div id="bfp" style="height:100%;width:0;background:var(--acc);transition:width .5s"></div></div></div>
      <div class="card"><h2>設定</h2><div class="row">
        <label>発言カウントのクールダウン <input id="cd" type="number" min="0" max="3600" style="width:80px"> 秒</label>
        <label><input type="checkbox" id="vo"> VCは2人以上いる時だけ計測</label></div>
        <div class="row" style="margin-top:10px"><label>ロール付与の通知先 <select id="nc"><option value="">通知しない</option></select></label>
          <button class="sec" id="nt">テスト送信</button></div>
        <div class="row" style="margin-top:10px"><label style="flex:1">通知メッセージ <input id="tpl" style="width:100%" maxlength="500" placeholder="🎉 {user} さんが **{role}** を獲得しました!({condition})"></label></div>
        <p class="mut">使える変数: {user}(メンション) {name}(表示名) {role}(ロール名) {condition}(達成条件)。空欄で初期文。一括適用・過去ログ取り込み時は通知しません。</p>
        <button id="save">保存</button></div>
      <div class="card"><h2>ランキング</h2><div class="row"><select id="lm">${Object.entries(metrics).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div><div id="lb"></div></div>`;
    const $ = (s) => el.querySelector(s);

    async function loadRules() {
      const rules = await api('/rules');
      $('#rules').innerHTML = rules.length ? `<table><tr><th>条件</th><th>ロール</th><th></th></tr>${rules.map((r) => {
        const ro = roleName(r.role_id);
        return `<tr><td>${esc(metrics[r.metric])} ${r.threshold} 以上${r.replace_lower ? ' <span class="mut">(下位を外す)</span>' : ''}</td>
        <td>${ro ? `<span class="dot" style="background:${ro.color}"></span>${esc(ro.name)}` : '<span class="mut">削除済みロール</span>'}</td>
        <td><button class="del" data-id="${r.id}">削除</button></td></tr>`;
      }).join('')}</table>` : '<p class="mut">まだありません</p>';
    }
    $('#rules').onclick = async (e) => { const id = e.target.dataset.id; if (id && confirm('削除しますか？')) { await api('/rules/' + id, { method: 'DELETE' }); loadRules(); } };
    $('#go').onclick = async () => {
      await api('/rules', { method: 'POST', body: { metric: $('#m').value, threshold: $('#t').value, role_id: $('#r').value, replace_lower: $('#rl').checked } });
      $('#t').value = ''; toast('追加しました'); loadRules();
    };
    $('#sync').onclick = async () => { toast('適用中…'); const { changed } = await api('/sync', { method: 'POST' }); toast(`${changed} 件のロールを更新しました`); };
    const [s, chans] = await Promise.all([api('/settings'), getChannels()]);
    $('#cd').value = s.message_cooldown; $('#vo').checked = !!s.voice_require_others;
    $('#nc').innerHTML += chans.map((c) => `<option value="${c.id}">#${esc(c.name)}</option>`).join('');
    $('#nc').value = s.notify_channel_id || ''; $('#tpl').value = s.notify_template || '';
    const save = () => api('/settings', { method: 'PUT', body: { message_cooldown: $('#cd').value, voice_require_others: $('#vo').checked, notify_channel_id: $('#nc').value, notify_template: $('#tpl').value } });
    $('#save').onclick = async () => { await save(); toast('保存しました'); };
    $('#nt').onclick = async () => { await save(); await api('/notify-test', { method: 'POST' }); toast('テストを送信しました'); };
    async function loadLb() {
      const rows = await api('/leaderboard?metric=' + $('#lm').value);
      $('#lb').innerHTML = rows.length ? `<table>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.value}</td></tr>`).join('')}</table>` : '<p class="mut">データなし</p>';
    }
    $('#lm').onchange = loadLb;
    if (botJoinedAt) { // 開始日の初期値 = BOTを入れた日(消せば全期間)
      const d = new Date(botJoinedAt), p2 = (n) => String(n).padStart(2, '0');
      $('#bff').value = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    }
    let timer;
    async function pollBf() {
      const j = await api('/backfill');
      if (!j) { $('#bfs').textContent = ''; return; }
      $('#bf').disabled = j.running;
      const fmt = (ms) => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : m <= 1 ? '約1分以内' : `約${m}分`; };
      $('#bfbar').style.display = j.running ? 'block' : 'none';
      if (j.running) {
        $('#bfp').style.width = j.percent + '%';
        const eta = j.etaMs != null ? `残り${fmt(j.etaMs)}` : '残り時間を計算中…';
        $('#bfs').textContent = j.phase === 'collect' ? 'チャンネル一覧を取得中…'
          : j.phase === 'apply' ? 'ロールを適用中…'
          : `${j.percent}% ・ ${eta} ・ チャンネル ${j.done}/${j.total} ・ ${j.scanned.toLocaleString()}件確認${j.current ? ' (#' + j.current + ')' : ''}`;
        timer = setTimeout(pollBf, 2000);
      } else if (j.status === 'interrupted') {
        $('#bfs').innerHTML = `中断されました(${j.percent}% まで完了) <button class="sec" id="bfr">続きから再開</button>`;
        $('#bfr').onclick = async () => { await api('/backfill/resume', { method: 'POST' }); pollBf(); };
        $('#bf').disabled = false;
      } else if (j.error) $('#bfs').textContent = 'エラー: ' + j.error;
      else { $('#bfs').textContent = `完了(${j.from ? new Date(j.from).toLocaleDateString() : '最初'}〜${j.to ? new Date(j.to - 1).toLocaleDateString() : '現在'}): ${j.users}人 / ${j.scanned.toLocaleString()}件 / ロール更新 ${j.rolesChanged ?? 0}件 ・ 所要時間 ${Math.max(1, Math.round(j.elapsedMs / 60000))}分`; loadLb(); }
    }
    $('#bf').onclick = async () => {
      const f = $('#bff').value, t = $('#bft').value;
      const range = `${f || '最初'} 〜 ${t || '現在'}`;
      if (!confirm(`期間(${range})の発言数で、現在の発言数を上書きします。よろしいですか？`)) return;
      const body = { from: f ? new Date(f + 'T00:00:00').getTime() : null, to: t ? new Date(t + 'T00:00:00').getTime() + 864e5 : null };
      await api('/backfill', { method: 'POST', body }); pollBf();
    };
    new MutationObserver(() => { if (!el.isConnected) clearTimeout(timer); }).observe(document.body, { childList: true, subtree: true });
    pollBf();
    loadRules(); loadLb();
  },
});
