// しりとり
Dash.registerTab({
  name: 'shiritori', title: 'しりとり',
  pages: [{
    id: 'settings', title: 'しりとり', icon: 'list',
    async render(el, { api, channels: getChannels, esc, toast, pageHeader }) {
      const [st, chans, panel] = await Promise.all([api('/settings'), getChannels(), api('/panel')]);
      const warn = st.intent ? '' : '<p class="hint">⚠️ BOTがメッセージの本文を読めないため、「メッセージで送る」は、動きません。<code>/shiritori say</code> で、送ってください。(BOTの運営者が、MESSAGE CONTENT INTENT を有効にすると、使えます)</p>';
      el.innerHTML = `${pageHeader('しりとり', '<code>/shiritori start</code> で、BOT(ルミ)と、しりとりで勝負します。ひとりでも、みんなでも遊べます。')}
        <div class="card"><label class="sw"><input type="checkbox" id="en" ${st.enabled ? 'checked' : ''}><i></i><span><b>しりとりを使う</b><small>オフのときは、<code>/shiritori</code>(戦績以外)が使えません</small></span></label>
          <div class="grid2" style="margin-top:12px">
            <div class="field"><label class="f" for="lv">BOTの強さ(始めるときに、選ばなかったとき)</label><select id="lv">${Object.entries(st.levels).map(([k, v]) => `<option value="${k}" ${st.level === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><p class="hint">やさしい: 返しやすい言葉・辞書の一部だけ / ふつう / むずかしい: 返しにくい文字(る・ぬ・ぷ・ぎ など)で終わる言葉を選びます</p></div>
            <div class="field"><label class="f" for="ts">1回の制限時間(秒)</label><input id="ts" type="number" min="10" max="600" value="${st.timeSec}"><p class="hint">人が、この時間内に答えないと、BOTの勝ちです</p></div>
            <div class="field"><label class="f" for="ap">異議申し立ての、確認チャンネル</label><select id="ap"><option value="">使わない(ダッシュボードだけで、確認する)</option>${chans.map((c) => `<option value="${c.id}" ${st.appealChannelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select><p class="hint">辞書で弾かれた言葉の「異議申し立て」が、ボタンつき(登録する/却下)で、ここに届きます。運営が、押して決めます</p></div>
            <div class="field"><label class="f" for="pv">人どうしの、しりとりのチャンネル(常設)</label><select id="pv" multiple size="5">${chans.map((c) => `<option value="${c.id}" ${(st.pvpChannelIds ?? []).includes(c.id) ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select><p class="hint">ここで、人どうしで、しりとりをすると、ルミが審判をして(✅ / ❌)、言葉を、ランキングに数えます。<b>Ctrl(⌘)を押しながら</b>、複数選べます。スレッドも、選べます</p></div>
            <div class="field"><label class="f" for="pt">人どうしの、待ち時間(秒)</label><input id="pt" type="number" min="30" max="86400" value="${st.pvpTimeSec}"><p class="hint">この時間、動きがなければ、そのしりとりは終わります(常設のチャンネルは、次の言葉から、新しく始まります)</p></div>
            <div class="field"><label class="sw"><input type="checkbox" id="dl" ${st.deliberation ? 'checked' : ''}><i></i><span><b>審議を使う</b><small>最新の言葉に、⚖️ をつけると、投票で、有効/無効を決めます。無効なら、その言葉は、取り消されます</small></span></label></div>
            <div class="field"><label class="f" for="dv">審議が決まる票数</label><input id="dv" type="number" min="1" max="20" value="${st.deliberationVotes}"><p class="hint">同じ側が、この票数に届くと、決まります。運営(管理者)が押すと、その場で、決まります</p></div>
            <div class="field"><label class="f" for="ds">審議の制限時間(秒)</label><input id="ds" type="number" min="30" max="3600" value="${st.deliberationSec}"></div>
            <div class="field"><label class="f" for="ch">遊べるチャンネル</label><select id="ch"><option value="">どこでもよい</option>${chans.map((c) => `<option value="${c.id}" ${st.channelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select><p class="hint">決めると、そのチャンネル(のスレッド)でだけ、始められます</p></div>
            <div class="field"><label class="sw" style="margin-top:22px"><input type="checkbox" id="as" ${st.allowSpectate ? 'checked' : ''}><i></i><span><b>観戦を、許す</b><small>「観戦する」で、ほかの人の、プライベートスレッド(進行中・終了済み)に、入って見られます。スレッドの名前に、【進行中】【終了済み】が、出ます</small></span></label></div>
            <div class="field"><label class="sw" style="margin-top:22px"><input type="checkbox" id="wc" ${st.wordCheck ? 'checked' : ''}><i></i><span><b>辞書で、言葉をチェックする</b><small>名詞として辞書にない言葉は、「見つかりません」と断ります(負けには、なりません)。オフなら、どんな、かなも通ります</small></span></label></div>
            <div class="field"><label class="sw" style="margin-top:22px"><input type="checkbox" id="mm" ${st.messageMode ? 'checked' : ''}><i></i><span><b>メッセージで、言葉を送れる</b><small>始めたチャンネルで、ひらがな・カタカナの発言を、言葉として、受け取ります</small></span></label></div>
          </div>
          ${warn}
          <div class="acts"><button class="btn" id="save" type="button">保存</button></div></div>
        <div class="card"><h2>「しりとりを始める」ボタン</h2>
          <p class="hint">チャンネルに、ボタンを置きます。押した人に、<b>その人だけの、プライベートスレッド</b>ができて、ルミとの、しりとりが始まります(もう一度遊ぶボタンも、スレッドに出ます)。BOTに、<b>プライベートスレッドの作成</b>と<b>スレッドでの発言</b>の権限が、必要です。</p>
          <div class="field"><label class="f" for="pc">ボタンを置くチャンネル</label><select id="pc"><option value="">チャンネルを選ぶ</option>${chans.filter((c) => !c.thread).map((c) => `<option value="${c.id}" ${panel?.channel_id === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select></div>
          <div class="acts"><button class="btn" id="pin" type="button">${panel ? '置き直す' : 'ボタンを置く'}</button>${panel ? `<a class="btn ghost" href="${esc(panel.link)}" target="_blank" rel="noopener">メッセージを見る</a><button class="btn danger" id="prm" type="button">外す</button>` : ''}</div></div>
        <div class="card"><h2>過去ログを取り込む</h2>
          <p class="hint">すでに、人どうしで、しりとりをしていた、チャンネル(スレッド)の言葉を、ランキング(使われた言葉・使った言葉の数)に、数えます。つながっている、ひらがな・カタカナの発言だけを拾います(最新の3000件まで。取り込みずみの所は、二重に数えません)。BOTが、そのチャンネルを読める必要があります。</p>
          <div class="field"><label class="f" for="ic">取り込むチャンネル(スレッド)</label><select id="ic"><option value="">選ぶ</option>${chans.map((c) => `<option value="${c.id}">#${esc(c.name)}</option>`).join('')}</select></div>
          <div class="acts"><button class="btn" id="imp" type="button">取り込む</button></div><p class="hint" id="impr"></p></div>
        <div class="card"><h2>遊び方</h2><ul style="margin:0;padding-left:1.2em">
          <li><code>/shiritori start</code> で、始めます。「ひとりで」か「みんなで」、BOTの強さ、どちらが先かを、選べます(チャンネルごとに、1つ)</li>
          <li>言葉は、<code>/shiritori say</code> で送ります(メッセージで送れる設定なら、そのまま書いても、OK)</li>
          <li>ひらがな・カタカナ・<b>漢字</b>(林檎 → りんご)。2文字以上(読みで)。漢字まじりの発言は、プライベートスレッドの、ひとりの勝負でだけ、メッセージから受け取ります(ふつうの会話と、区別がつかないため。<code>/shiritori say</code> なら、いつでも)。「ー」は、その前の文字の母音(らーめーん → ん)。小さい「ゃゅょっ」は、大きい字として、数えます。濁点は、区別します</li>
          <li>「ん」で終わる・同じ言葉を使う・時間切れは、負け。BOTが言葉に詰まったら、人の勝ち</li><li><b>人どうしの勝負</b>: <code>/shiritori start mode:人どうし</code>(ルミは審判)。順番に、メッセージで言葉をつなぎます(同じ人は、続けて2回できません)。✅ = OK、❌ = だめ。「ん」・同じ言葉は、その人の負け。上の「人どうしの、しりとりのチャンネル(常設)」に入れると、言葉らしい発言で、自動で始まります。言葉は、ランキング(使われた言葉・使った言葉の数)に、数えます</li><li><b>審議</b>(任意): 最新の言葉に ⚖️ をつけると、投票で有効/無効を決めます</li>
          <li>ルミの辞書は、約${st.words}語です。人の言葉は、「名詞として辞書に載っているか」を、形態素解析(IPA辞書)で、チェックします(オフにもできます)。載っていない言葉は、断られますが、負けにはなりません</li>
          <li><code>/shiritori stats</code> で、戦績(勝ち負け・最長)と、ランキングを見られます</li></ul></div>`;
      const q = (x) => el.querySelector(x);
      q('#pin').onclick = async () => { const ch = q('#pc').value; if (!ch) return toast('チャンネルを選んでください'); try { await api('/panel', { method: 'POST', body: { channel_id: ch } }); toast('ボタンを置きました'); location.reload(); } catch (e) { toast(e.message); } };
      q('#prm')?.addEventListener('click', async () => { await api('/panel', { method: 'DELETE' }); toast('外しました'); location.reload(); });
      q('#imp').onclick = async () => { const ch = q('#ic').value; if (!ch) return toast('チャンネルを選んでください'); q('#impr').textContent = '取り込み中…(少し、かかります)'; try { const r = await api('/import', { method: 'POST', body: { channel_id: ch } }); q('#impr').textContent = `✅ ${r.scanned}件の発言から、${r.words}語を数えました(${r.players}人)。`; } catch (e) { q('#impr').textContent = ''; toast(e.message); } };
      q('#save').onclick = async () => { await api('/settings', { method: 'PUT', body: { enabled: q('#en').checked, level: q('#lv').value, timeSec: q('#ts').value, channelId: q('#ch').value || null, messageMode: q('#mm').checked, wordCheck: q('#wc').checked, allowSpectate: q('#as').checked, appealChannelId: q('#ap').value || null, pvpChannelIds: [...q('#pv').selectedOptions].map((o) => o.value), pvpTimeSec: q('#pt').value, deliberation: q('#dl').checked, deliberationVotes: q('#dv').value, deliberationSec: q('#ds').value } }); toast('保存しました'); };
    },
  }, {
    id: 'appeals', title: '異議申し立て', icon: 'inbox',
    async render(el, { api, esc, toast, pageHeader }) {
      const draw = async () => {
        const r = await api('/appeals'), when = (t) => new Date(t).toLocaleString('ja-JP');
        el.innerHTML = `${pageHeader('異議申し立て', '辞書で弾かれた言葉の、「異議申し立て」です。<b>登録</b>すると、このサーバーのしりとりで、その言葉が、通るようになります。')}
          <div class="card"><h2>確認待ち(${r.pending.length})</h2>${r.pending.length ? `<table><tr><th>言葉</th><th>申し立てた人</th><th>日時</th><th></th></tr>${r.pending.map((a) => `<tr><td><b>${esc(a.word)}</b></td><td>${esc(a.name)}</td><td class="mut small">${when(a.created_at)}</td><td><div class="acts" style="margin:0"><button class="btn" data-id="${a.id}" data-d="approved" type="button">登録する</button><button class="btn danger" data-id="${a.id}" data-d="rejected" type="button">却下</button></div></td></tr>`).join('')}</table>` : '<p class="mut">確認待ちは、ありません。</p>'}</div>
          <div class="card"><h2>登録した言葉(${r.approved.length})</h2>${r.approved.length ? `<table><tr><th>言葉</th><th>決めた人</th><th></th></tr>${r.approved.map((a) => `<tr><td><b>${esc(a.word)}</b></td><td>${esc(a.by ?? '')}</td><td><button class="btn ghost" data-id="${a.id}" data-d="removed" type="button">登録を取り消す</button></td></tr>`).join('')}</table>` : '<p class="mut">まだ、ありません。</p>'}</div>
          ${r.rejected.length ? `<div class="card"><h2>最近、却下したもの</h2><p class="mut">${r.rejected.map((a) => esc(a.word)).join('・')}</p></div>` : ''}`;
        el.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => { try { await api(`/appeals/${b.dataset.id}`, { method: 'POST', body: { decision: b.dataset.d } }); toast('決めました'); draw(); } catch (e) { toast(e.message); } }));
      };
      await draw();
    },
  }, {
    id: 'ranking', title: 'ランキング', icon: 'trophy',
    async render(el, { api, esc, pageHeader }) {
      const draw = async (by) => {
        const r = await api(`/ranking?by=${by}`);
        el.innerHTML = `${pageHeader('しりとりランキング', 'このサーバーの、しりとりの戦績と、よく使われた言葉です。')}
          <div class="card"><div class="field"><label class="f" for="by">並べ方</label><select id="by">${Object.entries(r.ranks).map(([k, v]) => `<option value="${k}" ${r.by === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
            <table><tr><th>#</th><th>名前</th><th>勝ち</th><th>負け</th><th>最長</th></tr>${r.players.map((p, n) => `<tr><td>${n + 1}</td><td>${esc(p.name)}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.best}語</td></tr>`).join('') || '<tr><td colspan="5" class="mut">まだ、記録がありません</td></tr>'}</table></div>
          <div class="card"><h2>📚 いちばん使われた言葉</h2><table><tr><th>#</th><th>言葉</th><th>回数</th></tr>${r.words.map((w, n) => `<tr><td>${n + 1}</td><td>${esc(w.word)}</td><td>${w.uses}回</td></tr>`).join('') || '<tr><td colspan="3" class="mut">まだ、記録がありません</td></tr>'}</table></div>`;
        el.querySelector('#by').onchange = (e) => draw(e.target.value);
      };
      await draw('wins');
    },
  }],
});
