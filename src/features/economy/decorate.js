import { getSettings, money } from './settings.js';
import { peek } from './db.js';
import { commands } from './commands.js';

/**
 * 通貨のコマンド(とパネル)の返事には、必ず、実行した人の名前と、いまの残高(所持金・銀行)を書く。
 * 返事を送る直前に、core/commands.js から呼ばれる。埋め込みには、上の名前と、下の残高。文字だけの返事には、最後に、小さい1行を足す。
 * 選ぶ途中の画面(メニュー・ボタンつきの文字)には、足さない
 */
const NAMES = new Set(commands.map((c) => c.data.name));
const PREFIX = /^(panel|rich|eco):/; // 通貨のパネル・ランキング・ゲームのボタン
export const isEconomy = (i) => NAMES.has(i.commandName) || PREFIX.test(i.customId ?? '') || (/^(hub|cpanel):/.test(i.customId ?? '') && NAMES.has(i.__cmd)); // メニューパネルとカスタムパネルは、動かしたコマンドで、決める

export function decorateReply(i, p) {
  if (!i.guildId || !i.user || !isEconomy(i)) return p;
  const s = getSettings(i.guildId); if (!s.enabled) return p;
  const a = peek(i.guildId, i.user.id), name = i.member?.displayName ?? i.user.username, bal = `所持金 ${money(s, a.wallet)}(銀行 ${money(s, a.bank)})`;
  if (typeof p === 'string') return decorateReply(i, { content: p });
  if (!p || typeof p !== 'object') return p;
  if (p.embeds?.length) {
    for (const e of p.embeds) {
      const d = e?.data ?? e; if (!d) continue;
      if (!d.author) d.author = { name: String(name).slice(0, 256), icon_url: i.user.displayAvatarURL?.() };
      const text = d.footer?.text ?? '';
      if (!/所持金|手持ち|残高/.test(text)) d.footer = { ...(d.footer ?? {}), text: (text ? `${text} ・ ` : '') + bal };
      else if (/所持金/.test(text) && !/銀行/.test(text)) d.footer = { ...d.footer, text: text.replace(/所持金[^・]*/, bal) };
    }
  } else if (typeof p.content === 'string' && !p.components?.length) {
    const add = `\n-# 👤 ${name} ・ ${bal}`;
    if (p.content.length + add.length <= 2000) p.content += add;
  }
  return p;
}
