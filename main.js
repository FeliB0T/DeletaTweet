(() => {
  const DELAY = 500;        
  const SCROLL_DELAY = 800; 
  const MAX_RETRY_MENU = 6;

  let running = true;
  let deletedCount = 0;
  let undoneReposts = 0;
  const seenArticles = new WeakSet();

  window.stopDeletion = () => { running = false; console.log("Parando..."); };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const primary = () => document.querySelector('[data-testid="primaryColumn"]') || document;
  const $all = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const text = (el) => (el?.textContent || "").trim().toLowerCase();

  function getMyHandle() {
    const app = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    if (app && app.href) {
      const m = app.href.match(/x\.com\/([^\/?#]+)/i);
      if (m) return m[1].toLowerCase();
    }
    const path = location.pathname.split('/').filter(Boolean);
    if (path[0]) return path[0].toLowerCase();
    return null;
  }
  const MY = getMyHandle();

  function closeListsModalIfOpen() {
    const dialogs = $all('div[role="dialog"]');
    for (const d of dialogs) {
      const t = text(d);
      if (t.includes('escolher uma lista') || t.includes('suas listas') || t.includes('choose a list') || t.includes('your lists')) {
        const closeBtn = d.querySelector('[aria-label="Fechar"], [aria-label="Close"]');
        if (closeBtn) closeBtn.click();
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
        if (location.pathname.includes('/i/lists/add_member')) history.back();
        return true;
      }
    }
    return false;
  }

  function findDeleteButtonInMenu() {
    const items = $all('[role="menuitem"], button, [role="button"]');
    for (const it of items) {
      const t = text(it);
      if (!t) continue;
      if (t.includes('delete') || t.includes('excluir') || t.includes('apagar') || t.includes('deletar') || t.includes('remover')) {
        return it;
      }
    }
    return null;
  }

  function findUndoRepostInMenu() {
    const items = $all('[role="menuitem"], button, [role="button"]');
    return items.find(el => {
      const t = text(el);
      return t.includes('undo repost') || t.includes('desfazer repost') || t.includes('desfazer retweet') || t.includes('undo retweet');
    }) || null;
  }

  function findConfirmDelete() {
    return document.querySelector('[data-testid="confirmationSheetConfirm"]')
      || $all('button, [role="button"]').find(b => {
        const t = text(b);
        return t.includes('delete') || t.includes('excluir') || t.includes('apagar') || t.includes('deletar');
      }) || null;
  }

  function isOwnedTweet(article) {
    if (!MY) return true; 
    const header = article.querySelector('[data-testid="User-Name"]') || article;
    const a = header.querySelector(`a[href^="/${CSS.escape(MY)}"]`);
    return !!a;
  }

  function isRepostedByMe(article) {
    const ctx = article.querySelector('[data-testid="socialContext"]');
    const t = text(ctx);
    if (!t) return false;
    return t.includes('você repostou') || t.includes('you reposted') || t.includes('repostado por você');
  }

  function getTweetMenuCaret(article) {
    const btn = article.querySelector(':scope [data-testid="caret"]')
      || article.querySelector(':scope [aria-label="More"], :scope [aria-label="Mais"], :scope [aria-label="Mais opções"]');
    return (btn && btn.offsetParent !== null) ? btn : null;
  }

  function getRetweetButton(article) {
    const btn = article.querySelector(':scope [data-testid="retweet"], :scope [data-testid="unretweet"]');
    return (btn && btn.offsetParent !== null) ? btn : null;
  }

  async function click(el, label) {
    el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
    await sleep(30);
    el.click();
    if (label) console.log(label);
    await sleep(DELAY);
  }

  async function openMenuAndWait(checkFn) {
    for (let i=0;i<MAX_RETRY_MENU;i++) {
      const el = checkFn();
      if (el) return el;
      await sleep(120);
    }
    return null;
  }

  async function processOwnedTweet(article) {
    const caret = getTweetMenuCaret(article);
    if (!caret) return false;
    await click(caret, "⋯ Abrindo menu do seu tweet...");
    const delBtn = await openMenuAndWait(findDeleteButtonInMenu);
    if (!delBtn) { 
      // menu errado (provavelmente do usuário); fecha e ignora
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
      return false;
    }
    await click(delBtn, "Excluir...");
    const confirm = await openMenuAndWait(findConfirmDelete);
    if (confirm) {
      await click(confirm, "Confirmano");
      deletedCount++;
      console.log(`🗑️ Excluídos: ${deletedCount} | 🔄 Reposts desfeitos: ${undoneReposts}`);
      return true;
    }
    return false;
  }

  async function processRepost(article) {
    const rt = getRetweetButton(article);
    if (!rt) return false;
    await click(rt, "↩️ Abrindo menu do Repost...");
    const undo = await openMenuAndWait(findUndoRepostInMenu);
    if (!undo) {
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
      return false;
    }
    await click(undo, "Desfazendo repost...");
    const confirm = await openMenuAndWait(findConfirmDelete);
    if (confirm) await click(confirm, "desfazer");
    undoneReposts++;
    console.log(`🗑️ Excluídos: ${deletedCount} | 🔄 Reposts desfeitos: ${undoneReposts}`);
    return true;
  }

  function nextArticle() {
    const arts = $all('article', primary());
    for (const a of arts) {
      if (seenArticles.has(a)) continue;
      if (!a.offsetParent) { seenArticles.add(a); continue; }
      return a;
    }
    return null;
  }

  async function main() {
    console.log("🚀 Limpando posts/respostas + desfazendo reposts. Para parar: stopDeletion()");
    while (running) {
      closeListsModalIfOpen();

      const confirm = findConfirmDelete();
      if (confirm) { await click(confirm, "Confirmando"); continue; }

      const delNow = findDeleteButtonInMenu();
      if (delNow) { await click(delNow, "Excluindo"); continue; }
      const undoNow = findUndoRepostInMenu();
      if (undoNow) { await click(undoNow, "Desfazendo repost"); continue; }

      const art = nextArticle();
      if (!art) {
        window.scrollBy(0, Math.max(900, window.innerHeight));
        await sleep(SCROLL_DELAY);
        continue;
      }

      let acted = false;
      if (isRepostedByMe(art)) {
        acted = await processRepost(art);
      } 
      if (!acted && isOwnedTweet(art)) {
        acted = await processOwnedTweet(art);
      }

      seenArticles.add(art);
      if (!acted) {
      }
    }
    console.log(`Finalizado. Excluídos: ${deletedCount} | Reposts desfeitos: ${undoneReposts}`);
  }

  main().catch(e => console.error("Erro:", e));
})();
