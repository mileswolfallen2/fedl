// Lightweight multi-page handler for GD fedl
(function(){
  function qs(id){return document.getElementById(id)}

  const page = document.body.dataset.page;
  let cachedItems = null;
  let cachedLevelMeta = null;

  // Storage helpers
  function read(key, fallback){
    try{const v = localStorage.getItem(key); return v?JSON.parse(v):fallback}
    catch(e){return fallback}
  }
  function write(key, val){localStorage.setItem(key,JSON.stringify(val))}

  function parseData(txt){
    return txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{
      const parts = l.split('|').map(p=>p.trim());
      return {level:parts[0]||'Unknown',position:parts[1]||'',title:parts[2]||'Untitled',url:parts[3]||''};
    });
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
    return fetch('data.txt').then(r=>r.text()).then(txt=>{
      cachedItems = parseData(txt);
      return cachedItems;
    });
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

  if(page==='roulette'){
    const spinBtn = qs('roulette-spin');
    const statusEl = qs('roulette-status');
    const titleEl = qs('roulette-title');
    const rankEl = qs('roulette-rank');
    const idEl = qs('roulette-level-id');
    const noteEl = qs('roulette-note');
    const openEl = qs('roulette-open');

    function showPick(item, meta){
      statusEl.textContent = 'Your demon is:';
      titleEl.textContent = item.title;
      rankEl.textContent = `Rank: #${item.position}`;
      idEl.textContent = `Level ID: ${meta.levelId || 'unknown'}`;
      noteEl.textContent = meta.source === 'api'
        ? 'Level ID was looked up from the Geometry Dash community API.'
        : 'Level ID came from your local level-ids.txt file.';
      if(item.url){
        openEl.hidden = false;
        openEl.href = item.url;
      }else{
        openEl.hidden = true;
      }
    }

    spinBtn.addEventListener('click', ()=>{
      statusEl.textContent = 'Spinning...';
      titleEl.textContent = 'Choosing a demon';
      rankEl.textContent = 'Rank: -';
      idEl.textContent = 'Level ID: -';
      noteEl.textContent = 'Checking your local file and API if needed.';
      openEl.hidden = true;
      Promise.all([loadItems(), loadLevelMeta()]).then(([items, metaMap])=>{
        if(!items.length){
          statusEl.textContent = 'No demons found.';
          titleEl.textContent = 'Add demons to data.txt';
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
        noteEl.textContent = 'The local file or API lookup failed.';
        console.error(err);
      });
    });
  }

  // Players page
  if(page==='players'){
    const form = qs('player-form'); const nameIn = qs('player-name'); const list = qs('players');
    let players = read('gd_players',[]);
    function render(){list.innerHTML=''; players.forEach((p,idx)=>{
      const li=document.createElement('li'); li.innerHTML=`<span><span class="name">${escapeHtml(p.name)}</span> <span class="muted">(${p.id})</span></span>`;
      const actions=document.createElement('div'); actions.className='actions';
      const edit=document.createElement('button'); edit.textContent='Edit'; edit.onclick=()=>{const nv=prompt('Edit name',p.name); if(nv){players[idx].name=nv; write('gd_players',players); render()}};
      const del=document.createElement('button'); del.textContent='Delete'; del.onclick=()=>{if(confirm('Delete player?')){players.splice(idx,1); write('gd_players',players); render()}};
      actions.appendChild(edit); actions.appendChild(del); li.appendChild(actions); list.appendChild(li);
    })}
    form.addEventListener('submit',e=>{e.preventDefault(); const name=nameIn.value.trim(); if(!name) return; players.push({id:Date.now().toString(36),name}); write('gd_players',players); nameIn.value=''; render()});
    render();
  }

  // Lists page
  if(page==='lists'){
    const levelsEl = qs('levels'); const listArea = qs('list-area'); const titleEl = qs('list-title');
    // Load hard-coded data file data.txt (category|position|title|url per line)
    function loadData(){
      loadItems().then(items=>{
        setupLevels(items);
      }).catch(err=>{listArea.innerHTML='<p class="muted">Failed to load data.txt — run via a local server.</p>'; console.error(err)});
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
      const filterSelect = qs('level-filter');
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
      // search and filter handlers
      qs('search').addEventListener('input', ()=> renderTable(items));
      filterSelect.addEventListener('change', ()=> renderTable(items));
      // default select Full List
      selectLevel('Full List', items, levelsEl.querySelector('.level-link'));
    }

    function selectLevel(level, items, linkEl){
      levelsEl.querySelectorAll('.level-link').forEach(a=>a.classList.remove('active'));
      if(linkEl) linkEl.classList.add('active');
      qs('level-filter').value = level;
      renderTable(items);
    }

    function renderTable(items){
      const q = (qs('search') && qs('search').value || '').toLowerCase();
      const levelFilter = (qs('level-filter') && qs('level-filter').value) || 'all';
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
      filtered.forEach(it=>{
        const tr = document.createElement('tr');
        const tdNum = document.createElement('td'); tdNum.textContent = it.position;
        const tdTitle = document.createElement('td'); tdTitle.textContent = it.title;
        const tdAct = document.createElement('td');
        const a = document.createElement('a'); a.textContent='Open'; a.href='#'; a.className='btn';
        a.addEventListener('click', (e)=>{e.preventDefault(); openVideo(it.url)});
        tdAct.appendChild(a);
        tr.appendChild(tdNum); tr.appendChild(tdTitle); tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
    }

    function openVideo(url){
      if(!url) return; const id = extractYouTubeID(url);
      if(!id){ window.open(url,'_blank'); return }
      let modal = document.querySelector('.video-modal');
      if(!modal){
        modal = document.createElement('div'); modal.className='video-modal';
        const inner = document.createElement('div'); inner.className='inner';
        const close = document.createElement('button'); close.textContent='Close'; close.className='btn'; close.style.float='right'; close.onclick=()=>modal.remove();
        inner.appendChild(close);
        const iframe = document.createElement('iframe'); iframe.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'; iframe.allowFullscreen=true;
        inner.appendChild(iframe); modal.appendChild(inner); document.body.appendChild(modal);
      }
      modal.querySelector('iframe').src = `https://www.youtube.com/embed/${id}`;
      modal.style.display = 'flex';
    }

    function extractYouTubeID(url){
      const m = url.match(/(?:v=|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/); return m?m[1]:'';
    }

    loadData();
  }

  // Utility
  function escapeHtml(s){return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c])}
})();
