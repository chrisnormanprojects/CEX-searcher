import { mkdir, writeFile } from 'node:fs/promises';

const API='https://wss2.cex.uk.webuy.io/v3';
const OUT='data/catalog.json';
const CATEGORY_ID=892;
const MAX_PRICE=50;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function arr(x){return Array.isArray(x)?x:[]}
function data(j){return j?.response?.data||{}}
function online(p){return Number(p?.outOfEcomStock)===0||Number(p?.ecomQuantityOnHand||0)>0}

async function rawFetch(url,timeout=15000){
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);
 try{const r=await fetch(url,{signal:c.signal,headers:{accept:'application/json,text/plain,*/*','user-agent':'Mozilla/5.0 (compatible; CEX-searcher/1.4; +https://github.com/chrisnormanprojects/CEX-searcher)'}});const text=await r.text();return {ok:r.ok,status:r.status,text}}
 finally{clearTimeout(timer)}
}
async function getJson(url){const r=await rawFetch(url);if(!r.ok)throw Object.assign(new Error(`HTTP ${r.status} ${url}`),{status:r.status});if(r.text.trim().startsWith('<'))throw new Error(`HTML response ${url}`);return JSON.parse(r.text)}
async function discover(){const j=await getJson(`${API}/categories?productLineIds=%5B7%5D`);const category=arr(data(j).categories).find(x=>Number(x.categoryId)===CATEGORY_ID);if(!category)throw new Error('PCI-Express Graphics Cards category not returned');return category}

const target=`${API}/boxes?categoryIds=${encodeURIComponent(JSON.stringify([CATEGORY_ID]))}&firstRecord=1&count=100&sortBy=sellprice&sortOrder=asc`;
const routes=[
 {name:'direct',url:target},
 {name:'community-worker',url:`https://cex-proxy.raul-blideran98.workers.dev/?url=${encodeURIComponent(target)}`},
 {name:'allorigins',url:`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`},
 {name:'corsproxy.io',url:`https://corsproxy.io/?${encodeURIComponent(target)}`},
 {name:'cors.lol',url:`https://api.cors.lol/?url=${encodeURIComponent(target)}`},
 {name:'cors.eu.org',url:`https://cors.eu.org/${target}`}
];

async function tryRoutes(){
 const diagnostics=[];
 for(const route of routes){
  const started=Date.now();
  try{
   const r=await rawFetch(route.url,12000);let json=null,count=0;
   if(r.ok&&!r.text.trim().startsWith('<')){try{json=JSON.parse(r.text);count=arr(data(json).boxes).filter(p=>Number(p.categoryId)===CATEGORY_ID).length}catch{}}
   diagnostics.push({name:route.name,status:r.status,ok:r.ok,json:!!json,matchingProducts:count,ms:Date.now()-started});
   console.log(`Route ${route.name}: HTTP ${r.status}; json=${!!json}; matching=${count}; ${Date.now()-started}ms`);
   if(json&&count>0)return {route:route.name,json,diagnostics};
  }catch(e){diagnostics.push({name:route.name,status:null,ok:false,json:false,matchingProducts:0,ms:Date.now()-started,error:e.message});console.warn(`Route ${route.name}: ${e.message}`)}
  await sleep(150);
 }
 return {route:null,json:null,diagnostics};
}

async function main(){
 const category=await discover();const totalBoxes=Number(category.totalBoxes||0);
 console.log(`Category: ${category.categoryFriendlyName} (${CATEGORY_ID})`);console.log(`Catalogue listings: ${totalBoxes}`);
 const probe=await tryRoutes();
 let products=probe.json?arr(data(probe.json).boxes).filter(p=>Number(p.categoryId)===CATEGORY_ID):[];
 const byId=new Map();for(const p of products){const id=p.boxId||p.boxName,price=Number(p.sellPrice);if(!id||!Number.isFinite(price)||price>MAX_PRICE)continue;if(!online(p)&&Number(p.outOfStock)!==0)continue;byId.set(id,p)}
 const list=[...byId.values()].sort((a,b)=>Number(a.sellPrice)-Number(b.sellPrice));
 const payload={generatedAt:new Date().toISOString(),source:API,scope:'Computing > Graphics and Capture Cards > PCI-Express Graphics Cards',mode:'route-probe',maxPrice:MAX_PRICE,category:{id:CATEGORY_ID,name:category.categoryFriendlyName,totalBoxes},catalogueListings:totalBoxes,workingRoute:probe.route,routeDiagnostics:probe.diagnostics,productCount:list.length,boxesBlocked:!probe.route,products:list};
 await mkdir('data',{recursive:true});await writeFile(OUT,JSON.stringify(payload,null,2));console.log(`Working route: ${probe.route||'none'}`);console.log(`Wrote ${list.length} filtered products from probe to ${OUT}`)
}
main().catch(err=>{console.error(err);process.exit(1)});
