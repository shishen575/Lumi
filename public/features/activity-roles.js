// 活動ロール: 概要 / ルール / ランキング / 過去ログ取り込み / 通知と設定
(() => {
  const UNIT = { messages: '回', reactions_received: '個', reactions_given: '個', voice_minutes: '分' };
  const fmtVoice = (m) => (m >= 60 ? `${Math.floor(m / 60).toLocaleString()}時間${m % 60}分` : `${m}分`);
  const fmt = (metric, v) => (metric === 'voice_minutes' ? fmtVoice(v) : `${v.toLocaleString()}${UNIT[metric]}`);
  const roleBadge = (ro, esc) => (ro ? `<span class="role"><span class="dot" style="background:${ro.color === '#000000' ? 'var(--mut)' : ro.color}"></span>${esc(ro.name)}</span>` : '<span class="badge warn">削除されたロール</span>');

  Dash.registerTab({
    name: 'activity-roles', title: '活動ロール',
    pages: [
      /* ===== 概要 ===== */
      { id: 'overview', title: '概要', icon: 'home',
        async render(el, { api, roles: getRoles, esc, ic, pageHeader }) {
          const [ov, roles, rules] = await Promise.all([api('/overview'), getRoles(), api('/rules')]);
          const byId = new Map(roles.map((r) => [r.id, r]));
          const blocked = rules.filter((r) => byId.get(r.role_id) && !byId.get(r.role_id).assignable);
          const missing = rules.filter((r) => !byId.get(r.role_id));
          const tile = (k, v, u) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}<span class="u">${u}</span></div></div>`;
          const hash = location.hash.split('/')[0];
          const step = (cls, title, body, link) => `<li class="${cls}"><span class="mark">${cls === 'warn' ? ic('alert', '') : ic('check', '')}</span><div class="grow"><b>${title}</b><span class="mut small">${body}</span></div>${link ? `<a class="btn ghost sm" href="${hash}/${link[0]}">${link[1]}</a>` : ''}</li>`;
          el.innerHTML = `${pageHeader('概要', 'このサーバーの、活動の集計と、設定の状況です。')}
            <div class="tiles">${tile('集計中のメンバー', ov.members.toLocaleString(), '人')}${tile('発言数の合計', ov.messages.toLocaleString(), '回')}
              ${tile('リアクションの合計', ov.reactions_received.toLocaleString(), '個')}${tile('VC接続の合計', fmtVoice(ov.voice_minutes), '')}</div>
            <div class="card"><h2>セットアップの状況</h2><p class="sub">上から順に進めると、すぐに使い始められます。</p>
              <ul class="todo">
                ${rules.length ? step('done', 'ルールを作る', `${rules.length}件のルールが登録されています`, ['activity-roles.rules', 'ルールを見る'])
                  : step('', 'ルールを作る', '「発言数 100 以上 → ロール」のように、条件とロールを登録します', ['activity-roles.rules', 'ルールを作る'])}
                ${blocked.length ? step('warn', 'BOTのロールの位置を直す', `${blocked.length}件のルールのロールが、BOTのロールより上にあるため、付与できません。サーバー設定で、BOTのロールを上へ移動してください`)
                  : missing.length ? step('warn', 'ロールを確認する', `${missing.length}件のルールのロールが、削除されています。ルールを編集してください`, ['activity-roles.rules', 'ルールを見る'])
                  : step(rules.length ? 'done' : '', 'BOTのロールの位置', rules.length ? 'すべてのルールのロールを、付与できます' : 'BOTのロールを、付与したいロールより上に置いてください')}
                ${ov.notify ? step('done', 'ロール獲得の通知', '通知チャンネルが設定されています', ['activity-roles.settings', '設定を見る'])
                  : step('', 'ロール獲得の通知(任意)', '通知チャンネルを決めると、ロールが付いたときにお知らせします', ['activity-roles.settings', '通知を設定'])}
                ${step(ov.members > 0 ? 'done' : '', '過去の発言を取り込む(任意)', ov.members > 0 ? `${ov.members.toLocaleString()}人分の集計があります。導入前の発言も数えたいときに使います` : 'BOT導入前のメッセージを、期間を指定して数えます', ['activity-roles.import', '取り込みを開く'])}
              </ul></div>`;
        } },

      /* ===== ルール ===== */
      { id: 'rules', title: 'ルール', icon: 'list',
        async render(el, { api, roles: getRoles, esc, ic, toast, modal, confirm, pageHeader }) {
          const [{ metrics }, roles] = await Promise.all([api('/meta'), getRoles()]);
          const byId = new Map(roles.map((r) => [r.id, r]));
          let rules = [];

          const draw = () => {
            const body = Object.entries(metrics).map(([m, label]) => {
              const rs = rules.filter((r) => r.metric === m).sort((a, b) => a.threshold - b.threshold);
              if (!rs.length) return '';
              return `<div class="card flush rg"><div class="card-h"><h2>${esc(label)}</h2><span class="badge mut">${rs.length}段階</span></div>${rs.map((r) => {
                const ro = byId.get(r.role_id);
                return `<div class="rule"><div class="thr">${r.threshold.toLocaleString()}<small>${UNIT[m]}以上</small></div><span class="arrow">→</span>
                  <div class="rolebox">${roleBadge(ro, esc)}${ro && !ro.assignable ? '<span class="badge warn">BOTより上のため付与不可</span>' : ''}${r.replace_lower ? '<span class="badge mut">下位を外す</span>' : ''}${r.revoke ? '<span class="badge mut">下回ったら剥奪</span>' : ''}</div>
                  <div class="acts"><button class="btn ghost icon" type="button" data-edit="${r.id}" aria-label="編集" title="編集">${ic('edit')}</button><button class="btn danger icon" type="button" data-del="${r.id}" aria-label="削除" title="削除">${ic('trash')}</button></div></div>`;
              }).join('')}</div>`;
            }).join('');
            el.innerHTML = `${pageHeader('ルール', '「条件を満たしたら、このロールを付ける」を登録します。同じ条件に複数登録すると、ランク(段階)になります。',
              `<button class="btn ghost" type="button" id="sync">${ic('check')} 全員に適用</button><button class="btn" type="button" id="add">${ic('plus')} ルールを追加</button>`)}
              ${body || `<div class="card empty">${ic('list')}<h2>まだルールがありません</h2><p>最初のルールを作りましょう。たとえば「発言数 100 回以上 → 見習い」。</p><button class="btn" type="button" id="add2">${ic('plus')} ルールを追加</button></div>`}`;
            el.querySelector('#add').onclick = () => edit(null);
            const a2 = el.querySelector('#add2'); if (a2) a2.onclick = () => edit(null);
            el.querySelector('#sync').onclick = bulk;
            el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => edit(rules.find((r) => String(r.id) === b.dataset.edit))));
            el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
              if (!await confirm({ title: 'ルールを削除', message: 'このルールを削除します。すでに付いているロールは外れません。', ok: '削除する', danger: true })) return;
              await api('/rules/' + b.dataset.del, { method: 'DELETE' }); toast('削除しました'); load();
            }));
          };
          const load = async () => { rules = await api('/rules'); draw(); };

          function edit(rule) {
            const opts = roles.map((r) => `<option value="${r.id}" ${r.assignable ? '' : 'disabled'}>${esc(r.name)}${r.assignable ? '' : '(付与不可)'}</option>`).join('');
            const m = modal(rule ? 'ルールを編集' : 'ルールを追加', `
              <div class="field"><label class="f" for="m-metric">条件</label><select id="m-metric">${Object.entries(metrics).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
              <div class="field"><label class="f" for="m-thr">この数に達したら</label><div class="inline"><input id="m-thr" type="number" min="1" inputmode="numeric" placeholder="100"><span id="m-unit" class="mut"></span></div></div>
              <div class="field"><label class="f" for="m-role">付けるロール</label><select id="m-role">${opts}</select><p class="hint">灰色のロールは、BOTまたはあなたのロールより上にあるため、選べません。</p></div>
              <label class="sw"><input type="checkbox" id="m-rl"><i></i><span><b>下位ランクのロールを外す</b><small>上のランクに上がったとき、同じ条件の下のランクのロールを外します</small></span></label>
              <label class="sw"><input type="checkbox" id="m-rv"><i></i><span><b>条件を下回ったらロールを剥奪</b><small>数が条件に届かない人から、このロールを外します(活動したとき、または「全員に適用」で反映)</small></span></label>`,
              [{ label: 'キャンセル', cls: 'ghost', onClick: (c) => c() },
               { label: rule ? '更新' : '追加', onClick: async (close, box) => {
                 const q = (s) => box.querySelector(s);
                 const body = { metric: q('#m-metric').value, threshold: q('#m-thr').value, role_id: q('#m-role').value, replace_lower: q('#m-rl').checked, revoke: q('#m-rv').checked };
                 if (!body.threshold) { toast('数を入力してください', 'err'); return; }
                 if (rule) await api('/rules/' + rule.id, { method: 'PUT', body }); else await api('/rules', { method: 'POST', body });
                 close(); toast(rule ? '更新しました' : '追加しました'); load();
               } }]);
            const q = (s) => m.el.querySelector(s);
            const unit = () => (q('#m-unit').textContent = `${UNIT[q('#m-metric').value]} 以上`);
            q('#m-metric').onchange = unit;
            if (rule) { q('#m-metric').value = rule.metric; q('#m-thr').value = rule.threshold; if ([...q('#m-role').options].some((o) => o.value === rule.role_id)) q('#m-role').value = rule.role_id; q('#m-rl').checked = !!rule.replace_lower; q('#m-rv').checked = !!rule.revoke; }
            unit();
          }

          function bulk() {
            const m = modal('全員にいま適用', `<p>登録したルールを、サーバーの全メンバーに、いま適用します。ふだんは、活動したときに自動で判定されます。</p>
              <label class="sw"><input type="checkbox" id="b-n"><i></i><span><b>通知も送る</b><small>ロールが付いた人ごとに、通知チャンネルへ送ります。人数が多いと大量に流れます</small></span></label>`,
              [{ label: 'キャンセル', cls: 'ghost', onClick: (c) => c() },
               { label: '適用する', onClick: async (close, box) => {
                 const notify = box.querySelector('#b-n').checked; close(); toast('適用中…');
                 const { changed } = await api('/sync', { method: 'POST', body: { notify } }); toast(`${changed}件のロールを更新しました`);
               } }]);
            m.el.querySelector('footer button:last-child').focus();
          }
          await load();
        } },

      /* ===== ランキング ===== */
      { id: 'ranking', title: 'ランキング', icon: 'trophy',
        async render(el, { api, esc, pageHeader }) {
          const { metrics } = await api('/meta');
          let metric = 'messages';
          el.innerHTML = `${pageHeader('ランキング', 'サーバーを抜けたメンバーは、順位に含まれません。')}
            <div class="seg" role="group" aria-label="ランキングの種類">${Object.entries(metrics).map(([k, v]) => `<button type="button" data-m="${k}" aria-pressed="${k === metric}">${esc(v.replace('(分)', ''))}</button>`).join('')}</div>
            <div class="card flush" id="lbc"></div>`;
          const draw = async () => {
            const rows = await api('/leaderboard?metric=' + metric);
            const max = Math.max(1, ...rows.map((r) => r.value));
            el.querySelector('#lbc').innerHTML = rows.length
              ? `<ol class="lb">${rows.map((r, i) => `<li><span class="rk ${i < 3 ? 'top' : ''}">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="val">${fmt(metric, r.value)}</span><span class="barw"><i style="width:${Math.max(2, r.value / max * 100)}%"></i></span></li>`).join('')}</ol>`
              : '<div class="empty"><h2>まだデータがありません</h2><p>活動が記録されると、ここに並びます。</p></div>';
          };
          el.querySelector('.seg').onclick = (e) => {
            const b = e.target.closest('button'); if (!b) return;
            metric = b.dataset.m; el.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw();
          };
          await draw();
        } },

      /* ===== 分布 ===== */
      { id: 'distribution', title: '分布', icon: 'chart',
        async render(el, { api, roles: getRoles, esc, pageHeader }) {
          const [{ metrics }, roles] = await Promise.all([api('/meta'), getRoles()]);
          const byId = new Map(roles.map((r) => [r.id, r]));
          let metric = 'messages';
          el.innerHTML = `${pageHeader('分布', 'メンバーの活動量が、どのあたりに何人いるかを見て、ルールの条件を決める目安にできます。')}
            <div class="seg" role="group" aria-label="集計の種類">${Object.entries(metrics).map(([k, v]) => `<button type="button" data-m="${k}" aria-pressed="${k === metric}">${esc(v.replace('(分)', ''))}</button>`).join('')}</div>
            <div id="dist"></div>`;
          const num = (m, v) => `${v.toLocaleString()}${UNIT[m]}`;
          const draw = async () => {
            const d = await api('/distribution?metric=' + metric);
            const box = el.querySelector('#dist');
            if (!d.tracked) { box.innerHTML = '<div class="card empty"><h2>まだデータがありません</h2><p>活動が記録されると、ここに分布が表示されます。</p></div>'; return; }
            const max = Math.max(1, ...d.buckets.map((b) => b.count));
            const pc = (n) => `${(n / d.tracked * 100).toFixed(n && n / d.tracked < 0.1 ? 1 : 0)}%`;
            const tile = (k, v) => `<div class="tile"><div class="k">${k}</div><div class="v" style="font-size:22px">${num(metric, v)}<span class="u">以上</span></div></div>`;
            const label = (b) => (b.to === null ? `${num(metric, b.from)}以上` : b.from === b.to ? num(metric, b.from) : `${b.from.toLocaleString()}〜${num(metric, b.to)}`);
            box.innerHTML = `
              <div class="tiles">${tile('中央値(真ん中の人)', d.percentiles.p50)}${tile('上位25%', d.percentiles.p75)}${tile('上位10%', d.percentiles.p90)}${tile('上位1%', d.percentiles.p99)}</div>
              <div class="card"><h2>人数の分布</h2>
                <p class="sub">活動が記録されている ${d.tracked.toLocaleString()}人が対象です(サーバー全体は ${d.members_total.toLocaleString()}人。BOTと、活動のない人を含みます)。</p>
                ${d.buckets.map((b) => `<div class="dr ${b.count ? '' : 'zero'}"><span class="l">${label(b)}</span><span class="b"><i style="width:${b.count / max * 100}%"></i></span><span class="n">${b.count.toLocaleString()}人<small>${pc(b.count)}</small></span></div>`).join('')}
              </div>
              <div class="card"><h2>ルールごとの到達人数</h2>
                <p class="sub">いまの条件を満たしている人数です。数を変えるときの、目安にしてください。</p>
                ${d.tiers.length ? d.tiers.map((t) => { const ro = byId.get(t.role_id); return `<div class="dr ${t.count ? '' : 'zero'}"><span class="roleline">${roleBadge(ro, esc)}<b>${num(metric, t.threshold)}以上</b></span><span class="l"></span><span class="b alt"><i style="width:${t.count / d.tracked * 100}%"></i></span><span class="n">${t.count.toLocaleString()}人<small>${pc(t.count)}</small></span></div>`; }).join('')
                  : '<p class="mut" style="margin:0">この条件のルールは、まだ登録されていません。</p>'}
              </div>`;
          };
          el.querySelector('.seg').onclick = (e) => {
            const b = e.target.closest('button'); if (!b) return;
            metric = b.dataset.m; el.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw();
          };
          await draw();
        } },

      /* ===== 過去ログ取り込み ===== */
      { id: 'import', title: '過去ログ取り込み', icon: 'download',
        async render(el, { api, esc, ic, toast, confirm, pageHeader }) {
          const { botJoinedAt } = await api('/meta');
          const p2 = (n) => String(n).padStart(2, '0');
          const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
          el.innerHTML = `${pageHeader('過去ログ取り込み', 'BOTを入れる前のメッセージも、発言数に数えます(発言数のみ)。')}
            <div class="card"><h2>期間を決めて取り込む</h2>
              <p class="sub">全チャンネルを遡るため、メッセージが多いと時間がかかります。BOTが閲覧できないチャンネルは対象外です。</p>
              <div class="grid2"><div class="field"><label class="f" for="bff">開始日</label><input id="bff" type="date"></div><div class="field"><label class="f" for="bft">終了日(この日を含む)</label><input id="bft" type="date"></div></div>
              <p class="hint" style="margin:-6px 0 14px">開始日の初期値は、BOTを入れた日です。空欄にすると、それぞれ「最初から」「現在まで」になります。</p>
              <div class="card" style="background:var(--warn-soft);border-color:transparent;padding:12px 16px;margin-bottom:16px"><span class="small"><b>現在の発言数は、取り込んだ結果で上書きされます。</b>期間を絞ると、その期間の数だけになります。完了後、全員にロールを適用します(通知はしません)。</span></div>
              <div class="acts"><button class="btn" id="bf" type="button">取り込みを開始</button></div></div>
            <div class="card" id="bfc" hidden></div>`;
          const $ = (s) => el.querySelector(s);
          if (botJoinedAt) $('#bff').value = ymd(botJoinedAt);
          const fmtT = (ms) => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : m <= 1 ? '約1分以内' : `約${m}分`; };
          let timer;
          async function poll() {
            const j = await api('/backfill'); const c = $('#bfc');
            if (!j) { c.hidden = true; return; }
            c.hidden = false; $('#bf').disabled = j.running;
            const span = `${j.from ? new Date(j.from).toLocaleDateString() : '最初'} 〜 ${j.to ? new Date(j.to - 1).toLocaleDateString() : '現在'}`;
            if (j.running) {
              const status = j.phase === 'collect' ? 'チャンネル一覧を取得中…' : j.phase === 'gap' ? '再起動中の発言を確認中…' : j.phase === 'apply' ? 'ロールを適用中…' : `残り${j.etaMs != null ? fmtT(j.etaMs) : '…(計算中)'}`;
              c.innerHTML = `<h2>実行中 <span class="badge">${span}</span></h2><div class="prog"><i style="width:${j.percent}%"></i></div>
                <div class="inline small"><b style="font-size:18px">${j.percent}%</b><span class="mut">${status} ・ チャンネル ${j.done}/${j.total} ・ ${j.scanned.toLocaleString()}件確認${j.current ? ' ・ #' + esc(j.current) : ''}</span></div>`;
              timer = setTimeout(poll, 2000);
            } else if (j.status === 'interrupted') {
              c.innerHTML = `<h2>中断されました <span class="badge warn">${j.percent}%まで完了</span></h2><p class="sub">BOTの再起動などで止まりました。ふだんは再起動後に自動で再開しますが、続けて失敗したため止まっています。続きから再開できます(止まっていた間の発言も、再開時に数えます)。</p><button class="btn" id="bfr" type="button">続きから再開</button>`;
              c.querySelector('#bfr').onclick = async () => { await api('/backfill/resume', { method: 'POST' }); poll(); };
            } else if (j.error) c.innerHTML = `<h2>エラー</h2><p class="mut">${esc(j.error)}</p>`;
            else c.innerHTML = `<h2>完了しました <span class="badge ok">${span}</span></h2><p class="mut" style="margin:0">${j.users.toLocaleString()}人 ・ ${j.scanned.toLocaleString()}件を確認 ・ ロール更新 ${j.rolesChanged ?? 0}件 ・ 所要時間 ${Math.max(1, Math.round(j.elapsedMs / 60000))}分</p>`;
          }
          $('#bf').onclick = async () => {
            const f = $('#bff').value, t = $('#bft').value;
            if (!await confirm({ title: '取り込みを開始', message: `期間(${f || '最初'} 〜 ${t || '現在'})の発言数で、現在の発言数を<b>上書き</b>します。よろしいですか?`, ok: '開始する' })) return;
            await api('/backfill', { method: 'POST', body: { from: f ? new Date(f + 'T00:00:00').getTime() : null, to: t ? new Date(t + 'T00:00:00').getTime() + 864e5 : null } });
            poll();
          };
          new MutationObserver(() => { if (!el.isConnected) clearTimeout(timer); }).observe(document.body, { childList: true, subtree: true });
          poll();
        } },

      /* ===== 通知と設定 ===== */
      { id: 'settings', title: '通知と設定', icon: 'sliders',
        async render(el, { api, channels: getChannels, esc, toast, pageHeader }) {
          const [s, chans] = await Promise.all([api('/settings'), getChannels()]);
          const DEF = '🎉 {user} さんが **{role}** を獲得しました!({condition})';
          el.innerHTML = `${pageHeader('通知と設定')}
            <div class="card"><h2>ロール獲得の通知</h2><p class="sub">ロールが付いたとき、選んだチャンネルにお知らせします。</p>
              <div class="field"><label class="f" for="nc">通知先のチャンネル</label><select id="nc"><option value="">通知しない</option>${chans.map((c) => `<option value="${c.id}">#${esc(c.name)}</option>`).join('')}</select></div>
              <div class="field"><label class="f" for="tpl">メッセージ</label><input id="tpl" type="text" maxlength="500" placeholder="${esc(DEF)}">
                <p class="hint">使える変数: <code>{user}</code> メンション / <code>{name}</code> 表示名 / <code>{role}</code> ロール名 / <code>{condition}</code> 達成した条件。空欄で初期の文になります。</p></div>
              <div class="card" style="background:var(--bg2);margin-bottom:14px;padding:12px 16px"><div class="small mut" style="margin-bottom:4px">プレビュー</div><div id="pv"></div></div>
              <div class="acts"><button class="btn ghost" id="nt" type="button">テスト送信</button></div></div>
            <div class="card"><h2>数え方</h2><p class="sub">連投や、1人だけのVCの水増しを防ぎます。</p>
              <div class="field"><label class="f" for="cd">発言カウントのクールダウン</label><div class="inline"><input id="cd" type="number" min="0" max="3600"><span class="mut">秒</span></div><p class="hint">この間隔より短い連投は、数えません。0にすると、すべて数えます。</p></div>
              <label class="sw"><input type="checkbox" id="vo"><i></i><span><b>VCは2人以上いるときだけ計測</b><small>1人で入っているだけの時間を、数えません</small></span></label></div>
            <div class="acts"><button class="btn" id="save" type="button">設定を保存</button></div>`;
          const $ = (x) => el.querySelector(x);
          $('#cd').value = s.message_cooldown; $('#vo').checked = !!s.voice_require_others; $('#nc').value = s.notify_channel_id || ''; $('#tpl').value = s.notify_template || '';
          const preview = () => {
            const t = ($('#tpl').value.trim() || DEF);
            $('#pv').innerHTML = esc(t).replace(/\{user\}/g, '<span class="badge">@たろう</span>').replace(/\{name\}/g, 'たろう').replace(/\{role\}/g, '常連').replace(/\{condition\}/g, '発言数 500以上').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
          };
          $('#tpl').oninput = preview; preview();
          const save = () => api('/settings', { method: 'PUT', body: { message_cooldown: $('#cd').value, voice_require_others: $('#vo').checked, notify_channel_id: $('#nc').value, notify_template: $('#tpl').value } });
          $('#save').onclick = async () => { await save(); toast('保存しました'); };
          $('#nt').onclick = async () => { await save(); await api('/notify-test', { method: 'POST' }); toast('テストを送信しました'); };
        } },
    ],
  });
})();
