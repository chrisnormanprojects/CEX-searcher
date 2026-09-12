import { mkdir, writeFile } from 'node:fs/promises';

const API='https://wss2.cex.uk.webuy.io/v3';
const OUT='data/catalog.json';
const CATEGORY_ID=892;
const MAX_PRICE=50;
const PER_CATEGORY=100;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function arr(x){return Array.isArray(x)?x:[]}
function data(j){return j?.response?.data||{}}
function online(p){return Number(p?.outOfEcomStock)===0||Number(p?.ecomQuantityOnHand||0)>0}
async function getJson(path,attempt=1){const url=path.startsWith('http')?path:`${API}${path}`;const c=new AbortController();const timer=setTimeout(()=>c.abort(),15000);try{const r=await fetch(url,{signal:c.signal,headers:{accept:'application/json,text/plain,*/*','user-agent':'Mozilla/5.0 (compatible; CEX-searcher/1.3; +https://github.com/chrisnormanprojects/CEX-searcher)'}});if(!r.ok){const e=new Error(`HTTP ${r.status} ${url}`);e.status=r.status;throw e}const body=await r.text();if(body.trim().startsWith('<'))throw new Error(`HTML response ${url}`);return JSON.parse(body)}catch(e){if(e.status===403)throw e;if(attempt<3){await sleep(750*attempt);return getJson(path,attempt+1)}throw e}finally{clearTimeout(timer)}}
async function discover(){const cat=await getJson('/categories?productLineIds=%5B7%5D');const category=arr(data(cat).categories).find(x=>Number(x.categoryId)===CATEGORY_ID);if(!category)throw new Error('PCI-Express Graphics Cards category not returned');return category}
async function fetchCards(){const j=await getJson(`/boxes?categoryIds=${encodeURIComponent(JSON.stringify([CATEGORY_ID]))}&firstRecord=1&count=${PER_CATEGORY}&sortBy=sellprice&sortOrder=asc`);return arr(data(j).boxes).filter(p=>Number(p.categoryId)===CATEGORY_ID)}
async function fallback(){try{const j=await getJson('/boxes?q=graphics%20card&firstRecord=1&count=100&sortBy=sellprice&sortOrder=asc');return arr(data(j).boxes).filter(p=>Number(p.categoryId)===CATEGORY_ID)}catch(e){console.warn(`Fallback failed: ${e.message}`);return []}}
async function main(){const category=await discover();const totalBoxes=Number(category.totalBoxes||0);console.log(`Category: ${category.categoryFriendlyName} (${CATEGORY_ID})`);console.log(`Catalogue listings: ${totalBoxes}`);let products=[],blocked=false;try{products=await fetchCards()}catch(e){console.warn(`Category fetch failed: ${e.message}`);blocked=e.status===403}let mode='pci-express-category';if(blocked||!products.length){mode='pci-express-search-fallback';products=await fallback()}const byId=new Map();for(const p of products){const id=p.boxId||p.boxName,price=Number(p.sellPrice);if(!id||!Number.isFinite(price)||price>MAX_PRICE)continue;if(!online(p)&&Number(p.outOfStock)!==0)continue;byId.set(id,p)}const list=[...byId.values()].sort((a,b)=>Number(a.sellPrice)-Number(b.sellPrice));const payload={generatedAt:new Date().toISOString(),source:API,scope:'Computing > Graphics and Capture Cards > PCI-Express Graphics Cards',mode,maxPrice:MAX_PRICE,category:{id:CATEGORY_ID,name:category.categoryFriendlyName,totalBoxes},catalogueListings:totalBoxes,productCount:list.length,boxesBlocked:blocked&&!list.length,products:list};await mkdir('data',{recursive:true});await writeFile(OUT,JSON.stringify(payload,null,2));console.log(`Wrote ${list.length} PCI-Express graphics-card products plus metadata to ${OUT}`)}
main().catch(err=>{console.error(err);process.exit(1)});
