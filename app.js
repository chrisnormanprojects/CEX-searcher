const API='https://wss2.cex.uk.webuy.io/v3';
const DATA_URL='data/catalog.json';
const $=s=>document.querySelector(s);
const els={query:$('#query'),maxPrice:$('#maxPrice'),category:$('#category'),onlineOnly:$('#onlineOnly'),hideZero:$('#hideZero'),searchBtn:$('#searchBtn'),locationBtn:$('#locationBtn'),sortBy:$('#sortBy'),results:$('#results'),message:$('#message'),status:$('#statusPill'),count:$('#resultCount'),cheapest:$('#cheapestPrice'),locationText:$('#locationText'),template:$('#cardTemplate')};
let products=[];let dataMeta=null;

function setStatus(text,live=false){els.status.textContent=text;els.status.classList.toggle('live',live)}
function showMessage(text){els.message.textContent=text;els.message.classList.toggle('hidden',!text)}
function money(v){return Number.isFinite(Number(v))?`£${Number(v).toFixed(2)}`:'—'}
function productUrl(id){return `https://uk.webuy.com/product-detail?id=${encodeURIComponent(id)}`}
function imageUrl(p){return p?.imageUrls?.medium||p?.imageUrls?.small||''}
function inOnlineStock(p){return Number(p?.outOfEcomStock)===0||Number(p?.ecomQuantityOnHand||0)>0}
function availableSomewhere(p){return Number(p?.outOfStock)===0||inOnlineStock(p)}
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
    setStatus(`Cached CeX data • ${ageLabel(json.generatedAt)}`,true);
    render();
  }catch(e){
    console.error(e);
    setStatus('Data updating');
    showMessage('The new CeX data feed is being prepared. GitHub is fetching CeX stock server-side so the page no longer depends on browser proxies. Refresh this page in a few minutes.');
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
  setStatus(`Cached CeX data • ${ageLabel(dataMeta?.generatedAt)}`,true);
  render();
}

function render(){
  const list=filtered();els.results.innerHTML='';els.count.textContent=list.length;els.cheapest.textContent=list.length?money(Math.min(...list.map(p=>Number(p.sellPrice)))):'—';
  if(!list.length){showMessage(products.length?'No cached products match the current search and filters. Try a broader search, a higher maximum price, or turn off Online stock only.':'CeX data is still being prepared.');return}else showMessage('');
  for(const p of list){
    const node=els.template.content.cloneNode(true),card=node.querySelector('.card'),img=node.querySelector('.thumb');
    const src=imageUrl(p);if(src){img.src=src;img.alt=p.boxName||'CeX product'}else{img.style.display='none'}
    node.querySelector('.category-label').textContent=p.categoryFriendlyName||p.categoryName||p.superCatFriendlyName||'CeX';
    node.querySelector('.rating').textContent=p.boxRating?`★ ${Number(p.boxRating).toFixed(1)}`:'';
    node.querySelector('.title').textContent=p.boxName||p.boxId;
    node.querySelector('.price').textContent=money(p.sellPrice);
    const stock=node.querySelector('.stock-badge');stock.textContent=inOnlineStock(p)?`Online: ${Number(p.ecomQuantityOnHand||0)>0?p.ecomQuantityOnHand:'in stock'}`:(availableSomewhere(p)?'Store stock':'Out of stock');stock.classList.toggle('out',!availableSomewhere(p));
    node.querySelector('.cash').textContent=`Cash trade-in ${money(p.cashPrice)}`;
    node.querySelector('.voucher').textContent=`Voucher ${money(p.exchangePrice)}`;
    const link=node.querySelector('.view-link');link.href=productUrl(p.boxId);
    const btn=node.querySelector('.stock-btn'),store=node.querySelector('.store-stock');
    btn.textContent='Check at CeX';btn.addEventListener('click',()=>window.open(productUrl(p.boxId),'_blank','noopener'));
    store.classList.add('hidden');
    card.dataset.price=p.sellPrice;els.results.appendChild(node);
  }
}

function locationInfo(){
  els.locationText.textContent='Not required';
  showMessage('Location is no longer required for the main bargain search. Product links open CeX directly so you can check the latest individual store availability.');
}

els.searchBtn.addEventListener('click',search);els.query.addEventListener('keydown',e=>{if(e.key==='Enter')search()});
[els.maxPrice,els.category,els.onlineOnly,els.hideZero,els.sortBy].forEach(e=>e.addEventListener('change',render));
els.locationBtn.addEventListener('click',locationInfo);
document.querySelectorAll('[data-price]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-price]').forEach(x=>x.classList.remove('active'));b.classList.add('active');els.maxPrice.value=b.dataset.price;render()}));
loadCatalog();
