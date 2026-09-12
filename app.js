const API='https://wss2.cex.uk.webuy.io/v3';
const PROXIES=[
  u=>`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u=>`https://corsproxy.io/?${encodeURIComponent(u)}`,
  u=>`https://api.cors.lol/?url=${encodeURIComponent(u)}`
];
const CACHE_TTL=30*60*1000;
const $=s=>document.querySelector(s);
const els={query:$('#query'),maxPrice:$('#maxPrice'),category:$('#category'),onlineOnly:$('#onlineOnly'),hideZero:$('#hideZero'),searchBtn:$('#searchBtn'),locationBtn:$('#locationBtn'),sortBy:$('#sortBy'),results:$('#results'),message:$('#message'),status:$('#statusPill'),count:$('#resultCount'),cheapest:$('#cheapestPrice'),locationText:$('#locationText'),template:$('#cardTemplate')};
let products=[];let locationCoords=null;

function cacheGet(key){try{const x=JSON.parse(localStorage.getItem(key));if(x&&Date.now()-x.t<CACHE_TTL)return x.v}catch{}return null}
function cacheSet(key,v){try{localStorage.setItem(key,JSON.stringify({t:Date.now(),v}))}catch{}}
function timeoutFetch(url,ms=10000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);return fetch(url,{signal:c.signal}).finally(()=>clearTimeout(t))}
async function fetchJson(url){const cached=cacheGet(url);if(cached)return cached;const attempts=[u=>u,...PROXIES];let lastErr;for(const wrap of attempts){try{const r=await timeoutFetch(wrap(url),10000);if(!r.ok)throw new Error(`HTTP ${r.status}`);const text=await r.text();if(text.trim().startsWith('<'))throw new Error('HTML response');const j=JSON.parse(text);cacheSet(url,j);return j}catch(e){lastErr=e}}throw lastErr||new Error('Request failed')}
function setStatus(text,live=false){els.status.textContent=text;els.status.classList.toggle('live',live)}
function showMessage(text){els.message.textContent=text;els.message.classList.toggle('hidden',!text)}
function money(v){return Number.isFinite(Number(v))?`£${Number(v).toFixed(2)}`:'—'}
function productUrl(id){return `https://uk.webuy.com/product-detail?id=${encodeURIComponent(id)}`}
function imageUrl(p){return p?.imageUrls?.medium||p?.imageUrls?.small||''}
function inOnlineStock(p){return Number(p?.outOfEcomStock)===0&&Number(p?.ecomQuantityOnHand||0)>0}
function availableSomewhere(p){return Number(p?.outOfStock)===0||inOnlineStock(p)}

async function search(){
  const q=els.query.value.trim();
  if(!q){showMessage('Enter a search term first. For this first version, CeX search works best with a word such as game, Zelda, controller or Blu-ray.');return}
  els.searchBtn.disabled=true;setStatus('Searching…');showMessage('');els.results.innerHTML='';
  try{
    const url=`${API}/boxes?q=${encodeURIComponent(q)}&firstRecord=1&count=100&sortBy=relevance&sortOrder=desc`;
    const json=await fetchJson(url);
    products=json?.response?.data?.boxes||[];
    if(!Array.isArray(products))products=[];
    render();setStatus('Live data',true);
  }catch(e){
    console.error(e);setStatus('Data unavailable');showMessage('CeX did not return data. This can happen if CeX or the browser proxy temporarily blocks requests. Try again shortly or use a different search term.');
  }finally{els.searchBtn.disabled=false}
}

function filtered(){
  const max=Number(els.maxPrice.value||Infinity),cat=els.category.value;
  let a=products.filter(p=>Number(p.sellPrice)<=max)
    .filter(p=>!cat||p.superCatFriendlyName===cat||p.superCatName===cat)
    .filter(p=>!els.onlineOnly.checked||inOnlineStock(p))
    .filter(p=>!els.hideZero.checked||availableSomewhere(p));
  if(els.sortBy.value==='price')a.sort((x,y)=>Number(x.sellPrice)-Number(y.sellPrice));
  if(els.sortBy.value==='rating')a.sort((x,y)=>Number(y.boxRating||0)-Number(x.boxRating||0));
  if(els.sortBy.value==='name')a.sort((x,y)=>String(x.boxName).localeCompare(String(y.boxName)));
  return a;
}

function render(){
  const list=filtered();els.results.innerHTML='';els.count.textContent=list.length;els.cheapest.textContent=list.length?money(Math.min(...list.map(p=>Number(p.sellPrice)))):'—';
  if(!list.length){showMessage(products.length?'No products match the current filters. Try raising the maximum price or turning off Online stock only.':'No products were returned for that search.');return}else showMessage('');
  for(const p of list){
    const node=els.template.content.cloneNode(true),card=node.querySelector('.card'),img=node.querySelector('.thumb');
    const src=imageUrl(p);if(src){img.src=src;img.alt=p.boxName||'CeX product'}else{img.style.display='none'}
    node.querySelector('.category-label').textContent=p.categoryFriendlyName||p.categoryName||p.superCatFriendlyName||'CeX';
    node.querySelector('.rating').textContent=p.boxRating?`★ ${Number(p.boxRating).toFixed(1)}`:'';
    node.querySelector('.title').textContent=p.boxName||p.boxId;
    node.querySelector('.price').textContent=money(p.sellPrice);
    const stock=node.querySelector('.stock-badge');stock.textContent=inOnlineStock(p)?`Online: ${p.ecomQuantityOnHand||'✓'}`:(availableSomewhere(p)?'Store stock':'Out of stock');stock.classList.toggle('out',!availableSomewhere(p));
    node.querySelector('.cash').textContent=`Cash trade-in ${money(p.cashPrice)}`;
    node.querySelector('.voucher').textContent=`Voucher ${money(p.exchangePrice)}`;
    const link=node.querySelector('.view-link');link.href=productUrl(p.boxId);
    const btn=node.querySelector('.stock-btn'),store=node.querySelector('.store-stock');btn.addEventListener('click',()=>nearby(p,store,btn));
    card.dataset.price=p.sellPrice;els.results.appendChild(node);
  }
}

async function nearby(p,box,btn){
  if(!locationCoords){showMessage('Tap “Use my location” first so I can ask CeX for nearby store stock.');return}
  btn.disabled=true;btn.textContent='Checking…';
  try{
    const {latitude,longitude}=locationCoords,url=`${API}/boxes/${encodeURIComponent(p.boxId)}/neareststores?latitude=${latitude}&longitude=${longitude}`;
    const j=await fetchJson(url),stores=j?.response?.data?.nearestStores||[];
    box.classList.remove('hidden');box.textContent=stores.length?stores.slice(0,5).map(s=>`${s.storeName}: ${s.quantityOnHand} (${Number(s.distance).toFixed(1)} km)`).join(' • '):'No nearby store stock returned.';
  }catch(e){box.classList.remove('hidden');box.textContent='Nearby stock could not be loaded right now.'}finally{btn.disabled=false;btn.textContent='Nearby stock'}
}

function getLocation(){
  if(!navigator.geolocation){showMessage('Location is not available in this browser.');return}
  els.locationBtn.disabled=true;els.locationBtn.textContent='Locating…';
  navigator.geolocation.getCurrentPosition(pos=>{locationCoords={latitude:pos.coords.latitude,longitude:pos.coords.longitude};els.locationText.textContent='Enabled';els.locationBtn.textContent='Location enabled';els.locationBtn.disabled=false;showMessage('');},()=>{els.locationText.textContent='Not allowed';els.locationBtn.textContent='Use my location';els.locationBtn.disabled=false;showMessage('Location permission was not granted. Online-stock search still works.');},{enableHighAccuracy:false,timeout:10000,maximumAge:600000});
}

els.searchBtn.addEventListener('click',search);els.query.addEventListener('keydown',e=>{if(e.key==='Enter')search()});
[els.maxPrice,els.category,els.onlineOnly,els.hideZero,els.sortBy].forEach(e=>e.addEventListener('change',render));
els.locationBtn.addEventListener('click',getLocation);
document.querySelectorAll('[data-price]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-price]').forEach(x=>x.classList.remove('active'));b.classList.add('active');els.maxPrice.value=b.dataset.price;render()}));
search();
