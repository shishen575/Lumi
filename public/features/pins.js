// ピン留め: 過去の分を、一度だけ数えれば、あとは、ピン留めされるたびに、自動で足されます
Dash.registerTab({
  name: 'pins', title: 'ピン留め',
  pages: [{
    id: 'status', title: 'ピン留めの数', icon: 'list',
    async render(el, { api, esc, toast, pageHeader }) {
      let timer, sig = null;
      const when = (t) => (t ? new Date(t).toLocaleString('ja-JP') : '—');
      const table = (rows, head) => (rows?.length ? `<table><tr><th>#</th><th>${head}</th><th>件数</th></tr>${rows.map((r, n) => `<tr><td>${n + 1}</td><td>${esc(r.name)}</td><td><b>${r.count}</b></td></tr>`).join('')}</table>` : '<p class="mut">まだ、ありません</p>');
      const prog = (h) => `${h.done ?? 0} / ${h.total || '?'} チャンネル ・ 見つけたピン留め ${h.found ?? 0}件${h.current ? ` ・ いま: ${h.current}` : ''}`;
      const draw = async () => {
        const s = await api('/status'), h = s.state, r = s.result, busy = h?.status === 'running';
        const nsig = JSON.stringify([busy, h?.status, h?.finishedAt, r?.total]);
        if (sig === nsig && el.querySelector('#sc')) { // 変わっていなければ、進み具合の文字だけ、書き換える(画面は、描き直さない)
          const scp = el.querySelector('#scp'); if (busy && scp) scp.textContent = prog(h);
          if (busy) schedule(4000); return;
        }
        sig = nsig; const y = window.scrollY;
        el.innerHTML = `${pageHeader('ピン留めの数', '過去の分を、一度だけ数えれば、あとは、ピン留めされるたびに、自動で足されます(探し直しは、しません)。')}
          <div class="card"><h2>${r?.partial ? '記録(いまからの分)' : '過去の分も、入れた記録'}</h2>
            <p class="hint">「◯◯さんが、メッセージをピン留めしました」というシステムのメッセージを、全チャンネルの履歴から拾って、数えます。外したピンも、入ります。メッセージが多いと、時間がかかります(裏で動くので、画面は、閉じても大丈夫です)。消されたシステムメッセージは、数えられません。</p>
            <div class="acts"><button class="btn" id="sc" type="button" ${busy ? 'disabled' : ''}>${busy ? '調べています…' : h?.status === 'done' ? '過去の分を、もう一度、数える' : '過去の分を、数え始める'}</button></div>
            ${busy ? `<p class="hint" id="scp">${esc(prog(h))}</p>` : ''}
            ${h?.status === 'stopped' ? '<p class="hint">前回の調べは、再起動などで、途中で止まりました。もう一度、数え始めてください。</p>' : ''}
            ${h?.status === 'error' ? `<p class="hint" style="color:var(--bad,#c0392b)">調べが、止まりました: ${esc(h.error ?? '')}</p>` : ''}
            ${r ? `<p class="hint">合計 <b>${r.total}件</b>${h?.finishedAt ? ` ・ ${when(h.finishedAt)} に、過去の分を数えました` : ' ・ 過去の分は、まだ数えていません'}${r.unknown ? ` ・ 発言者が不明: ${r.unknown}件` : ''}</p>
              <div class="grid2"><div><h3>ピン留めが多いチャンネル</h3>${table(r.channels.map((c) => ({ name: '#' + c.name, count: c.count })), 'チャンネル')}</div><div><h3>ピン留めした人</h3>${table(r.pinners, '名前')}</div><div><h3>ピン留めされた発言の、発言者</h3>${table(r.targets, '名前')}</div></div>` : '<p class="hint">まだ、記録がありません。</p>'}</div>`;
        window.scrollTo(0, y);
        el.querySelector('#sc').onclick = async () => { try { const x = await api('/scan', { method: 'POST' }); toast(x.started ? '数え始めました' : 'すでに、調べています'); } catch (e) { toast(e.message); } sig = null; schedule(1500); };
        if (busy) schedule(4000);
      };
      const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(() => { if (el.isConnected) draw().catch(() => {}); }, ms); };
      await draw();
    },
  }],
});
