// メッセージリンクの転送
Dash.registerTab({
  name: 'message-link', title: 'メッセージリンク',
  pages: [{
    id: 'settings', title: 'リンクの転送', icon: 'inbox',
    async render(el, { api, esc, toast, pageHeader }) {
      const st = await api('/settings');
      el.innerHTML = `${pageHeader('メッセージリンクの転送', 'メッセージのリンクを貼ると、元のメッセージの<b>文章と画像を、そのまま転送</b>します。')}
        <div class="card"><h2>状態の確認</h2>
          <ul class="todo">
            <li class="${st.intentEnabled ? 'done' : 'warn'}"><span class="mark">${st.intentEnabled ? Dash.ic('check') : Dash.ic('alert')}</span><div class="grow"><b>BOTがメッセージの本文を読める</b>
              <span class="mut small">${st.intentEnabled ? '有効です' : '<b>無効です。</b>この機能は、本文を読めないと動きません。BOTの運営者が、Developer Portal の Bot で「MESSAGE CONTENT INTENT」をオンにして、環境変数 <code>MESSAGE_CONTENT_INTENT=1</code> を設定し、BOTを再起動してください(順番を守らないと、BOTが起動できません)'}</span></div></li>
            <li class="${st.enabled ? 'done' : ''}"><span class="mark">${Dash.ic('check')}</span><div class="grow"><b>このサーバーで転送する</b><span class="mut small">${st.enabled ? 'オンです' : 'オフです。下のスイッチをオンにして、保存してください'}</span></div></li>
          </ul></div>
        <div class="card"><h2>設定</h2>
          <label class="sw"><input type="checkbox" id="en" ${st.enabled ? 'checked' : ''}><i></i><span><b>メッセージリンクを転送する</b><small>このサーバーのメッセージのリンクが貼られたら、元の文章・画像・添付ファイルを、貼られたチャンネルに表示します</small></span></label>
          <div class="acts" style="margin-top:12px"><button class="btn" id="save" type="button">保存</button></div></div>
        <div class="card"><h2>転送のルール</h2>
          <ul style="margin:0;padding-left:1.2em">
            <li>貼った人が、元のチャンネルを見られるときだけ転送します(見られないチャンネルの内容は、転送しません)</li>
            <li>このサーバーのメッセージだけが対象です。他のサーバーのリンクは転送しません</li>
            <li>成人向けチャンネルの内容は、成人向けでないチャンネルには転送しません</li>
            <li><code>&lt;https://…&gt;</code> のように、<code>&lt; &gt;</code> で囲んだリンクは、転送しません</li>
            <li>1つのメッセージにつき、最大3件まで。続けて貼ったときは、5秒の間隔を空けます</li>
            <li>目隠し(ネタバレ)の文章と画像は、隠したまま転送します</li>
            <li>転送した内容は、保存しません</li></ul></div>`;
      el.querySelector('#save').onclick = async () => { await api('/settings', { method: 'PUT', body: { enabled: el.querySelector('#en').checked } }); toast('保存しました'); };
    },
  }],
});
