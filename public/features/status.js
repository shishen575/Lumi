// BOTの状態: 再起動のお知らせ
Dash.registerTab({
  name: 'status', title: 'BOTの状態',
  pages: [{
    id: 'restart', title: '再起動のお知らせ', icon: 'inbox',
    async render(el, { api, channels: getChannels, esc, toast, pageHeader }) {
      const [s, chans] = await Promise.all([api('/settings'), getChannels()]);
      el.innerHTML = `${pageHeader('再起動のお知らせ', 'Lumi が更新や再起動で止まるときと、戻ってきたときに、お知らせするチャンネルを決めます。')}
        <div class="card"><h2>お知らせするチャンネル</h2>
          <div class="field"><label class="f" for="rc">チャンネル</label><select id="rc"><option value="">お知らせしない</option>${chans.map((c) => `<option value="${c.id}">#${esc(c.name)}</option>`).join('')}</select></div>
          <div class="acts" style="margin-top:12px"><button class="btn" id="save" type="button">保存</button></div></div>
        <div class="card"><h2>お知らせの内容</h2><ul style="margin:0;padding-left:1.2em">
          <li>止まる前に「🔄 再起動します」、戻ったときに「✅ 戻りました(バージョン・かかった時間)」を送ります</li>
          <li>止まる合図を受けてから、<b>5秒待って</b>から終了します(お知らせを出す時間です)</li>
          <li>短い間に何度も起動したときは、戻ったお知らせを続けて流しません</li></ul></div>`;
      el.querySelector('#rc').value = s.channel_id || '';
      el.querySelector('#save').onclick = async () => { await api('/settings', { method: 'PUT', body: { channel_id: el.querySelector('#rc').value } }); toast('保存しました'); };
    },
  }],
});
