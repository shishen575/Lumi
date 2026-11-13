// 通貨: 設定 / 予算
Dash.registerTab({
  name: 'economy', title: '通貨',
  pages: [
    /* ===== 設定 ===== */
    { id: 'settings', title: '通貨の設定', icon: 'coin',
      async render(el, { api, esc, toast, pageHeader }) {
        const st = await api('/settings');
        el.innerHTML = `${pageHeader('通貨の設定', '犯罪・バイト・乞食・ギャンブル(チンチロ・スロット・ブラックジャック)で遊べる、サーバーの通貨です。')}
          <div class="card"><h2>通貨機能</h2>
            <label class="sw"><input type="checkbox" id="en" ${st.enabled ? 'checked' : ''}><i></i><span><b>このサーバーで、通貨機能を使う</b><small>オンにすると、<code>/balance</code> <code>/work</code> <code>/crime</code> <code>/slot</code> などが使えます</small></span></label></div>
          <div class="card"><h2>通貨と、お金の量</h2>
            <div class="grid2">
              <div class="field"><label class="f" for="cn">通貨の名前</label><input id="cn" type="text" maxlength="10" value="${esc(st.currencyName)}"></div>
              <div class="field"><label class="f" for="ce">通貨の絵文字</label><input id="ce" type="text" maxlength="40" value="${esc(st.currencyEmoji)}"></div>
              <div class="field"><label class="f" for="sb">最初にもらえるお金</label><input id="sb" type="number" min="0" max="1000000" value="${st.startBalance}"></div>
              <div class="field"><label class="f" for="mb">1回に賭けられる上限</label><input id="mb" type="number" min="10" value="${st.maxBet}"></div>
            </div></div>
          <div class="card"><h2>借金</h2>
            <label class="sw"><input type="checkbox" id="ad" ${st.allowDebt ? 'checked' : ''}><i></i><span><b>借金を許可する</b><small>オンのとき: 罰金やチンチロの倍払いが、持っているお金を超えると、所持金が0より下(借金)になります。<b>所持金が0以下の間は、犯罪ができません</b>(バイト・乞食で返せます)。オフのとき: 持っているお金までしか、引かれません</small></span></label></div>
          <div class="card"><h2>闇マーケット</h2>
            <label class="sw"><input type="checkbox" id="bm" ${st.blackMarket ? 'checked' : ''}><i></i><span><b>闇マーケットを使う(犯罪に道具が必要)</b><small>オンのとき: 犯罪・大型犯罪に、専用の<b>道具</b>が必要になります(1回の挑戦で1つ使います)。道具は <code>/market</code> で買えて、値段は毎日少し変わります。オフのとき: 道具なしで、これまでどおり挑戦できます(<code>/market</code> は使えません)</small></span></label></div>
          <div class="card"><h2>ギャンブルの還元率</h2>
            <p class="sub">賭け金に対して、平均でどれだけ戻ってくるかを、パーセントで決めます。100%未満だと、遊ぶほど、お金が減っていきます。</p>
            <div class="field"><label class="f" for="pr">還元率(%)</label><div class="inline"><input id="pr" type="number" min="50" max="150" value="${st.payoutRate}" style="width:110px"><input id="prs" type="range" min="50" max="150" value="${st.payoutRate}" style="flex:1;min-width:120px"><span class="mut">%</span></div>
              <p class="hint">50〜150%。初期値は95%です。スロットとチンチロは、この値にぴったり合います。ブラックジャックは、プレイヤーの腕で変わるので、目安です。</p></div>
            <div id="rates"></div></div>
          <div class="acts"><button class="btn" id="save" type="button">設定を保存</button></div>`;
        const q = (x) => el.querySelector(x);
        const drawRates = async () => {
          const r = await api('/rates?rate=' + encodeURIComponent(q('#pr').value));
          q('#rates').innerHTML = `<div class="card flush" style="margin:0"><div class="card-h"><h2>スロットの配当(賭け金に対する戻り)</h2><span class="badge">${r.rate}%</span></div>
            <div style="padding:6px 18px 12px"><table><tr><th>出目</th><th>戻り</th></tr>
              ${r.slot.map((x) => `<tr><td style="font-size:20px">${x.symbol} ${x.symbol} ${x.symbol}</td><td><b>×${x.three.toLocaleString()}</b></td></tr>`).join('')}
              <tr><td style="font-size:20px">🍒 🍒</td><td><b>×${r.cherryTwo}</b></td></tr><tr><td style="font-size:20px">🍒</td><td><b>×${r.cherryOne}</b></td></tr></table>
              <p class="hint" style="margin-top:10px">チンチロの勝ちの配当は、基本の ×${r.chinchiro} 倍、ブラックジャックの勝ちの儲けは ×${r.blackjack} 倍になります(基本の還元率は、スロット約${r.baseSlotRtp.toFixed(0)}%、ブラックジャック約${r.baseBlackjack.toFixed(0)}%)。</p></div></div>`;
        };
        q('#pr').oninput = () => { q('#prs').value = q('#pr').value; };
        q('#prs').oninput = () => { q('#pr').value = q('#prs').value; };
        q('#pr').onchange = q('#prs').onchange = drawRates;
        drawRates();
        q('#save').onclick = async () => {
          await api('/settings', { method: 'PUT', body: { enabled: q('#en').checked, currencyName: q('#cn').value, currencyEmoji: q('#ce').value, startBalance: q('#sb').value, maxBet: q('#mb').value, payoutRate: q('#pr').value, allowDebt: q('#ad').checked, blackMarket: q('#bm').checked } });
          toast('保存しました');
        };
      } },

    /* ===== 留置場 ===== */
    { id: 'jail', title: '留置場', icon: 'alert',
      async render(el, { api, esc, ic, toast, confirm, pageHeader }) {
        const dur = (ms) => { const t = Math.ceil(ms / 1000), m = Math.floor(t / 60), r = t % 60; return m ? `${m}分${r ? `${r}秒` : ''}` : `${r}秒`; };
        const draw = async () => {
          const rows = await api('/jail');
          el.innerHTML = `${pageHeader('留置場', '犯罪に失敗して、留置場に入っている人です。管理者は、ここから釈放できます(Discordでは <code>/release</code> でも釈放できます)。',
            rows.length ? '<button class="btn danger" id="all" type="button">全員を釈放</button>' : '')}
            ${rows.length ? `<div class="card flush"><div class="card-h"><h2>留置場にいる人</h2><span class="badge">${rows.length}人</span></div>
              <ol class="lb">${rows.map((r) => `<li style="grid-template-columns:minmax(0,1fr) auto auto"><span class="nm">🚔 ${esc(r.name)}</span><span class="val mut">あと ${dur(r.left)}</span><button class="btn ghost sm" type="button" data-u="${r.user_id}">釈放</button></li>`).join('')}</ol></div>`
              : `<div class="card empty">${ic('check')}<h2>留置場は、空です</h2><p>犯罪に失敗した人が、ここに表示されます。</p></div>`}`;
          const q = (x) => el.querySelector(x);
          el.querySelectorAll('[data-u]').forEach((b) => (b.onclick = async () => { await api('/release', { method: 'POST', body: { user_id: b.dataset.u } }); toast('釈放しました'); draw(); }));
          if (q('#all')) q('#all').onclick = async () => {
            if (!await confirm({ title: '全員を釈放', message: `留置場にいる ${rows.length}人 を、全員釈放します。`, ok: '釈放する', danger: true })) return;
            const r = await api('/release', { method: 'POST', body: { all: true } }); toast(`${r.released}人を釈放しました`); draw();
          };
        };
        await draw();
      } },

    /* ===== 管理者ツール(残高の調整・罰金の返金・操作の記録) ===== */
    { id: 'admin', title: '残高の調整', icon: 'shield',
      async render(el, { api, esc, ic, toast, confirm, pageHeader }) {
        const st = await api('/settings'); const can = st.canEditBudget; const em = esc(st.currencyEmoji);
        const fmtN = (n) => `${em} ${Number(n).toLocaleString()}`;
        const dt = (t) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        let picked = null;
        el.innerHTML = `${pageHeader('残高の調整', '管理者が、メンバーのお金を増やす・減らす・指定した額にする、罰金を返金する、ためのページです。すべての操作は、下の記録に残ります。')}
          ${can ? '' : '<div class="card" style="background:var(--warn-soft);border-color:transparent"><b>この操作ができるのは、サーバーのオーナー・管理者・運営だけです</b><p class="small" style="margin:6px 0 0">あなたは、記録を見ることだけができます。</p></div>'}
          ${can ? `<div class="card"><h2>1. メンバーを選ぶ</h2><div class="inline"><input id="q" type="text" placeholder="名前の一部、またはユーザーID" maxlength="32" style="max-width:320px"><button class="btn ghost sm" id="find" type="button">探す</button></div><div id="found" style="margin-top:10px"></div></div>
          <div id="panel"></div>` : ''}
          <div class="card flush"><div class="card-h"><h2>操作の記録</h2></div><div id="log"></div></div>`;
        const q = (x) => el.querySelector(x);
        const drawLog = async () => {
          const rows = await api('/audit');
          q('#log').innerHTML = rows.length ? `<ol class="lb">${rows.map((r) => `<li style="grid-template-columns:minmax(0,1fr) auto"><span class="nm" style="white-space:normal"><b>${esc(r.actor_name)}</b> が ${r.target_name ? `<b>${esc(r.target_name)}</b> の ` : ''}${esc(r.action)}${r.amount != null ? ` ${fmtN(r.amount)}` : ''}${r.note ? `<br><span class="mut small">${esc(r.note)}</span>` : ''}</span><span class="mut small">${dt(r.at)}</span></li>`).join('')}</ol>` : '<div class="empty"><h2>まだ、記録がありません</h2></div>';
        };
        const drawPanel = async () => {
          if (!picked) { q('#panel').innerHTML = ''; return; }
          const a = await api('/account/' + picked);
          q('#panel').innerHTML = `<div class="card"><h2>2. ${esc(a.name)} の口座</h2>
              <div class="tiles" style="margin:10px 0 14px"><div class="tile"><div class="k">手持ち${a.wallet < 0 ? '(借金)' : ''}</div><div class="v">${fmtN(a.wallet)}</div></div><div class="tile"><div class="k">銀行</div><div class="v">${fmtN(a.bank)}</div></div></div>
              <div class="grid2"><div class="field"><label class="f" for="tg">対象</label><select id="tg"><option value="wallet">手持ち</option><option value="bank">銀行</option></select></div>
                <div class="field"><label class="f" for="md">操作</label><select id="md"><option value="add">増やす</option><option value="subtract">減らす</option><option value="set">指定した額にする</option></select></div>
                <div class="field"><label class="f" for="am">金額</label><input id="am" type="number" min="0" placeholder="1000"></div>
                <div class="field"><label class="f" for="nt">メモ(任意)</label><input id="nt" type="text" maxlength="100" placeholder="理由など"></div></div>
              <div class="acts"><button class="btn" id="apply" type="button">調整する</button></div>
              <p class="hint">予算には、影響しません(管理者による調整は、予算の出し入れとは別です)。${st.allowDebt ? '' : '借金を許可していないので、手持ちは0未満になりません。'}</p></div>
            <div class="card flush"><div class="card-h"><h2>最近の罰金(犯罪・大型犯罪)</h2></div>${a.fines.length ? `<ol class="lb">${a.fines.map((f) => `<li style="grid-template-columns:minmax(0,1fr) auto auto"><span class="nm">${f.kind === 'heist' ? '🏦 大型犯罪' : '🚔 犯罪'}の罰金 <b>${fmtN(f.amount)}</b> <span class="mut small">${dt(f.at)}</span></span>${f.refunded ? '<span class="badge ok">返金済み</span>' : `<button class="btn ghost sm" type="button" data-f="${f.id}" data-a="${f.amount}">返金する</button>`}<span></span></li>`).join('')}</ol>` : '<div class="empty"><h2>最近の罰金は、ありません</h2></div>'}</div>`;
          q('#apply').onclick = async () => {
            const body = { user_id: picked, target: q('#tg').value, mode: q('#md').value, amount: q('#am').value, note: q('#nt').value };
            if (body.amount === '') { toast('金額を入力してください', 'err'); return; }
            const label = `${a.name} の${body.target === 'bank' ? '銀行' : '手持ち'}を、${Number(body.amount).toLocaleString()} ${{ add: '増やします', subtract: '減らします', set: 'にします' }[body.mode]}。`;
            if (!await confirm({ title: '残高を調整', message: label, ok: '実行する', danger: body.mode !== 'add' })) return;
            await api('/adjust', { method: 'POST', body }); toast('調整しました'); await drawPanel(); drawLog();
          };
          el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = async () => {
            if (!await confirm({ title: '罰金を返金', message: `${a.name} に、罰金 ${Number(b.dataset.a).toLocaleString()} を返金します。(1つの罰金につき、1回だけです)`, ok: '返金する' })) return;
            const r = await api('/refund', { method: 'POST', body: { fine_id: b.dataset.f } });
            toast(r.short ? `予算が足りず、${r.paid.toLocaleString()} だけ返金しました` : '返金しました'); await drawPanel(); drawLog();
          }));
        };
        if (can) {
          const find = async () => {
            const v = q('#q').value.trim(); if (!v) return;
            const list = await api('/members?q=' + encodeURIComponent(v));
            q('#found').innerHTML = list.length ? list.map((m) => `<button class="btn ghost sm" type="button" data-id="${m.id}" style="margin:0 6px 6px 0">${esc(m.name)}</button>`).join('') : '<span class="mut small">見つかりませんでした</span>';
            q('#found').querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { picked = b.dataset.id; drawPanel(); }));
          };
          q('#find').onclick = find; q('#q').onkeydown = (e) => { if (e.key === 'Enter') find(); };
        }
        await drawLog();
      } },

    /* ===== 予算 ===== */
    { id: 'budget', title: '予算', icon: 'shield',
      async render(el, { api, esc, ic, toast, confirm, pageHeader }) {
        const draw = async () => {
          const st = await api('/settings'); const rich = await api('/richest');
          const em = esc(st.currencyEmoji);
          el.innerHTML = `${pageHeader('サーバーの予算', '報酬や配当を、サーバーの予算から支払うようにして、通貨が増えすぎるのを防ぎます。')}
            <div class="card"><h2>予算を使う</h2>
              <label class="sw"><input type="checkbox" id="be" ${st.budgetEnabled ? 'checked' : ''} ${st.canEditBudget ? '' : 'disabled'}><i></i><span><b>サーバーの予算で、お金をやりくりする</b>
                <small>オンのとき: バイト・犯罪・乞食の報酬、ギャンブルの配当、最初にもらえるお金は、予算から支払われます。罰金・保釈金・ギャンブルの賭け金は、予算に入ります。予算が足りないときは、払えるぶんだけ支払われます。<br>オフのとき: 予算に関係なく、お金が増えたり減ったりします。</small></span></label>
              ${st.canEditBudget ? '<div class="acts" style="margin-top:12px"><button class="btn" id="bes" type="button">保存</button></div>' : '<p class="hint">予算のオン・オフと金額を変えられるのは、サーバーのオーナー・管理者・運営だけです。</p>'}</div>
            <div class="tiles"><div class="tile"><div class="k">現在の予算</div><div class="v">${em} ${st.treasury.toLocaleString()}</div></div>
              <div class="tile"><div class="k">出回っているお金</div><div class="v">${em} ${st.circulation.total.toLocaleString()}</div></div>
              <div class="tile"><div class="k">口座の数</div><div class="v">${st.circulation.accounts.toLocaleString()}<span class="u">人</span></div></div></div>
            ${st.canEditBudget ? `<div class="card"><h2>予算を変える</h2>
              <p class="sub">予算がオフでも、金額は変えられます(オンにしたときに使われます)。</p>
              <div class="field"><label class="f" for="ba">金額</label><input id="ba" type="number" min="0" placeholder="100000" style="max-width:220px"></div>
              <div class="acts"><button class="btn" id="b-set" type="button">この金額にする</button><button class="btn ghost" id="b-add" type="button">追加する</button><button class="btn ghost" id="b-sub" type="button">減らす</button></div></div>` : ''}
            <div class="card flush"><div class="card-h"><h2>お金持ちランキング</h2></div>${rich.length ? `<ol class="lb">${rich.map((r, n) => `<li><span class="rk ${n < 3 ? 'top' : ''}">${n + 1}</span><span class="nm">${esc(r.name)}</span><span class="val">${em} ${r.total.toLocaleString()}</span></li>`).join('')}</ol>` : '<div class="empty"><h2>まだ、データがありません</h2></div>'}</div>`;
          const q = (x) => el.querySelector(x);
          if (q('#bes')) q('#bes').onclick = async () => { await api('/settings', { method: 'PUT', body: { budgetEnabled: q('#be').checked } }); toast('保存しました'); draw(); };
          const op = (mode) => async () => {
            const amount = q('#ba').value; if (amount === '') { toast('金額を入力してください', 'err'); return; }
            if (mode === 'set' && !await confirm({ title: '予算を設定', message: `予算を ${Number(amount).toLocaleString()} にします。`, ok: '設定する' })) return;
            await api('/budget', { method: 'POST', body: { mode, amount } }); toast('更新しました'); draw();
          };
          if (q('#b-set')) { q('#b-set').onclick = op('set'); q('#b-add').onclick = op('add'); q('#b-sub').onclick = op('subtract'); }
        };
        await draw();
      } },
  ],
});
