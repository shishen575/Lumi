import { Events } from 'discord.js';
import { db } from '../../core/db.js';
import { commands, answerButton } from './commands.js';
import { postByMsg, queueVote, flush } from './db.js';
import { sameEmoji } from './emoji.js';
import { bumpRound } from './round.js';

/** 大喜利: お題を出し、回答を投稿し、リアクションの草で投票する。環境変数 BUMP_EVERY(既定5) / BUMP_MINUTES(既定0=無効) */
export default {
  name: 'ogiri',
  title: '大喜利',
  commands,
  components: [answerButton],
  help: [
    '`/odai` でお題を出し、`/kaitou` か「回答する」ボタンで回答します。回答に、草の絵文字(既定は ☑️)のリアクションを付けて投票します。',
    '`/kekka` で結果(TOP10)を発表して、お題を終わります。`/ranking` で累計ランキング、`/best` で一番草が入った投稿、`/up` でお題を一番下に出し直せます。',
    '`/kusaemoji` で、草の絵文字を変えられます(管理者のみ)。',
  ].join('\n'),

  register({ client }) {
    // 草: 回答に付いた「投稿時の絵文字」と同じリアクションだけ数える。再起動前の回答も、Partialsで受け取れる
    const onReaction = async (reaction, user, add) => {
      try {
        const post = postByMsg(reaction.message.id);
        if (!post || !sameEmoji(post, reaction.emoji)) return;
        if (user.partial) user = await user.fetch().catch(() => user);
        if (user.bot) return; // ボット(自分を含む)のリアクションは数えない
        if (!add) return queueVote('del', post.msg_id, user.id);
        if (user.id === post.uid) { // 自分の回答への草は数えない。リアクションも外す(権限が無ければ外せないが、数えないのは同じ)
          reaction.users.remove(user.id).catch(() => {});
          return;
        }
        queueVote('add', post.msg_id, user.id);
      } catch (e) { console.error('[ogiri] リアクションの処理に失敗:', e.message); }
    };
    client.on(Events.MessageReactionAdd, (r, u) => onReaction(r, u, true));
    client.on(Events.MessageReactionRemove, (r, u) => onReaction(r, u, false));

    // 時間による再掲: BUMP_MINUTES 分が経ち、前回の再掲から新しい回答があるとき(30秒ごとに確認)
    client.once(Events.ClientReady, () => {
      setInterval(async () => {
        const min = Number.parseInt(process.env.BUMP_MINUTES ?? '0', 10) || 0;
        if (min <= 0) return;
        const due = db.prepare('SELECT round_id FROM ogiri_rounds WHERE ended=0 AND since_bump>0 AND last_bump<=?').all(Date.now() - min * 60_000);
        for (const r of due) await bumpRound(client, r.round_id).catch((e) => console.error('[ogiri] 再掲に失敗:', e.message));
      }, 30_000).unref?.();
    });

    // 終了時に、まとめていた草を先に書く
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { flush(); } catch { /* 終了を優先 */ } process.exit(0); });
    process.on('exit', () => { try { flush(); } catch { /* 終了を優先 */ } });
  },
};
