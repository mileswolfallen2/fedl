// Lightweight multi-page handler for GD fedl
(function(){
  function qs(id){return document.getElementById(id)}

  const page = document.body.dataset.page;
  const isFileProtocol = window.location.protocol === 'file:';
  const liveServerBase = 'https://raspberrypi-1.tail46eacb.ts.net/fedl';
  const canUseLiveServer = !isFileProtocol || !!liveServerBase;
  const liveApiUrl = `${liveServerBase}/api/list`;
  const liveRunsUrl = `${liveServerBase}/api/runs`;
  const liveEventsUrl = `${liveServerBase}/events`;
  const liveDataFileUrl = `${liveServerBase}/server/data.txt`;
  /** Use for POST /api/import/* and any path under the same base as list/runs (not root-relative /api/...). */
  function liveApiPath(path){
    const p = String(path || '').startsWith('/') ? path : `/${path}`;
    return `${liveServerBase}${p}`;
  }
  const offlinePage = 'offlineindex.html';

  function redirectToOffline(){
    if(window.location.pathname.endsWith(`/${offlinePage}`)) return;
    window.location.replace(offlinePage);
  }

  function probeLiveServer(timeoutMs = 5000){
    const controller = new AbortController();
    const timeoutId = setTimeout(()=>controller.abort(), timeoutMs);
    return fetch(liveServerBase, {
      method:'HEAD',
      cache:'no-store',
      signal: controller.signal
    }).then(response => {
      clearTimeout(timeoutId);
      return response;
    }).catch(error => {
      clearTimeout(timeoutId);
      throw error;
    });
  }

  if(!window.location.pathname.endsWith(`/${offlinePage}`)){
    probeLiveServer().catch(()=>{
      redirectToOffline();
    });
  }
  let cachedItems = null;
  let cachedRuns = null;
  let cachedLevelMeta = null;
  let liveBound = false;
  let liveHandlers = [];
  let runsHandlers = [];

  // Storage helpers
  function read(key, fallback){
    try{const v = localStorage.getItem(key); return v?JSON.parse(v):fallback}
    catch(e){return fallback}
  }
  function write(key, val){localStorage.setItem(key,JSON.stringify(val))}

  const FEDL_USER_ACCOUNTS = 'fedl_user_accounts';
  const FEDL_USER_ACCOUNT_ACTIVE = 'fedl_user_account_active';

  function fedlAccountId(){
    try {
      return localStorage.getItem(FEDL_USER_ACCOUNT_ACTIVE) || '';
    } catch (e) {
      return '';
    }
  }

  function fedlSetActiveAccountId(id){
    try {
      if (id) {
        localStorage.setItem(FEDL_USER_ACCOUNT_ACTIVE, id);
      } else {
        localStorage.removeItem(FEDL_USER_ACCOUNT_ACTIVE);
      }
    } catch (e) {}
  }

  function fedlListAccounts(){
    return read(FEDL_USER_ACCOUNTS, []);
  }

  function fedlSaveAccountsList(accounts){
    write(FEDL_USER_ACCOUNTS, accounts);
  }

  function fedlNewAccountId(){
    return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function fedlEmptyRouletteSlots(){
    return { '1': null, '2': null, '3': null };
  }

  function fedlDefaultUserData(){
    return { roulettePick: null, levelPercents: {}, savedRuns: [], rouletteSlots: fedlEmptyRouletteSlots() };
  }

  function fedlGetAccountPayload(accountId){
    const raw = read(`fedl_user_data_${accountId}`, fedlDefaultUserData());
    if (!Array.isArray(raw.savedRuns)) {
      raw.savedRuns = [];
    }
    if (!raw.levelPercents || typeof raw.levelPercents !== 'object') {
      raw.levelPercents = {};
    }
    if (!raw.rouletteSlots || typeof raw.rouletteSlots !== 'object') {
      raw.rouletteSlots = fedlEmptyRouletteSlots();
    }
    ['1', '2', '3'].forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(raw.rouletteSlots, k)) {
        raw.rouletteSlots[k] = null;
      }
    });
    return raw;
  }

  function fedlNextPercentHint(inputValue){
    const raw = String(inputValue || '').trim().replace(',', '.');
    if (!raw) {
      return {
        kind: 'muted',
        text: 'Enter your current best %, then tap Submit % to save and see the next % to aim for (+1% roulette step).'
      };
    }
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { kind: 'error', text: 'Enter a number from 0 to 100.' };
    }
    if (n >= 100) {
      return {
        kind: 'success',
        text: 'You are at 100%. Beat the level, then spin — your next demon usually adds +1% to your roulette target.'
      };
    }
    const next = Math.min(100, Math.floor(n) + 1);
    if (next >= 100) {
      return { kind: 'success', text: 'Saved. Next goal on this level: 100% (full completion).' };
    }
    return {
      kind: 'success',
      text: `Saved. Next % to hit on this level: ${next}% (classic +1% roulette step).`
    };
  }

  async function fedlReadJsonResponse(r){
    const text = await r.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = {};
    }
    const msg = (data && data.error && String(data.error)) || (data && data.message && String(data.message)) || '';
    const plain = String(text || '').trim();
    return { data, message: msg || plain || r.statusText || `Error ${r.status}` };
  }

  function fedlAddSavedRun(accountId, fields){
    if (!accountId || accountId !== fedlServerUserId) {
      return { ok: false, error: 'Sign in to save runs to your account.' };
    }
    const playerName = String(fields.playerName || '').trim();
    const levelTitle = String(fields.levelTitle || '').trim();
    if (!playerName || !levelTitle) {
      return { ok: false, error: 'Player name and level are required to save a run.' };
    }
    const p = fedlGetAccountPayload(accountId);
    const list = p.savedRuns.slice();
    const id = `sv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    list.unshift({
      id,
      playerName,
      levelTitle,
      videoUrl: String(fields.videoUrl || '').trim(),
      percent: String(fields.percent != null ? fields.percent : '100').trim() || '100',
      rawFootageUrl: String(fields.rawFootageUrl || '').trim(),
      notes: String(fields.notes || '').trim(),
      savedAt: new Date().toISOString()
    });
    p.savedRuns = list.slice(0, 48);
    fedlSaveAccountPayload(accountId, p);
    return { ok: true };
  }

  function fedlRemoveSavedRun(accountId, runId){
    if (!accountId || accountId !== fedlServerUserId || !runId) {
      return;
    }
    const p = fedlGetAccountPayload(accountId);
    p.savedRuns = (p.savedRuns || []).filter(r => r && r.id !== runId);
    fedlSaveAccountPayload(accountId, p);
  }

  function fedlSaveAccountPayload(accountId, payload){
    write(`fedl_user_data_${accountId}`, payload);
    fedlSchedulePushUserState(accountId);
  }

  let fedlServerUserId = null;
  let fedlServerUsername = null;
  const FEDL_AUTH_TOKEN_KEY = 'fedl_auth_token';

  function fedlGetAuthToken(){
    try {
      return localStorage.getItem(FEDL_AUTH_TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function fedlSetAuthToken(token){
    try {
      if (token) {
        localStorage.setItem(FEDL_AUTH_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(FEDL_AUTH_TOKEN_KEY);
      }
    } catch (e) {}
  }

  function fedlClearServerSession(){
    fedlServerUserId = null;
    fedlServerUsername = null;
    fedlSetAuthToken('');
  }

  function fedlDataUserId(){
    if (fedlServerUserId) {
      return fedlServerUserId;
    }
    return fedlAccountId();
  }

  let fedlPushStateTimer = null;
  function fedlSchedulePushUserState(accountId){
    if (!accountId || !fedlGetAuthToken() || accountId !== fedlServerUserId || !canUseLiveServer) {
      return;
    }
    if (fedlPushStateTimer) {
      clearTimeout(fedlPushStateTimer);
    }
    fedlPushStateTimer = setTimeout(()=>{
      const payload = fedlGetAccountPayload(accountId);
      fetch(`${liveServerBase}/api/user/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fedlGetAuthToken()}`
        },
        body: JSON.stringify({ data: payload })
      }).catch(()=>{});
    }, 450);
  }

  function fedlRefreshAuthState(){
    const t = fedlGetAuthToken();
    if (!t || !canUseLiveServer) {
      fedlServerUserId = null;
      fedlServerUsername = null;
      return Promise.resolve(null);
    }
    return fetch(`${liveServerBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${t}` },
      cache: 'no-store'
    }).then(r=>{
      if (!r.ok) {
        throw new Error('auth');
      }
      return r.json();
    }).then(j=>{
      fedlServerUserId = j.userId;
      fedlServerUsername = j.username;
      return j;
    }).catch(()=>{
      fedlClearServerSession();
      return null;
    });
  }

  function fedlPullUserStateToLocal(userId){
    const t = fedlGetAuthToken();
    if (!t || !userId || !canUseLiveServer) {
      return Promise.resolve();
    }
    return fetch(`${liveServerBase}/api/user/state`, {
      headers: { Authorization: `Bearer ${t}` },
      cache: 'no-store'
    }).then(r=>{
      if (!r.ok) {
        return null;
      }
      return r.json();
    }).then(j=>{
      if (j && j.data) {
        write(`fedl_user_data_${userId}`, j.data);
      }
    }).catch(()=>{});
  }

  function injectFedlAuthNav(){
    const nav = document.querySelector('header nav');
    if (!nav || nav.querySelector('.fedl-auth-nav')) {
      return;
    }
    const wrap = document.createElement('span');
    wrap.className = 'fedl-auth-nav';
    nav.appendChild(wrap);
  }

  function fedlUpdateAuthNav(){
    const wrap = document.querySelector('.fedl-auth-nav');
    if (!wrap) {
      return;
    }
    wrap.textContent = '';
    if (fedlServerUsername) {
      const label = document.createElement('span');
      label.className = 'fedl-auth-label muted';
      label.appendChild(document.createTextNode('Hi, '));
      const strong = document.createElement('strong');
      strong.textContent = fedlServerUsername;
      label.appendChild(strong);
      wrap.appendChild(label);
      wrap.appendChild(document.createTextNode(' '));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ghost-btn small-btn fedl-logout-btn';
      btn.textContent = 'Log out';
      btn.addEventListener('click', ()=>{
        const tok = fedlGetAuthToken();
        if (tok && canUseLiveServer) {
          fetch(`${liveServerBase}/api/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tok}` }
          }).catch(()=>{});
        }
        fedlClearServerSession();
        fedlUpdateAuthNav();
        document.dispatchEvent(new CustomEvent('fedl-auth-updated'));
        window.location.reload();
      });
      wrap.appendChild(btn);
    } else {
      const a1 = document.createElement('a');
      a1.href = 'login.html';
      a1.textContent = 'Log in';
      wrap.appendChild(a1);
      wrap.appendChild(document.createTextNode(' '));
      const a2 = document.createElement('a');
      a2.href = 'signup.html';
      a2.textContent = 'Sign up';
      wrap.appendChild(a2);
    }
  }

  function fedlNormalizeLevelKey(title){
    return String(title || '').trim().toLowerCase();
  }

  function fedlGetLevelPercent(accountId, title){
    if (!accountId) {
      return '';
    }
    const p = fedlGetAccountPayload(accountId);
    const k = fedlNormalizeLevelKey(title);
    return (p.levelPercents && p.levelPercents[k]) ? String(p.levelPercents[k]) : '';
  }

  function fedlSetLevelPercent(accountId, title, percent){
    if (!accountId) {
      return;
    }
    const p = fedlGetAccountPayload(accountId);
    if (!p.levelPercents) {
      p.levelPercents = {};
    }
    const k = fedlNormalizeLevelKey(title);
    const v = String(percent || '').trim();
    if (v) {
      p.levelPercents[k] = v;
    } else {
      delete p.levelPercents[k];
    }
    if (p.roulettePick && fedlNormalizeLevelKey(p.roulettePick.title) === k) {
      p.roulettePick.percent = v;
    }
    fedlSaveAccountPayload(accountId, p);
  }

  function fedlSaveRoulettePick(accountId, pick){
    if (!accountId || !pick) {
      return;
    }
    const p = fedlGetAccountPayload(accountId);
    p.roulettePick = {
      title: pick.title,
      position: pick.position,
      level: pick.level,
      url: pick.url,
      levelId: pick.levelId,
      noteSource: pick.noteSource,
      percent: String(pick.percent || '').trim()
    };
    if (p.roulettePick.title && p.roulettePick.percent) {
      if (!p.levelPercents) {
        p.levelPercents = {};
      }
      p.levelPercents[fedlNormalizeLevelKey(p.roulettePick.title)] = p.roulettePick.percent;
    }
    fedlSaveAccountPayload(accountId, p);
  }

  function fedlCreateAccount(displayName){
    const name = String(displayName || '').trim();
    if (!name) {
      return null;
    }
    const accounts = fedlListAccounts();
    const id = fedlNewAccountId();
    accounts.push({ id, name, createdAt: new Date().toISOString() });
    fedlSaveAccountsList(accounts);
    fedlSetActiveAccountId(id);
    fedlSaveAccountPayload(id, fedlDefaultUserData());
    return { id, name };
  }

  function parseData(txt){
    return txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{
      const parts = l.split('|').map(p=>p.trim());
      return {level:parts[0]||'Unknown',position:parts[1]||'',title:parts[2]||'Untitled',url:parts[3]||''};
    });
  }

  function formatData(items){
    return items.map(item=>[
      item.level || 'new',
      item.position || '',
      item.title || '',
      item.url || ''
    ].join('|')).join('\n');
  }

  function parseLevelMeta(txt){
    const map = {};
    txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).forEach(l=>{
      if(l.startsWith('//')) return;
      const parts = l.split('|').map(p=>p.trim());
      const title = parts[0] || '';
      if(!title) return;
      map[title] = {
        levelId: parts[1] || 'unknown',
        percent: parts[2] || '100'
      };
    });
    return map;
  }

  function loadItems(){
    if(cachedItems) return Promise.resolve(cachedItems);
    if(!canUseLiveServer){
      return fetch('data.txt', {cache:'no-store'}).then(r=>{
        if(!r.ok) throw new Error('static data unavailable');
        return r.text();
      }).then(txt=>{
        cachedItems = parseData(txt);
        return cachedItems;
      });
    }
    return fetch(liveApiUrl, {cache:'no-store'}).then(r=>{
      if(!r.ok) throw new Error('API unavailable');
      const contentType = (r.headers.get('content-type') || '').toLowerCase();
      if(contentType.includes('application/json')){
        return r.json().then(data=>Array.isArray(data.items) ? data.items : []);
      }
      return r.text().then(txt=>parseData(txt));
    }).then(items=>{
      cachedItems = items;
      return cachedItems;
    }).catch(()=>{
      return fetch(liveDataFileUrl, {cache:'no-store'}).then(r=>{
        if(!r.ok) throw new Error('server data unavailable');
        return r.text();
      }).then(txt=>{
        cachedItems = parseData(txt);
        return cachedItems;
      }).catch(()=>{
        return fetch('data.txt', {cache:'no-store'}).then(r=>{
          if(!r.ok) throw new Error('static data unavailable');
          return r.text();
        }).then(txt=>{
          cachedItems = parseData(txt);
          return cachedItems;
        });
      });
    });
  }

  function clearItemsCache(){
    cachedItems = null;
  }

  function loadRuns(){
    if(cachedRuns) return Promise.resolve(cachedRuns);
    if(!canUseLiveServer){
      cachedRuns = [];
      return Promise.resolve(cachedRuns);
    }
    return fetch(liveRunsUrl, {cache:'no-store'}).then(r=>{
      if(!r.ok) throw new Error('Runs API unavailable');
      return r.json();
    }).then(data=>{
      cachedRuns = Array.isArray(data.items) ? data.items : [];
      return cachedRuns;
    });
  }

  function clearRunsCache(){
    cachedRuns = null;
  }

  function onLiveUpdate(handler){
    liveHandlers.push(handler);
  }

  function notifyLiveUpdate(items){
    liveHandlers.forEach(handler=>handler(items));
  }

  function onRunsUpdate(handler){
    runsHandlers.push(handler);
  }

  function notifyRunsUpdate(runs){
    runsHandlers.forEach(handler=>handler(runs));
  }

  function refreshItems(){
    clearItemsCache();
    return loadItems().then(items=>{
      notifyLiveUpdate(items);
      return items;
    });
  }

  function refreshRuns(){
    clearRunsCache();
    return loadRuns().then(runs=>{
      notifyRunsUpdate(runs);
      return runs;
    });
  }

  function bindLiveUpdates(){
    if(liveBound || !canUseLiveServer || typeof window.EventSource === 'undefined') return;
    liveBound = true;
    const source = new EventSource(liveEventsUrl);
    source.addEventListener('list-update', ()=>{
      refreshItems().catch(err=>console.error(err));
    });
    source.addEventListener('runs-update', ()=>{
      refreshRuns().catch(err=>console.error(err));
    });
    source.onerror = function(){
      source.close();
      liveBound = false;
      window.setTimeout(bindLiveUpdates, 3000);
    };
  }

  function loadLevelMeta(){
    if(cachedLevelMeta) return Promise.resolve(cachedLevelMeta);
    return fetch('level-ids.txt').then(r=>r.text()).then(txt=>{
      cachedLevelMeta = parseLevelMeta(txt);
      return cachedLevelMeta;
    }).catch(()=>{
      cachedLevelMeta = {};
      return cachedLevelMeta;
    });
  }

  function fetchLevelIdFromApi(title){
    const url = `https://gdbrowser.com/api/search/${encodeURIComponent(title)}?diff=-2&demonFilter=5&count=10`;
    return fetch(url).then(r=>r.json()).then(results=>{
      if(!Array.isArray(results) || !results.length) return null;
      const exact = results.find(item=>String(item.name||'').toLowerCase() === String(title||'').toLowerCase());
      const match = exact || results[0];
      if(!match || !match.id) return null;
      return String(match.id);
    }).catch(()=>null);
  }

  function renderApprovedRunsForLevel(item, hostEl){
    if(!hostEl) return;
    hostEl.innerHTML = '<p class="muted">Loading approved runs...</p>';
    loadRuns().then(runs=>{
      const approvedRuns = runs.filter(run=>{
        return String(run.status || '').toLowerCase() === 'approved'
          && String(run.levelTitle || '').toLowerCase() === String(item.title || '').toLowerCase();
      });
      if(!approvedRuns.length){
        hostEl.innerHTML = '<p class="muted">No approved runs have been linked to this level yet.</p>';
        return;
      }
      hostEl.innerHTML = approvedRuns.map(run=>`
        <article class="modal-run-card">
          <strong>${escapeHtml(run.playerName || 'Unknown player')}</strong>
          <span>${escapeHtml(run.percent || '100')}%</span>
          <a class="text-link" href="${escapeAttr(run.videoUrl || '#')}" target="_blank" rel="noopener noreferrer">Open run video</a>
        </article>
      `).join('');
    }).catch(err=>{
      console.error(err);
      hostEl.innerHTML = '<p class="muted">Could not load approved runs for this level.</p>';
    });
  }

  function extractYouTubeID(url){
    const m = String(url || '').match(/(?:v=|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : '';
  }

  function updateAccountProgressInModal(modal, item){
    if (!modal) {
      return;
    }
    const inner = modal.querySelector('.inner');
    if (!inner) {
      return;
    }
    let accBar = modal.querySelector('.modal-account-progress');
    if (!accBar) {
      accBar = document.createElement('div');
      accBar.className = 'modal-account-progress';
      const runsWrap = inner.querySelector('.modal-runs-wrap');
      if (runsWrap) {
        inner.insertBefore(accBar, runsWrap);
      } else {
        inner.appendChild(accBar);
      }
    }
    const accId = fedlDataUserId();
    if (!accId || !item || !item.title) {
      accBar.hidden = true;
      accBar.innerHTML = '';
      return;
    }
    accBar.hidden = false;
    const cur = fedlGetLevelPercent(accId, item.title);
    const labelText = fedlServerUserId
      ? 'Your progress (synced to your account)'
      : 'Your progress (saved on this device)';
    accBar.innerHTML =
      '<p class="modal-account-label">' +
      labelText +
      '</p>' +
      '<div class="modal-account-row">' +
      '<input type="text" class="modal-account-pct-input" inputmode="decimal" placeholder="e.g. 47" />' +
      '<span class="muted">%</span>' +
      '</div>';
    const input = accBar.querySelector('.modal-account-pct-input');
    if (input) {
      input.value = cur;
      input.addEventListener('change', ()=>{
        fedlSetLevelPercent(accId, item.title, input.value);
      });
    }
  }

  function openVideoModal(item, options){
    const config = Object.assign({showRuns:false}, options || {});
    const url = item && item.url;
    if(!url) return;
    const id = extractYouTubeID(url);
    if(!id){
      window.open(url,'_blank');
      return;
    }
    let modal = document.querySelector('.video-modal');
    if(!modal){
      modal = document.createElement('div'); modal.className='video-modal';
      const inner = document.createElement('div'); inner.className='inner';
      const close = document.createElement('button'); close.textContent='Close'; close.className='btn'; close.style.float='right'; close.onclick=()=>modal.remove();
      inner.appendChild(close);
      const iframe = document.createElement('iframe'); iframe.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'; iframe.allowFullscreen=true;
      inner.appendChild(iframe); modal.appendChild(inner); document.body.appendChild(modal);
      const runsWrap = document.createElement('div'); runsWrap.className = 'modal-runs-wrap';
      runsWrap.innerHTML = `
        <div class="modal-runs-head">
          <strong>Approved runs</strong>
          <span class="muted">Player, percent, and linked video</span>
        </div>
        <div class="modal-runs-list"></div>
      `;
      inner.appendChild(runsWrap);
    }
    modal.querySelector('iframe').src = `https://www.youtube.com/embed/${id}`;
    const runsWrap = modal.querySelector('.modal-runs-wrap');
    const runsList = modal.querySelector('.modal-runs-list');
    if(runsWrap) runsWrap.hidden = !config.showRuns;
    if(config.showRuns && runsList){
      renderApprovedRunsForLevel(item, runsList);
    }
    updateAccountProgressInModal(modal, item);
    modal.style.display = 'flex';
  }

  if(page==='index'){
    const totalEl = qs('hero-total-levels');
    const topEl = qs('hero-top-entry');
    const approvedRunsEl = qs('hero-last-slot');
    const featuredListEl = qs('featured-list');

    function renderFeatured(items){
      if(!featuredListEl) return;
      const rankedItems = items.slice().sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0));
      const featured = rankedItems.slice(0, 3);
      if(!featured.length){
        featuredListEl.innerHTML = `
          <article class="featured-card">
            <span class="featured-rank">#--</span>
            <strong>No list data found</strong>
            <p>The homepage preview could not load any FEDL entries yet.</p>
          </article>
        `;
        return;
      }

      featuredListEl.innerHTML = featured.map(item=>`
        <article class="featured-card">
          <span class="featured-rank">#${escapeHtml(item.position || '--')}</span>
          <strong>${escapeHtml(item.title || 'Untitled')}</strong>
          <p>${item.url ? 'Video link is ready from the list page.' : 'This entry does not have a linked video yet.'}</p>
        </article>
      `).join('');
    }

    function renderHome(items){
      const rankedItems = items.slice().sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0));
      const firstItem = rankedItems[0];

      if(totalEl) totalEl.textContent = String(rankedItems.length || 0);
      if(topEl) topEl.textContent = firstItem ? firstItem.title : 'Unavailable';
      renderFeatured(rankedItems);
    }

    function renderApprovedRuns(runs){
      if(!approvedRunsEl) return;
      const approvedCount = runs.filter(run=>String(run.status || '').toLowerCase() === 'approved').length;
      approvedRunsEl.textContent = String(approvedCount);
    }

    loadItems().then(renderHome).catch(()=>{
      renderHome([]);
    });
    loadRuns().then(renderApprovedRuns).catch(()=>{
      renderApprovedRuns([]);
    });

    bindLiveUpdates();
    onLiveUpdate(renderHome);
    onRunsUpdate(renderApprovedRuns);
  }

  if(page==='roulette'){
    const spinBtn = qs('roulette-spin');
    const statusEl = qs('roulette-status');
    const titleEl = qs('roulette-title');
    const rankEl = qs('roulette-rank');
    const idEl = qs('roulette-level-id');
    const noteEl = qs('roulette-note');
    const openEl = qs('roulette-open');
    const pctInput = qs('roulette-percent');
    const pctRow = qs('roulette-progress-row');
    const accountSelect = qs('roulette-account-select');
    const accountNewInput = qs('roulette-account-new');
    const accountCreateBtn = qs('roulette-account-create');
    const restoreBtn = qs('roulette-restore');
    const pctHint = qs('roulette-percent-hint');
    const loginSyncHint = qs('roulette-login-sync-hint');
    const slotsHintEl = qs('roulette-slots-hint');
    const pctSubmitBtn = qs('roulette-percent-submit');

    let lastRoulette = { item: null, meta: null };

    function setPercentHint(text, kind){
      if(!pctHint) return;
      pctHint.textContent = text || '';
      pctHint.className =
        'small roulette-percent-hint ' +
        (kind === 'error' ? 'error-text' : kind === 'success' ? 'success-text' : 'muted');
    }

    function resetPercentHint(){
      const h = fedlNextPercentHint('');
      setPercentHint(h.text, h.kind);
    }

    function refreshRouletteSlotsUi(){
      const aid = fedlDataUserId();
      ['1', '2', '3'].forEach(k=>{
        const saveB = qs(`roulette-slot-save-${k}`);
        const loadB = qs(`roulette-slot-load-${k}`);
        const lab = qs(`roulette-slot-label-${k}`);
        if(saveB) saveB.disabled = !aid;
        if(loadB) loadB.disabled = !aid;
        if(lab){
          if(!aid){
            lab.textContent = '—';
          }else{
            const slot = fedlGetAccountPayload(aid).rouletteSlots[k];
            if(slot && slot.title){
              const pct = slot.percent ? ` @ ${slot.percent}%` : '';
              const t = String(slot.title);
              const short = t.length > 36 ? `${t.slice(0, 34)}…` : t;
              lab.textContent = short + pct;
            }else{
              lab.textContent = 'Empty';
            }
          }
        }
      });
      if(slotsHintEl){
        if(!aid){
          slotsHintEl.textContent = 'Create a profile below or log in to use save slots.';
        }else{
          slotsHintEl.textContent = 'Save the demon on screen into a slot, or load a slot to swap demons.';
        }
      }
    }

    function syncPercentRow(){
      if(!pctRow) return;
      const aid = fedlDataUserId();
      if(!aid || !lastRoulette.item){
        pctRow.hidden = true;
        if(pctInput) pctInput.value = '';
        if(pctHint) pctHint.textContent = '';
        return;
      }
      pctRow.hidden = false;
      if(pctInput){
        pctInput.value = fedlGetLevelPercent(aid, lastRoulette.item.title) || '';
      }
      resetPercentHint();
    }

    function refreshRouletteAccountUi(){
      const panel = document.querySelector('.roulette-account-panel');
      const serverMode = !!fedlServerUsername;
      if(loginSyncHint){
        loginSyncHint.hidden = !!fedlServerUserId;
      }
      if(panel){
        const controls = panel.querySelector('.roulette-account-controls');
        const createRow = panel.querySelector('.roulette-account-create-row');
        const selLabel = panel.querySelector('.roulette-account-label');
        let note = panel.querySelector('.fedl-server-account-note');
        if(serverMode){
          if(controls) controls.style.display = 'none';
          if(createRow) createRow.style.display = 'none';
          if(selLabel) selLabel.style.display = 'none';
          if(!note){
            note = document.createElement('p');
            note.className = 'muted fedl-server-account-note';
            const heading = panel.querySelector('.roulette-account-heading');
            if(heading){
              heading.insertAdjacentElement('afterend', note);
            }else{
              panel.appendChild(note);
            }
          }
          note.textContent = `Signed in as ${fedlServerUsername}. Progress syncs to this server (this browser keeps a copy).`;
          note.style.display = '';
        }else{
          if(controls) controls.style.display = '';
          if(createRow) createRow.style.display = '';
          if(selLabel) selLabel.style.display = '';
          if(note) note.style.display = 'none';
        }
      }
      if(!accountSelect || serverMode){
        if(restoreBtn){
          const id = fedlDataUserId();
          const pick = id ? fedlGetAccountPayload(id).roulettePick : null;
          restoreBtn.hidden = !pick || !pick.title;
        }
        refreshRouletteSlotsUi();
        syncPercentRow();
        return;
      }
      const accounts = fedlListAccounts();
      const active = fedlAccountId();
      accountSelect.innerHTML = '<option value="">No profile (progress not saved)</option>';
      accounts.forEach(a=>{
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        if(a.id === active) opt.selected = true;
        accountSelect.appendChild(opt);
      });
      if(restoreBtn){
        const pick = active ? fedlGetAccountPayload(active).roulettePick : null;
        restoreBtn.hidden = !pick || !pick.title;
      }
      refreshRouletteSlotsUi();
      syncPercentRow();
    }

    function showPick(item, meta){
      lastRoulette = { item, meta };
      statusEl.textContent = 'Your demon is:';
      titleEl.textContent = item.title;
      rankEl.textContent = `Rank: #${item.position}`;
      idEl.textContent = `Level ID: ${meta.levelId || 'unknown'}`;
      noteEl.textContent = meta.source === 'api'
        ? 'Level ID was looked up from the Geometry Dash community API.'
        : 'Level ID came from your local level-ids.txt file.';
      if(item.url){
        openEl.hidden = false;
        openEl.href = '#';
        openEl.onclick = function(e){
          e.preventDefault();
          openVideoModal(item, {showRuns:false});
        };
      }else{
        openEl.hidden = true;
        openEl.onclick = null;
      }
      const aid = fedlDataUserId();
      if(aid){
        const pct = fedlGetLevelPercent(aid, item.title) || '';
        fedlSaveRoulettePick(aid, {
          title: item.title,
          position: item.position,
          level: item.level,
          url: item.url,
          levelId: meta.levelId,
          noteSource: meta.source,
          percent: pct
        });
        refreshRouletteAccountUi();
      }
      syncPercentRow();
    }

    function saveRouletteSlot(slotKey){
      const aid = fedlDataUserId();
      if(!aid || !lastRoulette.item){
        if(slotsHintEl) slotsHintEl.textContent = 'Spin a demon first, and use a profile or log in.';
        return;
      }
      const p = fedlGetAccountPayload(aid);
      const pct = pctInput ? String(pctInput.value || '').trim() : '';
      p.rouletteSlots[slotKey] = {
        title: lastRoulette.item.title,
        position: lastRoulette.item.position,
        level: lastRoulette.item.level,
        url: lastRoulette.item.url,
        levelId: lastRoulette.meta && lastRoulette.meta.levelId,
        noteSource: lastRoulette.meta && lastRoulette.meta.source,
        percent: pct,
        savedAt: new Date().toISOString()
      };
      fedlSaveAccountPayload(aid, p);
      if(pct){
        fedlSetLevelPercent(aid, lastRoulette.item.title, pct);
      }
      refreshRouletteSlotsUi();
    }

    function loadRouletteSlot(slotKey){
      const aid = fedlDataUserId();
      if(!aid) return;
      const slot = fedlGetAccountPayload(aid).rouletteSlots[slotKey];
      if(!slot || !slot.title){
        if(slotsHintEl) slotsHintEl.textContent = 'That slot is empty.';
        return;
      }
      const pctStr = String(slot.percent != null ? slot.percent : '').trim();
      if(pctStr){
        fedlSetLevelPercent(aid, slot.title, pctStr);
      }
      const item = {
        title: slot.title,
        position: slot.position,
        level: slot.level,
        url: slot.url
      };
      const meta = {
        levelId: slot.levelId,
        source: slot.noteSource === 'api' ? 'api' : 'file'
      };
      showPick(item, meta);
      if(pctInput){
        pctInput.value = pctStr || fedlGetLevelPercent(aid, slot.title) || '';
      }
      resetPercentHint();
      refreshRouletteSlotsUi();
    }

    if(pctInput){
      pctInput.addEventListener('change', ()=>{
        const aid = fedlDataUserId();
        if(!aid || !lastRoulette.item) return;
        fedlSetLevelPercent(aid, lastRoulette.item.title, pctInput.value);
      });
    }
    if(pctSubmitBtn){
      pctSubmitBtn.addEventListener('click', ()=>{
        const aid = fedlDataUserId();
        if(!aid || !lastRoulette.item){
          setPercentHint('Spin a demon and use a profile or log in to track %.', 'error');
          return;
        }
        fedlSetLevelPercent(aid, lastRoulette.item.title, pctInput ? pctInput.value : '');
        const h = fedlNextPercentHint(pctInput ? pctInput.value : '');
        setPercentHint(h.text, h.kind);
      });
    }
    ['1', '2', '3'].forEach(k=>{
      const sb = qs(`roulette-slot-save-${k}`);
      const lb = qs(`roulette-slot-load-${k}`);
      if(sb) sb.addEventListener('click', ()=> saveRouletteSlot(k));
      if(lb) lb.addEventListener('click', ()=> loadRouletteSlot(k));
    });
    if(accountSelect){
      accountSelect.addEventListener('change', ()=>{
        fedlSetActiveAccountId(accountSelect.value || '');
        refreshRouletteAccountUi();
      });
    }
    if(accountCreateBtn && accountNewInput){
      accountCreateBtn.addEventListener('click', ()=>{
        const name = String(accountNewInput.value || '').trim();
        if(!name) return;
        fedlCreateAccount(name);
        accountNewInput.value = '';
        refreshRouletteAccountUi();
      });
    }
    if(restoreBtn){
      restoreBtn.addEventListener('click', ()=>{
        const aid = fedlDataUserId();
        if(!aid) return;
        const pick = fedlGetAccountPayload(aid).roulettePick;
        if(!pick || !pick.title) return;
        const item = {
          title: pick.title,
          position: pick.position,
          level: pick.level,
          url: pick.url
        };
        const meta = {
          levelId: pick.levelId,
          source: pick.noteSource === 'api' ? 'api' : 'file'
        };
        showPick(item, meta);
      });
    }

    document.addEventListener('fedl-auth-updated', ()=>{
      refreshRouletteAccountUi();
    });
    fedlRefreshAuthState()
      .then(()=> fedlPullUserStateToLocal(fedlServerUserId))
      .finally(()=>{
        refreshRouletteAccountUi();
        fedlUpdateAuthNav();
      });

    spinBtn.addEventListener('click', ()=>{
      statusEl.textContent = 'Spinning...';
      titleEl.textContent = 'Choosing a demon';
      rankEl.textContent = 'Rank: -';
      idEl.textContent = 'Level ID: -';
      noteEl.textContent = 'Checking your local file and API if needed.';
      openEl.hidden = true;
      if(pctRow) pctRow.hidden = true;
      if(pctHint) pctHint.textContent = '';
      Promise.all([loadItems(), loadLevelMeta()]).then(([items, metaMap])=>{
        if(!items.length){
          statusEl.textContent = 'No demons found.';
          titleEl.textContent = 'Add demons to the live server list';
          idEl.textContent = 'Level ID: -';
          noteEl.textContent = 'No list data was found.';
          return;
        }
        const item = items[Math.floor(Math.random()*items.length)];
        const localMeta = metaMap[item.title] || {levelId:'unknown', percent:'100'};
        if(localMeta.levelId && localMeta.levelId !== 'unknown'){
          window.setTimeout(()=>showPick(item, {levelId: localMeta.levelId, percent: localMeta.percent, source: 'file'}), 350);
          return;
        }
        fetchLevelIdFromApi(item.title).then(levelId=>{
          const meta = {
            levelId: levelId || 'unknown',
            percent: localMeta.percent || '100',
            source: levelId ? 'api' : 'file'
          };
          window.setTimeout(()=>showPick(item, meta), 350);
        });
      }).catch(err=>{
        statusEl.textContent = 'Could not load the list.';
        titleEl.textContent = 'Run the site on a local server';
        rankEl.textContent = 'Rank: -';
        idEl.textContent = 'Level ID: -';
        noteEl.textContent = 'The live list or API lookup failed.';
        console.error(err);
      });
    });
  }

  if(page==='guess'){
    const modeSelect = qs('guess-mode');
    const startBtn = qs('guess-start');
    const form = qs('guess-form');
    const input = qs('guess-input');
    const statusEl = qs('guess-status');
    const titleEl = qs('guess-level-title');
    const attemptsEl = qs('guess-attempts');
    const feedbackEl = qs('guess-feedback');
    const answerEl = qs('guess-answer');
    const openEl = qs('guess-open');

    const guessModes = {
      casual: {label:'Casual', tries:6},
      standard: {label:'Standard', tries:4},
      hard: {label:'Hard', tries:3},
      marathon: {label:'Marathon', tries:8}
    };

    const state = {
      active: false,
      triesLeft: guessModes.standard.tries,
      answer: null,
      item: null
    };

    function getRankedItems(items){
      return items.slice().filter(item=>Number(item.position) > 0).sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0));
    }

    function getSelectedMode(){
      return guessModes[(modeSelect && modeSelect.value) || 'standard'] || guessModes.standard;
    }

    function resetGuessUi(message){
      const mode = getSelectedMode();
      state.active = false;
      state.triesLeft = mode.tries;
      state.answer = null;
      state.item = null;
      statusEl.textContent = message;
      titleEl.textContent = 'No level selected';
      attemptsEl.textContent = `Tries left: ${mode.tries}`;
      feedbackEl.textContent = `Mode: ${mode.label}. Enter a rank number to start guessing.`;
      answerEl.textContent = 'The correct rank will show here if you run out of guesses.';
      openEl.hidden = true;
      openEl.href = '#';
      openEl.onclick = null;
      input.value = '';
    }

    function finishRound(message, revealAnswer){
      state.active = false;
      statusEl.textContent = message;
      attemptsEl.textContent = `Tries left: ${state.triesLeft}`;
      answerEl.textContent = revealAnswer
        ? `${state.item.title} is ranked #${state.answer}.`
        : 'Correct. Start another round whenever you want.';
      if(state.item && state.item.url){
        openEl.hidden = false;
        openEl.href = '#';
        openEl.onclick = function(e){
          e.preventDefault();
          openVideoModal(state.item, {showRuns:false});
        };
      }
    }

    function startRound(){
      const mode = getSelectedMode();
      statusEl.textContent = 'Picking a level...';
      attemptsEl.textContent = `Tries left: ${mode.tries}`;
      feedbackEl.textContent = `Loading a ${mode.label.toLowerCase()} round.`;
      answerEl.textContent = 'You will get hints after each wrong guess.';
      openEl.hidden = true;
      openEl.onclick = null;
      input.value = '';
      loadItems().then(items=>{
        const rankedItems = getRankedItems(items);
        if(!rankedItems.length){
          resetGuessUi('No ranked levels were found.');
          feedbackEl.textContent = 'Add list data first, then start another round.';
          return;
        }
        const item = rankedItems[Math.floor(Math.random() * rankedItems.length)];
        state.active = true;
        state.triesLeft = mode.tries;
        state.answer = Number(item.position);
        state.item = item;
        statusEl.textContent = 'Guess this level\'s rank.';
        titleEl.textContent = item.title;
        attemptsEl.textContent = `Tries left: ${mode.tries}`;
        feedbackEl.textContent = `Mode: ${mode.label}. Guess the rank and I will tell you higher or lower.`;
        answerEl.textContent = 'The correct rank will show here if you run out of guesses.';
        input.value = '';
        input.focus();
      }).catch(err=>{
        console.error(err);
        resetGuessUi('Could not load the list for the guessing game.');
        feedbackEl.textContent = 'Try again after the list finishes loading.';
      });
    }

    function submitGuess(){
      if(!state.active || !state.item){
        feedbackEl.textContent = 'Start a round first so there is a level to guess.';
        return;
      }
      const rawGuess = input.value.trim();
      const guess = Number(rawGuess);
      if(!rawGuess || !Number.isInteger(guess) || guess < 1){
        feedbackEl.textContent = 'Enter a valid whole-number rank.';
        return;
      }
      if(guess === state.answer){
        feedbackEl.textContent = `Correct. ${state.item.title} is #${state.answer}.`;
        finishRound('You got it.', false);
        return;
      }
      state.triesLeft -= 1;
      attemptsEl.textContent = `Tries left: ${state.triesLeft}`;
      const direction = guess < state.answer ? 'Higher' : 'Lower';
      if(state.triesLeft > 0){
        feedbackEl.textContent = `${direction}. #${guess} is not the right spot.`;
        return;
      }
      feedbackEl.textContent = `${direction}. That was your last guess.`;
      finishRound('Round over.', true);
    }

    resetGuessUi('Start a round to get a level.');
    if(modeSelect){
      modeSelect.addEventListener('change', ()=>{
        if(!state.active) resetGuessUi('Start a round to get a level.');
      });
    }
    startBtn.addEventListener('click', startRound);
    form.addEventListener('submit', function(e){
      e.preventDefault();
      submitGuess();
    });
  }

  // Players page
  if(page==='players'){
    const playersArea = qs('players-area');
    const searchEl = qs('search');
    const filterSelect = qs('group-filter');
    const groupsEl = qs('player-groups');
    if(!playersArea || !searchEl || !filterSelect || !groupsEl) return;

    let players = [];

    function getGroupKey(name){
      const first = String(name || '').trim().charAt(0).toUpperCase();
      return first.match(/[A-Z0-9]/) ? first : '#';
    }

    function computeGroups(items){
      const set = new Set();
      items.forEach(item => set.add(getGroupKey(item.name)));
      return Array.from(set).sort((a,b)=> a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));
    }

    function setupGroups(items){
      const groups = computeGroups(items);
      groupsEl.innerHTML = '';
      filterSelect.innerHTML = '<option value="all">All players</option>';
      groups.forEach(group => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = group;
        btn.className = 'level-link';
        btn.addEventListener('click', () => {
          filterSelect.value = group;
          renderTable();
          groupsEl.querySelectorAll('.level-link').forEach(el=>el.classList.remove('active'));
          btn.classList.add('active');
        });
        li.appendChild(btn);
        groupsEl.appendChild(li);

        const opt = document.createElement('option');
        opt.value = group;
        opt.textContent = group;
        filterSelect.appendChild(opt);
      });
    }

    function buildPlayers(runs, listItems){
      const lookup = new Map(listItems.map(item => [String(item.title || '').toLowerCase(), Number(item.position) || 9999]));
      const map = new Map();
      runs.filter(run => String(run.status || '').toLowerCase() === 'approved').forEach(run => {
        const playerName = String(run.playerName || '').trim();
        if(!playerName) return;
        const key = playerName.toLowerCase();
        let entry = map.get(key);
        if(!entry){
          entry = {name: playerName, runs: 0, bestRank: 9999, topLevels: new Set()};
          map.set(key, entry);
        }
        entry.runs += 1;
        const rank = lookup.get(String(run.levelTitle || '').toLowerCase()) || 9999;
        if(rank > 0 && rank < entry.bestRank) entry.bestRank = rank;
        if(run.levelTitle) entry.topLevels.add(String(run.levelTitle).trim());
      });
      return Array.from(map.values()).map(entry => ({
        name: entry.name,
        runs: entry.runs,
        bestRank: entry.bestRank === 9999 ? '—' : `#${entry.bestRank}`,
        topLevels: Array.from(entry.topLevels).slice(0, 3).join(', ')
      })).sort((a,b) => {
        if(b.runs !== a.runs) return b.runs - a.runs;
        const aRank = typeof a.bestRank === 'string' ? Number(a.bestRank.slice(1)) || 9999 : a.bestRank;
        const bRank = typeof b.bestRank === 'string' ? Number(b.bestRank.slice(1)) || 9999 : b.bestRank;
        if(aRank !== bRank) return aRank - bRank;
        return a.name.localeCompare(b.name);
      });
    }

    function renderTable(){
      const query = String(searchEl.value || '').toLowerCase().trim();
      const filterValue = filterSelect.value || 'all';
      const filtered = players.filter(item => {
        if(filterValue !== 'all' && getGroupKey(item.name) !== filterValue) return false;
        if(!query) return true;
        return item.name.toLowerCase().includes(query);
      });

      playersArea.innerHTML = '';
      if(!filtered.length){
        playersArea.innerHTML = '<tr><td colspan="4" class="muted">No server players found.</td></tr>';
        return;
      }

      filtered.forEach(item => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td'); tdName.textContent = item.name;
        const tdRuns = document.createElement('td'); tdRuns.textContent = String(item.runs);
        const tdRank = document.createElement('td'); tdRank.textContent = item.bestRank;
        const tdLevels = document.createElement('td'); tdLevels.textContent = item.topLevels;
        tr.appendChild(tdName);
        tr.appendChild(tdRuns);
        tr.appendChild(tdRank);
        tr.appendChild(tdLevels);
        playersArea.appendChild(tr);
      });
    }

    function showLoading(){
      playersArea.innerHTML = '<tr><td colspan="4" class="muted">Loading player stats from server...</td></tr>';
    }

    function syncView(newPlayers){
      players = newPlayers;
      setupGroups(players);
      renderTable();
    }

    function loadPlayerStats(){
      showLoading();
      return Promise.all([loadRuns(), loadItems()])
        .then(([runs, items]) => {
          const computed = buildPlayers(runs, items);
          syncView(computed);
        })
        .catch(err => {
          console.error(err);
          playersArea.innerHTML = '<tr><td colspan="4" class="muted">Could not load server player stats.</td></tr>';
        });
    }

    searchEl.addEventListener('input', renderTable);
    filterSelect.addEventListener('change', () => {
      const activeBtn = Array.from(groupsEl.querySelectorAll('.level-link')).find(btn => btn.textContent === filterSelect.value);
      groupsEl.querySelectorAll('.level-link').forEach(btn => btn.classList.toggle('active', btn === activeBtn));
      renderTable();
    });

    loadPlayerStats();
    bindLiveUpdates();
    onRunsUpdate(() => {
      loadPlayerStats();
    });
    onLiveUpdate(() => {
      loadPlayerStats();
    });
  }

  function initListPage(){
    const levelsEl = qs('levels'); const listArea = qs('list-area'); const titleEl = qs('list-title');
    const searchEl = qs('search');
    const filterSelect = qs('level-filter');
    let currentItems = [];
    let controlsBound = false;
    // Load hard-coded data file data.txt (category|position|title|url per line)
    function loadData(){
      const run = ()=>{
        loadItems().then(items=>{
          applyItems(items);
        }).catch(err=>{listArea.innerHTML='<p class="muted">Failed to load list data - run via the Node server.</p>'; console.error(err)});
      };
      fedlRefreshAuthState()
        .then(()=> fedlPullUserStateToLocal(fedlServerUserId))
        .finally(run);
    }

    function computeCategories(items){
      const max = items.reduce((m,it)=>Math.max(m, Number(it.position)||0), 0);
      const cats = ['Full List'];
      for(let i=1;i<=max;i+=10){
        const start = i; const end = Math.min(i+9, max);
        cats.push(`Top ${start}-${end}`);
      }
      return cats;
    }

    function setupLevels(items){
      const categories = computeCategories(items);
      levelsEl.innerHTML='';
      filterSelect.innerHTML = '<option value="all">Full List</option>';
      categories.forEach(cat=>{
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = cat;
        btn.className = 'level-link';
        btn.addEventListener('click', ()=> {
          selectLevel(cat, items, btn);
          filterSelect.value = cat;
        });
        li.appendChild(btn);
        levelsEl.appendChild(li);

        const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; filterSelect.appendChild(opt);
      });
      if(!controlsBound){
        searchEl.addEventListener('input', ()=> renderTable(currentItems));
        filterSelect.addEventListener('change', ()=> renderTable(currentItems));
        controlsBound = true;
      }
    }

    function selectLevel(level, items, linkEl){
      levelsEl.querySelectorAll('.level-link').forEach(a=>a.classList.remove('active'));
      if(linkEl) linkEl.classList.add('active');
      qs('level-filter').value = level;
      renderTable(items);
    }

    function renderTable(items){
      const q = (searchEl && searchEl.value || '').toLowerCase();
      const levelFilter = (filterSelect && filterSelect.value) || 'all';
      const filtered = items.filter(it=>{
        // apply level / category filter (support range categories like "Top 1-10")
        if(levelFilter && levelFilter!=='all' && levelFilter!=='Full List'){
          const m = levelFilter.match(/Top\s*(\d+)-(\d+)/i);
          if(m){
            const s = Number(m[1]); const e = Number(m[2]); const pos = Number(it.position)||0;
            if(pos < s || pos > e) return false;
          }
        }
        if(!q) return true;
        return (it.title||'').toLowerCase().includes(q) || (it.level||'').toLowerCase().includes(q);
      }).sort((a,b)=> (Number(a.position)||0)-(Number(b.position)||0));

      const tbody = qs('list-area'); tbody.innerHTML='';
      const accId = fedlDataUserId();
      filtered.forEach(it=>{
        const tr = document.createElement('tr');
        const tdNum = document.createElement('td'); tdNum.textContent = it.position;
        const tdTitle = document.createElement('td'); tdTitle.textContent = it.title;
        const tdPct = document.createElement('td');
        tdPct.className = 'list-my-progress-cell';
        if(accId){
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'list-progress-input';
          inp.value = fedlGetLevelPercent(accId, it.title) || '';
          inp.placeholder = '%';
          inp.title = 'Your progress for this level (this browser)';
          inp.addEventListener('change', ()=>{
            fedlSetLevelPercent(accId, it.title, inp.value);
          });
          tdPct.appendChild(inp);
        }else{
          const span = document.createElement('span');
          span.className = 'muted';
          span.textContent = '—';
          span.title = 'Create a profile on the Roulette page to save progress';
          tdPct.appendChild(span);
        }
        const tdAct = document.createElement('td');
        const a = document.createElement('a'); a.textContent='Open'; a.href='#'; a.className='btn';
        a.addEventListener('click', (e)=>{e.preventDefault(); openVideoModal(it, {showRuns:true})});
        tdAct.appendChild(a);
        tr.appendChild(tdNum); tr.appendChild(tdTitle); tr.appendChild(tdPct); tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
    }

    function applyItems(items){
      const previousFilter = filterSelect.value || 'all';
      currentItems = items.slice();
      setupLevels(currentItems);
      const availableFilters = Array.from(filterSelect.options).map(option=>option.value);
      filterSelect.value = availableFilters.includes(previousFilter) ? previousFilter : 'all';
      const activeText = filterSelect.value === 'all' ? 'Full List' : filterSelect.value;
      levelsEl.querySelectorAll('.level-link').forEach(btn=>{
        btn.classList.toggle('active', btn.textContent === activeText);
      });
      renderTable(currentItems);
    }

    loadData();
    return {applyItems};
  }

  // Lists page
  if(page==='lists'){
    const listPage = initListPage();
    document.addEventListener('fedl-auth-updated', ()=>{
      loadItems().then(items=>listPage.applyItems(items)).catch(()=>{});
    });
    bindLiveUpdates();
    onLiveUpdate(function(updatedItems){
      listPage.applyItems(updatedItems);
    });
  }

  if(page==='admelist'){
    const loginScreenEl = qs('admin-login-screen');
    const adminShellContentEl = qs('admin-shell-content');
    const loginFormEl = qs('admin-login-form');
    const statusEl = qs('admin-status');
    const listTbody = qs('admin-list-body');
    const addBtn = qs('add-row');
    const saveBtn = qs('save-list');
    const searchEl = qs('admin-search');
    const adminPasswordEl = qs('admin-password');
    const authStatusEl = qs('admin-auth-status');
    const runsStatusEl = qs('runs-admin-status');
    const runsTbody = qs('run-admin-body');
    const runSearchEl = qs('run-search');
    const importStatusEl = qs('import-status');
    const importPointercrateBtn = qs('import-pointercrate');
    const importAredlBtn = qs('import-aredl');
    const importTargetedOpenBtn = qs('import-targeted-open');
    const importTargetedModal = qs('import-targeted-modal');
    const importTargetedForm = qs('import-targeted-form');
    const importTargetedSourceEl = qs('import-targeted-source');
    const importTargetedQueryEl = qs('import-targeted-query');
    const importTargetedQueryLabelEl = qs('import-targeted-query-label');
    const importTargetedSubmitBtn = qs('import-targeted-submit');
    const importTargetedCancelBtn = qs('import-targeted-cancel');
    const bulkApproveOpenBtn = qs('bulk-approve-open');
    const bulkApproveModal = qs('bulk-approve-modal');
    const bulkApproveForm = qs('bulk-approve-form');
    const bulkApprovePlayerInput = qs('bulk-approve-player');
    const bulkApproveNotesInput = qs('bulk-approve-notes');
    const bulkApprovePreviewEl = qs('bulk-approve-preview');
    const bulkApproveCancelBtn = qs('bulk-approve-cancel');
    const bulkApproveSubmitBtn = qs('bulk-approve-submit');
    let items = [];
    let runs = [];
    const adminPasswordKey = 'fedl_admin_password';

    function getAdminPassword(){
      try{return sessionStorage.getItem(adminPasswordKey) || '';}
      catch(e){return '';}
    }

    function setAdminPassword(password){
      try{
        if(password) sessionStorage.setItem(adminPasswordKey, password);
        else sessionStorage.removeItem(adminPasswordKey);
      }catch(e){}
      if(adminPasswordEl) adminPasswordEl.value = password;
      if(authStatusEl){
        authStatusEl.textContent = password
          ? 'Password saved for this browser session.'
          : 'Saved only in this browser session.';
        if(password) authStatusEl.classList.remove('error-text');
      }
    }

    function authHeaders(extraHeaders){
      const headers = Object.assign({}, extraHeaders || {});
      const password = getAdminPassword();
      if(password){
        headers.Authorization = `Basic ${btoa(`fedl:${password}`)}`;
      }
      return headers;
    }

    function handleAdminAuthFailure(message, targetSetter){
      setAdminPassword('');
      document.body.classList.add('admin-locked');
      if(adminShellContentEl) adminShellContentEl.hidden = true;
      if(loginScreenEl) loginScreenEl.hidden = false;
      targetSetter(message || 'Admin password required or incorrect.', true);
    }

    function unlockAdminShell(){
      document.body.classList.remove('admin-locked');
      if(loginScreenEl) loginScreenEl.hidden = true;
      if(adminShellContentEl) adminShellContentEl.hidden = false;
    }

    function verifyAdminPassword(){
      if(!getAdminPassword()){
        handleAdminAuthFailure('Enter the admin password to continue.', function(message, isError){
          if(!authStatusEl) return;
          authStatusEl.textContent = message;
          authStatusEl.classList.toggle('error-text', !!isError);
        });
        return Promise.resolve(false);
      }
      return fetch(`${liveRunsUrl}/__authcheck__`, {
        method:'DELETE',
        headers:authHeaders()
      }).then(r=>{
        if(r.status === 401) throw new Error('Admin auth failed');
        if(r.status !== 404) throw new Error('Admin verify failed');
        return true;
      }).then(ok=>{
        unlockAdminShell();
        if(authStatusEl){
          authStatusEl.textContent = 'Access granted for this browser session.';
          authStatusEl.classList.remove('error-text');
        }
        loadAdmin();
        loadRunsAdmin();
        return ok;
      }).catch(err=>{
        console.error(err);
        handleAdminAuthFailure('Wrong admin password. Try again.', function(message, isError){
          if(!authStatusEl) return;
          authStatusEl.textContent = message;
          authStatusEl.classList.toggle('error-text', !!isError);
        });
        return false;
      });
    }

    function setStatus(message, isError){
      if(!statusEl) return;
      statusEl.textContent = message;
      statusEl.classList.toggle('error-text', !!isError);
    }

    function setRunsStatus(message, isError){
      if(!runsStatusEl) return;
      runsStatusEl.textContent = message;
      runsStatusEl.classList.toggle('error-text', !!isError);
    }

    function filteredItems(){
      const query = (searchEl && searchEl.value || '').trim().toLowerCase();
      if(!query) return items;
      return items.filter(item=>{
        return [item.level, item.position, item.title, item.url].some(value=>
          String(value || '').toLowerCase().includes(query)
        );
      });
    }

    function normalizePositions(){
      let position = 1;
      items.forEach(item=>{
        if(item._isDraft){
          item.position = '';
          return;
        }
        item.position = String(position);
        position += 1;
      });
    }

    function moveItemToPosition(index, rawPosition){
      if(!items[index]) return;
      const parsedPosition = Number(rawPosition);
      if(!Number.isFinite(parsedPosition) || parsedPosition < 1) return;
      const nextPosition = Math.max(1, parsedPosition);
      const [item] = items.splice(index, 1);
      item._isDraft = false;
      const drafts = items.filter(entry=>entry._isDraft);
      const ranked = items.filter(entry=>!entry._isDraft);
      const targetIndex = Math.min(ranked.length, nextPosition - 1);
      ranked.splice(targetIndex, 0, item);
      items = drafts.concat(ranked);
      normalizePositions();
    }

    function renderAdminTable(){
      const rows = filteredItems();
      listTbody.innerHTML = '';
      rows.forEach(item=>{
        const actualIndex = items.indexOf(item);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input data-field="position" data-index="${actualIndex}" type="number" min="1" value="${escapeAttr(item.position)}"></td>
          <td><input data-field="level" data-index="${actualIndex}" type="text" value="${escapeAttr(item.level)}"></td>
          <td><input data-field="title" data-index="${actualIndex}" type="text" value="${escapeAttr(item.title)}"></td>
          <td><input data-field="url" data-index="${actualIndex}" type="url" value="${escapeAttr(item.url)}"></td>
          <td><button type="button" class="btn danger-btn small-btn" data-delete="${actualIndex}">Delete</button></td>
        `;
        listTbody.appendChild(tr);
      });
      if(!rows.length){
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5" class="muted">No rows match your search.</td>';
        listTbody.appendChild(tr);
      }
    }

    function filteredRuns(){
      const query = (runSearchEl && runSearchEl.value || '').trim().toLowerCase();
      if(!query) return runs;
      return runs.filter(run=>{
        return [
          run.status,
          run.playerName,
          run.levelTitle,
          run.videoUrl,
          run.rawFootageUrl,
          run.notes,
          run.reviewNotes
        ].some(value=>String(value || '').toLowerCase().includes(query));
      });
    }

    function formatDate(value){
      if(!value) return 'Unknown';
      const date = new Date(value);
      if(Number.isNaN(date.getTime())) return 'Unknown';
      return date.toLocaleString();
    }

    function renderRunsTable(){
      const rows = filteredRuns();
      runsTbody.innerHTML = '';
      rows.forEach(run=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="status-pill status-${escapeAttr(run.status || 'pending')}">${escapeHtml(run.status || 'pending')}</span></td>
          <td><strong>${escapeHtml(run.playerName || 'Unknown')}</strong></td>
          <td><strong>${escapeHtml(run.percent || '100')}%</strong></td>
          <td>
            <div class="run-admin-cell">
              <strong>${escapeHtml(run.levelTitle || 'Untitled')}</strong>
              <span class="muted small">${escapeHtml(run.notes || 'No submission notes.')}</span>
            </div>
          </td>
          <td>${escapeHtml(formatDate(run.submittedAt))}</td>
          <td>
            <div class="run-admin-actions">
              <a class="btn ghost-btn small-btn" href="${escapeAttr(run.videoUrl || '#')}" target="_blank" rel="noopener noreferrer">Video</a>
              <button type="button" class="btn ghost-btn small-btn" data-run-action="approved" data-run-id="${escapeAttr(run.id)}">Approve</button>
              <button type="button" class="btn ghost-btn small-btn" data-run-action="rejected" data-run-id="${escapeAttr(run.id)}">Reject</button>
              <button type="button" class="btn danger-btn small-btn" data-run-delete="${escapeAttr(run.id)}">Delete</button>
            </div>
          </td>
        `;
        runsTbody.appendChild(tr);

        const detailRow = document.createElement('tr');
        detailRow.className = 'run-admin-detail-row';
        detailRow.innerHTML = `
          <td colspan="6">
            <div class="run-admin-detail">
              <span><strong>Raw:</strong> ${run.rawFootageUrl ? `<a href="${escapeAttr(run.rawFootageUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(run.rawFootageUrl)}</a>` : 'None provided'}</span>
              <span><strong>Percent:</strong> ${escapeHtml(run.percent || '100')}%</span>
              <span><strong>Reviewed by:</strong> ${escapeHtml(run.reviewedBy || 'Unassigned')}</span>
              <span><strong>Review notes:</strong> ${escapeHtml(run.reviewNotes || 'No review notes yet.')}</span>
            </div>
          </td>
        `;
        runsTbody.appendChild(detailRow);
      });
      if(!rows.length){
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" class="muted">No run submissions match your search.</td>';
        runsTbody.appendChild(tr);
      }
    }

    function saveItems(){
      if(!canUseLiveServer){
        setStatus('Start the Node server to save the live list.', true);
        return Promise.resolve();
      }
      const hasUnplacedDraft = items.some(item=>{
        const hasContent = String(item.title || '').trim() || String(item.url || '').trim() || String(item.level || '').trim();
        return item._isDraft && hasContent;
      });
      if(hasUnplacedDraft){
        setStatus('Give each new row a number before saving.', true);
        return Promise.resolve();
      }
      items = items
        .map(item=>({
          level: String(item.level || '').trim() || 'new',
          position: String(item.position || '').trim(),
          title: String(item.title || '').trim(),
          url: String(item.url || '').trim()
        }))
        .filter(item=>item.title);
      normalizePositions();
      return fetch(liveApiUrl, {
        method:'PUT',
        headers:authHeaders({'Content-Type':'application/json'}),
        body: JSON.stringify({text: formatData(items)})
      }).then(r=>{
        if(r.status === 401) throw new Error('Admin auth failed');
        if(!r.ok) throw new Error('Save failed');
        clearItemsCache();
        renderAdminTable();
        setStatus('Saved. Live pages update automatically.');
      }).catch(err=>{
        console.error(err);
        if(String(err && err.message || '') === 'Admin auth failed'){
          handleAdminAuthFailure('Wrong admin password. Enter it above, then try again.', setStatus);
          return;
        }
        setStatus('Could not save. Check the live server endpoint.', true);
      });
    }

    function loadAdmin(){
      loadItems().then(loaded=>{
        items = loaded.slice().sort((a,b)=>(Number(a.position) || 0) - (Number(b.position) || 0)).map(item=>({
          level: item.level,
          position: item.position,
          title: item.title,
          url: item.url,
          _isDraft: false
        }));
        normalizePositions();
        renderAdminTable();
        setStatus('Connected to live list data.');
        updateStats();
      }).catch(err=>{
        console.error(err);
        setStatus('Could not load list data.', true);
      });
    }

    function loadRunsAdmin(){
      loadRuns().then(loadedRuns=>{
        runs = loadedRuns.slice().sort((a,b)=>new Date(b.submittedAt) - new Date(a.submittedAt));
        renderRunsTable();
        setRunsStatus('Connected to live run submissions.');
        updateStats();
      }).catch(err=>{
        console.error(err);
        setRunsStatus('Could not load run submissions.', true);
      });
    }

    function updateRunStatus(runId, status){
      if(!canUseLiveServer){
        setRunsStatus('Start the Node server to review submissions.', true);
        return;
      }
      const run = runs.find(entry=>entry.id === runId);
      if(!run) return;
      const reviewNotes = window.prompt(`Review notes for ${run.levelTitle} (${status})`, run.reviewNotes || '');
      if(reviewNotes === null) return;
      fetch(`${liveRunsUrl}/${encodeURIComponent(runId)}`, {
        method:'PUT',
        headers:authHeaders({'Content-Type':'application/json'}),
        body: JSON.stringify({
          ...run,
          status,
          reviewNotes,
          reviewedBy:'FEDL Admin'
        })
      }).then(r=>{
        if(r.status === 401) throw new Error('Admin auth failed');
        if(!r.ok) throw new Error('Run update failed');
        clearRunsCache();
        setRunsStatus(`Run marked ${status}.`);
        return refreshRuns();
      }).catch(err=>{
        console.error(err);
        if(String(err && err.message || '') === 'Admin auth failed'){
          handleAdminAuthFailure('Wrong admin password. Enter it above to review runs.', setRunsStatus);
          return;
        }
        setRunsStatus('Could not update that run.', true);
      });
    }

    function deleteRun(runId){
      if(!canUseLiveServer){
        setRunsStatus('Start the Node server to delete submissions.', true);
        return;
      }
      fetch(`${liveRunsUrl}/${encodeURIComponent(runId)}`, {
        method:'DELETE',
        headers:authHeaders()
      }).then(r=>{
        if(r.status === 401) throw new Error('Admin auth failed');
        if(!r.ok) throw new Error('Run delete failed');
        clearRunsCache();
        setRunsStatus('Run removed from the queue.');
        return refreshRuns();
      }).catch(err=>{
        console.error(err);
        if(String(err && err.message || '') === 'Admin auth failed'){
          handleAdminAuthFailure('Wrong admin password. Enter it above to delete runs.', setRunsStatus);
          return;
        }
        setRunsStatus('Could not delete that run.', true);
      });
    }

    listTbody.addEventListener('input', function(event){
      const target = event.target;
      const field = target.getAttribute('data-field');
      const index = Number(target.getAttribute('data-index'));
      if(!field || Number.isNaN(index) || !items[index]) return;
      if(field === 'position') return;
      items[index][field] = target.value;
      setStatus('Unsaved changes');
    });

    listTbody.addEventListener('focusout', function(event){
      const target = event.target;
      if(!(target instanceof HTMLElement)) return;
      const field = target.getAttribute('data-field');
      const index = Number(target.getAttribute('data-index'));
      if(field !== 'position' || Number.isNaN(index) || !items[index]) return;
      moveItemToPosition(index, target.value);
      renderAdminTable();
      setStatus('Unsaved changes');
    });

    listTbody.addEventListener('click', function(event){
      const deleteButton = event.target.closest('[data-delete]');
      if(!deleteButton) return;
      const deleteIndex = deleteButton.getAttribute('data-delete');
      if(deleteIndex == null) return;
      const index = Number(deleteIndex);
      if(Number.isNaN(index)) return;
      items.splice(index, 1);
      normalizePositions();
      renderAdminTable();
      setStatus('Row removed. Save when ready.');
    });

    runsTbody.addEventListener('click', function(event){
      const actionButton = event.target.closest('[data-run-action]');
      if(actionButton){
        updateRunStatus(
          actionButton.getAttribute('data-run-id'),
          actionButton.getAttribute('data-run-action')
        );
        return;
      }
      const deleteButton = event.target.closest('[data-run-delete]');
      if(deleteButton){
        const runId = deleteButton.getAttribute('data-run-delete');
        if(runId && window.confirm('Delete this run submission?')){
          deleteRun(runId);
        }
      }
    });

    addBtn.addEventListener('click', function(){
      items.unshift({level:'new', position:'', title:'', url:'', _isDraft:true});
      normalizePositions();
      renderAdminTable();
      setStatus('New row added at the top. Give it a number when you want to place it.');
    });

    saveBtn.addEventListener('click', function(){
      saveItems();
    });

    if(searchEl){
      searchEl.addEventListener('input', renderAdminTable);
    }
    if(runSearchEl){
      runSearchEl.addEventListener('input', renderRunsTable);
    }
    if(adminPasswordEl){
      setAdminPassword(getAdminPassword());
    }

    function setImportStatus(message, isError){
      if(!importStatusEl) return;
      importStatusEl.textContent = message;
      importStatusEl.classList.toggle('error-text', !!isError);
    }

    function toggleImportButtons(enabled){
      [importPointercrateBtn, importAredlBtn, importTargetedOpenBtn, bulkApproveOpenBtn].forEach(btn=>{ if(btn) btn.disabled = !enabled; });
    }

    function updateImportTargetedQueryLabel(){
      if(!importTargetedQueryLabelEl) return;
      const levelRadio = document.querySelector('input[name="import-targeted-filter"][value="level"]');
      const isLevel = levelRadio && levelRadio.checked;
      importTargetedQueryLabelEl.textContent = isLevel ? 'Level name or id' : 'Player name';
      if(importTargetedQueryEl){
        importTargetedQueryEl.placeholder = isLevel ? 'e.g. Acheron or demon id' : 'Name as on the list';
      }
    }
    function openImportTargetedModal(){
      if(!importTargetedModal) return;
      importTargetedModal.hidden = false;
      if(importTargetedForm) importTargetedForm.reset();
      const playerRadio = document.querySelector('input[name="import-targeted-filter"][value="player"]');
      if(playerRadio) playerRadio.checked = true;
      updateImportTargetedQueryLabel();
      if(importTargetedQueryEl) importTargetedQueryEl.focus();
    }
    function closeImportTargetedModal(){
      if(importTargetedModal) importTargetedModal.hidden = true;
    }
    function submitImportTargeted(event){
      event.preventDefault();
      if(!canUseLiveServer){
        setImportStatus('Start the Node server to use the import tool.', true);
        return;
      }
      const source = importTargetedSourceEl && String(importTargetedSourceEl.value || '').trim();
      const filterRadio = document.querySelector('input[name="import-targeted-filter"]:checked');
      const filter = filterRadio && String(filterRadio.value || '').trim();
      const query = importTargetedQueryEl && String(importTargetedQueryEl.value || '').trim();
      if(!source || !filter || !query) return;
      if(importTargetedSubmitBtn) importTargetedSubmitBtn.disabled = true;
      setImportStatus(`Fetching ${source} records…`);
      toggleImportButtons(false);
      fetch(liveApiPath('/api/import/targeted'), {
        method: 'POST',
        headers: authHeaders({'Content-Type':'application/json'}),
        body: JSON.stringify({ source, filter, query })
      }).then(async response=>{
        const payload = await response.json().catch(()=>({}));
        if(response.status === 401) throw new Error('Admin auth failed');
        if(!response.ok) throw new Error(payload.error || `Import failed (${response.status})`);
        return payload;
      }).then(payload=>{
        clearRunsCache();
        const matched = Number(payload.matched) || 0;
        const added = Number(payload.added) || 0;
        const skipped = Number(payload.skipped) || 0;
        setImportStatus(
          `Targeted import: ${matched} API record${matched === 1 ? '' : 's'} matched, ${added} added, ${skipped} skipped (duplicates or missing video). Notes set to “Valid run”.`
        );
        closeImportTargetedModal();
        return refreshRuns();
      }).catch(err=>{
        console.error(err);
        if(String(err && err.message || '') === 'Admin auth failed'){
          handleAdminAuthFailure('Wrong admin password. Enter it above, then try again.', setImportStatus);
          closeImportTargetedModal();
          return;
        }
        setImportStatus(err.message || 'Targeted import failed.', true);
      }).finally(()=>{
        if(importTargetedSubmitBtn) importTargetedSubmitBtn.disabled = false;
        toggleImportButtons(true);
      });
    }

    let bulkApprovePreviewTimer = null;
    function countPendingRunsForPlayer(name){
      const q = String(name || '').trim().toLowerCase();
      if(!q) return 0;
      return runs.filter(run=>{
        const st = String(run.status || 'pending').toLowerCase();
        const pn = String(run.playerName || '').trim().toLowerCase();
        return st === 'pending' && pn === q;
      }).length;
    }
    function updateBulkApprovePreview(){
      if(!bulkApprovePreviewEl || !bulkApprovePlayerInput) return;
      const n = countPendingRunsForPlayer(bulkApprovePlayerInput.value);
      const label = String(bulkApprovePlayerInput.value || '').trim();
      if(!label){
        bulkApprovePreviewEl.textContent = '';
        return;
      }
      bulkApprovePreviewEl.textContent = n
        ? `${n} pending run${n === 1 ? '' : 's'} match this name in the current queue.`
        : 'No pending runs match this name in the current queue.';
    }
    function openBulkApproveModal(){
      if(!bulkApproveModal) return;
      bulkApproveModal.hidden = false;
      if(bulkApproveForm) bulkApproveForm.reset();
      updateBulkApprovePreview();
      if(bulkApprovePlayerInput){
        bulkApprovePlayerInput.focus();
      }
    }
    function closeBulkApproveModal(){
      if(bulkApproveModal) bulkApproveModal.hidden = true;
      if(bulkApprovePreviewTimer){
        clearTimeout(bulkApprovePreviewTimer);
        bulkApprovePreviewTimer = null;
      }
    }
    function submitBulkApprove(event){
      event.preventDefault();
      if(!canUseLiveServer){
        setImportStatus('Start the Node server to use the import tool.', true);
        return;
      }
      const playerName = bulkApprovePlayerInput && String(bulkApprovePlayerInput.value || '').trim();
      if(!playerName) return;
      const reviewNotesRaw = bulkApproveNotesInput && String(bulkApproveNotesInput.value || '').trim();
      const body = { playerName };
      if(reviewNotesRaw) body.reviewNotes = reviewNotesRaw;
      if(bulkApproveSubmitBtn) bulkApproveSubmitBtn.disabled = true;
      setImportStatus('Bulk-approving pending runs for that player...');
      fetch(`${liveRunsUrl}/bulk-approve`, {
        method: 'POST',
        headers: authHeaders({'Content-Type':'application/json'}),
        body: JSON.stringify(body)
      }).then(async response=>{
        const payload = await response.json().catch(()=>({}));
        if(response.status === 401) throw new Error('Admin auth failed');
        if(!response.ok) throw new Error(payload.error || `Bulk approve failed (${response.status})`);
        return payload;
      }).then(payload=>{
        clearRunsCache();
        const n = Number(payload.approved) || 0;
        setImportStatus(n ? `Bulk approve done: ${n} pending run${n === 1 ? '' : 's'} approved for ${playerName}.` : `No pending runs to approve for ${playerName}.`);
        closeBulkApproveModal();
        return refreshRuns();
      }).catch(err=>{
        console.error(err);
        if(String(err && err.message || '') === 'Admin auth failed'){
          handleAdminAuthFailure('Wrong admin password. Enter it above, then try again.', setImportStatus);
          closeBulkApproveModal();
          return;
        }
        setImportStatus(err.message || 'Bulk approve failed.', true);
      }).finally(()=>{
        if(bulkApproveSubmitBtn) bulkApproveSubmitBtn.disabled = false;
      });
    }

    function runImport(path, label){
      setImportStatus(`Importing ${label} runs...`);
      toggleImportButtons(false);
      return fetch(liveApiPath(path), {
        method: 'POST',
        headers: authHeaders({'Content-Type':'application/json'})
      }).then(async response => {
        const payload = await response.json().catch(()=>({}));
        if(response.status === 401){
          throw new Error('Admin auth failed');
        }
        if(!response.ok){
          throw new Error(payload.error || `Import failed with status ${response.status}`);
        }
        return payload;
      }).then(payload => {
        setImportStatus(`${label} import complete. Added ${payload.added || 0} runs, skipped ${payload.skipped || 0}.`);
        refreshRuns().catch(()=>{});
      }).catch(error => {
        console.error(error);
        if(error.message === 'Admin auth failed'){
          handleAdminAuthFailure('Wrong admin password. Enter it above, then try again.', setImportStatus);
          return;
        }
        setImportStatus(error.message || 'Import failed.', true);
      }).finally(()=>{
        toggleImportButtons(true);
      });
    }

    if(importPointercrateBtn){
      importPointercrateBtn.addEventListener('click', ()=> runImport('/api/import/pointercrate', 'Pointercrate'));
    }
    if(importAredlBtn){
      importAredlBtn.addEventListener('click', ()=> runImport('/api/import/aredl', 'AREDL'));
    }

    if(importTargetedOpenBtn){
      importTargetedOpenBtn.addEventListener('click', ()=> openImportTargetedModal());
    }
    if(importTargetedCancelBtn){
      importTargetedCancelBtn.addEventListener('click', ()=> closeImportTargetedModal());
    }
    if(importTargetedModal){
      importTargetedModal.addEventListener('click', event=>{
        if(event.target === importTargetedModal) closeImportTargetedModal();
      });
    }
    if(importTargetedForm){
      importTargetedForm.addEventListener('submit', submitImportTargeted);
      importTargetedForm.querySelectorAll('input[name="import-targeted-filter"]').forEach(radio=>{
        radio.addEventListener('change', updateImportTargetedQueryLabel);
      });
    }

    if(bulkApproveOpenBtn){
      bulkApproveOpenBtn.addEventListener('click', ()=> openBulkApproveModal());
    }
    if(bulkApproveCancelBtn){
      bulkApproveCancelBtn.addEventListener('click', ()=> closeBulkApproveModal());
    }
    if(bulkApproveModal){
      bulkApproveModal.addEventListener('click', event=>{
        if(event.target === bulkApproveModal) closeBulkApproveModal();
      });
    }
    if(bulkApproveForm){
      bulkApproveForm.addEventListener('submit', submitBulkApprove);
    }
    if(bulkApprovePlayerInput){
      bulkApprovePlayerInput.addEventListener('input', ()=>{
        if(bulkApprovePreviewTimer) clearTimeout(bulkApprovePreviewTimer);
        bulkApprovePreviewTimer = setTimeout(updateBulkApprovePreview, 200);
      });
    }
    document.addEventListener('keydown', event=>{
      if(event.key !== 'Escape') return;
      if(importTargetedModal && !importTargetedModal.hidden){
        closeImportTargetedModal();
        return;
      }
      if(bulkApproveModal && !bulkApproveModal.hidden) closeBulkApproveModal();
    });

    if(loginFormEl){
      loginFormEl.addEventListener('submit', function(event){
        event.preventDefault();
        setAdminPassword((adminPasswordEl && adminPasswordEl.value || '').trim());
        if(authStatusEl){
          authStatusEl.textContent = 'Checking password...';
          authStatusEl.classList.remove('error-text');
        }
        verifyAdminPassword();
      });
    }

    bindLiveUpdates();
    onLiveUpdate(function(updatedItems){
      items = updatedItems.slice().sort((a,b)=>(Number(a.position) || 0) - (Number(b.position) || 0)).map(item=>({
        level: item.level,
        position: item.position,
        title: item.title,
        url: item.url,
        _isDraft: false
      }));
      normalizePositions();
      renderAdminTable();
      setStatus('List reloaded from live server.');
    });
    onRunsUpdate(function(updatedRuns){
      runs = updatedRuns.slice().sort((a,b)=>new Date(b.submittedAt) - new Date(a.submittedAt));
      renderRunsTable();
      setRunsStatus('Run queue reloaded from the live server.');
    });

    if(getAdminPassword()){
      verifyAdminPassword();
    }else{
      handleAdminAuthFailure('Enter the admin password to continue.', function(message, isError){
        if(!authStatusEl) return;
        authStatusEl.textContent = message;
        authStatusEl.classList.toggle('error-text', !!isError);
      });
    }

    const bugReportsBody = qs('bug-reports-body');
    const bugReportSearchEl = qs('bug-report-search');
    const bugReportsStatusEl = qs('bug-reports-admin-status');
    let bugReports = [];

    function setBugReportsStatus(message, isError){
      if(!bugReportsStatusEl) return;
      bugReportsStatusEl.textContent = message;
      bugReportsStatusEl.classList.toggle('error-text', !!isError);
    }

    function loadBugReports(){
      if(!canUseLiveServer){
        setBugReportsStatus('Start the Node server to load bug reports.', true);
        return Promise.resolve([]);
      }
      return fetch(`${liveServerBase}/api/bugreports`, {
        method: 'GET',
        headers: authHeaders()
      }).then(r=>{
        if(r.status === 401) throw new Error('Admin auth failed');
        if(!r.ok) throw new Error('Failed to load bug reports');
        return r.json();
      }).then(payload=>{
        return Array.isArray(payload.items) ? payload.items : [];
      }).catch(err=>{
        console.error(err);
        setBugReportsStatus('Could not load bug reports.', true);
        return [];
      });
    }

    function refreshBugReports(){
      return loadBugReports().then(loaded=>{
        bugReports = loaded.slice().sort((a,b)=>new Date(b.submittedAt) - new Date(a.submittedAt));
        renderBugReportsTable();
        updateStats();
      });
    }

    function filteredBugReports(){
      const query = (bugReportSearchEl && bugReportSearchEl.value || '').trim().toLowerCase();
      if(!query) return bugReports;
      return bugReports.filter(report=>{
        return [
          report.category,
          report.status,
          report.subject,
          report.description,
          report.accountUsername
        ].some(value=>String(value || '').toLowerCase().includes(query));
      });
    }

    function renderBugReportsTable(){
      const rows = filteredBugReports();
      if(!bugReportsBody) return;
      bugReportsBody.innerHTML = '';
      rows.forEach(report=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="status-pill status-${escapeAttr(report.category || 'other')}">${escapeHtml(report.category || 'other')}</span></td>
          <td><span class="status-pill status-${escapeAttr(report.status || 'open')}">${escapeHtml(report.status || 'open')}</span></td>
          <td><strong>${escapeHtml(report.accountUsername || 'Anonymous')}</strong></td>
          <td>
            <div class="run-admin-cell">
              <strong>${escapeHtml(report.subject || 'Untitled')}</strong>
              <span class="muted small">${escapeHtml((report.description || '').slice(0, 100))}${report.description && report.description.length > 100 ? '...' : ''}</span>
            </div>
          </td>
          <td>${escapeHtml(formatDate(report.submittedAt))}</td>
          <td>
            <div class="run-admin-actions">
              <button type="button" class="btn ghost-btn small-btn" data-bug-action="resolved" data-bug-id="${escapeAttr(report.id)}">Resolve</button>
              <button type="button" class="btn danger-btn small-btn" data-bug-delete="${escapeAttr(report.id)}">Delete</button>
            </div>
          </td>
        `;
        bugReportsBody.appendChild(tr);

        const detailRow = document.createElement('tr');
        detailRow.className = 'bug-report-detail-row';
        detailRow.innerHTML = `
          <td colspan="6">
            <div class="bug-report-detail">
              <span><strong>Email:</strong> ${report.email ? escapeHtml(report.email) : 'Not provided'}</span>
              <span><strong>Description:</strong> ${escapeHtml(report.description || 'No description')}</span>
            </div>
          </td>
        `;
        bugReportsBody.appendChild(detailRow);
      });
      if(!rows.length){
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" class="muted">No bug reports match your search.</td>';
        bugReportsBody.appendChild(tr);
      }
    }

    function updateBugReportStatus(reportId, status){
      if(!canUseLiveServer){
        setBugReportsStatus('Start the Node server to update bug reports.', true);
        return;
      }
      const report = bugReports.find(entry=>entry.id === reportId);
      if(!report) return;
      fetch(`${liveServerBase}/api/bugreports/${encodeURIComponent(reportId)}`, {
        method:'PUT',
        headers:authHeaders({'Content-Type':'application/json'}),
        body: JSON.stringify({
          ...report,
          status
        })
      }).then(r=>{
        if(r.status === 401) throw new Error('Admin auth failed');
        if(!r.ok) throw new Error('Bug report update failed');
        return refreshBugReports();
      }).then(()=>{
        setBugReportsStatus(`Bug report marked ${status}.`);
      }).catch(err=>{
        console.error(err);
        if(String(err && err.message || '') === 'Admin auth failed'){
          handleAdminAuthFailure('Wrong admin password. Enter it above to update bug reports.', setBugReportsStatus);
          return;
        }
        setBugReportsStatus('Could not update that bug report.', true);
      });
    }

    function deleteBugReport(reportId){
      if(!canUseLiveServer){
        setBugReportsStatus('Start the Node server to delete bug reports.', true);
        return;
      }
      fetch(`${liveServerBase}/api/bugreports/${encodeURIComponent(reportId)}`, {
        method:'DELETE',
        headers:authHeaders()
      }).then(r=>{
        if(r.status === 401) throw new Error('Admin auth failed');
        if(!r.ok) throw new Error('Bug report delete failed');
        return refreshBugReports();
      }).then(()=>{
        setBugReportsStatus('Bug report removed.');
      }).catch(err=>{
        console.error(err);
        if(String(err && err.message || '') === 'Admin auth failed'){
          handleAdminAuthFailure('Wrong admin password. Enter it above to delete bug reports.', setBugReportsStatus);
          return;
        }
        setBugReportsStatus('Could not delete that bug report.', true);
      });
    }

    if(bugReportsBody){
      bugReportsBody.addEventListener('click', function(event){
        const actionButton = event.target.closest('[data-bug-action]');
        if(actionButton){
          updateBugReportStatus(
            actionButton.getAttribute('data-bug-id'),
            actionButton.getAttribute('data-bug-action')
          );
          return;
        }
        const deleteButton = event.target.closest('[data-bug-delete]');
        if(deleteButton){
          const reportId = deleteButton.getAttribute('data-bug-delete');
          if(reportId && window.confirm('Delete this bug report?')){
            deleteBugReport(reportId);
          }
        }
      });
    }

    if(bugReportSearchEl){
      bugReportSearchEl.addEventListener('input', renderBugReportsTable);
    }

    function updateStats(){
      const totalRuns = Array.isArray(runs) ? runs.length : 0;
      const pendingRuns = Array.isArray(runs) ? runs.filter(r=>String(r.status || '').toLowerCase() === 'pending').length : 0;
      const levelsCount = items ? items.filter(i=>i && i.title && !i._isDraft).length : 0;
      const openReports = Array.isArray(bugReports) ? bugReports.filter(r=>String(r.status || '').toLowerCase() === 'open').length : 0;
      const statTotalRuns = qs('stat-total-runs');
      const statPendingRuns = qs('stat-pending-runs');
      const statLevelsCount = qs('stat-levels-count');
      const statBugReports = qs('stat-bug-reports');
      const statsStatusEl = qs('admin-stats-status');
      if(statTotalRuns) statTotalRuns.textContent = totalRuns;
      if(statPendingRuns) statPendingRuns.textContent = pendingRuns;
      if(statLevelsCount) statLevelsCount.textContent = levelsCount;
      if(statBugReports) statBugReports.textContent = openReports;
      if(statsStatusEl) statsStatusEl.textContent = 'Stats loaded.';
    }

    if(bugReportsBody || qs('stat-total-runs')){
      refreshBugReports().then(()=>{
        setBugReportsStatus('Bug reports loaded.');
      });
    }

    onLiveUpdate(function(updatedItems){
      items = updatedItems.slice().sort((a,b)=>(Number(a.position) || 0) - (Number(b.position) || 0)).map(item=>({
        level: item.level,
        position: item.position,
        title: item.title,
        url: item.url,
        _isDraft: false
      }));
      normalizePositions();
      renderAdminTable();
      setStatus('List reloaded from live server.');
      updateStats();
    });
    onRunsUpdate(function(updatedRuns){
      runs = updatedRuns.slice().sort((a,b)=>new Date(b.submittedAt) - new Date(a.submittedAt));
      renderRunsTable();
      setRunsStatus('Run queue reloaded from the live server.');
      updateStats();
    });

    const adminTabButtons = document.querySelectorAll('.admin-tab');
    const adminTabPanels = document.querySelectorAll('.admin-tab-panel');

    function switchAdminTab(tabName){
      adminTabButtons.forEach(btn=>{
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
      });
      adminTabPanels.forEach(panel=>{
        panel.hidden = panel.id !== `tab-${tabName}`;
      });
    }

    adminTabButtons.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const tab = btn.getAttribute('data-tab');
        if(tab) switchAdminTab(tab);
      });
    });
  }

  if(page==='run'){
    const form = qs('run-form');
    const formStatusEl = qs('run-form-status');
    const listStatusEl = qs('run-list-status');
    const submissionsEl = qs('run-submissions');
    const levelOptionsEl = qs('run-level-options');
    const myRunsSection = qs('run-my-runs-section');
    const savedRunsListEl = qs('run-saved-runs-list');
    const saveAccountBtn = qs('run-save-account');
    const playerNameInput = qs('run-player-name');

    function setRunFormStatus(message, isError, isSuccess){
      if(!formStatusEl) return;
      formStatusEl.textContent = message;
      formStatusEl.classList.toggle('error-text', !!isError);
      formStatusEl.classList.toggle('success-text', !!isSuccess);
    }

    function setRunListStatus(message, isError){
      if(!listStatusEl) return;
      listStatusEl.textContent = message;
      listStatusEl.classList.toggle('error-text', !!isError);
    }

    function showRunSubmissionsShimmer(){
      if(!submissionsEl) return;
      submissionsEl.textContent = '';
      for(let i = 0; i < 4; i += 1){
        const card = document.createElement('article');
        card.className = 'submission-card submission-card--shimmer';
        card.setAttribute('aria-hidden', 'true');
        submissionsEl.appendChild(card);
      }
    }

    function applyRunPlayerDefault(){
      if(!playerNameInput || !fedlServerUsername) return;
      if(String(playerNameInput.value || '').trim() !== '') return;
      playerNameInput.value = fedlServerUsername;
    }

    function renderRunSubmissions(runs){
      submissionsEl.innerHTML = '';
      if(!runs.length){
        submissionsEl.innerHTML = '<article class="submission-card"><strong>No runs submitted yet</strong><p>The live queue is empty right now.</p></article>';
        return;
      }
      runs.slice(0, 8).forEach(run=>{
        const card = document.createElement('article');
        card.className = 'submission-card';
        const acct = run.accountUsername
          ? ` • Account: ${escapeHtml(run.accountUsername)}`
          : '';
        card.innerHTML = `
          <div class="submission-card-top">
            <strong>${escapeHtml(run.levelTitle || 'Untitled')}</strong>
            <span class="status-pill status-${escapeAttr(run.status || 'pending')}">${escapeHtml(run.status || 'pending')}</span>
          </div>
          <p class="submission-meta">By ${escapeHtml(run.playerName || 'Unknown')} • ${escapeHtml(run.percent || '100')}% • ${escapeHtml(new Date(run.submittedAt).toLocaleString())}${acct}</p>
          <p>${escapeHtml(run.reviewNotes || run.notes || 'No notes yet.')}</p>
          <div class="submission-links">
            <a class="text-link" href="${escapeAttr(run.videoUrl || '#')}" target="_blank" rel="noopener noreferrer">Watch run</a>
          </div>
        `;
        submissionsEl.appendChild(card);
      });
    }

    function renderMySavedRuns(){
      if(!myRunsSection || !savedRunsListEl) return;
      if(!fedlServerUserId){
        myRunsSection.hidden = true;
        if(saveAccountBtn) saveAccountBtn.hidden = true;
        return;
      }
      myRunsSection.hidden = false;
      if(saveAccountBtn) saveAccountBtn.hidden = false;
      const p = fedlGetAccountPayload(fedlServerUserId);
      const runs = p.savedRuns || [];
      savedRunsListEl.textContent = '';
      if(!runs.length){
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No runs saved yet. Fill the form and use “Save to my account” to keep drafts, or submit to the live queue.';
        savedRunsListEl.appendChild(empty);
        return;
      }
      runs.forEach(entry=>{
        const card = document.createElement('article');
        card.className = 'submission-card run-saved-card';
        const top = document.createElement('div');
        top.className = 'submission-card-top';
        const strong = document.createElement('strong');
        strong.textContent = entry.levelTitle || 'Untitled';
        top.appendChild(strong);
        const pill = document.createElement('span');
        pill.className = 'status-pill status-pending';
        pill.textContent = 'Saved';
        top.appendChild(pill);
        card.appendChild(top);
        const meta = document.createElement('p');
        meta.className = 'submission-meta';
        meta.textContent = `${entry.playerName || '—'} • ${entry.percent || '100'}% • ${entry.savedAt ? new Date(entry.savedAt).toLocaleString() : ''}`;
        card.appendChild(meta);
        if(entry.videoUrl){
          const link = document.createElement('a');
          link.className = 'text-link';
          link.href = entry.videoUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Video link';
          card.appendChild(link);
        }
        const actions = document.createElement('div');
        actions.className = 'run-saved-card-actions';
        const fillBtn = document.createElement('button');
        fillBtn.type = 'button';
        fillBtn.className = 'btn ghost-btn small-btn';
        fillBtn.textContent = 'Load into form';
        fillBtn.addEventListener('click', ()=>{
          qs('run-player-name').value = entry.playerName || '';
          qs('run-level-title').value = entry.levelTitle || '';
          qs('run-video-url').value = entry.videoUrl || '';
          qs('run-percent').value = entry.percent || '100';
          qs('run-raw-footage-url').value = entry.rawFootageUrl || '';
          qs('run-notes').value = entry.notes || '';
          setRunFormStatus('Loaded this run into the form. Submit or edit, then save or send to the queue.', false, false);
        });
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn ghost-btn small-btn';
        delBtn.textContent = 'Remove';
        delBtn.addEventListener('click', ()=>{
          fedlRemoveSavedRun(fedlServerUserId, entry.id);
          renderMySavedRuns();
        });
        actions.appendChild(fillBtn);
        actions.appendChild(delBtn);
        card.appendChild(actions);
        savedRunsListEl.appendChild(card);
      });
    }

    function loadRunPage(){
      loadItems().then(items=>{
        const titles = items.map(item=>item.title).filter(Boolean);
        levelOptionsEl.innerHTML = titles.map(title=>`<option value="${escapeAttr(title)}"></option>`).join('');
      }).catch(err=>console.error(err));

      showRunSubmissionsShimmer();
      setRunListStatus('Loading recent submissions…');

      loadRuns().then(runs=>{
        const sortedRuns = runs.slice().sort((a,b)=>new Date(b.submittedAt) - new Date(a.submittedAt));
        renderRunSubmissions(sortedRuns);
        setRunListStatus('Live submissions are updating automatically.');
      }).catch(err=>{
        console.error(err);
        renderRunSubmissions([]);
        setRunListStatus('Could not load recent submissions.', true);
      });
    }

    if(saveAccountBtn){
      saveAccountBtn.addEventListener('click', ()=>{
        const fields = {
          playerName: qs('run-player-name').value.trim(),
          levelTitle: qs('run-level-title').value.trim(),
          videoUrl: qs('run-video-url').value.trim(),
          percent: qs('run-percent').value.trim(),
          rawFootageUrl: qs('run-raw-footage-url').value.trim(),
          notes: qs('run-notes').value.trim()
        };
        const res = fedlAddSavedRun(fedlServerUserId, fields);
        if(!res.ok){
          setRunFormStatus(res.error, true);
          return;
        }
        setRunFormStatus('Run saved to your account. You can keep multiple saved runs and load them anytime.', false, true);
        renderMySavedRuns();
      });
    }

    document.addEventListener('fedl-auth-updated', ()=>{
      renderMySavedRuns();
      applyRunPlayerDefault();
    });

    form.addEventListener('submit', function(event){
      event.preventDefault();
      if(!canUseLiveServer){
        setRunFormStatus('Start the Node server before submitting runs.', true);
        return;
      }
      const payload = {
        playerName: qs('run-player-name').value.trim(),
        levelTitle: qs('run-level-title').value.trim(),
        videoUrl: qs('run-video-url').value.trim(),
        percent: qs('run-percent').value.trim(),
        rawFootageUrl: qs('run-raw-footage-url').value.trim(),
        notes: qs('run-notes').value.trim()
      };
      setRunFormStatus('Sending your run to the live queue...');
      const headers = { 'Content-Type': 'application/json' };
      const tok = fedlGetAuthToken();
      if(tok){
        headers.Authorization = `Bearer ${tok}`;
      }
      fetch(liveRunsUrl, {
        method:'POST',
        headers,
        body: JSON.stringify(payload)
      }).then(async r=>{
        if(!r.ok){
          const { message } = await fedlReadJsonResponse(r);
          throw new Error(message);
        }
        clearRunsCache();
        form.reset();
        applyRunPlayerDefault();
        const okMsg = fedlServerUsername
          ? `Run submitted successfully. It is linked to your account (${fedlServerUsername}) for moderators.`
          : 'Run submitted successfully. The admin panel can review it now.';
        setRunFormStatus(okMsg, false, true);
        return refreshRuns();
      }).catch(err=>{
        console.error(err);
        setRunFormStatus(err.message || 'Could not submit the run. Check the server and try again.', true);
      });
    });

    bindLiveUpdates();
    onRunsUpdate(function(updatedRuns){
      const sortedRuns = updatedRuns.slice().sort((a,b)=>new Date(b.submittedAt) - new Date(a.submittedAt));
      renderRunSubmissions(sortedRuns);
      setRunListStatus('Recent submissions reloaded from the live server.');
    });

    fedlRefreshAuthState()
      .then(()=> fedlPullUserStateToLocal(fedlServerUserId))
      .finally(()=>{
        renderMySavedRuns();
        fedlUpdateAuthNav();
        applyRunPlayerDefault();
      });

    loadRunPage();
  }

  const FEDL_USERNAME_RE = /^[a-z0-9_]{3,24}$/;
  const FEDL_AUTH_REDIRECT_MS = 1400;
  if (page === 'signup') {
    const form = qs('signup-form');
    const statusEl = qs('signup-status');
    const submitBtn = qs('signup-submit');
    function setSignupStatus(msg, kind){
      statusEl.textContent = msg || '';
      statusEl.className =
        kind === 'error' ? 'muted error-text' : kind === 'success' ? 'muted success-text' : 'muted';
    }
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      if (!canUseLiveServer) {
        setSignupStatus('Open this site through the FEDL server (not as a local file) to sign up.', 'error');
        return;
      }
      const username = String(qs('signup-username').value || '').trim().toLowerCase();
      const password = qs('signup-password').value || '';
      const password2 = qs('signup-password2').value || '';
      if (!FEDL_USERNAME_RE.test(username)) {
        setSignupStatus('Use 3–24 characters: lowercase letters, numbers, or underscore only.', 'error');
        return;
      }
      if (password.length < 8) {
        setSignupStatus('Password must be at least 8 characters.', 'error');
        return;
      }
      if (password !== password2) {
        setSignupStatus('Passwords do not match.', 'error');
        return;
      }
      submitBtn.disabled = true;
      setSignupStatus('Creating account…');
      fetch(liveApiPath('/api/auth/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      }).then(async r=>{
        const { data, message } = await fedlReadJsonResponse(r);
        if (!r.ok) {
          throw new Error(message || 'Sign up failed');
        }
        fedlSetAuthToken(data.token);
        fedlServerUserId = data.userId;
        fedlServerUsername = data.username;
        document.dispatchEvent(new CustomEvent('fedl-auth-updated'));
        setSignupStatus('Account created successfully. Loading your data…', 'success');
        return fedlPullUserStateToLocal(data.userId);
      }).then(()=>{
        setSignupStatus('You are signed in. Redirecting to the home page…', 'success');
        setTimeout(()=>{
          window.location.href = 'index.html';
        }, FEDL_AUTH_REDIRECT_MS);
      }).catch(err=>{
        console.error(err);
        setSignupStatus(err.message || 'Could not sign up.', 'error');
        submitBtn.disabled = false;
      });
    });
  }

  if (page === 'login') {
    const form = qs('login-form');
    const statusEl = qs('login-status');
    const submitBtn = qs('login-submit');
    function setLoginStatus(msg, kind){
      statusEl.textContent = msg || '';
      statusEl.className =
        kind === 'error' ? 'muted error-text' : kind === 'success' ? 'muted success-text' : 'muted';
    }
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      if (!canUseLiveServer) {
        setLoginStatus('Open this site through the FEDL server to log in.', 'error');
        return;
      }
      const username = String(qs('login-username').value || '').trim().toLowerCase();
      const password = qs('login-password').value || '';
      if (!username) {
        setLoginStatus('Enter your username.', 'error');
        return;
      }
      submitBtn.disabled = true;
      setLoginStatus('Signing in…');
      fetch(liveApiPath('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      }).then(async r=>{
        const { data, message } = await fedlReadJsonResponse(r);
        if (!r.ok) {
          throw new Error(message || 'Log in failed');
        }
        fedlSetAuthToken(data.token);
        fedlServerUserId = data.userId;
        fedlServerUsername = data.username;
        document.dispatchEvent(new CustomEvent('fedl-auth-updated'));
        setLoginStatus('Signed in successfully. Loading your data…', 'success');
        return fedlPullUserStateToLocal(data.userId);
      }).then(()=>{
        setLoginStatus('Welcome back. Redirecting to the home page…', 'success');
        setTimeout(()=>{
          window.location.href = 'index.html';
        }, FEDL_AUTH_REDIRECT_MS);
      }).catch(err=>{
        console.error(err);
        setLoginStatus(err.message || 'Could not log in.', 'error');
        submitBtn.disabled = false;
      });
    });
  }

  if(page==='contact'){
    const form = qs('contact-form');
    const formStatusEl = qs('contact-form-status');
    const categoryEl = qs('contact-category');
    const subjectEl = qs('contact-subject');
    const descriptionEl = qs('contact-description');
    const emailEl = qs('contact-email');

    function setContactFormStatus(message, isError){
      if(!formStatusEl) return;
      formStatusEl.textContent = message;
      if(isError){
        formStatusEl.classList.add('error-text');
        formStatusEl.classList.remove('success-text');
      }else{
        formStatusEl.classList.remove('error-text');
        formStatusEl.classList.add('success-text');
      }
    }

    if(form){
      form.addEventListener('submit', function(event){
        event.preventDefault();
        if(!canUseLiveServer){
          setContactFormStatus('Start the Node server before submitting.', true);
          return;
        }
        const payload = {
          category: categoryEl ? categoryEl.value : 'other',
          subject: subjectEl ? subjectEl.value.trim() : '',
          description: descriptionEl ? descriptionEl.value.trim() : '',
          email: emailEl ? emailEl.value.trim() : ''
        };
        if(!payload.subject || !payload.description){
          setContactFormStatus('Subject and description are required.', true);
          return;
        }
        setContactFormStatus('Submitting your report...');
        const headers = { 'Content-Type': 'application/json' };
        const tok = fedlGetAuthToken();
        if(tok){
          headers.Authorization = `Bearer ${tok}`;
        }
        fetch(`${liveServerBase}/api/bugreports`, {
          method:'POST',
          headers,
          body: JSON.stringify(payload)
        }).then(async r=>{
          if(!r.ok){
            const { message } = await fedlReadJsonResponse(r);
            throw new Error(message || 'Submit failed');
          }
          return r.json();
        }).then(()=>{
          setContactFormStatus('Thank you! Your report has been submitted. The admins will review it soon.');
          if(form) form.reset();
        }).catch(err=>{
          console.error(err);
          setContactFormStatus(err.message || 'Could not submit your report. Try again later.', true);
        });
      });
    }
  }

  injectFedlAuthNav();
  fedlRefreshAuthState().finally(()=>{
    fedlUpdateAuthNav();
    if ((page === 'signup' || page === 'login') && fedlServerUsername) {
      window.location.replace('index.html');
    }
  });

  // Utility
  function escapeHtml(s){return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c])}
  function escapeAttr(s){return escapeHtml(String(s == null ? '' : s))}
})();
