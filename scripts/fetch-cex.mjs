import { mkdir, writeFile } from 'node:fs/promises';

const API='https://wss2.cex.uk.webuy.io/v3';
const OUT='data/catalog.json';
const MAX_PRICE=50;
const PER_CATEGORY=100;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function arr(x){return Array.isArray(x)?x:[]}
function data(j){return j?.response?.data||{}}
function online(p){return Number(p?.outOfEcomStock)===0||Number(p?.ecomQuantityOnHand||0)>0}

async function getJson(path,attempt=1){
 const url=path.startsWith('http')?path:`${API}${path}`;
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),15000);
 try{
  const r=await fetch(url,{signal:c.signal,headers:{accept:'application/json,text/plain,*/*','user-agent':'Mozilla/5.0 (compatible; CEX-searcher/1.2; +https://github.com/chrisnormanprojects/CEX-searcher)'}});
  if(!r.ok){const e=new Error(`HTTP ${r.status} ${url}`);e.status=r.status;throw e}
  const body=await r.text();if(body.trim().startsWith('<'))throw new Error(`HTML response ${url}`);return JSON.parse(body)
 }catch(e){if(e.status===403)throw e;if(attempt<3){await sleep(750*attempt);return getJson(path,attempt+1)}throw e}finally{clearTimeout(timer)}
}

async function discover(){
 const pl=await getJson('/productlines?superCatIds=%5B3%5D');
 const computingLines=arr(data(pl).productLines||data(pl).productlines).filter(x=>Number(x.superCatId)===3);
 const selectedLine=computingLines.find(x=>String(x.productLineName||'').toLowerCase()==='graphics and capture cards');
 if(!selectedLine)throw new Error('Graphics and Capture Cards product line not returned');
 const id=selectedLine.productLineId??selectedLine.id;
 const cat=await getJson(`/categories?productLineIds=${encodeURIComponent(JSON.stringify([id]))}`);
 const categories=arr(data(cat).categories).filter(x=>Number(x.productLineId)===Number(id));
 if(!categories.length)throw new Error('No Graphics and Capture Cards categories returned');
 return {selectedLine,categories};
}

async function fetchCategory(category){
 const id=category.categoryId??category.id;
 const j=await getJson(`/boxes?categoryIds=${encodeURIComponent(JSON.stringify([id]))}&firstRecord=1&count=${PER_CATEGORY}&sortBy=sellprice&sortOrder=asc`);
 return arr(data(j).boxes).filter(p=>Number(p.superCatId)===3).map(p=>({...p,_categoryId:id}));
}

async function fallback(){
 const out=[];
 for(const q of ['graphics card','gpu','capture card']){
  try{const j=await getJson(`/boxes?q=${encodeURIComponent(q)}&firstRecord=1&count=100&sortBy=sellprice&sortOrder=asc`);out.push(...arr(data(j).boxes).filter(p=>Number(p.superCatId)===3))}
  catch(e){console.warn(`Fallback ${q} failed: ${e.message}`);if(e.status===403)break}
  await sleep(200)
 }
 return out
}

async function main(){
 const {selectedLine,categories}=await discover();
 const totalBoxes=categories.reduce((n,c)=>n+Number(c.totalBoxes||0),0);
 console.log(`Product line: ${selectedLine.productLineName}`);
 console.log(`Categories: ${categories.length}`);
 console.log(`Catalogue listings: ${totalBoxes}`);
 console.log(categories.map(x=>`${x.categoryFriendlyName} (${x.totalBoxes||0})`).join(' | '));
 let products=[],blocked=false;
 for(const category of categories){try{products.push(...await fetchCategory(category))}catch(e){console.warn(`Category ${category.categoryId} failed: ${e.message}`);if(e.status===403){blocked=true;break}}await sleep(175)}
 let mode='graphics-capture-categories';if(blocked||!products.length){mode='graphics-capture-search-fallback';products=await fallback()}
 const categoryIds=new Set(categories.map(x=>Number(x.categoryId)));
 const byId=new Map();
 for(const p of products){
  if(p.categoryId!=null&&!categoryIds.has(Number(p.categoryId)))continue;
  const id=p.boxId||p.boxName,price=Number(p.sellPrice);if(!id||!Number.isFinite(price)||price>MAX_PRICE)continue;
  if(!online(p)&&Number(p.outOfStock)!==0)continue;
  const old=byId.get(id);if(!old||Number(p.ecomQuantityOnHand||0)>Number(old.ecomQuantityOnHand||0))byId.set(id,p)
 }
 const list=[...byId.values()].sort((a,b)=>Number(a.sellPrice)-Number(b.sellPrice));
 const payload={generatedAt:new Date().toISOString(),source:API,scope:'Computing > Graphics and Capture Cards',mode,maxPrice:MAX_PRICE,productLine:{id:selectedLine.productLineId,name:selectedLine.productLineName},categoryCount:categories.length,catalogueListings:totalBoxes,categories:categories.map(x=>({id:x.categoryId,name:x.categoryFriendlyName,totalBoxes:Number(x.totalBoxes||0)})),productCount:list.length,boxesBlocked:blocked&&!list.length,products:list};
 await mkdir('data',{recursive:true});await writeFile(OUT,JSON.stringify(payload,null,2));console.log(`Wrote ${list.length} graphics/capture products plus metadata to ${OUT}`)
}
main().catch(err=>{console.error(err);process.exit(1)});
