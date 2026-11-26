// ピン留め: いまの数・過去の集計(ボタンで調べる)
Dash.registerTab({
  name: 'pins', title: 'ピン留め',
  pages: [{
    id: 'status', title: 'ピン留めの数', icon: 'list',
    async render(el, { api, esc, toast, pageHeader }) {
      let timer;
      const when = (t) => (t ? new Date(t).toLocaleString('ja-JP') : '—');
      const table = (rows, head) => (rows?.length ? `<table><tr><th>#</th><th>${head}</th><th>件数</th></tr>${rows.map((r, n) => `<tr><td>${n + 1}</td><td>${esc(r.name)}</td><td><b>${r.count}</b></td></tr>`).join('')}</table>` : '<p class="mut">まだ、ありません</p>');
      const draw = async () => {
        const s = await api('/status'), h = s.history.state, busy = h?.status === 'running', refreshing = !!s.refreshing;
        el.innerHTML = `${pageHeader('ピン留めの数', 'いまのピン留めと、過去のピン留め(外した分も)を、調べます。')}
          <div class="card"><h2>いまのピン留め</h2>
            <div class="acts"><button class="btn" id="rf" type="button" ${refreshing ? 'disabled' : ''}>${refreshing ? `調べています… ${s.refreshing.done} / ${s.refreshing.total}` : s.current ? '調べ直す' : '調べる'}</button></div>
            ${s.current ? `<p class="hint">${when(s.current.at)} に調べた結果: 合計 <b>${s.current.total}件</b> ・ ${s.current.scanned}チャンネルを調べました${s.current.failed ? `(読めなかった: ${s.current.failed})` : ''}</p>
              <div class="grid2"><div><h3>チャンネル別(多い順)</h3>${table(s.current.channels.map((c) => ({ name: '#' + c.name, count: c.count })), 'チャンネル')}</div><div><h3>ピン留めされた発言の、発言者</h3>${table(s.current.users, '名前')}</div></div>` : '<p class="hint">まだ、調べていません。「調べる」を押すと、全チャンネルを調べます(少し時間がかかります)。</p>'}</div>
          <div class="card"><h2>過去のピン留め(外した分も)</h2>
            <p class="hint">「◯◯さんが、メッセージをピン留めしました」というシステムのメッセージを、全チャンネルの履歴から拾って、数えます。メッセージが多いと、時間がかかります(裏で動くので、この画面は、閉じても大丈夫です)。消されたシステムメッセージは、数えられません。</p>
            <div class="acts"><button class="btn" id="sc" type="button" ${busy ? 'disabled' : ''}>${busy ? '調べています…' : h?.status === 'done' ? '調べ直す' : '数え始める'}</button></div>
            ${busy ? `<p class="hint">${h.done ?? 0} / ${h.total || '?'} チャンネル ・ 見つけたピン留め ${h.found ?? 0}件${h.current ? ` ・ いま: ${esc(h.current)}` : ''}</p>` : ''}
            ${h?.status === 'stopped' ? '<p class="hint">前回の調べは、再起動などで、途中で止まりました。もう一度、数え始めてください。</p>' : ''}
            ${h?.status === 'error' ? `<p class="hint" style="color:var(--bad,#c0392b)">調べが、止まりました: ${esc(h.error ?? '')}</p>` : ''}
            ${s.history.result ? `<p class="hint">${when(h.finishedAt)} に調べた結果: 合計 <b>${s.history.result.total}件</b>(${s.history.result.channels}チャンネル)${s.history.result.unknown ? ` ・ 発言者が不明: ${s.history.result.unknown}件` : ''}</p>
              <div class="grid2"><div><h3>ピン留めした人</h3>${table(s.history.result.pinners, '名前')}</div><div><h3>ピン留めされた発言の、発言者</h3>${table(s.history.result.targets, '名前')}</div></div>` : ''}</div>`;
        el.querySelector('#rf').onclick = async () => { try { await api('/refresh', { method: 'POST' }); toast('調べ始めました'); } catch (e) { toast(e.message); } schedule(1500); };
        el.querySelector('#sc').onclick = async () => { try { const r = await api('/scan', { method: 'POST' }); toast(r.started ? '数え始めました' : 'すでに、調べています'); } catch (e) { toast(e.message); } schedule(1500); };
        if (busy || refreshing) schedule(4000); // 調べている間は、進み具合を、自動で更新する
      };
      const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(() => { if (el.isConnected) draw().catch(() => {}); }, ms); };
      new MutationObserver(() => { if (!el.isConnected) clearTimeout(timer); }).observe(document.body, { childList: true, subtree: true });
      await draw();
    },
  }],
});
