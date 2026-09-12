const DATA_URL='data/catalog.json';
const $=s=>document.querySelector(s);
const els={query:$('#query'),maxPrice:$('#maxPrice'),superCategory:$('#superCategory'),category:$('#category'),onlineOnly:$('#onlineOnly'),hideZero:$('#hideZero'),searchBtn:$('#searchBtn'),locationBtn:$('#locationBtn'),sortBy:$('#sortBy'),results:$('#results'),message:$('#message'),status:$('#statusPill'),count:$('#resultCount'),cheapest:$('#cheapestPrice'),locationText:$('#locationText'),template:$('#cardTemplate')};
let products=[],dataMeta=null,loadedSelection='',loadSequence=0,controller=null,visibleLimit=100,lastGenerated=null,statusLabel='CeX index',loading=false;
const moreButton=document.createElement('button');moreButton.type='button';moreButton.hidden=true;moreButton.className='secondary';els.results.after(moreButton);
moreButton.addEventListener('click',()=>{visibleLimit+=100;render(false)});
function setStatus(text,live=false){els.status.textContent=text;els.status.classList.toggle('live',live)}
function showMessage(text){els.message.textContent=text;els.message.classList.toggle('hidden',!text)}
function updateAge(){if(!lastGenerated||loading)return;const age=Date.now()-Date.parse(lastGenerated);setStatus(`${statusLabel} • ${ageLabel(lastGenerated)}${age>7200000?' • update overdue':''}`,age<=7200000)}
function money(v){return Number.isFinite(Number(v))?`£${Number(v).toFixed(2)}`:'—'}
function productUrl(id){return `https://uk.webuy.com/product-detail?id=${encodeURIComponent(id)}`}
function imageUrl(p){return p?.imageUrls?.medium||p?.imageUrls?.small||''}
function storesFor(p){return Array.isArray(p?.stores)?p.stores.filter(Boolean):[]}
function inOnlineStock(p){return Number(p?.outOfEcomStock)===0||Number(p?.ecomQuantityOnHand||0)>0||p?.availability?.includes?.('In Stock Online')}
function availableSomewhere(p){return inOnlineStock(p)||storesFor(p).length>0||Number(p?.outOfStock)===0}
function normalise(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function ageLabel(iso){const t=Date.parse(iso);if(!Number.isFinite(t))return'unknown age';const m=Math.max(0,Math.round((Date.now()-t)/60000));return m<60?`${m} min old`:`${Math.floor(m/60)}h ${m%60}m old`}
function selection(){return `${els.superCategory.value}:${els.category.value}`}
function populateDepartments(){els.superCategory.innerHTML='<option value="">Choose a department</option>';for(const s of [...dataMeta.superCategories].sort((a,b)=>a.name.localeCompare(b.name))){const o=document.createElement('option');o.value=String(s.id);o.textContent=`${s.name} (${s.productCount.toLocaleString()})`;els.superCategory.appendChild(o)}}
function populateCategories(){const id=Number(els.superCategory.value);els.category.innerHTML='<option value="">Choose a category</option><option value="all">All categories (larger download)</option>';const groups=new Map();for(const c of dataMeta.categories.filter(c=>c.superCatId===id)){const g=c.productLineName||'Other';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(c)}for(const [g,cats] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){const og=document.createElement('optgroup');og.label=g;for(const c of cats.sort((a,b)=>a.name.localeCompare(b.name))){const o=document.createElement('option');o.value=String(c.id);o.textContent=`${c.name} (${c.cheapListings.toLocaleString()})`;og.appendChild(o)}els.category.appendChild(og)}}
function cancelLoad(){controller?.abort();loadSequence++;loading=false;products=[];loadedSelection='';els.searchBtn.disabled=false;render();}
async function loadCatalog(){els.searchBtn.disabled=true;loading=true;setStatus('Loading index…');try{const r=await fetch(`${DATA_URL}?v=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);dataMeta=await r.json();populateDepartments();populateCategories();products=[];lastGenerated=dataMeta.generatedAt;statusLabel='CeX index';els.locationText.textContent=`${dataMeta.productCount.toLocaleString()} products indexed`;showMessage('Choose a department, then a category.');render()}catch(e){console.error(e);lastGenerated=null;setStatus('Data unavailable');showMessage('The catalogue could not be loaded. Refresh to retry.')}finally{loading=false;els.searchBtn.disabled=!dataMeta;updateAge()}}
async function loadSelection(){
  const department=els.superCategory.value,category=els.category.value;
  cancelLoad();
  if(!department||!category){showMessage('Choose a department and category to search.');return;}
  const seq=loadSequence,key=selection(),s=dataMeta.superCategories.find(s=>String(s.id)===department);
  const cats=dataMeta.categories.filter(c=>String(c.superCatId)===department&&(category==='all'||String(c.id)===category));
  controller=new AbortController();const signal=controller.signal;loading=true;els.searchBtn.disabled=true;
  setStatus(`Loading ${category==='all'?s.name:cats[0]?.name}…`);showMessage('Loading products…');
  try{
    let items=[];
    if(dataMeta.schemaVersion===2){
      const files=cats.flatMap(c=>c.files),parts=new Array(files.length);let cursor=0,done=0;
      await Promise.all(Array.from({length:Math.min(4,files.length)},async()=>{while(cursor<files.length){const i=cursor++;const r=await fetch(`data/${files[i]}`,{signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);const j=await r.json();if(!Array.isArray(j.products))throw new Error('Invalid product file');parts[i]=j.products;done++;if(seq===loadSequence)showMessage(`Loading products… ${done}/${files.length}`);}}));
      items=parts.flat();
      if(items.length!==cats.reduce((n,c)=>n+c.cheapListings,0))throw new Error('Catalogue count mismatch');
    }else{
      // Old published catalogue remains usable while the first v2 refresh runs.
      const r=await fetch(`data/${s.file}?v=${Date.parse(dataMeta.generatedAt)}`,{signal,cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const j=await r.json();items=j.products.filter(p=>category==='all'||String(p.categoryId)===category);
    }
    if(seq!==loadSequence)return;
    const byId=new Map(dataMeta.categories.map(c=>[c.id,c]));
    products=items.map(p=>{const c=byId.get(p.categoryId);return {...p,categoryName:c?.categoryName||p.categoryName,categoryFriendlyName:c?.name||p.categoryFriendlyName,productLineName:c?.productLineName||p.productLineName,superCatFriendlyName:s.name}});
    loadedSelection=key;statusLabel=category==='all'?s.name:cats[0].name;lastGenerated=dataMeta.generatedAt;els.locationText.textContent=`${products.length.toLocaleString()} loaded`;showMessage(products.length?'':'No products at £50 or less in this category.');render();
  }catch(e){if(seq!==loadSequence||e.name==='AbortError')return;controller.abort();console.error(e);lastGenerated=null;setStatus('Products unavailable');showMessage('Products could not be loaded. Press Search to retry, or refresh the page for the latest catalogue.');}
  finally{if(seq===loadSequence){loading=false;els.searchBtn.disabled=false;updateAge();}}
}
function filtered(){const max=els.maxPrice.value===''?50:Number(els.maxPrice.value),q=normalise(els.query.value);let list=products.filter(p=>p.sellPrice<=max).filter(p=>!q||normalise(`${p.boxName} ${p.categoryName} ${p.categoryFriendlyName} ${p.productLineName}`).includes(q)).filter(p=>!els.onlineOnly.checked||inOnlineStock(p)).filter(p=>!els.hideZero.checked||availableSomewhere(p));if(els.sortBy.value==='price')list.sort((a,b)=>a.sellPrice-b.sellPrice||a.boxName.localeCompare(b.boxName));if(els.sortBy.value==='rating')list.sort((a,b)=>(b.boxRating||0)-(a.boxRating||0));if(els.sortBy.value==='name')list.sort((a,b)=>a.boxName.localeCompare(b.boxName));return list}
function render(reset=true){if(reset)visibleLimit=100;const list=filtered();els.results.innerHTML='';moreButton.hidden=list.length<=visibleLimit;moreButton.textContent=`Show more (${Math.min(visibleLimit,list.length).toLocaleString()} of ${list.length.toLocaleString()})`;els.count.textContent=list.length.toLocaleString();els.cheapest.textContent=list.length?money(list.reduce((min,p)=>Math.min(min,Number(p.sellPrice)),Infinity)):'—';if(!list.length){if(products.length)showMessage('No products match the current filters.');return}showMessage('');for(const p of list.slice(0,visibleLimit)){const node=els.template.content.cloneNode(true),img=node.querySelector('.thumb'),src=imageUrl(p);if(src){img.src=src;img.alt=p.boxName||'CeX product'}else img.style.display='none';node.querySelector('.category-label').textContent=[p.superCatFriendlyName||p.superCatName,p.categoryFriendlyName||p.categoryName].filter(Boolean).join(' • ');node.querySelector('.rating').textContent=p.boxRating?`★ ${Number(p.boxRating).toFixed(1)}`:'';node.querySelector('.title').textContent=p.boxName||p.boxId;node.querySelector('.price').textContent=money(p.sellPrice);const stores=storesFor(p),stock=node.querySelector('.stock-badge');stock.textContent=inOnlineStock(p)?`Online${Number(p.ecomQuantityOnHand||0)>0?`: ${p.ecomQuantityOnHand}`:''}`:(stores.length?`${stores.length} store${stores.length===1?'':'s'}`:'Out of stock');stock.classList.toggle('out',!availableSomewhere(p));node.querySelector('.cash').textContent=`Cash trade-in ${money(p.cashPrice)}`;node.querySelector('.voucher').textContent=`Voucher ${money(p.exchangePrice)}`;node.querySelector('.view-link').href=productUrl(p.boxId);const btn=node.querySelector('.stock-btn'),store=node.querySelector('.store-stock');if(stores.length){btn.textContent=`Show ${stores.length} store${stores.length===1?'':'s'}`;store.textContent=stores.join(' • ');btn.addEventListener('click',()=>{store.classList.toggle('hidden');btn.textContent=store.classList.contains('hidden')?`Show ${stores.length} store${stores.length===1?'':'s'}`:'Hide stores'})}else{btn.textContent='Check at CeX';btn.addEventListener('click',()=>window.open(productUrl(p.boxId),'_blank','noopener'))}els.results.appendChild(node)}}
function catalogueInfo(){showMessage(`${dataMeta?.productCount.toLocaleString()} saved products at £50 or less; ${dataMeta?.categoryCount} categories in ${dataMeta?.superCategoryCount} departments. ${dataMeta?.coverage==='complete'?'All search partitions passed coverage checks.':'Legacy catalogue: some categories may be incomplete.'} Scheduled hourly; runs can be delayed. Last refreshed ${new Date(dataMeta?.generatedAt).toLocaleString()}.`)}
function search(){if(!loading){if(loadedSelection===selection()&&loadedSelection)render();else loadSelection();}}
els.searchBtn.addEventListener('click',search);els.query.addEventListener('keydown',e=>{if(e.key==='Enter')search()});
els.superCategory.addEventListener('change',()=>{cancelLoad();populateCategories();statusLabel='CeX index';lastGenerated=dataMeta.generatedAt;updateAge();els.locationText.textContent=`${dataMeta.productCount.toLocaleString()} products indexed`;showMessage('Choose a category, or select All categories to search the department.');});
els.category.addEventListener('change',loadSelection);
[els.maxPrice,els.onlineOnly,els.hideZero,els.sortBy].forEach(e=>e.addEventListener('change',()=>render()));els.locationBtn.addEventListener('click',catalogueInfo);
document.querySelectorAll('[data-price]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-price]').forEach(x=>x.classList.remove('active'));b.classList.add('active');els.maxPrice.value=b.dataset.price;render()}));
setInterval(updateAge,60000);loadCatalog();
