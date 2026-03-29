// Lightweight multi-page handler for GD Demand List
(function(){
  function qs(id){return document.getElementById(id)}

  const page = document.body.dataset.page;

  // Storage helpers
  function read(key, fallback){
    try{const v = localStorage.getItem(key); return v?JSON.parse(v):fallback}
    catch(e){return fallback}
  }
  function write(key, val){localStorage.setItem(key,JSON.stringify(val))}

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
      fetch('data.txt').then(r=>r.text()).then(txt=>{
        const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
        const items = lines.map(l=>{
          const parts = l.split('|').map(p=>p.trim());
          return {level:parts[0]||'Unknown',position:parts[1]||'',title:parts[2]||'Untitled',url:parts[3]||''};
        });
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
