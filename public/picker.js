// 検索できるプルダウン: 選択肢が多い <select>(チャンネル・ロールなど)を、検索つきの選び方に、自動で置き換える。
// 元の <select> は隠して残すので、ページ側のコード(.value の読み書き・change イベント)は、そのまま動く。
(() => {
  const MIN_OPTIONS = 8; // これ以上の選択肢があるときだけ、検索つきにする
  const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();
  let openPicker = null;

  function enhance(sel) {
    if (sel.dataset.sx || sel.multiple || sel.options.length < MIN_OPTIONS) return;
    sel.dataset.sx = '1';
    const wrap = document.createElement('div'); wrap.className = 'sx';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sx-btn'; btn.setAttribute('aria-haspopup', 'listbox');
    const panel = document.createElement('div'); panel.className = 'sx-panel'; panel.hidden = true;
    const search = document.createElement('input'); search.type = 'search'; search.className = 'sx-search'; search.placeholder = '検索…'; search.autocomplete = 'off'; search.setAttribute('aria-label', '検索');
    const list = document.createElement('ul'); list.className = 'sx-list'; list.setAttribute('role', 'listbox');
    const empty = document.createElement('div'); empty.className = 'sx-empty'; empty.textContent = '見つかりません'; empty.hidden = true;
    panel.append(search, list, empty); wrap.append(btn, panel);
    sel.after(wrap); sel.style.display = 'none';
    const label = (o) => (o ? o.textContent.trim() : '');
    const refresh = () => { const o = sel.options[sel.selectedIndex]; btn.textContent = label(o) || '選択してください'; btn.classList.toggle('sx-blank', !o || o.value === ''); };

    // 選択肢(optgroup の見出しも、そのまま見出しとして出す)
    const items = [];
    const build = () => {
      list.replaceChildren(); items.length = 0;
      const addOpt = (o, parent) => {
        const li = document.createElement('li'); li.setAttribute('role', 'option'); li.className = 'sx-opt'; li.textContent = label(o); li.dataset.v = o.value; li._o = o;
        if (o.disabled) li.setAttribute('aria-disabled', 'true');
        li.onclick = () => { if (o.disabled) return; choose(o.value); };
        parent.append(li); items.push({ li, text: norm(label(o)), group: null });
        return li;
      };
      [...sel.children].forEach((c) => {
        if (c.tagName === 'OPTGROUP') {
          const h = document.createElement('li'); h.className = 'sx-group'; h.textContent = c.label; list.append(h);
          const start = items.length; [...c.children].forEach((o) => addOpt(o, list)); items.slice(start).forEach((x) => (x.group = h));
        } else addOpt(c, list);
      });
    };
    const filter = () => {
      const q = norm(search.value.trim()); let shown = 0; const seen = new Set();
      items.forEach((x) => { const ok = !q || x.text.includes(q); x.li.hidden = !ok; if (ok) { shown++; if (x.group) seen.add(x.group); } });
      list.querySelectorAll('.sx-group').forEach((h) => (h.hidden = !seen.has(h)));
      empty.hidden = shown > 0; setActive(firstVisible());
    };
    let active = null;
    const visible = () => items.filter((x) => !x.li.hidden && !x.li._o.disabled);
    const firstVisible = () => visible().find((x) => x.li._o.value === sel.value) ?? visible()[0] ?? null;
    const setActive = (x) => { active?.li.classList.remove('sx-active'); active = x; if (x) { x.li.classList.add('sx-active'); { const t = x.li.offsetTop, b = t + x.li.offsetHeight; if (t < list.scrollTop) list.scrollTop = t; else if (b > list.scrollTop + list.clientHeight) list.scrollTop = b - list.clientHeight; } } };
    const choose = (v) => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); refresh(); close(); btn.focus(); };
    const place = () => { const r = btn.getBoundingClientRect(), below = window.innerHeight - r.bottom; panel.style.width = `${r.width}px`; panel.style.left = `${r.left}px`; if (below < 280 && r.top > below) { panel.style.top = 'auto'; panel.style.bottom = `${window.innerHeight - r.top + 4}px`; } else { panel.style.bottom = 'auto'; panel.style.top = `${r.bottom + 4}px`; } };
    let openedAt = 0;
    function open() { if (openPicker && openPicker !== close) openPicker(); build(); search.value = ''; panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); place(); filter(); openedAt = Date.now(); search.focus({ preventScroll: true }); openPicker = close; }
    function close() { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (openPicker === close) openPicker = null; }
    btn.onclick = () => (panel.hidden ? open() : close());
    search.oninput = filter;
    search.onkeydown = (e) => {
      const v = visible(), n = v.indexOf(active);
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(v[Math.min(v.length - 1, n + 1)] ?? v[0]); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(v[Math.max(0, n - 1)]); }
      else if (e.key === 'Enter') { e.preventDefault(); if (active) choose(active.li._o.value); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
      else if (e.key === 'Tab') close();
    };
    document.addEventListener('mousedown', (e) => { if (!panel.hidden && !wrap.contains(e.target)) close(); });
    window.addEventListener('resize', () => { if (!panel.hidden) place(); });
    document.addEventListener('scroll', (e) => { if (!panel.hidden && Date.now() - openedAt > 300 && !panel.contains(e.target)) close(); }, true);
    // ページ側が、コードで値を入れたとき(sel.value = …)も、表示に反映する
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', { configurable: true, get() { return d.get.call(sel); }, set(v) { d.set.call(sel, v); refresh(); } });
    sel.addEventListener('change', refresh);
    const label0 = sel.closest('.field')?.querySelector('label'); if (label0) { label0.addEventListener('click', (e) => { e.preventDefault(); btn.focus(); }); }
    refresh();
  }
  const scan = (root = document) => root.querySelectorAll('select:not([data-sx])').forEach(enhance);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'SELECT') enhance(n); else scan(n); } }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', () => scan());
  window.SearchablePicker = { enhance, scan };
})();
