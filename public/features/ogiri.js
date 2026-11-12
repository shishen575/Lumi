// 大喜利: 読み上げ連携(SHB2－読み上げBOT)
Dash.registerTab({
  name: 'ogiri', title: '大喜利',
  pages: [{
    id: 'tts', title: '読み上げ連携', icon: 'speaker',
    async render(el, { api, channels: getChannels, esc, ic, toast, confirm, pageHeader }) {
      const draw = async () => {
        const [st, chans] = await Promise.all([api('/tts'), getChannels()]);
        const T = st.toggles;
        const sw = (id, title, sub, on) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i><span><b>${title}</b><small>${sub}</small></span></label>`;
        const head = pageHeader('読み上げ連携', 'お題と回答を、<b>SHB2－読み上げBOT</b>の声で、ボイスチャンネルに読み上げます。回答は、回答した人本人の声と速度で読まれます。');

        if (!st.connected) {
          el.innerHTML = `${head}
            <div class="card"><h2>${st.invalid ? 'トークンが無効になっています' : '読み上げBOTと連携する'}</h2>
              <p class="sub">${st.invalid ? '読み上げBOTの側で、連携が止められたか、トークンが作り直されました。もう一度、連携してください。' : '次の手順で、このサーバーを読み上げBOTにつなぎます。'}</p>
              <ol style="margin:0 0 16px;padding-left:1.3em">
                <li>読み上げBOTを、サーバーに招待します(<a href="https://shb2-bot.shishen575.com/" target="_blank" rel="noopener">招待と使い方</a>)</li>
                <li>サーバーの管理者が、読み上げBOTで <code>/external</code> を実行して、「オン」を選びます</li>
                <li>表示された <code>shb2_</code> で始まるトークンを、下に貼り付けます(トークンは、1回しか表示されません)</li>
              </ol>
              <div class="field"><label class="f" for="tk">トークン</label><input id="tk" type="password" autocomplete="off" placeholder="shb2_..." ${st.canEditToken ? '' : 'disabled'}>
                <p class="hint">${st.canEditToken ? 'トークンは暗号化して保存し、画面には表示しません。' : 'トークンを登録できるのは、サーバーのオーナー・管理者・運営だけです。'}</p></div>
              <div class="acts"><button class="btn" id="conn" type="button" ${st.canEditToken ? '' : 'disabled'}>連携する</button></div></div>`;
          el.querySelector('#conn').onclick = async () => {
            const token = el.querySelector('#tk').value.trim();
            if (!token) { toast('トークンを入力してください', 'err'); return; }
            const b = el.querySelector('#conn'); b.disabled = true;
            try { const r = await api('/tts/token', { method: 'PUT', body: { token } }); toast(`連携しました(${r.guildName})`); await draw(); } catch { b.disabled = false; }
          };
          return;
        }

        el.innerHTML = `${head}
          <div class="card"><div class="h-row" style="margin:0 0 4px"><h2 style="font-size:17px">連携の状態</h2><span class="badge ok">接続中</span></div>
            <p class="sub" style="margin-bottom:12px">読み上げBOTのサーバー: <b>${esc(st.guildName ?? '')}</b></p>
            <div class="acts"><button class="btn ghost sm" id="test" type="button">接続テスト</button>${st.canEditToken ? '<button class="btn danger sm" id="unlink" type="button">連携を解除</button>' : ''}</div></div>
          <div class="card"><h2>読み上げる内容</h2><p class="sub">大喜利の進行に合わせて、自動で読み上げます。VCに、読み上げBOTが入っているときだけ読まれます。</p>
            ${sw('t-odai', 'お題を読む', 'お題を出したとき', T.odai)}
            ${sw('t-answer', '回答を読む', '回答が投稿されたとき。回答した人本人の声と速度で読みます', T.answer)}
            ${sw('t-say', '回答者の名前を読む', '「○○さん。」と、回答の前に読みます(読み上げBOTの /name の設定を使います)', T.sayName)}
            ${sw('t-result', '結果を読む', '結果を発表したとき。TOP3を、順位と草の数、回答の順に読みます', T.result)}
            <div class="acts" style="margin-top:12px"><button class="btn" id="save" type="button">保存</button></div></div>
          <div class="card"><h2>読み上げ中か確認する</h2><p class="sub">大喜利をするチャンネルを選ぶと、そのチャンネルを読み上げている号機があるか分かります。</p>
            <div class="inline"><select id="ch" style="max-width:320px">${chans.map((c) => `<option value="${c.id}">#${esc(c.name)}</option>`).join('')}</select><button class="btn ghost sm" id="chk" type="button">確認</button></div>
            <p id="sess" class="hint" style="margin-top:10px"></p></div>`;
        const q = (x) => el.querySelector(x);
        q('#test').onclick = async () => { try { const r = await api('/tts/test', { method: 'POST' }); toast(`接続できました(${r.guild_name})`); } catch { await draw(); } };
        if (q('#unlink')) q('#unlink').onclick = async () => {
          if (!await confirm({ title: '連携を解除', message: '保存しているトークンを削除して、読み上げをやめます。読み上げBOTの側でも止めるときは、<code>/external</code> で「オフ」を選んでください。', ok: '解除する', danger: true })) return;
          await api('/tts/token', { method: 'DELETE' }); toast('解除しました'); await draw();
        };
        q('#save').onclick = async () => {
          await api('/tts/toggles', { method: 'PUT', body: { odai: q('#t-odai').checked, answer: q('#t-answer').checked, sayName: q('#t-say').checked, result: q('#t-result').checked } });
          toast('保存しました');
        };
        q('#chk').onclick = async () => {
          const out = q('#sess'); out.textContent = '確認中…';
          try { const r = await api('/tts/session?channel_id=' + q('#ch').value); out.textContent = r.active ? `読み上げ中です(${r.bot}号機)` : '読み上げていません。VCに入って、読み上げBOTで /join を実行してください'; }
          catch { out.textContent = '確認できませんでした'; }
        };
      };
      await draw();
    },
  }],
});
