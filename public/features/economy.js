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

    /* ===== 職業の昇進 ===== */
    { id: 'jobs', title: '職業の昇進', icon: 'list',
      async render(el, { api, esc, toast, pageHeader }) {
        const [st, meta] = await Promise.all([api('/settings'), api('/jobs-meta')]);
        const ranks = JSON.parse(JSON.stringify(st.jobRanks));
        const draw = () => {
          el.innerHTML = `${pageHeader('職業の昇進', 'バイト(/work)の出勤回数に応じて、階級が上がり、給料が増えます。階級の名前・必要な出勤回数・給料の倍率を、職業ごとに決められます。')}
            <div class="card"><label class="sw"><input type="checkbox" id="pe" ${st.promotionEnabled ? 'checked' : ''}><i></i><span><b>昇進を使う</b><small>オフのときは、階級も倍率もありません(出勤回数は、オフの間も記録されます)。メンバーは <code>/job</code> で、自分の階級を見られます</small></span></label></div>
            ${meta.jobs.map((j) => `<div class="card" data-job="${j.key}"><div class="card-h"><h2>${j.emoji} ${esc(j.name)}</h2></div>
              ${ranks[j.key].map((r, n) => `<div class="grid3" style="display:grid;grid-template-columns:minmax(0,1.4fr) 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px" data-n="${n}">
                <div class="field" style="margin:0"><label class="f">${n === 0 ? '最初の階級' : `階級 ${n + 1}`}</label><input class="rn" type="text" maxlength="12" value="${esc(r.name)}"></div>
                <div class="field" style="margin:0"><label class="f">必要な出勤回数</label><input class="rs" type="number" min="0" value="${r.shifts}" ${n === 0 ? 'disabled' : ''}></div>
                <div class="field" style="margin:0"><label class="f">給料の倍率(%)</label><input class="rp" type="number" min="50" max="500" value="${r.pct}"></div>
                <button class="btn danger icon" type="button" data-rm="${n}" ${n === 0 ? 'disabled' : ''} aria-label="削除">✕</button></div>`).join('')}
              <div class="acts" style="margin-top:8px"><button class="btn ghost" type="button" data-add="${j.key}" ${ranks[j.key].length >= meta.maxRanks ? 'disabled' : ''}>階級を追加</button><button class="btn ghost" type="button" data-reset="${j.key}">初期値に戻す</button></div></div>`).join('')}
            <div class="card"><h2>仕組み</h2><ul style="margin:0;padding-left:1.2em"><li>出勤回数が、次の階級の「必要な出勤回数」に届くと、昇進します(昇進した回は、お知らせが出ます)</li><li>給料の倍率は、現在の階級のものが、給料とボーナスに掛かります(100%で等倍)</li><li>最初の階級は、0回・変更不可の出勤回数です。階級は最大${meta.maxRanks}つまで</li></ul></div>
            <div class="acts"><button class="btn" id="save" type="button">設定を保存</button></div>`;
          const collect = () => {
            ranks && el.querySelectorAll('[data-job]').forEach((c) => { const key = c.dataset.job;
              ranks[key] = [...c.querySelectorAll('[data-n]')].map((row, n) => ({ name: row.querySelector('.rn').value, shifts: n === 0 ? 0 : Number(row.querySelector('.rs').value) || 0, pct: Number(row.querySelector('.rp').value) || 100 })); });
            st.promotionEnabled = el.querySelector('#pe').checked;
          };
          el.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { collect(); const l = ranks[b.dataset.add], last = l[l.length - 1]; l.push({ name: `ランク${l.length + 1}`, shifts: last.shifts + 20, pct: Math.min(500, last.pct + 30) }); draw(); }));
          el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { collect(); ranks[b.closest('[data-job]').dataset.job].splice(Number(b.dataset.rm), 1); draw(); }));
          el.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = () => { collect(); ranks[b.dataset.reset] = JSON.parse(JSON.stringify(meta.defaults[b.dataset.reset])); draw(); }));
          el.querySelector('#save').onclick = async () => {
            collect();
            const saved = await api('/settings', { method: 'PUT', body: { promotionEnabled: st.promotionEnabled, jobRanks: ranks } });
            Object.assign(ranks, JSON.parse(JSON.stringify(saved.jobRanks))); toast('保存しました'); draw();
          };
        };
        draw();
      } },
    /* ===== 指名手配 ===== */
    { id: 'wanted', title: '指名手配', icon: 'alert',
      async render(el, { api, esc, toast, pageHeader }) {
        const [st, meta, bal] = await Promise.all([api('/settings'), api('/jobs-meta'), api('/balance')]);
        const bp = (k) => bal.params.find((x) => x.key === k), bv = (k) => bp(k).value ?? bp(k).def;
        el.innerHTML = `${pageHeader('指名手配', '犯罪に成功すると「手配度」が溜まり、星(⭐)が付きます。星が多いほど、犯罪は失敗しやすくなります。警察のバイトを重ねた人は、手配された人を逮捕して、懸賞金をもらえます。')}
          <div class="card"><label class="sw"><input type="checkbox" id="we" ${st.wantedEnabled ? 'checked' : ''}><i></i><span><b>指名手配を使う</b><small>オンのとき: <code>/wanted</code>(手配書)と <code>/arrest</code>(逮捕)が使えます。手配中の人が多いほど、警察のバイトのボーナスが出やすくなります</small></span></label></div>
          <div class="card"><h2>設定</h2><div class="grid2">
            <div class="field"><label class="f" for="wd">手配度が1下がるまでの時間(分)</label><input id="wd" type="number" min="1" max="1440" value="${st.wantedDecayMin}"><p class="hint">放っておくと、手配度は時間とともに下がります</p></div>
            <div class="field"><label class="f" for="wb">星1つぶんの懸賞金</label><input id="wb" type="number" min="0" value="${st.bountyPerStar}"><p class="hint">懸賞金は、手配度に比例します(星2つで、この金額の2倍)。逮捕された人の罰金から、逮捕した人に支払われます(予算がオンなら、罰金は予算に入り、そこから払われます。罰金の割合は、ゲームバランスで変えられます)</p></div>
            <div class="field"><label class="f" for="wa">逮捕に必要な、警察の出勤回数</label><input id="wa" type="number" min="0" value="${st.arrestMinShifts}"><p class="hint">警察のバイト(/work)を、この回数以上している人だけが、逮捕できます</p></div>
            <div class="field"><label class="f" for="wp">手配中が1人増えるごとの、警察ボーナス(%)</label><input id="wp" type="number" min="0" max="50" value="${st.policeBonusPerWanted}"><p class="hint">警察のバイトのボーナス(犯人逮捕の特別手当)の確率は、${meta.bonusBase}% + 手配中の人数 × この値(上限 ${meta.bonusCap}%)です</p></div></div></div>
          <div class="card"><h2>逮捕の成功率と報酬</h2><p class="hint">警察のバイトの人が、手配された人を <code>/arrest</code> で逮捕するときの、確率とお金です。</p><div class="grid2">
            <div class="field"><label class="f" for="ac">逮捕の成功率(%)</label><input id="ac" type="number" min="${bp('wanted.arrestChance').min}" max="${bp('wanted.arrestChance').max}" value="${bv('wanted.arrestChance')}"><p class="hint">お店の品・ペットの「逮捕される確率」の効果は、この確率に足し引きされます。</p></div>
            <div class="field"><label class="f" for="ar">逮捕した人がもらう報酬(懸賞金の何%)</label><input id="ar" type="number" min="0" max="${bp('wanted.rewardPct').max}" value="${bv('wanted.rewardPct')}"><p class="hint">100% で、懸賞金のまま。50% なら半分、200% なら2倍です。</p></div>
            <div class="field"><label class="f" for="af">逮捕された人から取る罰金(懸賞金の何%)</label><input id="af" type="number" min="0" max="100" value="${bv('wanted.bountyFinePct')}"><p class="hint">取った罰金は、予算がオンなら予算に入ります。報酬の割合とは別に決められます。</p></div></div></div>
          <div class="card"><h2>仕組み</h2><ul style="margin:0;padding-left:1.2em">
            <li>手配度が <b>${meta.heatPerStar}</b> 増えるごとに、星が1つ(最大5つ)。星1つにつき、犯罪の成功率が <b>${meta.penaltyPerStar}%</b> 下がります</li>
            <li>犯罪・大型犯罪に失敗して<b>捕まる</b>と、手配は解除されます</li>
            <li>逮捕の成功率は <b>${meta.arrestChance}%</b>。逮捕された人は、星の数ぶん(1つ5分、最大30分)留置場に入り、手配が解除されます。逮捕した人の待ち時間は ${meta.arrestCdMin}分です</li></ul></div>
          <div class="card flush"><div class="card-h"><h2>成功したときに、上がる手配度</h2></div><div style="padding:6px 18px 12px"><table><tr><th>犯罪</th><th>手配度</th></tr>${meta.heat.map((h) => `<tr><td>${esc(h.name)}</td><td><b>+${h.heat}</b></td></tr>`).join('')}</table></div></div>
          <div class="acts"><button class="btn" id="save" type="button">設定を保存</button></div>`;
        const q = (x) => el.querySelector(x);
        q('#save').onclick = async () => { await api('/settings', { method: 'PUT', body: { wantedEnabled: q('#we').checked, wantedDecayMin: q('#wd').value, bountyPerStar: q('#wb').value, arrestMinShifts: q('#wa').value, policeBonusPerWanted: q('#wp').value } }); await api('/balance', { method: 'PUT', body: { values: { 'wanted.arrestChance': q('#ac').value, 'wanted.rewardPct': q('#ar').value, 'wanted.bountyFinePct': q('#af').value } } }); toast('保存しました'); };
      } },
    /* ===== ゲームバランス(ゲームの数字を、すべて変えられる) ===== */
    { id: 'balance', title: 'ゲームバランス', icon: 'shield',
      async render(el, { api, esc, toast, pageHeader, confirm }) {
        const data = await api('/balance');
        const unit = (u) => (u === '$' ? esc(data.currencyEmoji) : esc(u));
        const sections = [];
        for (const p of data.params) {
          let s = sections.find((x) => x.name === p.section); if (!s) sections.push((s = { name: p.section, groups: [] }));
          let g = s.groups.find((x) => x.name === p.group); if (!g) s.groups.push((g = { name: p.group, params: [] }));
          g.params.push(p);
        }
        el.innerHTML = `${pageHeader('ゲームバランス', '犯罪・バイト・乞食・大型犯罪・道具の値段・指名手配・保釈金の数字を、すべて変えられます。空欄のままの項目は、初期値のままです(灰色の文字が、初期値)。')}
          <div class="card"><div class="field" style="margin:0"><label class="f" for="bf">項目を探す</label><input id="bf" type="search" style="width:100%" placeholder="例: 成功率 / 銀行 / 警察 / 罰金"></div>
            <p class="hint" style="margin:8px 0 0">変えた項目には <b>●</b> が付きます。「保存」を押すまで、反映されません。報酬の「最小」が「最大」より大きいときは、保存時に入れ替わります。</p></div>
          ${sections.map((s) => `<h2 class="sec" style="margin:22px 0 8px">${esc(s.name)}</h2>${s.groups.map((g) => `<details class="card" data-g="${esc(g.name)}"><summary style="cursor:pointer;font-weight:700">${esc(g.name)} <span class="badge mut" data-cnt></span></summary>
            <div class="bl" style="margin-top:10px">${g.params.map((p) => `<div class="br" data-k="${p.key}" data-t="${esc(p.label + ' ' + g.name + ' ' + s.name)}" style="display:grid;grid-template-columns:minmax(0,1fr) 130px 52px;gap:8px;align-items:center;margin-bottom:6px">
              <label for="p-${p.key}" style="min-width:0">${esc(p.label)} <span class="mut small" data-dot></span></label>
              <input id="p-${p.key}" type="number" min="${p.min}" max="${p.max}" value="${p.value ?? ''}" placeholder="${p.def}" data-def="${p.def}" data-init="${p.value ?? ''}">
              <span class="mut small">${unit(p.unit)}</span></div>`).join('')}
              <div class="acts" style="margin-top:8px"><button class="btn ghost" type="button" data-reset-g>このグループを初期値に戻す</button></div></div></details>`).join('')}`).join('')}
          <div class="acts" style="margin-top:18px"><button class="btn" id="save" type="button">保存</button><button class="btn ghost" id="resetall" type="button">すべて初期値に戻す</button></div>`;
        const inputs = () => [...el.querySelectorAll('.br input')];
        const refresh = () => {
          el.querySelectorAll('.br').forEach((row) => { const i = row.querySelector('input'); row.querySelector('[data-dot]').textContent = i.value !== '' && i.value !== i.dataset.def ? '●' : ''; });
          el.querySelectorAll('details[data-g]').forEach((d) => { const n = [...d.querySelectorAll('.br input')].filter((i) => i.value !== '' && i.value !== i.dataset.def).length; const c = d.querySelector('[data-cnt]'); c.textContent = n ? `${n}件 変更` : ''; c.hidden = !n; });
        };
        el.addEventListener('input', refresh); refresh();
        el.querySelector('#bf').oninput = (e) => {
          const q = e.target.value.trim().toLowerCase();
          el.querySelectorAll('.br').forEach((r) => { r.style.display = !q || r.dataset.t.toLowerCase().includes(q) ? '' : 'none'; });
          el.querySelectorAll('details[data-g]').forEach((d) => { const any = [...d.querySelectorAll('.br')].some((r) => r.style.display !== 'none'); d.style.display = any ? '' : 'none'; if (q && any) d.open = true; });
        };
        el.querySelectorAll('[data-reset-g]').forEach((b) => (b.onclick = () => { b.closest('details').querySelectorAll('.br input').forEach((i) => (i.value = '')); refresh(); }));
        el.querySelector('#resetall').onclick = async () => { if (await confirm({ title: 'すべて初期値に戻す', message: 'ゲームバランスの数字を、すべて初期値に戻します(保存を押すまで反映されません)。', ok: '戻す', danger: true })) { inputs().forEach((i) => (i.value = '')); refresh(); } };
        el.querySelector('#save').onclick = async () => {
          const values = {}; inputs().forEach((i) => { values[i.closest('.br').dataset.k] = i.value === '' ? null : Number(i.value); });
          const r = await api('/balance', { method: 'PUT', body: { values } });
          toast(r.count ? `保存しました(${r.count}件を変更中)` : '保存しました(すべて初期値です)');
          const fresh = await api('/balance'); const byKey = new Map(fresh.params.map((p) => [p.key, p.value]));
          inputs().forEach((i) => { const v = byKey.get(i.closest('.br').dataset.k); i.value = v ?? ''; i.dataset.init = v ?? ''; }); refresh();
        };
      } },
    /* ===== お店・ペット ===== */
    { id: 'shop', title: 'お店・ペット', icon: 'coin',
      async render(el, { api, channels: getChannels, esc, toast, pageHeader }) {
        const [st, meta, chans] = await Promise.all([api('/settings'), api('/extras-meta'), getChannels()]);
        let pch = st.priceChannelId || '', pmin = st.priceBoardMin, prep = st.priceBoardReplace !== false;
        let items = JSON.parse(JSON.stringify(st.shopItems)), pets = JSON.parse(JSON.stringify(st.petSpecies)), shopOn = st.shopEnabled, petsOn = st.petsEnabled;
        const kinds = meta.fx, toUi = (k, v) => (kinds[k].kind === 'count' ? v : Math.round(v * 1000) / 10), fromUi = (k, v) => (kinds[k].kind === 'count' ? Math.round(Number(v)) : Number(v) / 100);
        const draw = () => {
          el.innerHTML = `${pageHeader('お店・ペット', 'お店(タバコ・お酒など。使うと、しばらく効果がつく)と、ペット(育てるとボーナスがつく)を、サーバーでオン・オフします。お店の品は、名前・値段・効果を、自由に変えられます。')}
            <div class="card"><label class="sw"><input type="checkbox" id="so" ${shopOn ? 'checked' : ''}><i></i><span><b>お店を使う</b><small><code>/shop</code> と <code>/use</code> が使えます。品は、番号で選びます</small></span></label>
              <label class="sw"><input type="checkbox" id="po" ${petsOn ? 'checked' : ''}><i></i><span><b>ペットを使う</b><small><code>/pet</code> が使えます(種類・値段・餌・ボーナスは、下で変えられます。ボーナスの強さなどは、「ゲームバランス」で)</small></span></label></div>
            <div class="card"><h2>値段表のチャンネル</h2><p class="hint">お店・ペット・不動産・闇市の、いまの値段を、決めたチャンネルに出します(オンになっているものだけ)。闇市は、今日の相場です。</p>
              <div class="grid2">
                <div class="field"><label class="f">値段表を出すチャンネル</label><select id="pch"><option value="">出さない</option>${chans.map((c) => `<option value="${c.id}" ${pch === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select></div>
                <div class="field"><label class="f">出す間隔</label><select id="pmin">${[5, 10, 30, 60, 180, 360, 720, 1440].map((m) => `<option value="${m}" ${pmin === m ? 'selected' : ''}>${m >= 60 ? m / 60 + '時間' : m + '分'}ごと</option>`).join('')}</select></div></div>
              <label class="sw"><input type="checkbox" id="prep" ${prep ? 'checked' : ''}><i></i><span><b>最新の1つだけ、いつも一番下に出す</b><small>前の値段表は、書き換えるか、消します。オフにすると、毎回、新しく出して、前のものを残します</small></span></label></div>
            <h2 class="sec" style="margin:18px 0 8px">お店の品(最大${meta.maxShop}品)</h2>
            ${items.map((it, n) => `<div class="card" data-i="${n}"><div class="card-h"><h2>${n + 1}. ${esc(it.emoji)} ${esc(it.name)}</h2><button class="btn danger icon" type="button" data-rm="${n}" aria-label="削除">✕</button></div>
              <div class="grid2">
                <div class="field"><label class="f">名前</label><input class="f-name" type="text" maxlength="12" value="${esc(it.name)}"></div>
                <div class="field"><label class="f">絵文字</label><input class="f-emoji" type="text" maxlength="8" value="${esc(it.emoji)}"></div>
                <div class="field"><label class="f">枠(同じ枠は、同時に1つだけ効く)</label><select class="f-slot">${Object.entries(meta.slots).map(([k, v]) => `<option value="${k}" ${it.slot === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
                <div class="field"><label class="f">値段</label><input class="f-price" type="number" min="1" value="${it.price}"></div>
                <div class="field"><label class="f">効果が続く時間(分)</label><input class="f-min" type="number" min="1" max="1440" value="${it.minutes}"></div>
                <div class="field"><label class="f">説明</label><input class="f-desc" type="text" maxlength="60" value="${esc(it.desc)}"></div></div>
              <p class="hint" style="margin:6px 0">効果: プラスは良いこと、マイナスは代償です(空欄は、効果なし)。％で入力します(回数は、そのまま)。</p>
              <div class="grid2">${Object.entries(kinds).map(([k, d]) => `<div class="field" style="margin:0"><label class="f">${esc(d.label)}${d.kind === 'count' ? '(回)' : '(%)'}</label><input class="f-fx" data-k="${k}" type="number" step="${d.kind === 'count' ? 1 : 0.5}" value="${it.effects?.[k] ? toUi(k, it.effects[k]) : ''}"></div>`).join('')}</div></div>`).join('')}
            <h2 class="sec" style="margin:18px 0 8px">ペットの種類(最大${meta.maxPets}種類)</h2>
            <p class="hint" style="margin:0 0 8px">「有効」をオフにした種類は、新しく飼えなくなります(すでに飼っている人は、そのまま)。ボーナスは「レベル1つぶん」の％です(レベルが上がるほど、効果が増えます)。</p>
            ${pets.map((p, n) => `<div class="card" data-p="${n}"><div class="card-h"><h2>${n + 1}. ${esc(p.emoji)} ${esc(p.name)}${p.enabled ? '' : ' <span class="mut small">(無効)</span>'}</h2><button class="btn danger icon" type="button" data-prm="${n}" aria-label="削除">✕</button></div>
              <label class="sw"><input type="checkbox" class="p-on" ${p.enabled ? 'checked' : ''}><i></i><span><b>有効(飼える)</b></span></label>
              <div class="grid2">
                <div class="field"><label class="f">名前</label><input class="p-name" type="text" maxlength="12" value="${esc(p.name)}"></div>
                <div class="field"><label class="f">絵文字</label><input class="p-emoji" type="text" maxlength="8" value="${esc(p.emoji)}"></div>
                <div class="field"><label class="f">飼う値段</label><input class="p-price" type="number" min="0" value="${p.price}"></div>
                <div class="field"><label class="f">餌の名前</label><input class="p-food" type="text" maxlength="12" value="${esc(p.foodName)}"></div>
                <div class="field"><label class="f">餌の絵文字</label><input class="p-foode" type="text" maxlength="8" value="${esc(p.foodEmoji)}"></div>
                <div class="field"><label class="f">餌代(1回)</label><input class="p-fc" type="number" min="0" value="${p.feedCost}"></div>
                <div class="field"><label class="f">餌1回で増える満腹度</label><input class="p-fh" type="number" min="1" max="100" value="${p.feedHunger}"></div></div>
              <p class="hint" style="margin:6px 0">ボーナス(レベル1つぶん・％。空欄は、なし)</p>
              <div class="grid2">${meta.petFx.map((k) => `<div class="field" style="margin:0"><label class="f">${esc(kinds[k].label)}(%)</label><input class="p-fx" data-k="${k}" type="number" step="0.1" value="${p.effects?.[k] ? Math.round(p.effects[k] * 1000) / 10 : ''}"></div>`).join('')}</div></div>`).join('')}
            <div class="acts"><button class="btn ghost" id="padd" type="button" ${pets.length >= meta.maxPets ? 'disabled' : ''}>ペットを追加</button><button class="btn ghost" id="preset" type="button">初期のペットに戻す</button></div>
            <div class="acts"><button class="btn ghost" id="add" type="button" ${items.length >= meta.maxShop ? 'disabled' : ''}>品を追加</button><button class="btn ghost" id="reset" type="button">初期の品に戻す</button><button class="btn" id="save" type="button">保存</button></div>`;
          const collect = () => {
            shopOn = el.querySelector('#so').checked; petsOn = el.querySelector('#po').checked; pch = el.querySelector('#pch').value; pmin = Number(el.querySelector('#pmin').value); prep = el.querySelector('#prep').checked;
            pets = [...el.querySelectorAll('[data-p]')].map((c, n) => ({ id: pets[n]?.id, enabled: c.querySelector('.p-on').checked, name: c.querySelector('.p-name').value, emoji: c.querySelector('.p-emoji').value, price: c.querySelector('.p-price').value, foodName: c.querySelector('.p-food').value, foodEmoji: c.querySelector('.p-foode').value, feedCost: c.querySelector('.p-fc').value, feedHunger: c.querySelector('.p-fh').value,
              effects: Object.fromEntries([...c.querySelectorAll('.p-fx')].filter((x) => x.value !== '').map((x) => [x.dataset.k, Number(x.value) / 100])) }));
            items = [...el.querySelectorAll('[data-i]')].map((c, n) => ({ id: items[n]?.id, name: c.querySelector('.f-name').value, emoji: c.querySelector('.f-emoji').value, slot: c.querySelector('.f-slot').value, price: c.querySelector('.f-price').value, minutes: c.querySelector('.f-min').value, desc: c.querySelector('.f-desc').value,
              effects: Object.fromEntries([...c.querySelectorAll('.f-fx')].filter((x) => x.value !== '').map((x) => [x.dataset.k, fromUi(x.dataset.k, x.value)])) }));
          };
          el.querySelector('#padd').onclick = () => { collect(); pets.push({ name: '新しいペット', emoji: '🐾', enabled: true, price: 1000, foodName: 'ごはん', foodEmoji: '🍖', feedCost: 150, feedHunger: 40, effects: {} }); draw(); };
          el.querySelector('#preset').onclick = () => { collect(); pets = JSON.parse(JSON.stringify(meta.defaultPets)); draw(); };
          el.querySelectorAll('[data-prm]').forEach((b) => (b.onclick = () => { collect(); pets.splice(Number(b.dataset.prm), 1); draw(); }));
          el.querySelector('#add').onclick = () => { collect(); items.push({ name: '新しい品', emoji: '🛍️', slot: 'other', price: 100, minutes: 15, effects: {}, desc: '' }); draw(); };
          el.querySelector('#reset').onclick = () => { collect(); items = JSON.parse(JSON.stringify(meta.defaultShop)); draw(); };
          el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { collect(); items.splice(Number(b.dataset.rm), 1); draw(); }));
          el.querySelector('#save').onclick = async () => { collect(); const r = await api('/settings', { method: 'PUT', body: { shopEnabled: shopOn, petsEnabled: petsOn, shopItems: items, petSpecies: pets, priceChannelId: pch || null, priceBoardMin: pmin, priceBoardReplace: prep } }); items = JSON.parse(JSON.stringify(r.shopItems)); pets = JSON.parse(JSON.stringify(r.petSpecies)); toast('保存しました'); draw(); };
        };
        draw();
      } },
    /* ===== 株 ===== */
    { id: 'stocks', title: '株', icon: 'coin',
      async render(el, { api, channels: getChannels, esc, toast, pageHeader }) {
        const [st, meta, chans] = await Promise.all([api('/settings'), api('/extras-meta'), getChannels()]);
        const names = JSON.parse(JSON.stringify(st.stockNames)), levels = { ...st.stockLevels };
        const daily = (L) => (L >= 1 ? ['1.5', '2.5', '3.5', '5', '7', '9', '12', '16', '21', '28'][L - 1] : '');
        el.innerHTML = `${pageHeader('株', '架空の会社の株を、売り買いできます。株価は、5分ごとに動きます(間隔は「ゲームバランス」で変えられます)。会社の名前・ティッカー・絵文字と、値動きの大きさ(10段階)を、サーバーで決められます。')}
          <div class="card"><label class="sw"><input type="checkbox" id="on" ${st.stocksEnabled ? 'checked' : ''}><i></i><span><b>株を使う</b><small><code>/stock</code> が使えます。売買の手数料などは、「ゲームバランス」で変えられます</small></span></label></div>
          <div class="card"><h2>新聞チャンネル</h2><p class="hint">株のニュース(新商品がヒット・不祥事など。株価が大きく上がったり、下がったりします)を、起きるたびに、決めたチャンネルに出します。起きやすさは、「ゲームバランス」の株で変えられます。</p>
            <div class="field"><label class="f">新聞を出すチャンネル</label><select id="nch"><option value="">出さない</option>${chans.map((c) => `<option value="${c.id}" ${st.newsChannelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select></div>
            <div class="grid2" style="margin-top:12px">
              <div class="field"><label class="f">新しいニュースが起きる間隔</label><select id="nevery">${[[0, 'ランダム(1日に1〜2回ほど)'], [5, '5分ごと'], [10, '10分ごと'], [15, '15分ごと'], [30, '30分ごと'], [60, '1時間ごと'], [180, '3時間ごと'], [360, '6時間ごと']].map(([m, l]) => `<option value="${m}" ${st.newsEvery === m ? 'selected' : ''}>${l}</option>`).join('')}</select><p class="hint">決めた間隔ごとに、ちょうど1つ、どれかの会社に、ニュースが起きます(株価が動く間隔より短くはできません)。</p></div>
              <div class="field"><label class="f">ニュースで動く強さ(%)</label><input id="npow" type="number" min="0" max="500" value="${st.newsPower}"><p class="hint">100% で、下の出来事に書いた割合のまま動きます。間隔を短くするときは、小さくすると、株価が荒れすぎません(初期値 25%)。</p></div></div></div>
          <div class="card"><h2>株価のグラフ</h2><p class="hint">決めたチャンネルに、24時間の株価のグラフ(折れ線)と、いまの値段を出します。</p>
            <div class="grid2">
              <div class="field"><label class="f">グラフを出すチャンネル</label><select id="bch"><option value="">出さない</option>${chans.map((c) => `<option value="${c.id}" ${st.stockChannelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select></div>
              <div class="field"><label class="f">出す間隔</label><select id="bmin">${[5, 10, 30, 60, 180, 360, 720, 1440].map((m) => `<option value="${m}" ${st.stockBoardMin === m ? 'selected' : ''}>${m >= 60 ? m / 60 + '時間' : m + '分'}ごと</option>`).join('')}</select></div></div>
            <label class="sw"><input type="checkbox" id="bedit" ${st.stockBoardEdit ? 'checked' : ''}><i></i><span><b>最新の1つだけ、いつも一番下に出す</b><small>前のグラフは、書き換えるか、消します(いつも、チャンネルの一番下に、最新が来ます)。オフにすると、毎回、新しく出して、前のグラフを残します</small></span></label></div>
          ${meta.companies.map((c) => `<div class="card" data-c="${c.id}"><div class="card-h"><h2>${esc(names[c.id].emoji)} ${esc(names[c.id].ticker)} <span class="mut small">基準 ${c.base.toLocaleString()} ・ ${esc(c.blurb)}</span></h2></div>
            <div class="grid2">
              <div class="field"><label class="f">会社の名前</label><input class="s-name" type="text" maxlength="16" value="${esc(names[c.id].name)}"></div>
              <div class="field"><label class="f">ティッカー(英数字2〜6文字)</label><input class="s-tick" type="text" maxlength="6" value="${esc(names[c.id].ticker)}"></div>
              <div class="field"><label class="f">絵文字</label><input class="s-emoji" type="text" maxlength="8" value="${esc(names[c.id].emoji)}"></div>
              <div class="field"><label class="f">値動きの大きさ(10段階)</label><select class="s-lv">${meta.volLabels.map((l, n) => `<option value="${n + 1}" ${levels[c.id] === n + 1 ? 'selected' : ''}>${n + 1}. ${esc(l)}(1日の目安 ${daily(n + 1)}%)</option>`).join('')}</select></div></div></div>`).join('')}
          <h2 class="sec" style="margin:18px 0 8px">ニュース(出来事)</h2>
          <p class="hint" style="margin:0 0 8px">ときどき、ニュースが起きて、株価が決まった割合で上がったり、下がったりします。起きやすさは、「ゲームバランス」の「ニュースの起きやすさ」で、変えられます。どのニュースが起きるかは、下の「起きやすさ」(1〜10)で決まります。</p>
          <div id="evl"></div>
          <div class="acts"><button class="btn ghost" id="evadd" type="button">出来事を追加</button><button class="btn ghost" id="evreset" type="button">初期の出来事に戻す</button></div>
          <div class="card"><h2>値動きの目安</h2><p class="hint" style="margin:0">1日の値動きの目安は、レベル1で約1.5%、レベル5で約7%、レベル10で約28%です。ニュースが起きると、書いた割合だけ、動きます(動く強さは、上の「ニュースで動く強さ」で変えられます)。</p></div>
          <div class="acts"><button class="btn ghost" id="reset" type="button">初期値に戻す</button><button class="btn" id="save" type="button">保存</button></div>`;
        let events = JSON.parse(JSON.stringify(st.newsEvents));
        const evCollect = () => { events = [...el.querySelectorAll('[data-ev]')].map((c, n) => ({ id: events[n]?.id, enabled: c.querySelector('.ev-on').checked, text: c.querySelector('.ev-text').value, pct: c.querySelector('.ev-pct').value, company: c.querySelector('.ev-co').value, weight: c.querySelector('.ev-w').value })); };
        const evDraw = () => {
          el.querySelector('#evl').innerHTML = events.map((e, n) => `<div class="card" data-ev="${n}"><div class="card-h"><h2>${Number(e.pct) > 0 ? '📈' : '📉'} ${esc(e.text)}</h2><button class="btn danger icon" type="button" data-evrm="${n}" aria-label="削除">✕</button></div>
            <label class="sw"><input type="checkbox" class="ev-on" ${e.enabled ? 'checked' : ''}><i></i><span><b>有効</b></span></label>
            <div class="grid2">
              <div class="field"><label class="f">出来事(新聞の見出し)</label><input class="ev-text" type="text" maxlength="30" value="${esc(e.text)}"></div>
              <div class="field"><label class="f">株価の変わる割合(%。プラスは上がる、マイナスは下がる。「ニュースで動く強さ」が掛かります)</label><input class="ev-pct" type="number" min="-50" max="50" step="1" value="${e.pct}"></div>
              <div class="field"><label class="f">どの会社に起きる?</label><select class="ev-co"><option value="">全部の会社</option>${meta.companies.map((c) => `<option value="${c.id}" ${e.company === c.id ? 'selected' : ''}>${esc(names[c.id].emoji)} ${esc(names[c.id].name)}</option>`).join('')}</select></div>
              <div class="field"><label class="f">起きやすさ(1〜10)</label><input class="ev-w" type="number" min="1" max="10" value="${e.weight}"></div></div></div>`).join('') || '<div class="card"><p class="hint" style="margin:0">出来事が、ありません。「出来事を追加」で、作れます。</p></div>';
          el.querySelector('#evadd').disabled = events.length >= meta.maxEvents;
          el.querySelectorAll('[data-evrm]').forEach((b) => (b.onclick = () => { evCollect(); events.splice(Number(b.dataset.evrm), 1); evDraw(); }));
        };
        el.querySelector('#evadd').onclick = () => { evCollect(); events.push({ enabled: true, text: '新しい出来事', pct: 5, company: '', weight: 3 }); evDraw(); };
        el.querySelector('#evreset').onclick = () => { events = JSON.parse(JSON.stringify(meta.defaultEvents)); evDraw(); };
        evDraw();
        el.querySelector('#reset').onclick = () => { el.querySelectorAll('[data-c]').forEach((c) => { const id = c.dataset.c; c.querySelector('.s-name').value = meta.defaultNames[id].name; c.querySelector('.s-tick').value = meta.defaultNames[id].ticker; c.querySelector('.s-emoji').value = meta.defaultNames[id].emoji; c.querySelector('.s-lv').value = meta.defaultLevels[id]; }); };
        el.querySelector('#save').onclick = async () => {
          evCollect();
          const stockNames = {}, stockLevels = {};
          el.querySelectorAll('[data-c]').forEach((c) => { const id = c.dataset.c; stockNames[id] = { name: c.querySelector('.s-name').value, ticker: c.querySelector('.s-tick').value, emoji: c.querySelector('.s-emoji').value }; stockLevels[id] = Number(c.querySelector('.s-lv').value); });
          await api('/settings', { method: 'PUT', body: { stocksEnabled: el.querySelector('#on').checked, stockNames, stockLevels, newsEvents: events, newsEvery: Number(el.querySelector('#nevery').value), newsPower: Number(el.querySelector('#npow').value), stockChannelId: el.querySelector('#bch').value || null, newsChannelId: el.querySelector('#nch').value || null, stockBoardMin: Number(el.querySelector('#bmin').value), stockBoardEdit: el.querySelector('#bedit').checked } }); toast('保存しました');
        };
      } },
    /* ===== 宝くじ ===== */
    { id: 'lottery', title: '宝くじ', icon: 'coin',
      async render(el, { api, channels: getChannels, esc, toast, pageHeader }) {
        const [st, meta, chans] = await Promise.all([api('/settings'), api('/extras-meta'), getChannels()]);
        let lots = JSON.parse(JSON.stringify(st.lotteries)), on = st.lotteryEnabled, mention = st.lotteryMention !== false, ch = st.lotteryChannelId || '';
        const rtp = (L) => { const d = Number(L.digits), p1 = 1 / 10 ** d, q2 = 1 / 10 ** (d - 1), p2 = q2 - p1, q3 = d >= 3 ? 1 / 10 ** (d - 2) : q2, p3 = d >= 3 ? q3 - q2 : 0; return (p1 * (L.jackpotBase / L.price) + p2 * L.prize2 + p3 * L.prize3) * 100; };
        const chOpts = (sel, blank) => `<option value="">${blank}</option>${chans.map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}`;
        const draw = () => {
          el.innerHTML = `${pageHeader('宝くじ', '番号(2〜4桁)のくじを買って、決まった時刻に、自動で抽選します。くじは、サーバーで、自由に、複数作れます(名前・値段・抽選の間隔と時刻・桁数・賞金・発表のチャンネル)。')}
            <div class="card"><label class="sw"><input type="checkbox" id="on" ${on ? 'checked' : ''}><i></i><span><b>宝くじを使う</b><small><code>/lottery</code> が使えます</small></span></label>
              <div class="field" style="margin-top:12px"><label class="f">抽選結果を発表するチャンネル(共通)</label><select id="ch">${chOpts(ch, '発表しない')}</select><p class="hint">くじごとに、別のチャンネルも選べます。</p></div>
              <label class="sw" style="margin-top:12px"><input type="checkbox" id="mention" ${mention ? 'checked' : ''}><i></i><span><b>買った人にメンションする</b><small>発表のとき、その回にくじを買った人全員に、メンションします(多いときは先頭の80人まで)</small></span></label></div>
            <h2 class="sec" style="margin:18px 0 8px">くじ(最大${meta.maxLotteries}つ)</h2>
            ${lots.map((L, n) => `<div class="card" data-i="${n}"><div class="card-h"><h2>${n + 1}. ${esc(L.emoji)} ${esc(L.name)}</h2><button class="btn danger icon" type="button" data-rm="${n}" aria-label="削除">✕</button></div>
              <div class="grid2">
                <div class="field"><label class="f">名前</label><input class="l-name" type="text" maxlength="12" value="${esc(L.name)}"></div>
                <div class="field"><label class="f">絵文字</label><input class="l-emoji" type="text" maxlength="8" value="${esc(L.emoji)}"></div>
                <div class="field"><label class="f">くじ1枚の値段</label><input class="l-price" type="number" min="1" value="${L.price}"></div>
                <div class="field"><label class="f">1人が、1回の抽選で買える枚数</label><input class="l-max" type="number" min="1" max="1000" value="${L.maxTickets}"></div>
                <div class="field"><label class="f">抽選の間隔(時間)</label><input class="l-hours" type="number" min="1" max="168" value="${L.drawHours}"></div>
                <div class="field"><label class="f">抽選の時刻の基準(日本時間の、何時)</label><input class="l-at" type="number" min="0" max="23" value="${L.drawAtHour}"></div>
                <div class="field"><label class="f">桁数(2〜4)</label><input class="l-digits" type="number" min="2" max="4" value="${L.digits}"></div>
                <div class="field"><label class="f">1等(ジャックポット)の最低額</label><input class="l-jp" type="number" min="0" value="${L.jackpotBase}"></div>
                <div class="field"><label class="f">売上のうち、ジャックポットに積む割合(%)</label><input class="l-share" type="number" min="0" max="100" value="${L.jackpotShare}"></div>
                <div class="field"><label class="f">2等(下の桁が、1桁を残して一致)の倍率</label><input class="l-p2" type="number" min="0" value="${L.prize2}"></div>
                <div class="field"><label class="f">3等(下の桁が、2桁を残して一致。3桁以上)の倍率</label><input class="l-p3" type="number" min="0" value="${L.prize3}"></div>
                <div class="field"><label class="f">このくじの発表チャンネル</label><select class="l-ch">${chOpts(L.channelId || '', '共通のチャンネル')}</select></div></div>
              <p class="hint" style="margin:6px 0 0">還元率の目安(ジャックポットが最低額のとき): <b>${rtp(L).toFixed(0)}%</b>。100%を超えると、遊ぶほど、お金が増えます。</p></div>`).join('')}
            <div class="card"><h2>仕組み</h2><ul style="margin:0;padding-left:1.2em"><li><b>1等</b>: 全部の桁が一致。ジャックポットを、当たりのくじの枚数で、等分します。当たりが出なければ、次回に持ち越しです</li><li><b>2等・3等</b>: くじ代の倍率が、当選金です(買ったときのくじ代で計算)</li><li>くじを<b>削除</b>すると、売れ残りのくじは、買ったときの値段で、払い戻されます</li></ul></div>
            <div class="acts"><button class="btn ghost" id="add" type="button" ${lots.length >= meta.maxLotteries ? 'disabled' : ''}>くじを追加</button><button class="btn" id="save" type="button">保存</button></div>`;
          const collect = () => {
            on = el.querySelector('#on').checked; ch = el.querySelector('#ch').value; mention = el.querySelector('#mention').checked;
            lots = [...el.querySelectorAll('[data-i]')].map((c, n) => ({ id: lots[n]?.id, name: c.querySelector('.l-name').value, emoji: c.querySelector('.l-emoji').value, price: c.querySelector('.l-price').value, maxTickets: c.querySelector('.l-max').value, drawHours: c.querySelector('.l-hours').value, drawAtHour: c.querySelector('.l-at').value, digits: c.querySelector('.l-digits').value, jackpotBase: c.querySelector('.l-jp').value, jackpotShare: c.querySelector('.l-share').value, prize2: c.querySelector('.l-p2').value, prize3: c.querySelector('.l-p3').value, channelId: c.querySelector('.l-ch').value || null }));
          };
          el.querySelector('#add').onclick = () => { collect(); lots.push({ ...meta.defaultLottery, id: undefined, name: '新しいくじ' }); draw(); };
          el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { collect(); lots.splice(Number(b.dataset.rm), 1); draw(); }));
          el.querySelector('#save').onclick = async () => { collect(); const r = await api('/settings', { method: 'PUT', body: { lotteryEnabled: on, lotteryChannelId: ch || null, lotteryMention: mention, lotteries: lots } }); lots = JSON.parse(JSON.stringify(r.lotteries)); toast('保存しました'); draw(); };
        };
        draw();
      } },
    /* ===== 不動産 ===== */
    { id: 'estate', title: '不動産', icon: 'coin',
      async render(el, { api, esc, toast, pageHeader }) {
        const [st, meta] = await Promise.all([api('/settings'), api('/extras-meta')]);
        let props = JSON.parse(JSON.stringify(st.estate)), on = st.estateEnabled;
        const draw = () => {
          el.innerHTML = `${pageHeader('不動産', '物件を買って、家賃(1時間ごとに溜まる)をもらえます。物件の名前・値段・家賃・維持費・持てる数を、サーバーで自由に決められます(最大${meta.maxProperties}件)。')}
            <div class="card"><label class="sw"><input type="checkbox" id="on" ${on ? 'checked' : ''}><i></i><span><b>不動産を使う</b><small><code>/estate</code> が使えます。家賃が溜まる上限の時間・売るときの割合・手数料は、「ゲームバランス」で変えられます</small></span></label></div>
            ${props.map((p, n) => `<div class="card" data-i="${n}"><div class="card-h"><h2>${n + 1}. ${esc(p.emoji)} ${esc(p.name)}</h2><button class="btn danger icon" type="button" data-rm="${n}" aria-label="削除">✕</button></div>
              <div class="grid2">
                <div class="field"><label class="f">名前</label><input class="e-name" type="text" maxlength="12" value="${esc(p.name)}"></div>
                <div class="field"><label class="f">絵文字</label><input class="e-emoji" type="text" maxlength="8" value="${esc(p.emoji)}"></div>
                <div class="field"><label class="f">値段</label><input class="e-price" type="number" min="1" value="${p.price}"></div>
                <div class="field"><label class="f">持てる数の上限(最大20)</label><input class="e-max" type="number" min="1" max="20" value="${p.maxOwn}"></div>
                <div class="field"><label class="f">1件買うごとに増える、ペットを飼える数(0〜10)</label><input class="e-pet" type="number" min="0" max="10" value="${p.petSlots ?? 0}"></div>
                <div class="field"><label class="f">家賃(1時間あたり)</label><input class="e-rent" type="number" min="0" value="${p.rent}"></div>
                <div class="field"><label class="f">維持費(1時間あたり)</label><input class="e-up" type="number" min="0" value="${p.upkeep}"></div>
                <div class="field" style="grid-column:1/-1"><label class="f">説明</label><input class="e-desc" type="text" maxlength="60" value="${esc(p.desc)}"></div></div>
              <p class="hint" style="margin:6px 0 0">手取り <b>${Math.max(0, p.rent - p.upkeep).toLocaleString()}</b>/時間 ・ 1日の利回り <b>${(Math.max(0, p.rent - p.upkeep) * 24 / Math.max(1, p.price) * 100).toFixed(1)}%</b>${p.upkeep > p.rent ? '(<span style="color:var(--bad,#d33)">維持費が家賃より高いので、手取りは0です</span>)' : ''}</p></div>`).join('')}
            <div class="acts"><button class="btn ghost" id="add" type="button" ${props.length >= meta.maxProperties ? 'disabled' : ''}>物件を追加</button><button class="btn ghost" id="reset" type="button">初期の物件に戻す</button><button class="btn" id="save" type="button">保存</button></div>`;
          const collect = () => {
            on = el.querySelector('#on').checked;
            props = [...el.querySelectorAll('[data-i]')].map((c, n) => ({ id: props[n]?.id, name: c.querySelector('.e-name').value, emoji: c.querySelector('.e-emoji').value, price: c.querySelector('.e-price').value, maxOwn: c.querySelector('.e-max').value, petSlots: c.querySelector('.e-pet').value, rent: c.querySelector('.e-rent').value, upkeep: c.querySelector('.e-up').value, desc: c.querySelector('.e-desc').value }));
          };
          el.querySelector('#add').onclick = () => { collect(); props.push({ name: '新しい物件', emoji: '🏠', price: 10000, rent: 30, upkeep: 5, maxOwn: 5, petSlots: 1, desc: '' }); draw(); };
          el.querySelector('#reset').onclick = () => { collect(); props = JSON.parse(JSON.stringify(meta.defaultEstate)); draw(); };
          el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { collect(); props.splice(Number(b.dataset.rm), 1); draw(); }));
          el.querySelector('#save').onclick = async () => { collect(); const r = await api('/settings', { method: 'PUT', body: { estateEnabled: on, estate: props } }); props = JSON.parse(JSON.stringify(r.estate)); toast('保存しました'); draw(); };
        };
        draw();
      } },
    /* ===== 留置場 ===== */
    /* ===== 持ち物一覧(だれが、何を持っているか) ===== */
    { id: 'holdings', title: '持ち物一覧', icon: 'list',
      async render(el, { api, esc, ic, pageHeader }) {
        const d = await api('/holdings'), em = esc(d.currencyEmoji);
        const dur = (ms) => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`; };
        const chips = (arr, f) => arr.length ? arr.map((x) => `<span class="badge" style="margin:2px 4px 2px 0">${f(x)}</span>`).join('') : '<span class="mut">なし</span>';
        el.innerHTML = `${pageHeader('持ち物一覧', 'だれが、どの品(お店・闇市)・ペット・物件・株を持っているかの一覧です。「効果中」は、使ってから、まだ効果が続いている品です。')}
          <div class="card"><div class="field" style="margin:0"><label class="f" for="hq">名前や品で、絞り込む</label><input id="hq" type="search" style="width:100%" placeholder="例: ビール / ポチ / ワンルーム" autocomplete="off"></div></div>
          <div id="hl"></div>`;
        const draw = () => {
          const q = el.querySelector('#hq').value.trim().toLowerCase();
          const rows = d.users.filter((u) => !q || `${u.name} ${u.items.map((x) => x.name).join(' ')} ${u.effects.map((x) => x.name).join(' ')} ${u.pets.map((x) => `${x.name} ${x.species}`).join(' ')} ${u.estate.map((x) => x.name).join(' ')} ${u.stocks.map((x) => x.name).join(' ')}`.toLowerCase().includes(q));
          el.querySelector('#hl').innerHTML = rows.length ? rows.map((u) => `<div class="card"><div class="card-h"><h2>${esc(u.name)}</h2><span class="badge">${em} ${u.money.toLocaleString()}</span></div>
            <div class="field" style="margin:0 0 8px"><label class="f">品</label>${chips(u.items, (x) => `${esc(x.emoji)} ${esc(x.name)} ×${x.qty}${x.kind === 'market' ? ' <span class="mut">(闇市)</span>' : ''}`)}</div>
            <div class="field" style="margin:0 0 8px"><label class="f">効果中</label>${chips(u.effects, (x) => `${esc(x.emoji)} ${esc(x.name)} <span class="mut">あと${dur(x.left)}</span>`)}</div>
            <div class="field" style="margin:0 0 8px"><label class="f">ペット</label>${chips(u.pets, (x) => `${esc(x.emoji)} ${esc(x.name)} <span class="mut">(${esc(x.species)})</span>`)}</div>
            <div class="field" style="margin:0 0 8px"><label class="f">物件</label>${chips(u.estate, (x) => `${esc(x.emoji)} ${esc(x.name)} ×${x.count}`)}</div>
            <div class="field" style="margin:0"><label class="f">株</label>${chips(u.stocks, (x) => `${esc(x.emoji)} ${esc(x.name)} ${x.shares}株`)}</div></div>`).join('')
            : `<div class="card empty">${ic('check')}<h2>${d.users.length ? '見つかりません' : 'まだ、何かを持っている人はいません'}</h2></div>`;
        };
        el.querySelector('#hq').oninput = draw; draw();
      } },
    /* ===== パネル(ボタンつきのメッセージ。置くと、元のコマンドを廃止できる) ===== */
    { id: 'panels', title: 'パネル', icon: 'list',
      async render(el, { api, channels: getChannels, esc, toast, confirm, pageHeader }) {
        const info = { crime: ['🚨', '犯罪・大型犯罪のボタンが並びます。押すと、その犯罪に挑戦します。'], work: ['💼', 'バイトと乞食のボタンが並びます。押すと、バイトをして、給料をもらいます。'], shop: ['🏪', 'お店・不動産・闇市を、まとめたパネルです。買うメニューと、「一覧」「使う」「家賃を受け取る」などのボタンが並びます。'], pet: ['🐾', 'ペットを飼うメニューと、「ようす」「餌」「遊ぶ」「名前」「手放す」のボタンが並びます。'], stock: ['📈', '「株価・持ち株」「ニュース」「買う」「売る」のボタンが並びます(株数は、入力欄に入れます。ニュースは、会社を選んで見られます)。'] };
        const [list, chans] = await Promise.all([api('/panels'), getChannels()]);
        const draw = (rows) => {
          el.innerHTML = `${pageHeader('パネル', 'チャンネルに、ボタンつきのメッセージ(パネル)を置くと、コマンドを打たなくても、ボタンで、犯罪・バイト・お店が使えます。パネルを置いたサーバーでは、元のコマンドを廃止できます(そのサーバーのコマンド一覧から、消えます)。品や数字を変えたときは、「置き直す」で、パネルを更新してください。')}
            ${rows.map((r) => `<div class="card" data-k="${r.kind}"><div class="card-h"><h2>${info[r.kind][0]} ${esc(r.title)}</h2>${r.installed ? '<span class="badge">設置ずみ</span>' : ''}</div>
              <p class="hint" style="margin:0 0 10px">${info[r.kind][1]} 廃止できるコマンド: ${r.commands.map((c) => `<code>/${c}</code>`).join(' ')}</p>
              <div class="grid2"><div class="field"><label class="f">パネルを置くチャンネル</label><select class="p-ch"><option value="">選んでください</option>${chans.map((c) => `<option value="${c.id}" ${r.installed?.channel_id === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select></div></div>
              <div class="field" style="margin-top:8px"><label class="f">廃止するコマンド(チェックしたコマンドは、このサーバーで使えなくなり、パネルからだけ使えます)</label>${r.commands.map((cm) => `<label class="sw" style="margin:2px 0"><input type="checkbox" class="p-ret" data-c="${cm}" ${(r.installed ? (r.installed.retire ?? []).includes(cm) : true) ? 'checked' : ''}><i></i><span><b><code>/${cm}</code> を廃止する</b></span></label>`).join('')}<p class="hint" style="margin:4px 0 0">チェックを外したコマンドは、パネルを置いても、そのまま残ります。</p></div>
              <label class="sw"><input type="checkbox" class="p-sticky" ${!r.installed || r.installed.sticky ? 'checked' : ''}><i></i><span><b>いつも一番下に出す</b><small>チャンネルで誰かが話したり、ボタンの結果が出たりしたら、パネルを消して、一番下に出し直します(8秒静かになってから)</small></span></label>
              <div class="acts"><button class="btn p-set" type="button">${r.installed ? '置き直す(更新)' : 'パネルを置く'}</button>${r.installed ? `<a class="btn ghost" href="${esc(r.installed.link)}" target="_blank" rel="noopener">パネルを開く</a><button class="btn danger p-rm" type="button">撤去する</button>` : ''}</div></div>`).join('')}`;
          el.querySelectorAll('[data-k]').forEach((c) => {
            const kind = c.dataset.k, row = rows.find((x) => x.kind === kind);
            c.querySelector('.p-set').onclick = async () => {
              const ch = c.querySelector('.p-ch').value, retire = [...c.querySelectorAll('.p-ret:checked')].map((x) => x.dataset.c), sticky = c.querySelector('.p-sticky').checked; if (!ch) { toast('チャンネルを選んでください', 'err'); return; }
              if (retire.length && !await confirm({ title: 'コマンドを廃止', message: `パネルを置くと、このサーバーでは、${retire.map((x) => '/' + x).join(' ')} が使えなくなります(パネルからだけ、使えます)。`, ok: '置く' })) return;
              const r = await api(`/panels/${kind}`, { method: 'POST', body: { channel_id: ch, retire, sticky } }); toast('パネルを置きました'); draw(rows.map((x) => (x.kind === kind ? r : x)));
            };
            const rm = c.querySelector('.p-rm');
            if (rm) rm.onclick = async () => {
              if (!await confirm({ title: 'パネルを撤去', message: `パネルのメッセージを消して、${row.commands.map((x) => '/' + x).join(' ')} を、元に戻します。`, ok: '撤去する', danger: true })) return;
              const r = await api(`/panels/${kind}`, { method: 'DELETE' }); toast('撤去しました'); draw(rows.map((x) => (x.kind === kind ? r : x)));
            };
          });
        };
        draw(list);
      } },
    /* ===== カスタムパネル(どんなコマンドでも、ボタンにして置ける) ===== */
    { id: 'custom', title: 'カスタムパネル', icon: 'list',
      async render(el, { api, channels: getChannels, esc, toast, confirm, pageHeader }) {
        const [cat, saved, chans] = await Promise.all([api('/command-catalog'), api('/custom-panels'), getChannels()]);
        const cmds = cat.commands.filter((c) => !c.unsupported), colors = { secondary: '灰色', primary: '青', success: '緑', danger: '赤' };
        const blank = () => ({ id: null, title: '新しいパネル', description: '', ch: '', sticky: true, retire: [], buttons: [] });
        const tag = (p) => { p.buttons.forEach((b, i) => { b._i = i; }); return p; }; // サーバーにあるボタンの番号(すぐ消すのに使う)
        let panels = [...saved.map((p) => tag(JSON.parse(JSON.stringify(p)))), blank()];
        const refreshRetired = async () => { cat.retiredBy = (await api('/command-catalog')).retiredBy; };
        const optsOf = (b) => { const c = cmds.find((x) => x.name === b.command); if (!c) return []; if (c.subs.length) return c.subs.find((x) => x.name === b.sub)?.options ?? []; return c.options; };
        const modeOf = (b, o) => (b.ask?.includes(o.name) ? 'ask' : (b.pick && o.name in b.pick) ? 'pick' : (b.values && o.name in b.values) ? 'fixed' : 'skip');
        const pickText = (b, o) => (b.pick?.[o.name] ?? []).map((e) => (String(e.label) === String(e.value) ? String(e.value) : `${e.label}=${e.value}`)).join(', ');
        const valInput = (o, v) => o.choices?.length ? `<select class="o-val">${o.choices.map((c) => `<option value="${esc(c.value)}" ${String(v) === String(c.value) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`
          : o.type === 5 ? `<select class="o-val"><option value="true" ${v === true ? 'selected' : ''}>オン(はい)</option><option value="false" ${v === false ? 'selected' : ''}>オフ(いいえ)</option></select>`
          : `<input class="o-val" type="${o.type === 3 ? 'text' : 'number'}" ${o.type === 10 ? 'step="any"' : ''} value="${v === undefined ? '' : esc(v)}" placeholder="${esc(o.description || o.name)}">`;
        const btnHtml = (b, bi, p) => { const c = cmds.find((x) => x.name === b.command), os = optsOf(b);
          return `<div class="card" data-bi="${bi}" style="background:var(--bg2)"><div class="card-h"><h3 style="margin:0">${esc(b.emoji || '')} ${esc(b.label || '(名前なし)')}</h3><button class="btn danger icon" type="button" data-rmb="${bi}" aria-label="ボタンを消す">✕</button></div>
            <div class="grid2">
              <div class="field"><label class="f">ボタンの文字</label><input class="b-label" type="text" maxlength="40" value="${esc(b.label)}"></div>
              <div class="field"><label class="f">絵文字</label><input class="b-emoji" type="text" maxlength="8" value="${esc(b.emoji || '')}"></div>
              <div class="field"><label class="f">色</label><select class="b-style">${Object.entries(colors).map(([k, l]) => `<option value="${k}" ${b.style === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
              <div class="field"><label class="f">コマンド</label><select class="b-cmd"><option value="">選んでください</option>${cmds.filter((x) => b.command === x.name || !(cat.retiredBy?.[x.name] ?? []).some((by) => by !== 'custom:' + p.id)).map((x) => `<option value="${x.name}" ${b.command === x.name ? 'selected' : ''}>/${esc(x.name)} — ${esc(x.description)}</option>`).join('')}</select></div>
              ${c?.subs.length ? `<div class="field"><label class="f">サブコマンド</label><select class="b-sub"><option value="">選んでください</option>${c.subs.map((x) => `<option value="${x.name}" ${b.sub === x.name ? 'selected' : ''}>${esc(x.name)} — ${esc(x.description)}</option>`).join('')}</select></div>` : ''}</div>
            ${os.length ? `<p class="hint" style="margin:6px 0">コマンドの項目: 「決めない」は省略、「固定」はいつも同じ値、「押したとき選ぶ」は、押すとプルダウンが出ます、「押したとき入力」は、押すと入力欄が出ます(それぞれ5項目まで)。</p>${os.map((o) => { const m = modeOf(b, o); return o.supported
              ? `<div class="grid2" data-opt="${esc(o.name)}" style="align-items:end"><div class="field" style="margin:0"><label class="f">${esc(o.name)}${o.required ? '(必須)' : ''} <span class="mut small">${esc(o.description || '')}</span></label><select class="o-mode">${[['skip', '決めない(省略)'], ['fixed', '固定の値'], ['pick', o.choices?.length ? '押したとき選ぶ(プルダウン・コマンドの選択肢)' : '押したとき選ぶ(プルダウン)'], ['ask', '押したとき入力']].filter(([k]) => !(k === 'skip' && o.required)).map(([k, l]) => `<option value="${k}" ${m === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
                <div class="field" style="margin:0;${m === 'fixed' ? '' : 'display:none'}" data-valbox>${valInput(o, b.values?.[o.name])}</div>${m === 'pick' ? `<div class="field" style="margin:0;grid-column:1/-1"><label class="f">選択肢${o.choices?.length ? '(空欄なら、コマンドの選択肢をすべて使います)' : '(カンマで区切る。「表示=値」で、表示を変えられます。25個まで)'}</label><input class="o-pick" type="text" value="${esc(pickText(b, o))}" placeholder="${o.choices?.length ? '' : '例: 1, 5, 10 または 少し=1, ふつう=5'}"></div>` : ''}</div>`
              : `<p class="hint" style="margin:4px 0">${esc(o.name)}: ボタンでは指定できない種類の項目です${o.required ? '(必須なので、このコマンドは使えません)' : '(省略されます)'}</p>`; }).join('')}` : ''}</div>`; };
        const draw = () => {
          el.innerHTML = `${pageHeader('カスタムパネル', 'どんなコマンドでも、ボタンにして、チャンネルに置けます。コマンドの項目は、固定の値にしたり、ボタンを押したときに入力欄で聞いたりできます(ユーザー・チャンネル・ロール・ファイルの項目は、ボタンでは指定できません)。「元のコマンドを廃止する」をオンにすると、このサーバーでは、使っているコマンドが、ボタンからだけ使えるようになります(/help は残ります)。')}
            ${panels.map((p, pi) => `<div class="card" data-pi="${pi}"><div class="card-h"><h2>${p.id ? '🧩' : '➕'} ${esc(p.title)}</h2>${p.id ? '<span class="badge">設置ずみ</span>' : ''}</div>
              <div class="grid2"><div class="field"><label class="f">パネルの題名</label><input class="p-title" type="text" maxlength="80" value="${esc(p.title)}"></div>
                <div class="field"><label class="f">置くチャンネル</label><select class="p-ch"><option value="">選んでください</option>${chans.map((c) => `<option value="${c.id}" ${p.ch === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select></div></div>
              <div class="field"><label class="f">説明(省略できる)</label><input class="p-desc" type="text" maxlength="1000" value="${esc(p.description)}"></div>
              <label class="sw"><input type="checkbox" class="p-sticky" ${p.sticky ? 'checked' : ''}><i></i><span><b>いつも一番下に出す</b><small>だれかが話したら、パネルを一番下に出し直します</small></span></label>
              ${(() => { const used = [...new Set(p.buttons.map((b) => b.command).filter((x) => x && x !== 'help'))]; return used.length ? `<div class="field" style="margin-top:8px"><label class="f">廃止するコマンド(ボタンで使っているコマンドから選びます。チェックしたものは、このサーバーで使えなくなり、パネルからだけ使えます。/help は、いつも残ります)</label>${used.map((cm) => `<label class="sw" style="margin:2px 0"><input type="checkbox" class="p-ret" data-c="${esc(cm)}" ${(p.retire ?? []).includes(cm) ? 'checked' : ''}><i></i><span><b><code>/${esc(cm)}</code> を廃止する</b></span></label>`).join('')}</div>` : ''; })()}
              <h3 style="margin:14px 0 8px">ボタン(最大${cat.maxButtons}個)</h3>${p.buttons.map((b, bi) => btnHtml(b, bi, p)).join('') || '<p class="hint">ボタンが、まだありません。</p>'}
              <div class="acts"><button class="btn ghost p-addb" type="button" ${p.buttons.length >= cat.maxButtons ? 'disabled' : ''}>ボタンを追加</button><button class="btn p-save" type="button">${p.id ? '更新する' : 'パネルを置く'}</button>${p.id ? `<a class="btn ghost" href="${esc(p.link)}" target="_blank" rel="noopener">パネルを開く</a><button class="btn danger p-del" type="button">撤去する</button>` : ''}</div></div>`).join('')}`;
          el.querySelectorAll('.card[data-pi]').forEach((card) => {
            const pi = Number(card.dataset.pi), p = panels[pi];
            const collect = () => {
              p.title = card.querySelector('.p-title').value; p.ch = card.querySelector('.p-ch').value; p.description = card.querySelector('.p-desc').value; p.sticky = card.querySelector('.p-sticky').checked; p.retire = [...card.querySelectorAll('.p-ret:checked')].map((x) => x.dataset.c);
              p.buttons = [...card.querySelectorAll('[data-bi]')].map((bc, bi) => { const old = p.buttons[bi], b = { label: bc.querySelector('.b-label').value, emoji: bc.querySelector('.b-emoji').value, style: bc.querySelector('.b-style').value, command: bc.querySelector('.b-cmd').value, sub: bc.querySelector('.b-sub')?.value ?? '', values: {}, ask: [], pick: {} };
                if (b.command !== old.command) b.sub = ''; // コマンドを変えたら、項目は、選び直す
                bc.querySelectorAll('[data-opt]').forEach((r) => { const m = r.querySelector('.o-mode').value, name = r.dataset.opt; if (m === 'ask') b.ask.push(name); else if (m === 'pick') b.pick[name] = (r.querySelector('.o-pick')?.value ?? '').split(/[,、]/).map((x) => x.trim()).filter(Boolean).map((x) => { const k = x.indexOf('='); return k > 0 ? { label: x.slice(0, k).trim(), value: x.slice(k + 1).trim() } : { label: x, value: x }; }); else if (m === 'fixed') b.values[name] = r.querySelector('.o-val').value; });
                if (b.command !== old.command || (b.sub !== old.sub)) { b.values = {}; b.ask = []; b.pick = {}; }
                return b; });
            };
            card.querySelectorAll('.b-cmd, .b-sub, .o-mode').forEach((x) => (x.onchange = () => { collect(); draw(); }));
            card.querySelector('.p-addb').onclick = () => { collect(); p.buttons.push({ label: '', emoji: '', style: 'secondary', command: '', sub: '', values: {}, ask: [], pick: {} }); draw(); };
            card.querySelectorAll('[data-rmb]').forEach((x) => (x.onclick = async () => {
              collect(); const bi = Number(x.dataset.rmb), b = p.buttons[bi];
              if (p.id && b._i !== undefined) { // 置いてあるパネルのボタンは、すぐに消す(使っていなくなったコマンドは、すぐに元に戻る)
                const r = await api(`/custom-panels/${p.id}/buttons/${b._i}`, { method: 'DELETE' });
                p.buttons.splice(bi, 1); p.buttons.forEach((o) => { if (o._i > b._i) o._i--; }); p.retire = r.retire; await refreshRetired();
                toast('ボタンを消しました(使っていないコマンドは、元に戻りました)');
              } else p.buttons.splice(bi, 1);
              draw();
            }));
            card.querySelector('.p-save').onclick = async () => {
              collect(); if (!p.ch) { toast('チャンネルを選んでください', 'err'); return; }
              if (p.retire.length && !await confirm({ title: 'コマンドを廃止', message: `廃止するコマンド(${p.retire.map((x) => '/' + x).join(' ')})が、このサーバーでは、使えなくなります(ボタンからだけ、使えます)。`, ok: '置く' })) return;
              const body = { title: p.title, description: p.description, channel_id: p.ch, sticky: p.sticky, retire: p.retire, buttons: p.buttons.map((b) => ({ label: b.label, emoji: b.emoji, style: b.style, command: b.command, sub: b.sub, modes: Object.fromEntries([...Object.keys(b.values).map((k) => [k, 'fixed']), ...b.ask.map((k) => [k, 'ask']), ...Object.keys(b.pick).map((k) => [k, 'pick'])]), values: b.values, pick: b.pick })) };
              const r = await api('/custom-panels/' + (p.id ?? 'new'), { method: 'PUT', body }); toast('パネルを置きました');
              panels[pi] = tag(JSON.parse(JSON.stringify(r))); if (!p.id) panels.push(blank()); await refreshRetired(); draw();
            };
            const del = card.querySelector('.p-del');
            if (del) del.onclick = async () => { if (!await confirm({ title: 'パネルを撤去', message: `「${p.title}」のメッセージを消して、廃止していたコマンドを、元に戻します。`, ok: '撤去する', danger: true })) return; await api('/custom-panels/' + p.id, { method: 'DELETE' }); toast('撤去しました'); panels.splice(pi, 1); await refreshRetired(); draw(); };
          });
        };
        draw();
      } },
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
    { id: 'admin', title: '残高の調整・アイテム', icon: 'shield',
      async render(el, { api, esc, ic, toast, confirm, pageHeader }) {
        const st = await api('/settings'); const can = st.canEditBudget; const em = esc(st.currencyEmoji);
        const fmtN = (n) => `${em} ${Number(n).toLocaleString()}`;
        const dt = (t) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        let picked = null;
        el.innerHTML = `${pageHeader('残高の調整・アイテム', '管理者が、メンバーのお金を増やす・減らす・指定した額にする、アイテムを付ける・取り上げる、罰金を返金する、ためのページです。すべての操作は、下の記録に残ります。')}
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
          q('#panel').insertAdjacentHTML('beforeend', `<div class="card"><h2>3. アイテムの付与・回収</h2><p class="hint" style="margin:0 0 8px">お店の品と、闇市の道具を、${esc(a.name)} に付けたり、取り上げたりします。持てる上限(お店99個・闇市は設定の上限)を超えるぶんは、付きません。</p>
            <div class="tiles" style="margin:0 0 12px">${a.items.filter((x) => x.qty).map((x) => `<div class="tile"><div class="k">${esc(x.emoji)} ${esc(x.name)}${x.kind === 'market' ? '(闇市)' : ''}</div><div class="v">${x.qty}<span class="u">個</span></div></div>`).join('') || '<span class="mut small">いまは、品を持っていません</span>'}</div>
            <div class="grid2"><div class="field"><label class="f" for="gi">品</label><select id="gi">${['shop', 'market'].map((k) => `<optgroup label="${k === 'shop' ? 'お店' : '闇市'}">${a.items.filter((x) => x.kind === k).map((x) => `<option value="${x.id}">${esc(x.emoji)} ${esc(x.name)}(いま ${x.qty}個)</option>`).join('')}</optgroup>`).join('')}</select></div>
              <div class="field"><label class="f" for="gm">操作</label><select id="gm"><option value="add">付ける</option><option value="remove">取り上げる</option></select></div>
              <div class="field"><label class="f" for="gn">個数</label><input id="gn" type="number" min="1" max="99" value="1"></div>
              <div class="field"><label class="f" for="gt">メモ(任意)</label><input id="gt" type="text" maxlength="100" placeholder="理由など"></div></div>
            <div class="acts"><button class="btn" id="grant" type="button">実行する</button></div>
            <div class="acts" style="margin-top:8px"><button class="btn ghost" id="grant-all" type="button">全部の品を、上の個数ずつ付ける</button><button class="btn ghost danger" id="revoke-all" type="button">全部の品を、上の個数ずつ取り上げる</button></div>
            <p class="hint" style="margin:6px 0 0">「全部の品」は、お店と闇市の、すべての品が対象です(上限を超えるぶんは付きません)。全部を空にしたいときは、個数を 99 にして取り上げます。</p></div>`);
          const bulk = (mode) => async () => {
            const amount = q('#gn').value, nm = mode === 'add' ? '付与' : '回収';
            if (!await confirm({ title: '全部の品を' + nm, message: `${a.name} ${mode === 'add' ? 'に' : 'から'}、お店と闇市の全部の品を、${amount}個ずつ ${mode === 'add' ? '付けます' : '取り上げます'}。`, ok: '実行する', danger: mode !== 'add' })) return;
            const r = await api('/grant-item', { method: 'POST', body: { user_id: picked, item: 'all', mode, amount, note: q('#gt').value } }); toast(`${r.kinds}種類(${r.units}個)を${nm}しました`); await drawPanel(); drawLog();
          };
          q('#grant-all').onclick = bulk('add'); q('#revoke-all').onclick = bulk('remove');
          q('#grant').onclick = async () => {
            const it = a.items.find((x) => x.id === q('#gi').value), mode = q('#gm').value, amount = q('#gn').value;
            if (!await confirm({ title: 'アイテムを' + (mode === 'add' ? '付与' : '回収'), message: `${a.name} ${mode === 'add' ? 'に' : 'から'}、${it.emoji} ${it.name} を ${amount}個 ${mode === 'add' ? '付けます' : '取り上げます'}。`, ok: '実行する', danger: mode !== 'add' })) return;
            await api('/grant-item', { method: 'POST', body: { user_id: picked, item: it.id, mode, amount, note: q('#gt').value } }); toast(mode === 'add' ? '付与しました' : '取り上げました'); await drawPanel(); drawLog();
          };
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
