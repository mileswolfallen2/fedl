// One Page App - FEDL
(function(){
  function qs(id){return document.getElementById(id)}
  function escapeHtml(str){return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function escapeAttr(str){return escapeHtml(str).replace(/'/g,'&#39;');}

  const page = document.body.dataset.page;
  const isFileProtocol = window.location.protocol === 'file:';
  const TESTING_MODE = false;
  const liveServerBase = TESTING_MODE ? 'http://127.0.0.1:8090/fedl' : 'https://server.fedl.site/fedl';
  const canUseLiveServer = !isFileProtocol || !!liveServerBase;
  const liveApiUrl = `${liveServerBase}/api/list`;
  const liveRunsUrl = `${liveServerBase}/api/runs`;
  const liveDataFileUrl = `${liveServerBase}/server/data.txt`;

  function liveApiPath(path){
    const p = String(path || '').startsWith('/') ? path : `/${path}`;
    return `${liveServerBase}${p}`;
  }

  let cachedItems = null;
  let cachedRuns = null;

  function loadItems(){
    if(cachedItems) return Promise.resolve(cachedItems);
    return fetch(liveApiUrl, {cache:'no-store'}).then(r=>r.text()).then(txt=>{
      cachedItems = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{
        const parts = l.split('|').map(p=>p.trim());
        return {level:parts[0]||'',position:parts[1]||'',title:parts[2]||'',url:parts[3]||''};
      });
      return cachedItems;
    }).catch(()=>[]);
  }

  function loadRuns(){
    if(cachedRuns) return Promise.resolve(cachedRuns);
    return fetch(liveRunsUrl, {cache:'no-store'}).then(r=>r.json()).then(data=>{
      cachedRuns = Array.isArray(data.items) ? data.items : [];
      return cachedRuns;
    }).catch(()=>[]);
  }

  function calculatePoints(rank){
    if(rank<1||rank>1000) return 0;
    if(rank===1) return 100;
    if(rank<=10) return 90-rank+1;
    if(rank<=25) return 80-rank+1;
    if(rank<=50) return 60-rank+1;
    if(rank<=100) return 40-rank+1;
    if(rank<=200) return 20-rank+1;
    return 1;
  }

  const spaPage = window.location.hash.slice(1) || 'home';
  const pages = document.querySelectorAll('.spa-page');

  function showPage(pageName){
    pages.forEach(p => p.hidden = true);
    const pageEl = document.getElementById('page-' + pageName);
    if(pageEl) pageEl.hidden = false;
    history.replaceState(null, '', '#' + pageName);
    loadPageContent(pageName);
  }

  function loadPageContent(pageName){
    if(pageName === 'lists' || pageName === 'home'){
      const listBody = qs('list-body');
      if(listBody && !listBody.dataset.loaded){
        listBody.dataset.loaded = 'true';
        loadItems().then(items=>{
          const ranked = items.slice().sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0));
          renderListTable(ranked);
          if(qs('hero-total-levels')){
            qs('hero-total-levels').textContent = String(ranked.length);
            qs('hero-top-entry').textContent = ranked[0]?.title || 'Unavailable';
          }
        });
      }
    }
    if(pageName === 'players'){
      const playersBody = qs('players-body');
      const searchEl = qs('player-search');
      if(playersBody && searchEl && !playersBody.dataset.loaded){
        playersBody.dataset.loaded = 'true';
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
          const players = Array.from(map.values()).map(entry => ({
            name: entry.name,
            runs: entry.runs,
            bestRank: entry.bestRank === 9999 ? '—' : `#${entry.bestRank}`,
            points: entry.points,
            topLevels: Array.from(entry.topLevels).slice(0, 3).join(', ')
          })).sort((a,b) => b.points - a.points || a.name.localeCompare(b.name));

          function render(){
            const query = (searchEl.value || '').toLowerCase();
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
          searchEl.addEventListener('input', render);
          render();
        });
      }
    }
    if(pageName === 'run'){
      const runForm = qs('run-form');
      if(runForm && !runForm.dataset.loaded){
        runForm.dataset.loaded = 'true';
        const formStatusEl = qs('run-form-status');
        runForm.addEventListener('submit', function(e){
          e.preventDefault();
          const playerName = qs('run-player-name').value.trim();
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
    if(pageName === 'roulette'){
      const spinBtn = qs('roulette-spin');
      const resultEl = qs('roulette-result');
      if(spinBtn && resultEl && !spinBtn.dataset.loaded){
        spinBtn.dataset.loaded = 'true';
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
    if(pageName === 'guess'){
      const higherBtn = qs('guess-higher');
      const lowerBtn = qs('guess-lower');
      const levelEl = qs('guess-level');
      const resultEl = qs('guess-result');
      const scoreEl = qs('guess-score');
      if(higherBtn && lowerBtn && levelEl && !higherBtn.dataset.loaded){
        higherBtn.dataset.loaded = 'true';
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

  function renderListTable(items){
    const tbody = qs('list-body');
    if(!tbody) return;
    const searchInput = qs('list-search');
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    const filtered = items.filter(item => !query || (item.title||'').toLowerCase().includes(query) || (item.level||'').toLowerCase().includes(query));
    if(!filtered.length){
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No levels found.</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(item => `
      <tr>
        <td>#${escapeHtml(item.position || '')}</td>
        <td>${escapeHtml(item.level || '')}</td>
        <td>${escapeHtml(item.title || '')}</td>
        <td>${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank">Video</a>` : ''}</td>
      </tr>
    `).join('');
    document.querySelectorAll('.skeleton-card').forEach(el => el.remove());
    const featuredList = qs('featured-list');
    if(featuredList){
      const top10 = items.slice(0, 10);
      featuredList.innerHTML = top10.map(item => `
        <article class="featured-card">
          <span class="featured-rank">#${escapeHtml(item.position || '--')}</span>
          <strong>${escapeHtml(item.title || 'Untitled')}</strong>
          <p>${item.url ? 'Video link ready.' : 'No video linked.'}</p>
        </article>
      `).join('');
    }
  }

  // Initialize
  const navLinks = document.querySelectorAll('nav a[data-nav]');
  navLinks.forEach(link => {
    link.addEventListener('click', function(e){
      e.preventDefault();
      showPage(this.dataset.nav);
    });
  });

  if(spaPage && document.getElementById('page-' + spaPage)){
    showPage(spaPage);
  }else{
    showPage('home');
  }

  // Search listener
  const listSearch = qs('list-search');
  if(listSearch){
    listSearch.addEventListener('input', ()=>{
      loadItems().then(items=>{
        const ranked = items.slice().sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0));
        renderListTable(ranked);
      });
    });
  }

})();