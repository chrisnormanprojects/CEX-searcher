const DATA_URL='data/catalog.json';
const $=s=>document.querySelector(s);
const els={query:$('#query'),maxPrice:$('#maxPrice'),category:$('#category'),onlineOnly:$('#onlineOnly'),hideZero:$('#hideZero'),searchBtn:$('#searchBtn'),locationBtn:$('#locationBtn'),sortBy:$('#sortBy'),results:$('#results'),message:$('#message'),status:$('#statusPill'),count:$('#resultCount'),cheapest:$('#cheapestPrice'),locationText:$('#locationText'),template:$('#cardTemplate')};
let products=[];let dataMeta=null;

function setStatus(text,live=false){els.status.textContent=text;els.status.classList.toggle('live',live)}
function showMessage(text){els.message.textContent=text;els.message.classList.toggle('hidden',!text)}
function money(v){return Number.isFinite(Number(v))?`£${Number(v).toFixed(2)}`:'—'}
function productUrl(id){return `https://uk.webuy.com/product-detail?id=${encodeURIComponent(id)}`}
function imageUrl(p){return p?.imageUrls?.medium||p?.imageUrls?.small||''}
function storesFor(p){return Array.isArray(p?.stores)?p.stores.filter(Boolean):[]}
function inOnlineStock(p){return Number(p?.outOfEcomStock)===0||Number(p?.ecomQuantityOnHand||0)>0||p?.availability?.includes?.('In Stock Online')}
function availableSomewhere(p){return inOnlineStock(p)||storesFor(p).length>0||Number(p?.outOfStock)===0}
function normalise(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function ageLabel(iso){const t=Date.parse(iso);if(!Number.isFinite(t))return 'unknown age';const mins=Math.max(0,Math.round((Date.now()-t)/60000));if(mins<60)return `${mins} min old`;return `${Math.floor(mins/60)}h ${mins%60}m old`}

async function loadCatalog(){
  els.searchBtn.disabled=true;setStatus('Loading data…');showMessage('');
  try{
    const bust=Math.floor(Date.now()/300000);
    const r=await fetch(`${DATA_URL}?v=${bust}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const json=await r.json();
    products=Array.isArray(json?.products)?json.products:[];
    dataMeta=json;
    if(!products.length)throw new Error('Catalogue is empty');
    setStatus(`CeX search data • ${ageLabel(json.generatedAt)}`,true);
    els.locationText.textContent=`${products.length} loaded`;
    render();
  }catch(e){
    console.error(e);
    setStatus('Data unavailable');
    showMessage('The CeX catalogue snapshot could not be loaded. The hourly updater preserves the last good catalogue, so try refreshing shortly.');
  }finally{els.searchBtn.disabled=false}
}

function filtered(){
  const max=Number(els.maxPrice.value||Infinity),cat=els.category.value,q=normalise(els.query.value);
  let a=products
    .filter(p=>Number(p.sellPrice)<=max)
    .filter(p=>!q||normalise(`${p.boxName} ${p.categoryName} ${p.categoryFriendlyName} ${p.superCatName} ${p.superCatFriendlyName}`).includes(q))
    .filter(p=>!cat||p.superCatFriendlyName===cat||p.superCatName===cat||p.categoryFriendlyName===cat||p.categoryName===cat)
    .filter(p=>!els.onlineOnly.checked||inOnlineStock(p))
    .filter(p=>!els.hideZero.checked||availableSomewhere(p));
  if(els.sortBy.value==='price')a.sort((x,y)=>Number(x.sellPrice)-Number(y.sellPrice));
  if(els.sortBy.value==='rating')a.sort((x,y)=>Number(y.boxRating||0)-Number(x.boxRating||0));
  if(els.sortBy.value==='name')a.sort((x,y)=>String(x.boxName).localeCompare(String(y.boxName)));
  return a;
}

function search(){
  if(!products.length){loadCatalog();return}
  setStatus(`CeX search data • ${ageLabel(dataMeta?.generatedAt)}`,true);
  render();
}

function render(){
  const list=filtered();els.results.innerHTML='';els.count.textContent=list.length;els.cheapest.textContent=list.length?money(Math.min(...list.map(p=>Number(p.sellPrice)))):'—';
  if(!list.length){showMessage(products.length?'No products match the current filters. Try turning off Online stock only or increasing the price limit.':'CeX data is still being prepared.');return}else showMessage('');
  for(const p of list){
    const node=els.template.content.cloneNode(true),card=node.querySelector('.card'),img=node.querySelector('.thumb');
    const src=imageUrl(p);if(src){img.src=src;img.alt=p.boxName||'CeX graphics card'}else{img.style.display='none'}
    node.querySelector('.category-label').textContent=p.categoryFriendlyName||p.categoryName||'PCI-Express graphics card';
    node.querySelector('.rating').textContent=p.boxRating?`★ ${Number(p.boxRating).toFixed(1)}`:'';
    node.querySelector('.title').textContent=p.boxName||p.boxId;
    node.querySelector('.price').textContent=money(p.sellPrice);
    const stores=storesFor(p),stock=node.querySelector('.stock-badge');
    stock.textContent=inOnlineStock(p)?`Online${Number(p.ecomQuantityOnHand||0)>0?`: ${p.ecomQuantityOnHand}`:''}`:(stores.length?`${stores.length} store${stores.length===1?'':'s'}`:'Out of stock');
    stock.classList.toggle('out',!availableSomewhere(p));
    node.querySelector('.cash').textContent=`Cash trade-in ${money(p.cashPrice)}`;
    node.querySelector('.voucher').textContent=`Voucher ${money(p.exchangePrice)}`;
    const link=node.querySelector('.view-link');link.href=productUrl(p.boxId);
    const btn=node.querySelector('.stock-btn'),store=node.querySelector('.store-stock');
    if(stores.length){
      btn.textContent=`Show ${stores.length} store${stores.length===1?'':'s'}`;
      store.textContent=stores.join(' • ');
      btn.addEventListener('click',()=>{store.classList.toggle('hidden');btn.textContent=store.classList.contains('hidden')?`Show ${stores.length} store${stores.length===1?'':'s'}`:'Hide stores'});
    }else{
      btn.textContent='Check at CeX';btn.addEventListener('click',()=>window.open(productUrl(p.boxId),'_blank','noopener'));
    }
    card.dataset.price=p.sellPrice;els.results.appendChild(node);
  }
}

function locationInfo(){
  const withStores=products.filter(p=>storesFor(p).length).length;
  const online=products.filter(inOnlineStock).length;
  showMessage(`This snapshot contains ${products.length} graphics cards at £${dataMeta?.maxPrice??50} or less: ${online} with online stock and ${withStores} with named CeX store availability. Store names come directly from CeX's search catalogue and may change between hourly updates.`);
}

els.searchBtn.addEventListener('click',search);els.query.addEventListener('keydown',e=>{if(e.key==='Enter')search()});
[els.maxPrice,els.category,els.onlineOnly,els.hideZero,els.sortBy].forEach(e=>e.addEventListener('change',render));
els.locationBtn.addEventListener('click',locationInfo);
document.querySelectorAll('[data-price]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-price]').forEach(x=>x.classList.remove('active'));b.classList.add('active');els.maxPrice.value=b.dataset.price;render()}));
loadCatalog();
