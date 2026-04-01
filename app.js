// Lightweight multi-page handler for GD fedl
(function(){
  function qs(id){return document.getElementById(id)}

  const page = document.body.dataset.page;
  const liveServerBase = 'https://raspberrypi-1.tail46eacb.ts.net/fedl';
  const liveApiUrl = `${liveServerBase}/api/list`;
  const liveEventsUrl = `${liveServerBase}/events`;
  const liveDataFileUrl = `${liveServerBase}/server/data.txt`;
  let cachedItems = null;
  let cachedLevelMeta = null;
  let liveBound = false;
  let liveHandlers = [];

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

  function onLiveUpdate(handler){
    liveHandlers.push(handler);
  }

  function notifyLiveUpdate(items){
    liveHandlers.forEach(handler=>handler(items));
  }

  function refreshItems(){
    clearItemsCache();
    return loadItems().then(items=>{
      notifyLiveUpdate(items);
      return items;
    });
  }

  function bindLiveUpdates(){
    if(liveBound || typeof window.EventSource === 'undefined') return;
    liveBound = true;
    const source = new EventSource(liveEventsUrl);
    source.addEventListener('list-update', ()=>{
      refreshItems().catch(err=>console.error(err));
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

  if(page==='index'){
    const totalEl = qs('hero-total-levels');
    const topEl = qs('hero-top-entry');
    const lastEl = qs('hero-last-slot');
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
      const lastItem = rankedItems[rankedItems.length - 1];

      if(totalEl) totalEl.textContent = String(rankedItems.length || 0);
      if(topEl) topEl.textContent = firstItem ? firstItem.title : 'Unavailable';
      if(lastEl) lastEl.textContent = lastItem && lastItem.position ? `#${lastItem.position}` : '--';
      renderFeatured(rankedItems);
    }

    loadItems().then(renderHome).catch(()=>{
      renderHome([]);
    });

    bindLiveUpdates();
    onLiveUpdate(renderHome);
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

  // Players page
  if(page==='players'){
    const form = qs('player-form'); const nameIn = qs('player-name'); const list = qs('players');
    if(!form || !nameIn || !list) return;
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

  function initListPage(){
    const levelsEl = qs('levels'); const listArea = qs('list-area'); const titleEl = qs('list-title');
    const searchEl = qs('search');
    const filterSelect = qs('level-filter');
    let currentItems = [];
    let controlsBound = false;
    // Load hard-coded data file data.txt (category|position|title|url per line)
    function loadData(){
      loadItems().then(items=>{
        applyItems(items);
      }).catch(err=>{listArea.innerHTML='<p class="muted">Failed to load list data - run via the Node server.</p>'; console.error(err)});
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
    bindLiveUpdates();
    onLiveUpdate(function(updatedItems){
      listPage.applyItems(updatedItems);
    });
  }

  if(page==='admelist'){
    const statusEl = qs('admin-status');
    const tbody = qs('admin-list-body');
    const addBtn = qs('add-row');
    const saveBtn = qs('save-list');
    const searchEl = qs('admin-search');
    let items = [];

    function setStatus(message, isError){
      if(!statusEl) return;
      statusEl.textContent = message;
      statusEl.classList.toggle('error-text', !!isError);
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
      tbody.innerHTML = '';
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
        tbody.appendChild(tr);
      });
      if(!rows.length){
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5" class="muted">No rows match your search.</td>';
        tbody.appendChild(tr);
      }
    }

    function saveItems(){
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
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({text: formatData(items)})
      }).then(r=>{
        if(!r.ok) throw new Error('Save failed');
        clearItemsCache();
        renderAdminTable();
        setStatus('Saved. Live pages update automatically.');
      }).catch(err=>{
        console.error(err);
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
      }).catch(err=>{
        console.error(err);
        setStatus('Could not load list data.', true);
      });
    }

    tbody.addEventListener('input', function(event){
      const target = event.target;
      const field = target.getAttribute('data-field');
      const index = Number(target.getAttribute('data-index'));
      if(!field || Number.isNaN(index) || !items[index]) return;
      if(field === 'position') return;
      items[index][field] = target.value;
      setStatus('Unsaved changes');
    });

    tbody.addEventListener('focusout', function(event){
      const target = event.target;
      if(!(target instanceof HTMLElement)) return;
      const field = target.getAttribute('data-field');
      const index = Number(target.getAttribute('data-index'));
      if(field !== 'position' || Number.isNaN(index) || !items[index]) return;
      moveItemToPosition(index, target.value);
      renderAdminTable();
      setStatus('Unsaved changes');
    });

    tbody.addEventListener('click', function(event){
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

    loadAdmin();
  }

  // Utility
  function escapeHtml(s){return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c])}
  function escapeAttr(s){return escapeHtml(String(s == null ? '' : s))}
})();
