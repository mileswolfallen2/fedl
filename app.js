// Lightweight multi-page handler for GD fedl
(function(){
  function qs(id){return document.getElementById(id)}
  // Handle token from URL (for Discord OAuth)
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token');
  if (tokenFromUrl) {
    fedlSetAuthToken(tokenFromUrl);
    // Remove from URL
    const newUrl = new URL(window.location);
    newUrl.searchParams.delete('token');
    window.history.replaceState({}, '', newUrl);
    // Reload to apply
    window.location.reload();
  }
  // Handle Discord username prompt
  const needDiscordUsername = urlParams.get('needDiscordUsername');
  if (needDiscordUsername) {
    const discordId = urlParams.get('discordId');
    const email = urlParams.get('email');
    const name = urlParams.get('name');
    const suggestedUsername = urlParams.get('suggestedUsername');
    if (discordId) {
      promptForDiscordUsername({ discordId, email, name, suggestedUsername });
      // Remove from URL
      const newUrl = new URL(window.location);
      newUrl.searchParams.delete('needDiscordUsername');
      newUrl.searchParams.delete('discordId');
      newUrl.searchParams.delete('email');
      newUrl.searchParams.delete('name');
      newUrl.searchParams.delete('suggestedUsername');
      window.history.replaceState({}, '', newUrl);
    }
  }

  // Ensure Google Sign-In callback exists on the page
  window.handleCredentialResponse = window.handleCredentialResponse || function(cred){
    try {
      const idToken = cred && cred.credential ? cred.credential : cred;
      if (!idToken) return;
      fetch(liveApiPath('/api/auth/google/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken })
      }).then(r => r.json()).then(j => {
        if (j && j.token) {
          fedlSetAuthToken(j.token);
          window.location.reload();
        } else if (j && j.needUsername) {
          // Prompt user to choose a username for the new Google-based account
          promptForUsername(j);
        }
      }).catch(()=>{});
    } catch(e){ /* ignore */ }
  };

  window.fedlTurnstileSuccess = window.fedlTurnstileSuccess || function(token){
    const el = qs('turnstile-response');
    if (el) {
      el.value = token || '';
    }
  };

  function promptForDiscordUsername(payload){
    const page = document.body.dataset.page;
    // Determine container to inject UI
    const containerId = page === 'login' ? 'discord-username-container' : 'discord-username-container-signup';
    let container = document.getElementById(containerId);
    if (!container) {
      // Try to append near the Discord sign-in blocks if container not found
      container = document.createElement('div');
      container.id = containerId;
      container.style.textAlign = 'center';
      container.style.marginTop = '6px';
      // Try to place after the sign-in block in login card or signup card
      const insertAfter = document.querySelector('.auth-panel') || document.body;
      insertAfter.appendChild(container);
    }
    container.innerHTML = `
      <div class="discord-username-prompt" style="display:inline-block; text-align:left; background:#fff; padding:12px; border-radius:8px; border:1px solid #ddd; margin-top:6px;">
        <div style="margin-bottom:6px; font-weight:600; color:#000;">Choose a username</div>
        <input id="discord-username-input" value="${payload.suggestedUsername || ''}" type="text" pattern="[a-z0-9_]{3,24}" placeholder="3-24 chars, a-z 0-9 _" style="width:260px; padding:8px; border-radius:6px; border:1px solid #ccc;" />
        <button id="discord-finalize-btn" class="btn" style="margin-left:8px;">Create account</button>
        <div id="discord-username-status" class="muted" style="margin-top:6px; display:block;"></div>
      </div>`;
    const finalBtn = document.getElementById('discord-finalize-btn');
    const input = document.getElementById('discord-username-input');
    const status = document.getElementById('discord-username-status');
    finalBtn.addEventListener('click', ()=>{
      const username = String((input && input.value) || '').trim();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        status.textContent = 'Username must be 3-24 characters: lowercase letters, numbers, or underscore.';
        status.style.color = '#e11d48';
        return;
      }
      fetch(liveApiPath('/api/auth/discord/finalize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: payload.discordId, email: payload.email, name: payload.name, username })
      }).then(r => r.json()).then(res => {
        if (res && res.token) {
          fedlSetAuthToken(res.token);
          window.location.reload();
        } else {
          status.textContent = res.error || 'Failed to finalize username';
          status.style.color = '#e11d48';
        }
      }).catch(()=>{ status.textContent = 'Network error'; status.style.color = '#e11d48'; });
    });
  }

  function promptForUsername(payload){
    const page = document.body.dataset.page;
    // Determine container to inject UI
    const containerId = page === 'login' ? 'google-username-container' : 'google-username-container-signup';
    let container = document.getElementById(containerId);
    if (!container) {
      // Try to append near the Google sign-in blocks if container not found
      container = document.createElement('div');
      container.id = containerId;
      container.style.textAlign = 'center';
      container.style.marginTop = '6px';
      // Try to place after the sign-in block in login card or signup card
      const insertAfter = document.querySelector('.auth-panel') || document.body;
      insertAfter.appendChild(container);
    }
    container.innerHTML = `
      <div class="google-username-prompt" style="display:inline-block; text-align:left; background:#fff; padding:12px; border-radius:8px; border:1px solid #ddd; margin-top:6px;">
        <div style="margin-bottom:6px; font-weight:600; color:#000;">Choose a username</div>
        <input id="google-username-input" value="${payload.suggestedUsername || ''}" type="text" pattern="[a-z0-9_]{3,24}" placeholder="3-24 chars, a-z 0-9 _" style="width:260px; padding:8px; border-radius:6px; border:1px solid #ccc;" />
        <button id="google-finalize-btn" class="btn" style="margin-left:8px;">Create account</button>
        <div id="google-username-status" class="muted" style="margin-top:6px; display:block;"></div>
      </div>`;
    const finalBtn = document.getElementById('google-finalize-btn');
    const input = document.getElementById('google-username-input');
    const status = document.getElementById('google-username-status');
    finalBtn.addEventListener('click', ()=>{
      const username = String((input && input.value) || '').trim();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        status.textContent = 'Username must be 3-24 characters: lowercase letters, numbers, or underscore.';
        status.style.color = '#e11d48';
        return;
      }
      fetch(liveApiPath('/api/auth/google/finalize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleId: payload.googleId, email: payload.email, name: payload.name, username })
      }).then(r => r.json()).then(res => {
        if (res && res.token) {
          fedlSetAuthToken(res.token);
          window.location.reload();
        } else {
          status.textContent = res.error || 'Failed to finalize username';
          status.style.color = '#e11d48';
        }
      }).catch(()=>{ status.textContent = 'Network error'; status.style.color = '#e11d48'; });
    });
  }

  const page = document.body.dataset.page;
  const isFileProtocol = window.location.protocol === 'file:';
  const TESTING_MODE = false; // Set to true to enable testing mode with test server and mod accounts
  console.log('Current origin:', window.location.origin, 'isFileProtocol:', isFileProtocol);
  const liveServerBase = TESTING_MODE
    ? 'http://localhost:8090'
    : 'https://server.fedl.site/fedl';
  const canUseLiveServer = !isFileProtocol || !!liveServerBase;
  const liveApiUrl = `${liveServerBase}/api/list`;
  const liveRunsUrl = `${liveServerBase}/api/runs`;
  const liveEventsUrl = `${liveServerBase}/events`;
  const liveDataFileUrl = `${liveServerBase}/server/data.txt`;
  const MOD_USERS = ['wolf_reaper90','dioxyx','steve'];
  const SPA_PAGE_KEY = 'onepage';
  /** Use for POST /api/import/* and any path under the same base as list/runs (not root-relative /api/...). */
  function liveApiPath(path){
    const p = String(path || '').startsWith('/') ? path : `/${path}`;
    return `${liveServerBase}${p}`;
  }

  window.fedlApiPath = function(path) {
    return liveApiPath(path);
  };

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

  const pagesNeedingLiveStatus = new Set(['index', 'run', 'messages', 'contact', 'signup', 'login', 'account', 'reset-password', 'admelist']);
  if(!TESTING_MODE && pagesNeedingLiveStatus.has(page) && !window.location.pathname.endsWith(`/${offlinePage}`)){
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

  function loadAnimeJS() {
    return new Promise((resolve, reject) => {
      if (window.anime) { resolve(window.anime); return; }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js';
      script.onload = () => resolve(window.anime);
      script.onerror = () => reject(new Error('Failed to load anime.js'));
      document.head.appendChild(script);
    });
  }

  function loadAdsScript() {
    if (window.fedlAdScriptLoaded) return;
    window.fedlAdScriptLoaded = true;
    const script = document.createElement('script');
    script.src = 'https://pl29378364.profitablecpmratenetwork.com/85/92/03/859203c62bb20bf95a9f26d1218bb0ad.js';
    script.async = true;
    document.head.appendChild(script);
  }

  function animateNumber(el, endValue) {
    if (!window.anime || animationsDisabled()) { el.textContent = String(endValue); return; }
    const obj = { val: 0 };
    window.anime({
      targets: obj,
      val: endValue,
      duration: 2000,
      easing: 'easeOutExpo',
      round: 1,
      update: () => { el.textContent = Math.floor(obj.val); }
    });
  }

  const numberObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        if (el.dataset.animated) return;
        el.dataset.animated = 'true';
        const endVal = parseInt(el.dataset.endValue, 10);
        if (!isNaN(endVal)) animateNumber(el, endVal);
        numberObserver.unobserve(el);
      }
    });
  }, { threshold: 0.1 }) : null;

  function observeNumberEl(el) {
    if (!numberObserver || !el) return;
    numberObserver.observe(el);
  }

  const FEDL_ANIMATIONS_KEY = 'fedl_animations_disabled';
  const FEDL_LIST_ANIM_KEY = 'fedl_list_anim_disabled';
  const FEDL_ANIM_SPEED_KEY = 'fedl_anim_speed';
  const FEDL_ADS_KEY = 'fedl_ads_enabled';

  function animationsDisabled(){
    const val = localStorage.getItem(FEDL_ANIMATIONS_KEY);
    if (val === null) return false;
    return val === 'true';
  }
  function setAnimationsDisabled(val){
    localStorage.setItem(FEDL_ANIMATIONS_KEY, String(val));
  }
  function listAnimationsDisabled(){
    return localStorage.getItem(FEDL_LIST_ANIM_KEY) === 'true';
  }
  function getAnimationSpeed(){
    const val = localStorage.getItem(FEDL_ANIM_SPEED_KEY);
    return val ? parseInt(val, 10) : 3000;
  }
  function adsEnabled(){
    return localStorage.getItem(FEDL_ADS_KEY) === 'true';
  }
  function setAdsEnabled(val){
    localStorage.setItem(FEDL_ADS_KEY, String(val));
  }
  loadAnimeJS().then(() => {
    if (window.anime) {
      document.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('mousedown', () => {
          if(!animationsDisabled()) window.anime({ targets: btn, scale: 0.95, duration: 500, easing: 'easeInOutQuad' });
        });
        btn.addEventListener('mouseup', () => {
          if(!animationsDisabled()) window.anime({ targets: btn, scale: 1, duration: 500, easing: 'easeInOutQuad' });
        });
        btn.addEventListener('mouseleave', () => {
          if(!animationsDisabled()) window.anime({ targets: btn, scale: 1, duration: 500, easing: 'easeInOutQuad' });
        });
      });
    }
  }).catch(() => {});

  // Page transition helper
  function animatePageTransition(callback){
    if(animationsDisabled() || !window.anime){
      if(callback) callback();
      return;
    }
    let overlay = document.getElementById('page-transition-overlay');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.id = 'page-transition-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;pointer-events:none;opacity:0;background:var(--accent);mix-blend-mode:screen;transition:opacity 0.3s ease';
      document.body.appendChild(overlay);
    }
    overlay.style.opacity = '0';
    overlay.style.display = 'block';
    window.anime({
      targets: overlay,
      opacity: [0, 0.15, 0],
      duration: 600,
      easing: 'easeInOutQuad',
      begin: () => { overlay.style.opacity = '0'; },
      update: (anim) => {
        if(anim.progress > 20 && anim.progress < 60 && callback){
          callback();
          callback = null;
        }
      },
      complete: () => { overlay.style.display = 'none'; }
    });
  }

  // Celebration particles helper
  function createCelebrationParticles(count){
    if(animationsDisabled() || !window.anime) return;
    const colors = ['#5cc5ff','#ffb84d','#84cc16','#a78bfa','#f472b6','#ff9f1c','#00ff9f','#e056fd'];
    for(let i = 0; i < (count || 8); i++){
      const p = document.createElement('div');
      p.className = 'celebration-particle';
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.left = `${30 + Math.random() * 40}%`;
      p.style.top = `${40 + Math.random() * 30}%`;
      document.body.appendChild(p);
      const angle = (Math.PI * 2 * i) / count;
      const dist = 40 + Math.random() * 80;
      window.anime({
        targets: p,
        '--px': [0, Math.cos(angle) * dist + 'px'],
        '--py': [0, Math.sin(angle) * dist * -1 + 'px'],
        opacity: [1, 0],
        scale: [1, 0],
        duration: 800 + Math.random() * 400,
        easing: 'easeOutQuad',
        complete: () => p.remove()
      });
    }
  }

  // Add page transition to nav links
  (function initNavTransitions(){
    if(animationsDisabled()) return;
    document.querySelectorAll('header nav a').forEach(link => {
      link.addEventListener('click', function(e){
        const href = this.getAttribute('href');
        if(!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        e.preventDefault();
        animatePageTransition(() => {
          window.location.href = href;
        });
      });
    });
  })();

  // Page-enter animation for all pages
  (function initPageEnter(){
    const page = document.body.dataset.page;
    if(!page) return;
    const main = document.querySelector('main');
    if(main && window.anime && !animationsDisabled()){
      main.style.opacity = '0';
      main.style.transform = 'translateY(12px)';
      window.anime({
        targets: main,
        opacity: [0, 1],
        translateY: [12, 0],
        duration: getAnimationSpeed() * 0.5,
        easing: 'easeOutCubic'
      });
    } else if(main){
      main.style.opacity = '1';
      main.style.transform = 'translateY(0)';
    }
    // Input focus animation
    if(window.anime && !animationsDisabled()){
      document.querySelectorAll('input[type="text"], input[type="number"], input[type="password"], input[type="url"], textarea, select').forEach(el => {
        el.addEventListener('focus', function(){
          window.anime({ targets: this, scale: [1, 1.01, 1], duration: 300, easing: 'easeOutQuad' });
        });
      });
    }
    // Staggered nav items animation
    if(window.anime && !animationsDisabled()){
      const navLinks = document.querySelectorAll('header nav a');
      navLinks.forEach((link, i) => {
        link.style.opacity = '0';
        link.style.transform = 'translateY(-8px)';
        window.anime({
          targets: link,
          opacity: [0, 1],
          translateY: [-8, 0],
          duration: 400,
          delay: 60 * i,
          easing: 'easeOutCubic'
        });
      });
    }
    // Stats cards scroll observer (index page)
    if(page === 'index' && window.anime && !animationsDisabled() && 'IntersectionObserver' in window){
      const statCards = document.querySelectorAll('.stat-card, .stats-grid .stat-box');
      if(statCards.length){
        const statObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry, idx) => {
            if(entry.isIntersecting){
              window.anime({
                targets: entry.target,
                opacity: [0, 1],
                translateY: [15, 0],
                scale: [0.95, 1],
                duration: getAnimationSpeed() * 0.4,
                delay: idx * 80,
                easing: 'easeOutCubic'
              });
              statObserver.unobserve(entry.target);
            }
          });
        }, { threshold: 0.1 });
        statCards.forEach(card => {
          card.style.opacity = '0';
          card.style.transform = 'translateY(15px) scale(0.95)';
          statObserver.observe(card);
        });
      }
      // Featured cards stagger
      const featuredCards = document.querySelectorAll('.featured-card');
      if(featuredCards.length){
        const featObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if(entry.isIntersecting){
              const cards = entry.target.parentElement.querySelectorAll('.featured-card');
              cards.forEach((card, i) => {
                card.style.opacity = '0';
                card.style.transform = 'translateY(12px)';
                window.anime({
                  targets: card,
                  opacity: [0, 1],
                  translateY: [12, 0],
                  duration: 500,
                  delay: i * 100,
                  easing: 'easeOutCubic'
                });
              });
              featObserver.unobserve(entry.target);
            }
          });
        }, { threshold: 0.1 });
        const featuredList = document.querySelector('.featured-list');
        if(featuredList) featObserver.observe(featuredList);
      }
    }
  })();

  (function initTheme(){
    const themes = {
      dark: { '--bg': '#0f1724', '--panel': '#071326', '--accent': '#5cc5ff', '--muted': '#9fb3c8', '--text': '#e6eef8', '--card': '#081220', '--accent-warm': '#ffb84d' },
      light: { '--bg': '#f0f4f8', '--panel': '#e2e8f0', '--accent': '#0284c7', '--muted': '#64748b', '--text': '#1e293b', '--card': '#cbd5e1', '--accent-warm': '#f59e0b' },
      blue: { '--bg': '#0d1b2a', '--panel': '#1b3a5f', '--accent': '#38bdf8', '--muted': '#94a3b8', '--text': '#e0f2fe', '--card': '#142d4c', '--accent-warm': '#fbbf24' },
      midnight: { '--bg': '#0a0a12', '--panel': '#12121f', '--accent': '#a78bfa', '--muted': '#6b7280', '--text': '#e5e7eb', '--card': '#0f0f1a', '--accent-warm': '#f472b6' },
      cyberpunk: { '--bg': '#0f0f1a', '--panel': '#1a0a2e', '--accent': '#00ff9f', '--muted': '#b388ff', '--text': '#e0f7fa', '--card': '#150f25', '--accent-warm': '#ff00a8' },
      earth: { '--bg': '#1a2f1a', '--panel': '#2d4a2d', '--accent': '#84cc16', '--muted': '#a3c9a3', '--text': '#ecfccb', '--card': '#223d22', '--accent-warm': '#fbbf24' },
      retro: { '--bg': '#1a1208', '--panel': '#2b1a0a', '--accent': '#ff9f1c', '--muted': '#c9a66b', '--text': '#ffe4b5', '--card': '#241809', '--accent-warm': '#ff6b35' },
      matrix: { '--bg': '#000a00', '--panel': '#001100', '--accent': '#00ff00', '--muted': '#00aa00', '--text': '#00ff00', '--card': '#001100', '--accent-warm': '#88ff88' },
      synthwave: { '--bg': '#1a0a2e', '--panel': '#2d1b4e', '--accent': '#ff2a6d', '--muted': '#c792ea', '--text': '#f4e9ff', '--card': '#251440', '--accent-warm': '#05d9e8' },
      fire: { '--bg': '#1a0505', '--panel': '#2d0a0a', '--accent': '#ff4500', '--muted': '#cc5500', '--text': '#ffd4b8', '--card': '#250a0a', '--accent-warm': '#ffaa00' },
      galaxy: { '--bg': '#0a0612', '--panel': '#150f25', '--accent': '#e056fd', '--muted': '#7c3aed', '--text': '#f0e6ff', '--card': '#0f0818', '--accent-warm': '#f9ca24' },
      candy: { '--bg': '#fdf2f8', '--panel': '#fce7f3', '--accent': '#f472b6', '--muted': '#94a3b8', '--text': '#831843', '--card': '#fbcfe8', '--accent-warm': '#34d399' },
      highcontrast: { '--bg': '#000000', '--panel': '#111111', '--accent': '#ffffff', '--muted': '#cccccc', '--text': '#ffffff', '--card': '#0a0a0a', '--accent-warm': '#ffff00' },
      original: { '--bg': '#0f1724', '--panel': '#071326', '--accent': '#5cc5ff', '--muted': '#9fb3c8', '--text': '#e6eef8', '--card': '#081220', '--accent-warm': '#ffb84d' }
    };
    const saved = localStorage.getItem('fedl_theme') || 'dark';
    const vars = themes[saved];
    if (vars) {
      const root = document.documentElement;
      Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
      document.body.dataset.theme = saved;
    }
    try {
      const activeId = localStorage.getItem('fedl_user_account_active');
      if (activeId) {
        const userData = JSON.parse(localStorage.getItem('fedl_user_data_' + activeId));
        if (userData && userData.theme) {
          const themeName = userData.theme;
          const accountVars = themes[themeName];
          if (accountVars) {
            document.documentElement.style.setProperty('--bg', accountVars['--bg']);
            document.documentElement.style.setProperty('--panel', accountVars['--panel']);
            document.documentElement.style.setProperty('--accent', accountVars['--accent']);
            document.documentElement.style.setProperty('--muted', accountVars['--muted']);
            document.documentElement.style.setProperty('--text', accountVars['--text']);
            document.documentElement.style.setProperty('--card', accountVars['--card']);
            document.documentElement.style.setProperty('--accent-warm', accountVars['--accent-warm']);
            document.body.dataset.theme = themeName;
            localStorage.setItem('fedl_theme', themeName);
          }
        }
      }
    } catch(e) {}
  })();

  function debounce(fn, wait){
    let timeoutId = null;
    return function(){
      const ctx = this;
      const args = arguments;
      clearTimeout(timeoutId);
      timeoutId = setTimeout(()=>fn.apply(ctx, args), wait);
    };
  }

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
    return { roulettePick: null, levelPercents: {}, savedRuns: [], rouletteSlots: fedlEmptyRouletteSlots(), theme: 'dark' };
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

  function isFedlMod(){
      if(!fedlServerUsername) return Promise.resolve(false);
      return Promise.resolve(MOD_USERS.includes(fedlServerUsername.toLowerCase()));
    }

  function fedlUpdateAuthNav(){
    const wrap = document.querySelector('.fedl-auth-nav');
    if (!wrap) {
      return;
    }
    wrap.textContent = '';
    if (fedlServerUsername) {
      isFedlMod().then(isMod=>{
        const label = document.createElement('span');
        label.className = 'fedl-auth-label muted';
        label.appendChild(document.createTextNode('Hi, '));
        const strong = document.createElement('strong');
        strong.textContent = fedlServerUsername;
        label.appendChild(strong);
        wrap.appendChild(label);
        wrap.appendChild(document.createTextNode(' '));
        if (isMod) {
          const adminLink = document.createElement('a');
          adminLink.href = 'admelist.html';
          adminLink.textContent = 'Admin';
          wrap.appendChild(adminLink);
          wrap.appendChild(document.createTextNode(' '));
        }
        const accountLink = document.createElement('a');
        accountLink.href = 'account.html';
        accountLink.textContent = 'Account';
        wrap.appendChild(accountLink);
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
      });
    } else {
      const a1 = document.createElement('a');
        const returnTo = encodeURIComponent(window.location.href);
        a1.href = 'login.html?return=' + returnTo;
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

  function calculatePoints(rank){
    if(!rank || rank < 1) return 0;
    if(rank <= 200) return 10000 - (rank - 1) * 50;
    return 50;
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
    const rank = Number(item.position) || 0;
    const points = calculatePoints(rank);
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
    let pointsEl = modal.querySelector('.modal-points');
    if(!pointsEl){
      pointsEl = document.createElement('div'); pointsEl.className='modal-points';
      pointsEl.style.cssText = 'font-size:1.5em;font-weight:bold;margin-bottom:10px;color:var(--accent-color,#00aaff);';
      const inner = modal.querySelector('.inner');
      inner.insertBefore(pointsEl, inner.querySelector('iframe'));
    }
    pointsEl.textContent = rank > 0 ? `Rank #${rank} — ${points} points` : '';
    const runsWrap = modal.querySelector('.modal-runs-wrap');
    const runsList = modal.querySelector('.modal-runs-list');
    if(runsWrap) runsWrap.hidden = !config.showRuns;
    if(config.showRuns && runsList){
      renderApprovedRunsForLevel(item, runsList);
    }
    updateAccountProgressInModal(modal, item);
    if(!animationsDisabled() && window.anime){
      modal.style.opacity = '0';
      modal.style.transform = 'scale(0.95)';
      modal.style.display = 'flex';
      window.anime({ targets: modal, opacity: [0,1], scale: [0.95,1], duration: 3000, easing: 'easeInOutCubic' });
    } else {
      modal.style.opacity = '1';
      modal.style.transform = 'scale(1)';
      modal.style.display = 'flex';
    }
  }

  function bindHomeSnapshot(includeRuns){
    const totalEl = qs('hero-total-levels');
    const topEl = qs('hero-top-entry');
    const approvedRunsEl = qs('hero-last-slot');
    const playersEl = qs('hero-total-players');
    const recentRunsEl = qs('hero-recent-runs');
    const lastUpdatedEl = qs('hero-list-updated');
    const featuredListEl = qs('featured-list');
    const listPreviewEl = qs('offline-list-area');

    function renderFeatured(items){
      if(!featuredListEl) return;
      const rankedItems = items.slice().sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0));
      const featured = rankedItems.slice(0, 10);
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
      document.querySelectorAll('.skeleton-card').forEach(el => el.remove());
    }

    function renderHome(items){
      const rankedItems = items.slice().sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0));
      const firstItem = rankedItems[0];

      if(totalEl) { totalEl.dataset.endValue = rankedItems.length || 0; totalEl.textContent = '0'; observeNumberEl(totalEl); }
      if(topEl) topEl.textContent = firstItem ? firstItem.title : 'Unavailable';
      renderFeatured(rankedItems);
      if(listPreviewEl){
        const preview = rankedItems.slice(0, 10);
        listPreviewEl.innerHTML = preview.length ? preview.map(item=>`
          <tr>
            <td>#${escapeHtml(item.position || '--')}</td>
            <td>${escapeHtml(item.title || 'Untitled')}</td>
          </tr>
        `).join('') : '<tr><td colspan="2" class="muted">No local list data found.</td></tr>';
      }
    }

    function renderHomeStats(runs, items){
      const lookup = new Map((items || []).map(item => [String(item.title || '').toLowerCase(), Number(item.position) || 9999]));
      const map = new Map();
      runs.forEach(run=>{
        if(String(run.status || '').toLowerCase() !== 'approved') return;
        const playerName = String(run.playerName || '').trim();
        if(!playerName) return;
        const key = playerName.toLowerCase();
        let entry = map.get(key);
        if(!entry){
          entry = {name: playerName, runs: 0, bestRank: 9999, points: 0};
          map.set(key, entry);
        }
        entry.runs += 1;
        const rank = lookup.get(String(run.levelTitle || '').toLowerCase()) || 9999;
        if(rank > 0 && rank < entry.bestRank) entry.bestRank = rank;
        if(rank > 0 && rank < 1000) entry.points += calculatePoints(rank);
      });
      const sortedPlayers = Array.from(map.values()).sort((a,b)=>{
        if(b.points !== a.points) return b.points - a.points;
        const aRank = a.bestRank === 9999 ? 9999 : a.bestRank;
        const bRank = b.bestRank === 9999 ? 9999 : b.bestRank;
        if(aRank !== bRank) return aRank - bRank;
        return a.name.localeCompare(b.name);
      });
      const topPlayer = sortedPlayers[0]?.name || 'None';
      if(playersEl) playersEl.textContent = topPlayer;
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentRuns = runs.filter(run=>{
        if(String(run.status || '').toLowerCase() !== 'approved') return false;
        const submitted = run.submittedAt ? new Date(run.submittedAt).getTime() : 0;
        return submitted >= oneWeekAgo;
      }).length;
      if(recentRunsEl) { recentRunsEl.dataset.endValue = recentRuns; recentRunsEl.textContent = '0'; observeNumberEl(recentRunsEl); }
      const sortedRuns = runs.slice().sort((a,b)=>new Date(b.submittedAt||0) - new Date(a.submittedAt||0));
      const latestRun = sortedRuns.find(run=>run.submittedAt);
      if(lastUpdatedEl) lastUpdatedEl.textContent = latestRun 
        ? new Date(latestRun.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : 'N/A';
    }

    function renderApprovedRuns(runs){
      if(!approvedRunsEl) return;
      const approvedCount = runs.filter(run=>String(run.status || '').toLowerCase() === 'approved').length;
      approvedRunsEl.dataset.endValue = approvedCount;
      approvedRunsEl.textContent = '0';
      observeNumberEl(approvedRunsEl);
    }

    loadItems().then(items=>{
      renderHome(items);
      if(includeRuns){
        loadRuns().then(runs=>{
          renderApprovedRuns(runs);
          renderHomeStats(runs, items);
        }).catch(()=>{
          renderApprovedRuns([]);
          renderHomeStats([], items);
        });
        onRunsUpdate(runs=>{
          renderApprovedRuns(runs);
          renderHomeStats(runs, items);
        });
      }
    }).catch(()=>{
      renderHome([]);
    });
    onLiveUpdate(renderHome);
  }

  if(page==='index'){
    bindHomeSnapshot(true);
    bindLiveUpdates();
  }

  // One page app handler
  if(page===SPA_PAGE_KEY){
    const spaPage = window.location.hash.slice(1) || 'home';
    if(spaPage === 'lists' || spaPage === 'home'){
      bindHomeSnapshot(true);
      bindLiveUpdates();
      const listBody = qs('list-body');
      if(listBody){
        const listPage = initListPage();
        onLiveUpdate(function(updatedItems){
          listPage.applyItems(updatedItems);
        });
      }
    }
    if(spaPage === 'players'){
      const playersBody = qs('players-body');
      const playerSearch = qs('player-search');
      if(playersBody && playerSearch){
        let players = [];
        Promise.all([loadRuns(), loadItems()]).then(([runs, items])=>{
          const lookup = new Map(items.map(item => [String(item.title || '').toLowerCase(), Number(item.position) || 9999]));
          const map = new Map();
          runs.filter(run => String(run.status || '').toLowerCase() === 'approved').forEach(run => {
            const playerName = String(run.playerName || '').trim();
            if(!playerName) return;
            const key = playerName.toLowerCase();
            let entry = map.get(key);
            if(!entry){
              entry = {name: playerName, runs: 0, bestRank: 9999, points: 0, topLevels: new Set()};
              map.set(key, entry);
            }
            entry.runs += 1;
            const rank = lookup.get(String(run.levelTitle || '').toLowerCase()) || 9999;
            if(rank > 0 && rank < entry.bestRank) entry.bestRank = rank;
            if(rank > 0 && rank < 1000) entry.points += calculatePoints(rank);
            if(run.levelTitle) entry.topLevels.add(String(run.levelTitle).trim());
          });
          players = Array.from(map.values()).map(entry => ({
            name: entry.name,
            runs: entry.runs,
            bestRank: entry.bestRank === 9999 ? '—' : `#${entry.bestRank}`,
            points: entry.points,
            topLevels: Array.from(entry.topLevels).slice(0, 3).join(', ')
          })).sort((a,b) => b.points - a.points || a.name.localeCompare(b.name));
          function render(){
            const query = (playerSearch.value || '').toLowerCase();
            const filtered = players.filter(p => !query || p.name.toLowerCase().includes(query));
            if(!filtered.length){
              playersBody.innerHTML = '<tr><td colspan="5" class="muted">No player data found.</td></tr>';
              return;
            }
            playersBody.innerHTML = filtered.slice(0, 100).map(p => `
              <tr>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td>${p.runs}</td>
                <td>${p.bestRank}</td>
                <td>${p.points}</td>
                <td>${escapeHtml(p.topLevels)}</td>
              </tr>
            `).join('');
          }
          playerSearch.addEventListener('input', render);
          render();
        });
      }
    }
    if(spaPage === 'run'){
      const runForm = qs('run-form');
      if(runForm){
        const playerNameInput = qs('run-player-name');
        const formStatusEl = qs('run-form-status');
        runForm.addEventListener('submit', function(e){
          e.preventDefault();
          const playerName = playerNameInput.value.trim();
          const levelTitle = qs('run-level-title').value.trim();
          const videoUrl = qs('run-video-url').value.trim();
          const percent = qs('run-percent').value.trim();
          const rawUrl = qs('run-raw-url').value.trim();
          const notes = qs('run-notes').value.trim();
          if(!playerName || !levelTitle || !videoUrl || !percent){
            formStatusEl.textContent = 'Please fill in all required fields.';
            return;
          }
          formStatusEl.textContent = 'Submitting...';
          fetch(liveRunsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, levelTitle, videoUrl, percent, rawFootageUrl: rawUrl, notes })
          }).then(r => {
            if(!r.ok) throw new Error('Failed');
            formStatusEl.textContent = 'Run submitted successfully!';
            runForm.reset();
          }).catch(() => {
            formStatusEl.textContent = 'Failed to submit run.';
          });
        });
      }
    }
    if(spaPage === 'roulette'){
      const spinBtn = qs('roulette-spin');
      const resultEl = qs('roulette-result');
      if(spinBtn && resultEl){
        spinBtn.addEventListener('click', function(){
          loadItems().then(items => {
            if(!items.length){
              resultEl.innerHTML = '<p class="muted">No levels loaded.</p>';
              return;
            }
            const random = items[Math.floor(Math.random() * items.length)];
            resultEl.innerHTML = `
              <p><strong>${escapeHtml(random.title || 'Untitled')}</strong></p>
              <p class="muted">Rank #${random.position || '?'}</p>
              <p class="muted">${random.level || ''}</p>
            `;
          });
        });
      }
    }
    if(spaPage === 'guess'){
      const higherBtn = qs('guess-higher');
      const lowerBtn = qs('guess-lower');
      const levelEl = qs('guess-level');
      const resultEl = qs('guess-result');
      const scoreEl = qs('guess-score');
      if(higherBtn && lowerBtn && levelEl){
        let currentLevel = null;
        let score = 0;
        let revealed = false;
        function newRound(){
          loadItems().then(items => {
            if(!items.length) return;
            currentLevel = items[Math.floor(Math.random() * items.length)];
            levelEl.textContent = currentLevel.title || '???';
            resultEl.textContent = '';
            revealed = false;
          });
        }
        higherBtn.addEventListener('click', function(){
          if(revealed || !currentLevel) return;
          revealed = true;
          const rank = Number(currentLevel.position) || 9999;
          const actual = Math.random() * 100;
          if(actual > 50){
            score++;
            resultEl.textContent = `Correct! It was #${rank}`;
          }else{
            resultEl.textContent = `Wrong! It was #${rank}`;
          }
          scoreEl.textContent = `Score: ${score}`;
          setTimeout(newRound, 2000);
        });
        lowerBtn.addEventListener('click', function(){
          if(revealed || !currentLevel) return;
          revealed = true;
          const rank = Number(currentLevel.position) || 9999;
          const actual = Math.random() * 100;
          if(actual < 50){
            score++;
            resultEl.textContent = `Correct! It was #${rank}`;
          }else{
            resultEl.textContent = `Wrong! It was #${rank}`;
          }
          scoreEl.textContent = `Score: ${score}`;
          setTimeout(newRound, 2000);
        });
        newRound();
      }
    }
  }

  if(page==='offlineindex'){
    bindHomeSnapshot(false);
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
          note.textContent = `Signed in as ${fedlServerUsername}. Progress syncs online and this browser keeps a copy.`;
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
      const card = qs('roulette-card');
      if(card && window.anime && !animationsDisabled()){
        card.style.opacity = '0';
        card.style.transform = 'scale(0.9) translateY(12px)';
      }
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
      if(card && window.anime && !animationsDisabled()){
        const speed = getAnimationSpeed();
        window.anime({
          targets: card,
          opacity: [0, 1],
          scale: [0.9, 1.02, 1],
          translateY: [12, -2, 0],
          duration: speed,
          easing: 'easeOutCubic'
        });
      }
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
      const slotRow = document.querySelector(`.roulette-slot-row:nth-child(${slotKey})`);
      if(slotRow && window.anime && !animationsDisabled()){
        slotRow.classList.add('slot-active');
        window.anime({ targets: slotRow, backgroundColor: ['rgba(92,197,255,0.2)', 'rgba(92,197,255,0.08)'], duration: 500, easing: 'easeOutQuad', complete: () => slotRow.classList.remove('slot-active') });
      }
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

    const wheelWrap = document.getElementById('roulette-wheel-wrap');
    const wheelInner = document.getElementById('roulette-wheel-inner');

    function buildWheel(items){
      if(!wheelInner || !items.length) return;
      wheelInner.innerHTML = '';
      const segmentAngle = 360 / Math.min(items.length, 20);
      const colors = ['#5cc5ff','#ff6b35','#84cc16','#a78bfa','#f472b6','#ff9f1c','#00ff9f','#e056fd','#38bdf8','#ff4500','#34d399','#ffb84d','#c792ea','#5cc5ff','#fbbf24','#ff2a6d','#88ff88','#0ea5e9','#fb923c','#f0abfc'];
      const count = Math.min(items.length, 20);
      for(let i = 0; i < count; i++){
        const seg = document.createElement('div');
        seg.className = 'roulette-wheel-segment';
        seg.style.transform = `rotate(${i * segmentAngle}deg)`;
        seg.style.background = colors[i % colors.length];
        seg.style.clipPath = `polygon(0 0, 100% 0, 100% ${50 + 50 * Math.cos((segmentAngle/2) * Math.PI/180)}% 100% ${50 - 50 * Math.sin((segmentAngle/2) * Math.PI/180)}%)`;
        seg.textContent = items[i].title.substring(0,8);
        wheelInner.appendChild(seg);
      }
    }

    function spinWheel(targetIndex, totalItems, duration){
      if(!wheelInner || animationsDisabled()) return Promise.resolve();
      const segmentAngle = 360 / Math.min(totalItems, 20);
      const spins = 5;
      const finalAngle = spins * 360 - (targetIndex * segmentAngle);
      wheelInner.style.transition = 'none';
      wheelInner.style.transform = 'rotate(0deg)';
      return new Promise(resolve => {
        window.setTimeout(() => {
          if(window.anime){
            window.anime({
              targets: wheelInner,
              rotate: [0, finalAngle],
              duration: duration,
              easing: 'easeOutCubic',
              update: () => {
                wheelInner.style.transition = 'none';
              },
              complete: resolve
            });
          } else {
            wheelInner.style.transition = `transform ${duration}ms ease-out`;
            wheelInner.style.transform = `rotate(${finalAngle}deg)`;
            window.setTimeout(resolve, duration);
          }
        }, 50);
      });
    }

    spinBtn.addEventListener('click', ()=>{
      statusEl.textContent = 'Spinning...';
      titleEl.textContent = 'Choosing a demon';
      rankEl.textContent = 'Rank: -';
      idEl.textContent = 'Level ID: -';
      noteEl.textContent = 'Checking your local file and API if needed.';
      openEl.hidden = true;
      if(pctRow) pctRow.hidden = true;
      if(pctHint) pctHint.textContent = '';
      spinBtn.classList.add('btn-loading');
      spinBtn.disabled = true;
      if(window.anime && !animationsDisabled()){
        window.anime({ targets: spinBtn, scale: [1, 1.05, 1], duration: 600, easing: 'easeInOutSine', loop: true });
      }
      Promise.all([loadItems(), loadLevelMeta()]).then(([items, metaMap])=>{
        if(!items.length){
          statusEl.textContent = 'No demons found.';
          titleEl.textContent = 'Add demons to the list';
          idEl.textContent = 'Level ID: -';
          noteEl.textContent = 'No list data was found.';
          return;
        }
        buildWheel(items);
        const targetIndex = Math.floor(Math.random()*Math.min(items.length, 20));
        const item = items[targetIndex] || items[Math.floor(Math.random()*items.length)];
        const spinDuration = getAnimationSpeed();
        spinWheel(targetIndex, items.length, spinDuration).then(() => {
          spinBtn.classList.remove('btn-loading');
          spinBtn.disabled = false;
          if(window.anime && !animationsDisabled()){
            window.anime({ targets: spinBtn, scale: [1.05, 1], duration: 300, easing: 'easeOutBack' });
          }
          const localMeta = metaMap[item.title] || {levelId:'unknown', percent:'100'};
          if(localMeta.levelId && localMeta.levelId !== 'unknown'){
            showPick(item, {levelId: localMeta.levelId, percent: localMeta.percent, source: 'file'});
            return;
          }
          fetchLevelIdFromApi(item.title).then(levelId=>{
            const meta = {
              levelId: levelId || 'unknown',
              percent: localMeta.percent || '100',
              source: levelId ? 'api' : 'file'
            };
            showPick(item, meta);
          });
        });
      }).catch(err=>{
        statusEl.textContent = 'Could not load the list.';
        titleEl.textContent = 'Open the full site';
        rankEl.textContent = 'Rank: -';
        idEl.textContent = 'Level ID: -';
        noteEl.textContent = 'The list or lookup failed.';
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
      if(window.anime && !animationsDisabled()){
        const speed = getAnimationSpeed();
        window.anime({
          targets: answerEl,
          opacity: [0, 1],
          translateY: [8, 0],
          duration: speed * 0.5,
          easing: 'easeOutCubic'
        });
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
        feedbackEl.className = 'roulette-note muted guess-correct success-shine';
        if(window.anime && !animationsDisabled()){
          window.anime({ targets: feedbackEl, scale: [1, 1.05, 1], duration: 600, easing: 'easeOutBack' });
        }
        // Celebration particles
        createCelebrationParticles(10);
        finishRound('You got it.', false);
        return;
      }
      state.triesLeft -= 1;
      attemptsEl.textContent = `Tries left: ${state.triesLeft}`;
      const direction = guess < state.answer ? 'Higher' : 'Lower';
      if(state.triesLeft > 0){
        feedbackEl.textContent = `${direction}. #${guess} is not the right spot.`;
        feedbackEl.className = 'roulette-note muted guess-wrong';
        if(window.anime && !animationsDisabled()){
          window.anime({ targets: feedbackEl, translateX: [-6, 6, -6, 6, 0], duration: 400, easing: 'easeInOutQuad' });
        }
        return;
      }
      feedbackEl.textContent = `${direction}. That was your last guess.`;
      feedbackEl.className = 'roulette-note muted guess-wrong';
      finishRound('Round over.', true);
    }

    resetGuessUi('Start a round to get a level.');
    if(modeSelect){
      modeSelect.addEventListener('change', ()=>{
        if(!state.active) resetGuessUi('Start a round to get a level.');
        const card = qs('guess-card');
        if(card && window.anime && !animationsDisabled()){
          card.classList.add('mode-switching');
          window.anime({
            targets: card,
            opacity: [0.5, 1],
            duration: 300,
            easing: 'easeOutQuad',
            complete: () => { card.classList.remove('mode-switching'); }
          });
        }
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
          entry = {name: playerName, runs: 0, bestRank: 9999, points: 0, topLevels: new Set()};
          map.set(key, entry);
        }
        entry.runs += 1;
        const rank = lookup.get(String(run.levelTitle || '').toLowerCase()) || 9999;
        if(rank > 0 && rank < entry.bestRank) entry.bestRank = rank;
        if(rank > 0 && rank < 1000) entry.points += calculatePoints(rank);
        if(run.levelTitle) entry.topLevels.add(String(run.levelTitle).trim());
      });
      return Array.from(map.values()).map(entry => ({
        name: entry.name,
        runs: entry.runs,
        bestRank: entry.bestRank === 9999 ? '—' : `#${entry.bestRank}`,
        points: entry.points,
        topLevels: Array.from(entry.topLevels).slice(0, 3).join(', ')
      })).sort((a,b) => {
        if(b.points !== a.points) return b.points - a.points;
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
        playersArea.innerHTML = '<tr><td colspan="5" class="muted">No player data found.</td></tr>';
        return;
      }

      const fragment = document.createDocumentFragment();
      filtered.forEach(item => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td'); tdName.textContent = item.name;
        const tdRuns = document.createElement('td'); tdRuns.textContent = String(item.runs);
        const tdPoints = document.createElement('td'); tdPoints.textContent = String(item.points);
        const tdRank = document.createElement('td'); tdRank.textContent = item.bestRank;
        const tdLevels = document.createElement('td'); tdLevels.textContent = item.topLevels;
        tr.appendChild(tdName);
        tr.appendChild(tdRuns);
        tr.appendChild(tdPoints);
        tr.appendChild(tdRank);
        tr.appendChild(tdLevels);
        fragment.appendChild(tr);
      });
      playersArea.appendChild(fragment);
    }

    function showLoading(){
      playersArea.innerHTML = '<tr><td colspan="5" class="muted">Loading player stats...</td></tr>';
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
          playersArea.innerHTML = '<tr><td colspan="5" class="muted">Could not load player stats.</td></tr>';
        });
    }

    searchEl.addEventListener('input', debounce(renderTable, 120));
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
        }).catch(err=>{listArea.innerHTML='<p class="muted">Failed to load list data.</p>'; console.error(err)});
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
        searchEl.addEventListener('input', debounce(()=> renderTable(currentItems), 120));
        filterSelect.addEventListener('change', ()=> renderTable(currentItems));
        controlsBound = true;
      }
    }

    function selectLevel(level, items, linkEl){
      levelsEl.querySelectorAll('.level-link').forEach(a=>a.classList.remove('active'));
      if(linkEl) linkEl.classList.add('active');
      qs('level-filter').value = level;
      renderTable(items);
      if(window.anime && !animationsDisabled() && !listAnimationsDisabled()){
        const tableWrap = document.querySelector('.table-wrap');
        if(tableWrap){
          window.anime({ targets: tableWrap, translateY: [8, 0], opacity: [0.7, 1], duration: 400, easing: 'easeOutQuad' });
        }
      }
    }

    function renderTable(items){
      const q = (searchEl && searchEl.value || '').toLowerCase();
      const levelFilter = (filterSelect && filterSelect.value) || 'all';
      const filtered = items.filter(it=>{
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
      if((q || levelFilter !== 'all' && levelFilter !== 'Full List') && window.anime && !animationsDisabled()){
        const tableWrap = document.querySelector('.table-wrap');
        if(tableWrap){
          window.anime({ targets: tableWrap, scale: [0.99, 1], duration: 300, easing: 'easeOutQuad' });
        }
      }
      if(!filtered.length){
        tbody.innerHTML = '<tr><td colspan="4" class="muted">No levels match this search or range.</td></tr>';
        return;
      }
      currentItems = filtered;
      const accId = fedlDataUserId();
      const fragment = document.createDocumentFragment();
      const allRows = [];
      filtered.forEach(it=>{
        const tr = document.createElement('tr');
        if(window.anime && !animationsDisabled()){ tr.style.opacity = '0'; tr.style.transform = 'translateX(-20px) translateY(10px)'; }
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
            if(window.anime && !animationsDisabled() && !listAnimationsDisabled()){
              window.anime({ targets: inp, scale: [1, 1.08, 1], duration: 400, easing: 'easeOutBack' });
            }
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
        allRows.push(tr);
        fragment.appendChild(tr);
      });
      tbody.appendChild(fragment);
      if(window.anime && !animationsDisabled() && !listAnimationsDisabled()){
        const speed = getAnimationSpeed();
        const rowObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if(entry.isIntersecting){
              const row = entry.target;
              window.anime({
                targets: row,
                opacity: [0,1],
                translateX: [-20,0],
                translateY: [10,0],
                duration: speed,
                easing: 'easeOutCubic'
              });
              rowObserver.unobserve(row);
            }
          });
        }, { threshold: 0.1 });
        allRows.forEach(row => rowObserver.observe(row));
      } else {
        allRows.forEach(r => { r.style.opacity = '1'; r.style.transform = 'translateX(0) translateY(0)'; });
      }
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
    fedlRefreshAuthState().then(j=>{
      if(!j) return;
      const username = (j.username || '').toLowerCase();
      if(!username || !MOD_USERS.map(m=>m.toLowerCase()).includes(username)){
        window.location.href = 'index.html';
      }
    });
    const loginScreenEl = qs('admin-login-screen');
    const adminShellContentEl = qs('admin-shell-content');
    const loginFormEl = qs('admin-login-form');
    const adminPasswordEl = qs('admin-password');
    const authStatusEl = qs('admin-auth-status');
    const statusEl = qs('admin-status');
    const listTbody = qs('admin-list-body');
    const addBtn = qs('add-row');
    const addRowBottomBtn = qs('add-row-bottom');
    const saveBtn = qs('save-list');
    const searchEl = qs('admin-search');
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
        authStatusEl.textContent = password ? 'Password saved for this browser session.' : 'Saved only in this browser session.';
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

    function handleAdminAuthFailure(message){
      setAdminPassword('');
      document.body.classList.add('admin-locked');
      if(adminShellContentEl) adminShellContentEl.hidden = true;
      if(loginScreenEl) loginScreenEl.hidden = false;
      if(authStatusEl){
        authStatusEl.textContent = message || 'Admin password required or incorrect.';
        authStatusEl.classList.add('error-text');
      }
    }

    function unlockAdminShell(){
      document.body.classList.remove('admin-locked');
      if(loginScreenEl) loginScreenEl.hidden = true;
      if(adminShellContentEl) adminShellContentEl.hidden = false;
    }

    function verifyAdminPassword(){
      if(!getAdminPassword()){
        handleAdminAuthFailure('Enter the admin password to continue.');
        return Promise.resolve(false);
      }
      return fetch(`${liveRunsUrl}/__authcheck__`, {
        method:'DELETE',
        headers:authHeaders()
      }).then(r=>{
        if(r.status === 401) throw new Error('Admin auth failed');
        if(r.status !== 404 && r.status !== 204) throw new Error('Verify failed');
        return true;
      }).then(ok=>{
        unlockAdminShell();
        loadAdmin();
        loadRunsAdmin();
        return ok;
      }).catch(err=>{
        console.error(err);
        handleAdminAuthFailure('Wrong admin password. Try again.');
        return false;
      });
    }

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

    if(getAdminPassword()){
      verifyAdminPassword();
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
          reviewedBy: fedlServerUsername || 'FEDL Admin'
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
      if(deleteButton){
        const deleteIndex = deleteButton.getAttribute('data-delete');
        if(deleteIndex == null) return;
        const index = Number(deleteIndex);
        if(Number.isNaN(index)) return;
        items.splice(index, 1);
        normalizePositions();
        renderAdminTable();
        setStatus('Row removed. Save when ready.');
      }
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

    if(addRowBottomBtn){
      addRowBottomBtn.addEventListener('click', function(){
        items.push({level:'new', position:'', title:'', url:'', _isDraft:true});
        normalizePositions();
        renderAdminTable();
        setStatus('New row added at the bottom.');
      });
    }

    saveBtn.addEventListener('click', function(){
      saveItems();
    });

    if(searchEl){
      searchEl.addEventListener('input', debounce(()=> renderAdminTable(), 120));
      searchEl.addEventListener('input', function(){
        if(window.anime && !animationsDisabled()){
          window.anime({ targets: this, scale: [1, 1.02, 1], duration: 400, easing: 'easeOutQuad' });
        }
      });
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
    document.addEventListener('keydown', event=>{
      if(event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
      const key = event.key.toLowerCase();
      if(key === '/' && !event.ctrlKey && !event.metaKey){
        event.preventDefault();
        const searchInput = document.querySelector('.search-row input[type="text"], #list-search, .levels-table input');
        if(searchInput) searchInput.focus();
      }
      if(key === 'h' && !event.ctrlKey && !event.metaKey){
        window.location.href = 'index.html';
      }
      if(key === 'l' && !event.ctrlKey && !event.metaKey){
        window.location.href = 'lists.html';
      }
      if(key === 'r' && !event.ctrlKey && !event.metaKey){
        window.location.href = 'run.html';
      }
      if(key === '?' && !event.ctrlKey && !event.metaKey){
        window.location.href = 'rules.html';
      }
    });

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

    loadAdmin();
    loadRunsAdmin();

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
        if(tab) {
          const panel = document.getElementById(`tab-${tab}`);
          if(panel && window.anime && !animationsDisabled()){
            panel.style.opacity = '0';
            panel.style.transform = 'translateY(6px)';
            window.anime({
              targets: panel,
              opacity: [0, 1],
              translateY: [6, 0],
              duration: 300,
              easing: 'easeOutCubic'
            });
          }
          switchAdminTab(tab);
        }
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
      runs.slice(0, 8).forEach((run, idx)=>{
        const card = document.createElement('article');
        card.className = 'submission-card run-card-in';
        card.style.animationDelay = `${idx * 60}ms`;
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
        empty.textContent = 'No runs saved yet. Fill the form and use "Save to my account" to keep drafts, or submit to the live queue.';
        savedRunsListEl.appendChild(empty);
        return;
      }
      runs.forEach((entry, idx)=>{
        const card = document.createElement('article');
        card.className = 'submission-card run-saved-card run-card-in';
        card.style.animationDelay = `${idx * 60}ms`;
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
          if(window.GlassToast) window.GlassToast.show('info', 'Run loaded', 'Draft filled into the form.');
        });
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn ghost-btn small-btn';
        delBtn.textContent = 'Remove';
        delBtn.addEventListener('click', ()=>{
          const cardEl = card;
          animateSavedRunCard(cardEl, 'out');
          setTimeout(()=>{
            fedlRemoveSavedRun(fedlServerUserId, entry.id);
            renderMySavedRuns();
          }, 320);
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
          if(window.GlassToast) window.GlassToast.show('error', 'Save failed', res.error);
          return;
        }
        setRunFormStatus('Run saved to your account. You can keep multiple saved runs and load them anytime.', false, true);
        if(window.GlassToast) window.GlassToast.show('success', 'Run saved', 'Saved to your account.');
        if(window.anime && !animationsDisabled()){
          const statusEl = qs('run-form-status');
          if(statusEl){
            window.anime({ targets: statusEl, scale: [1, 1.03, 1], duration: 500, easing: 'easeOutBack' });
          }
        }
        renderMySavedRuns();
      });
    }

    function animateSavedRunCard(card, direction){
      if(!window.anime || animationsDisabled()) return;
      if(direction === 'in'){
        card.style.opacity = '0';
        card.style.transform = 'translateY(16px) scale(0.96)';
        window.anime({
          targets: card,
          opacity: [0, 1],
          translateY: [16, 0],
          scale: [0.96, 1],
          duration: getAnimationSpeed() * 0.5,
          easing: 'easeOutCubic'
        });
      } else if(direction === 'out'){
        window.anime({
          targets: card,
          opacity: [1, 0],
          scale: [1, 0.95],
          duration: 300,
          easing: 'easeInCubic',
          complete: () => { card.remove(); }
        });
      }
    }

    document.addEventListener('fedl-auth-updated', ()=>{
      renderMySavedRuns();
      applyRunPlayerDefault();
    });

    form.addEventListener('submit', function(event){
      event.preventDefault();
      if(!canUseLiveServer){
        setRunFormStatus('Submitting runs is not available right now.', true);
        if(window.GlassToast) window.GlassToast.show('error', 'Server offline', 'Submitting runs is not available right now.');
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
      const submitBtn = qs('run-submit');
      if(submitBtn && window.anime && !animationsDisabled()){
        submitBtn.classList.add('btn-loading');
        submitBtn.disabled = true;
      }
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
        if(window.GlassToast) window.GlassToast.show('success', 'Run submitted', 'Your run is in the review queue.');
        const submitBtn = qs('run-submit');
        if(submitBtn){
          submitBtn.classList.remove('btn-loading');
          submitBtn.disabled = false;
        }
        if(window.anime && !animationsDisabled()){
          const statusEl = qs('run-form-status');
          if(statusEl){
            statusEl.className = 'muted success-text run-success success-shine';
            window.anime({ targets: statusEl, scale: [1, 1.03, 1], duration: 500, easing: 'easeOutBack' });
          }
        }
        return refreshRuns();
        }).catch(err=>{
        console.error(err);
        const submitBtn = qs('run-submit');
        if(submitBtn){
          submitBtn.classList.remove('btn-loading');
          submitBtn.disabled = false;
        }
        setRunFormStatus(err.message || 'Could not submit the run. Check the server and try again.', true);
        if(window.GlassToast) window.GlassToast.show('error', 'Submit failed', err.message || 'Could not submit the run. Check the server and try again.');
      });
    });

    bindLiveUpdates();
    onRunsUpdate(function(updatedRuns){
      const sortedRuns = updatedRuns.slice().sort((a,b)=>new Date(b.submittedAt) - new Date(a.submittedAt));
      renderRunSubmissions(sortedRuns);
      setRunListStatus('Recent submissions reloaded.');
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
  const FEDL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const FEDL_AUTH_REDIRECT_MS = 1400;
  function fedlSetFormStatus(el, msg, kind){
    if (!el) {
      return;
    }
    el.textContent = msg || '';
    el.className =
      kind === 'error' ? 'muted error-text' : kind === 'success' ? 'muted success-text' : 'muted';
  }

  if (page === 'signup') {
    const form = qs('signup-form');
    const statusEl = qs('signup-status');
    const submitBtn = qs('signup-submit');
    function setSignupStatus(msg, kind){
      fedlSetFormStatus(statusEl, msg, kind);
    }
    function checkTurnstile(){
      if(TESTING_MODE) return true;
      const responseEl = qs('turnstile-response');
      const token = responseEl ? String(responseEl.value || '') : '';
      if(!token){
        setSignupStatus('Please complete the verification challenge.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Verification required', 'Please complete the challenge.');
        return false;
      }
      return true;
    }
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      if(!checkTurnstile()) return;
      if (!canUseLiveServer) {
        setSignupStatus('Sign up is not available right now.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Server offline', 'Sign up is not available right now.');
        return;
      }
      const username = String(qs('signup-username').value || '').trim().toLowerCase();
      const password = qs('signup-password').value || '';
      const password2 = qs('signup-password2').value || '';
      if (!FEDL_USERNAME_RE.test(username)) {
        setSignupStatus('Use 3–24 characters: lowercase letters, numbers, or underscore only.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Invalid username', 'Use 3–24 characters: lowercase letters, numbers, or underscore only.');
        return;
      }
      if (password.length < 8) {
        setSignupStatus('Password must be at least 8 characters.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Weak password', 'Password must be at least 8 characters.');
        return;
      }
      if (password !== password2) {
        setSignupStatus('Passwords do not match.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Passwords mismatch', 'Passwords do not match.');
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
        if(window.GlassToast) window.GlassToast.show('success', 'Welcome!', 'Account created successfully.');
        return fedlPullUserStateToLocal(data.userId);
      }).then(()=>{
        setSignupStatus('You are signed in. Redirecting…', 'success');
        setTimeout(()=>{
          const params = new URLSearchParams(window.location.search);
          const returnUrl = params.get('return') || 'index.html';
          window.location.href = returnUrl;
        }, FEDL_AUTH_REDIRECT_MS);
      }).catch(err=>{
        console.error(err);
        setSignupStatus(err.message || 'Could not sign up.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Sign up failed', err.message || 'Could not sign up.');
        submitBtn.disabled = false;
      });
    });
  }

  if (page === 'login') {
    const form = qs('login-form');
    const statusEl = qs('login-status');
    const submitBtn = qs('login-submit');
    function setLoginStatus(msg, kind){
      fedlSetFormStatus(statusEl, msg, kind);
    }
    function checkTurnstile(){
      if(TESTING_MODE) return true;
      const responseEl = qs('turnstile-response');
      const token = responseEl ? String(responseEl.value || '') : '';
      if(!token){
        setLoginStatus('Please complete the verification challenge.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Verification required', 'Please complete the challenge.');
        return false;
      }
      return true;
    }
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      if(!checkTurnstile()) return;
      if (!canUseLiveServer) {
        setLoginStatus('Log in is not available right now.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Server offline', 'Log in is not available right now.');
        return;
      }
      const username = String(qs('login-username').value || '').trim().toLowerCase();
      const password = qs('login-password').value || '';
      if (!username) {
        setLoginStatus('Enter your username.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Missing username', 'Enter your username.');
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
        if(window.GlassToast) window.GlassToast.show('success', 'Welcome back!', 'Signed in successfully.');
        return fedlPullUserStateToLocal(data.userId);
      }).then(()=>{
        setLoginStatus('Welcome back. Redirecting…', 'success');
        setTimeout(()=>{
          const params = new URLSearchParams(window.location.search);
          const returnUrl = params.get('return') || 'index.html';
          window.location.href = returnUrl;
        }, FEDL_AUTH_REDIRECT_MS);
      }).catch(err=>{
        console.error(err);
        setLoginStatus(err.message || 'Could not log in.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Login failed', err.message || 'Could not log in.');
        submitBtn.disabled = false;
      });
    });
  }

  // Handle Google Sign-In callback
  window.handleGoogleSignIn = function(response) {
    if (!response || !response.credential) {
      console.error('Google Sign-In failed: No credential received');
      return;
    }

    const statusEl = qs('login-status');
    if (statusEl) {
      fedlSetFormStatus(statusEl, 'Signing in with Google…');
    }

    // Send the JWT token to your backend for verification
    fetch(liveApiPath('/api/auth/google'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: response.credential })
    }).then(async r => {
      const { data, message } = await fedlReadJsonResponse(r);
      if (!r.ok) {
        throw new Error(message || 'Google authentication failed');
      }
      fedlSetAuthToken(data.token);
      fedlServerUserId = data.userId;
      fedlServerUsername = data.username;
      document.dispatchEvent(new CustomEvent('fedl-auth-updated'));
      if (statusEl) {
        fedlSetFormStatus(statusEl, 'Signed in successfully. Loading your data…', 'success');
      }
      if(window.GlassToast) window.GlassToast.show('success', 'Welcome back!', 'Signed in with Google.');
      return fedlPullUserStateToLocal(data.userId);
    }).then(() => {
      if (statusEl) {
        fedlSetFormStatus(statusEl, 'Welcome back. Redirecting…', 'success');
      }
      setTimeout(() => {
        const params = new URLSearchParams(window.location.search);
        const returnUrl = params.get('return') || 'index.html';
        window.location.href = returnUrl;
      }, FEDL_AUTH_REDIRECT_MS);
    }).catch(err => {
      console.error('Google Sign-In error:', err);
      if (statusEl) {
        fedlSetFormStatus(statusEl, err.message || 'Could not sign in with Google.', 'error');
      }
      if(window.GlassToast) window.GlassToast.show('error', 'Google sign-in failed', err.message || 'Could not sign in with Google.');
    });
  };

  // Handle Google Sign-Up callback (unify with Google token endpoint)
  window.handleGoogleSignUp = function(response) {
    if (!response || !response.credential) {
      console.error('Google Sign-Up failed: No credential received');
      return;
    }

    const statusEl = qs('signup-status');
    if (statusEl) {
      fedlSetFormStatus(statusEl, 'Creating account with Google…');
    }

    // Send the JWT token to your backend for verification (use token endpoint)
    fetch(liveApiPath('/api/auth/google/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: response.credential })
    }).then(async r => {
      const { data, message } = await fedlReadJsonResponse(r);
      if (!r.ok) {
        throw new Error(message || 'Google sign-up failed');
      }
      fedlSetAuthToken(data.token);
      fedlServerUserId = data.userId;
      fedlServerUsername = data.username;
      document.dispatchEvent(new CustomEvent('fedl-auth-updated'));
      if (statusEl) {
        fedlSetFormStatus(statusEl, 'Account created successfully. Loading your data…', 'success');
      }
      if(window.GlassToast) window.GlassToast.show('success', 'Welcome!', 'Account created with Google.');
      return fedlPullUserStateToLocal(data.userId);
    }).then(() => {
      if (statusEl) {
        fedlSetFormStatus(statusEl, 'You are signed in. Redirecting…', 'success');
      }
      setTimeout(() => {
        const params = new URLSearchParams(window.location.search);
        const returnUrl = params.get('return') || 'index.html';
        window.location.href = returnUrl;
      }, FEDL_AUTH_REDIRECT_MS);
    }).catch(err => {
      console.error('Google Sign-Up error:', err);
      if (statusEl) {
        fedlSetFormStatus(statusEl, err.message || 'Could not create account with Google.', 'error');
      }
      if(window.GlassToast) window.GlassToast.show('error', 'Google sign-up failed', err.message || 'Could not create account with Google.');
    });
  };

  if (page === 'account') {
    const FEDL_THEME_KEY = 'fedl_theme';
    const themeStatusEl = qs('account-theme-status');

    const themes = {
      dark: { '--bg': '#0f1724', '--panel': '#071326', '--accent': '#5cc5ff', '--muted': '#9fb3c8', '--text': '#e6eef8', '--card': '#081220', '--accent-warm': '#ffb84d' },
      light: { '--bg': '#f0f4f8', '--panel': '#e2e8f0', '--accent': '#0284c7', '--muted': '#64748b', '--text': '#1e293b', '--card': '#cbd5e1', '--accent-warm': '#f59e0b' },
      blue: { '--bg': '#0d1b2a', '--panel': '#1b3a5f', '--accent': '#38bdf8', '--muted': '#94a3b8', '--text': '#e0f2fe', '--card': '#142d4c', '--accent-warm': '#fbbf24' },
      midnight: { '--bg': '#0a0a12', '--panel': '#12121f', '--accent': '#a78bfa', '--muted': '#6b7280', '--text': '#e5e7eb', '--card': '#0f0f1a', '--accent-warm': '#f472b6' },
      cyberpunk: { '--bg': '#0f0f1a', '--panel': '#1a0a2e', '--accent': '#00ff9f', '--muted': '#b388ff', '--text': '#e0f7fa', '--card': '#150f25', '--accent-warm': '#ff00a8' },
      earth: { '--bg': '#1a2f1a', '--panel': '#2d4a2d', '--accent': '#84cc16', '--muted': '#a3c9a3', '--text': '#ecfccb', '--card': '#223d22', '--accent-warm': '#fbbf24' },
      retro: { '--bg': '#1a1208', '--panel': '#2b1a0a', '--accent': '#ff9f1c', '--muted': '#c9a66b', '--text': '#ffe4b5', '--card': '#241809', '--accent-warm': '#ff6b35' },
      matrix: { '--bg': '#000a00', '--panel': '#001100', '--accent': '#00ff00', '--muted': '#00aa00', '--text': '#00ff00', '--card': '#001100', '--accent-warm': '#88ff88' },
      synthwave: { '--bg': '#1a0a2e', '--panel': '#2d1b4e', '--accent': '#ff2a6d', '--muted': '#c792ea', '--text': '#f4e9ff', '--card': '#251440', '--accent-warm': '#05d9e8' },
      fire: { '--bg': '#1a0505', '--panel': '#2d0a0a', '--accent': '#ff4500', '--muted': '#cc5500', '--text': '#ffd4b8', '--card': '#250a0a', '--accent-warm': '#ffaa00' },
      galaxy: { '--bg': '#0a0612', '--panel': '#150f25', '--accent': '#e056fd', '--muted': '#7c3aed', '--text': '#f0e6ff', '--card': '#0f0818', '--accent-warm': '#f9ca24' },
      candy: { '--bg': '#fdf2f8', '--panel': '#fce7f3', '--accent': '#f472b6', '--muted': '#94a3b8', '--text': '#831843', '--card': '#fbcfe8', '--accent-warm': '#34d399' },
      highcontrast: { '--bg': '#000000', '--panel': '#111111', '--accent': '#ffffff', '--muted': '#cccccc', '--text': '#ffffff', '--card': '#0a0a0a', '--accent-warm': '#ffff00' },
      original: { '--bg': '#0f1724', '--panel': '#071326', '--accent': '#5cc5ff', '--muted': '#9fb3c8', '--text': '#e6eef8', '--card': '#081220', '--accent-warm': '#ffb84d' }
    };

    function applyTheme(name, animate = true) {
      const root = document.documentElement;
      const vars = themes[name];
      if (!vars) return;

      if (animate && window.anime && !animationsDisabled()) {
        let overlay = document.getElementById('theme-transition-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'theme-transition-overlay';
          overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;opacity:0;background:' + vars['--accent'];
          document.body.appendChild(overlay);
        }
        overlay.style.background = vars['--accent'];
        window.anime({
          targets: overlay,
          opacity: [0, 0.3, 0],
          duration: 600,
          easing: 'easeInOutQuad',
          begin: () => { overlay.style.display = 'block'; },
          update: (anim) => {
            if (anim.progress > 30 && anim.progress < 70) {
              Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
              document.body.dataset.theme = name;
            }
          },
          complete: () => { overlay.style.display = 'none'; }
        });
      } else {
        Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
        document.body.dataset.theme = name;
      }
    }

    function setThemeStatus(msg, kind) {
      fedlSetFormStatus(themeStatusEl, msg, kind);
    }

    function loadTheme() {
      const saved = localStorage.getItem(FEDL_THEME_KEY) || 'dark';
      applyTheme(saved, false);
      document.querySelectorAll('input[name="theme"]').forEach(el => {
        el.checked = el.value === saved;
      });
    }

    document.querySelectorAll('input[name="theme"]').forEach(el => {
      el.addEventListener('change', function() {
        const name = this.value;
        const preview = this.parentElement.querySelector('.theme-preview');
        if (window.anime && preview && !animationsDisabled()) {
          window.anime({
            targets: preview,
            scale: [1, 1.2, 1],
            duration: 400,
            easing: 'easeInOutBack'
          });
        }
        localStorage.setItem(FEDL_THEME_KEY, name);
        applyTheme(name);
        const activeId = fedlAccountId();
        if (activeId) {
          const accounts = fedlListAccounts();
          const account = accounts.find(a => a.id === activeId);
          if (account) {
            account.theme = name;
            fedlSaveAccountsList(accounts);
            const userData = fedlGetAccountPayload(activeId);
            userData.theme = name;
            write(`fedl_user_data_${activeId}`, userData);
          }
        }
        setThemeStatus('Theme saved!', 'success');
        if(window.GlassToast) window.GlassToast.show('success', 'Theme saved', 'Theme updated successfully.');
        const themePanel = document.querySelector('.account-panel:nth-child(2)');
        if(themePanel && window.anime && !animationsDisabled()){
          themePanel.classList.add('success-shine');
          window.anime({ targets: themePanel, scale: [1, 1.01, 1], duration: 400, easing: 'easeOutBack', complete: () => themePanel.classList.remove('success-shine') });
        }
      });
    });

    function loadAccountTheme() {
      const activeId = fedlAccountId();
      if (activeId) {
        const userData = fedlGetAccountPayload(activeId);
        if (userData && userData.theme) {
          localStorage.setItem(FEDL_THEME_KEY, userData.theme);
          applyTheme(userData.theme, false);
        }
      }
    }

    loadTheme();
    loadAccountTheme();

    const animToggle = qs('account-animations-toggle');
    if(animToggle){
      animToggle.checked = !animationsDisabled();
      animToggle.addEventListener('change', function(){
        setAnimationsDisabled(!this.checked);
        const panel = this.closest('.account-panel');
        if(panel && window.anime && !animationsDisabled()){
          window.anime({ targets: panel, scale: [1, 1.01, 1], duration: 400, easing: 'easeOutBack' });
        }
      });
    }
    const listAnimToggle = qs('account-list-animations-toggle');
    if(listAnimToggle){
      listAnimToggle.checked = !listAnimationsDisabled();
      listAnimToggle.addEventListener('change', function(){
        localStorage.setItem(FEDL_LIST_ANIM_KEY, String(!this.checked));
        const panel = this.closest('.account-panel');
        if(panel && window.anime && !animationsDisabled()){
          window.anime({ targets: panel, scale: [1, 1.01, 1], duration: 400, easing: 'easeOutBack' });
        }
      });
    }
    const speedSlider = qs('account-animation-speed');
    const speedLabel = qs('account-animation-speed-label');
    if(speedSlider && speedLabel){
      speedSlider.value = getAnimationSpeed();
      speedLabel.textContent = speedSlider.value + 'ms';
      speedSlider.addEventListener('input', function(){
        localStorage.setItem(FEDL_ANIM_SPEED_KEY, String(this.value));
        speedLabel.textContent = this.value + 'ms';
        if(window.anime && !animationsDisabled()){
          window.anime({ targets: speedLabel, scale: [1, 1.1, 1], duration: 300, easing: 'easeOutBack' });
        }
      });
    }

    const adsToggle = qs('account-ads-toggle');
    if(adsToggle){
      adsToggle.checked = adsEnabled();
      adsToggle.addEventListener('change', function(){
        setAdsEnabled(this.checked);
        if(this.checked && !window.fedlAdScriptLoaded){
          loadAdsScript();
        }
        const panel = this.closest('.account-panel');
        if(panel && window.anime && !animationsDisabled()){
          window.anime({ targets: panel, scale: [1, 1.01, 1], duration: 400, easing: 'easeOutBack' });
        }
      });
    }

    const overviewStatusEl = qs('account-overview-status');
    const accountUsernameEl = qs('account-username');
    const accountCreatedEl = qs('account-created');
    const resetBtn = qs('account-reset-email-btn');
    const resetStatusEl = qs('account-reset-status');
    const passwordForm = qs('account-password-form');
    const passwordStatusEl = qs('account-password-status');
    const passwordSubmit = qs('account-password-submit');

    function setOverviewStatus(msg, kind){
      fedlSetFormStatus(overviewStatusEl, msg, kind);
    }
    function setResetStatus(msg, kind){
      fedlSetFormStatus(resetStatusEl, msg, kind);
    }
    function setPasswordStatus(msg, kind){
      fedlSetFormStatus(passwordStatusEl, msg, kind);
    }
    function formatJoinedDate(iso){
      if (!iso) return 'Unknown';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'Unknown';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }
    function authHeaders(){
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fedlGetAuthToken()}`
      };
    }
    function loadAccount(){
      if (!fedlGetAuthToken()) {
        window.location.replace('login.html?return=' + encodeURIComponent('account.html'));
        return Promise.resolve();
      }
      setOverviewStatus('Loading your account…');
      return fetch(liveApiPath('/api/account'), {
        headers: { Authorization: `Bearer ${fedlGetAuthToken()}` },
        cache: 'no-store'
      }).then(async r=>{
        const { data, message } = await fedlReadJsonResponse(r);
        if (!r.ok) {
          throw new Error(message || 'Could not load account details.');
        }
        if (accountUsernameEl) {
          accountUsernameEl.textContent = data.username || 'Unknown';
        }
        if (accountCreatedEl) {
          accountCreatedEl.textContent = formatJoinedDate(data.createdAt);
        }
        setOverviewStatus('');
      }).catch(err=>{
        console.error(err);
        setOverviewStatus(err.message || 'Could not load your account.', 'error');
        if(window.GlassToast) window.GlassToast.show('error', 'Account error', err.message || 'Could not load your account.');
        if (String(err.message || '').toLowerCase().includes('not signed in')) {
          window.location.replace('login.html?return=' + encodeURIComponent('account.html'));
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function(){
        resetBtn.disabled = true;
        setResetStatus('Sending reset code to your messages…');
        fetch(liveApiPath('/api/account/password-reset-email'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${fedlGetAuthToken()}` }
        }).then(async r=>{
          const { message } = await fedlReadJsonResponse(r);
          if (!r.ok) {
            throw new Error(message || 'Could not send reset code.');
          }
          setResetStatus('Reset code sent! Check your messages.', 'success');
          if(window.GlassToast) window.GlassToast.show('success', 'Reset code sent', 'Check your messages for the code.');
        }).catch(err=>{
          console.error(err);
          setResetStatus(err.message || 'Could not send reset code.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Reset failed', err.message || 'Could not send reset code.');
        }).finally(()=>{
          resetBtn.disabled = false;
        });
      });
    }

    if (passwordForm) {
      passwordForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        const currentPassword = String(qs('account-current-password').value || '');
        const newPassword = String(qs('account-new-password').value || '');
        const confirmPassword = String(qs('account-confirm-password').value || '');
        if (!currentPassword) {
          setPasswordStatus('Enter your current password.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Missing field', 'Enter your current password.');
          if(window.anime && !animationsDisabled()){
            window.anime({ targets: qs('account-current-password'), translateX: [-4,4,-4,4,0], duration: 300, easing: 'easeInOutQuad' });
          }
          return;
        }
        if (newPassword.length < 8) {
          setPasswordStatus('New password must be at least 8 characters.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Weak password', 'New password must be at least 8 characters.');
          return;
        }
        if (newPassword !== confirmPassword) {
          setPasswordStatus('New passwords do not match.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Passwords mismatch', 'New passwords do not match.');
          return;
        }
        if (passwordSubmit) {
          passwordSubmit.disabled = true;
        }
        setPasswordStatus('Updating password…');
        fetch(liveApiPath('/api/account/password'), {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ currentPassword, newPassword })
        }).then(async r=>{
          const { data, message } = await fedlReadJsonResponse(r);
          if (!r.ok) {
            throw new Error(message || 'Could not update password.');
          }
          if (data && data.token) {
            fedlSetAuthToken(data.token);
          }
          passwordForm.reset();
          setPasswordStatus('Password updated.', 'success');
          if(window.GlassToast) window.GlassToast.show('success', 'Password updated', 'Your password has been changed.');
        }).catch(err=>{
          console.error(err);
          setPasswordStatus(err.message || 'Could not update password.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Password error', err.message || 'Could not update password.');
        }).finally(()=>{
          if (passwordSubmit) {
            passwordSubmit.disabled = false;
          }
        });
      });
    }

    loadAccount();
  }

  if (page === 'reset-password') {
    const requestForm = qs('reset-request-form');
    const requestStatusEl = qs('reset-request-status');
    const requestSubmit = qs('reset-request-submit');
    const requestInput = qs('reset-identifier');
    const tokenInput = qs('reset-token');
    const resetForm = qs('reset-password-form');
    const resetStatusEl = qs('reset-password-status');
    const resetSubmit = qs('reset-password-submit');

    function setRequestStatus(msg, kind){
      fedlSetFormStatus(requestStatusEl, msg, kind);
    }
    function setResetPasswordStatus(msg, kind){
      fedlSetFormStatus(resetStatusEl, msg, kind);
    }

    if (tokenInput) {
      const params = new URLSearchParams(window.location.search);
      tokenInput.value = params.get('token') || '';
    }

    if (requestForm) {
      requestForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        if (!canUseLiveServer) {
          setRequestStatus('Password reset is not available right now.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Server offline', 'Password reset is not available right now.');
          return;
        }
        const identifier = String(requestInput ? requestInput.value : '').trim().toLowerCase();
        if (!identifier) {
          setRequestStatus('Enter your username or email.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Missing field', 'Enter your username or email.');
          return;
        }
        if (requestSubmit) {
          requestSubmit.disabled = true;
        }
        setRequestStatus('Checking for your account…');
        fetch(liveApiPath('/api/auth/request-password-reset'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier })
        }).then(async r=>{
          const data = await fedlReadJsonResponse(r);
          if (!r.ok) {
            throw new Error(data.message || 'Could not request password reset.');
          }
          setRequestStatus(data.message || 'Check your messages for the reset code.', 'success');
          if(window.GlassToast) window.GlassToast.show('success', 'Reset code sent', 'Check your messages for the reset code.');
          if (requestInput) {
            requestInput.value = '';
          }
        }).catch(err=>{
          console.error(err);
          setRequestStatus(err.message || 'Could not request password reset.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Reset request failed', err.message || 'Could not request password reset.');
        }).finally(()=>{
          if (requestSubmit) {
            requestSubmit.disabled = false;
          }
        });
      });
    }

    if (resetForm) {
      resetForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        if (!canUseLiveServer) {
          setResetPasswordStatus('Password reset is not available right now.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Server offline', 'Password reset is not available right now.');
          return;
        }
        const token = String(tokenInput ? tokenInput.value : '').trim();
        const newPassword = String(qs('reset-new-password').value || '');
        const confirmPassword = String(qs('reset-confirm-password').value || '');
        if (!token) {
          setResetPasswordStatus('Paste the reset code below.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Missing code', 'Paste the reset code below.');
          return;
        }
        if (newPassword.length < 8) {
          setResetPasswordStatus('New password must be at least 8 characters.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Weak password', 'New password must be at least 8 characters.');
          return;
        }
        if (newPassword !== confirmPassword) {
          setResetPasswordStatus('New passwords do not match.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Passwords mismatch', 'New passwords do not match.');
          return;
        }
        if (resetSubmit) {
          resetSubmit.disabled = true;
        }
        setResetPasswordStatus('Resetting your password…');
        fetch(liveApiPath('/api/auth/reset-password'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword })
        }).then(async r=>{
          const { message } = await fedlReadJsonResponse(r);
          if (!r.ok) {
            throw new Error(message || 'Could not reset password.');
          }
          resetForm.reset();
          if (tokenInput) {
            tokenInput.value = '';
          }
          setResetPasswordStatus('Password reset complete. You can log in with your new password now.', 'success');
          if(window.GlassToast) window.GlassToast.show('success', 'Password reset', 'You can log in with your new password.');
        }).catch(err=>{
          console.error(err);
          setResetPasswordStatus(err.message || 'Could not reset password.', 'error');
          if(window.GlassToast) window.GlassToast.show('error', 'Reset failed', err.message || 'Could not reset password.');
        }).finally(()=>{
          if (resetSubmit) {
            resetSubmit.disabled = false;
          }
        });
      });
    }
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
          setContactFormStatus('Reports are not available right now.', true);
          if(window.GlassToast) window.GlassToast.show('error', 'Server offline', 'Reports are not available right now.');
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
          if(window.GlassToast) window.GlassToast.show('error', 'Missing fields', 'Subject and description are required.');
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
          if(window.GlassToast) window.GlassToast.show('success', 'Report submitted', 'The admins will review it soon.');
          if(form) form.reset();
        }).catch(err=>{
          console.error(err);
          setContactFormStatus(err.message || 'Could not submit your report. Try again later.', true);
          if(window.GlassToast) window.GlassToast.show('error', 'Submit failed', err.message || 'Could not submit your report. Try again later.');
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

  // Load ads if enabled
  if (adsEnabled()) {
    loadAdsScript();
  }

  // Back to top button
  (function initBackToTop(){
    var btn = document.getElementById('back-to-top');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'back-to-top';
      btn.setAttribute('aria-label', 'Back to top');
      btn.setAttribute('title', 'Back to top');
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4l-8 8h5v8h6v-8h5z"/></svg>';
      document.body.appendChild(btn);
    }
    var threshold = 400;
    var visible = false;
    function onScroll(){
      var y = window.pageYOffset || document.documentElement.scrollTop;
      if (y > threshold && !visible) {
        visible = true;
        btn.classList.add('is-visible');
        if (window.anime && !animationsDisabled()) {
          window.anime({ targets: btn, scale: [0.5, 1], opacity: [0, 1], duration: 400, easing: 'easeOutBack' });
        }
      } else if (y <= threshold && visible) {
        visible = false;
        if (window.anime && !animationsDisabled()) {
          window.anime({ targets: btn, scale: [1, 0.5], opacity: [1, 0], duration: 300, easing: 'easeInCubic', complete: function(){ btn.classList.remove('is-visible'); } });
        } else {
          btn.classList.remove('is-visible');
        }
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    btn.addEventListener('click', function(e){
      e.preventDefault();
      if (window.anime && !animationsDisabled()) {
        window.anime({ targets: btn, scale: [1, 0.85, 1], duration: 300, easing: 'easeOutBack' });
      }
      var startY = window.pageYOffset || document.documentElement.scrollTop;
      if (window.anime && !animationsDisabled()) {
        var obj = { y: startY };
        window.anime({
          targets: obj,
          y: 0,
          duration: Math.min(startY * 0.5, 800),
          easing: 'easeInOutCubic',
          update: function(){ window.scrollTo(0, obj.y); }
        });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    onScroll();
  })();

  // Utility
  function escapeHtml(s){return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c])}
  function escapeAttr(s){return escapeHtml(String(s == null ? '' : s))}
})();