import { mkdir, writeFile } from 'node:fs/promises';

const META_API='https://wss2.cex.uk.webuy.io/v3';
const SEARCH_API='https://search.webuy.io/1/indexes/*/queries';
const INDEX='prod_cex_uk';
const OUT='data/catalog.json';
const CATEGORY_ID=892;
const MAX_PRICE=50;
const HITS_PER_PAGE=100;
const MAX_PAGES=40;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arr=x=>Array.isArray(x)?x:[];
const data=j=>j?.response?.data||{};

async function fetchJson(url,options={},timeout=20000){
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);
 try{
  const r=await fetch(url,{...options,signal:c.signal,headers:{accept:'application/json','content-type':'application/json','user-agent':'Mozilla/5.0 (compatible; CEX-searcher/2.1; +https://github.com/chrisnormanprojects/CEX-searcher)',...(options.headers||{})}});
  const text=await r.text();
  if(!r.ok)throw new Error(`HTTP ${r.status} ${url}: ${text.slice(0,180)}`);
  return JSON.parse(text);
 }finally{clearTimeout(timer)}
}

async function discover(){
 const j=await fetchJson(`${META_API}/categories?productLineIds=%5B7%5D`);
 const category=arr(data(j).categories).find(x=>Number(x.categoryId)===CATEGORY_ID);
 if(!category)throw new Error('PCI-Express Graphics Cards category not returned');
 return category;
}

function normaliseHit(h){
 if(Number(h.categoryId)!==CATEGORY_ID)return null;
 const sellPrice=Number(h.sellPrice);
 if(!Number.isFinite(sellPrice)||sellPrice>MAX_PRICE)return null;
 const boxId=String(h.boxId??h.objectID??'').trim();if(!boxId)return null;
 const availability=arr(h.availability).map(String),stores=arr(h.stores).map(String);
 const online=availability.includes('In Stock Online')||Number(h.ecomQuantity??0)>0;
 const inStore=availability.includes('In Stock In Store')||stores.length>0;
 return {
  boxId,boxName:h.boxName??boxId,categoryId:CATEGORY_ID,
  categoryName:h.categoryName??'Graphics Cards - PCI-E',
  categoryFriendlyName:h.categoryFriendlyName??'PCI-Express Graphics Cards',
  superCatId:Number(h.scId??3),superCatName:h.superCatName??'Computing',superCatFriendlyName:h.superCatFriendlyName??'Computing',
  imageUrls:h.imageUrls??{},sellPrice,
  cashPrice:Number(h.cashPriceCalculated??h.cashBuyPrice??0),exchangePrice:Number(h.exchangePriceCalculated??h.exchangePrice??0),
  boxRating:Number(h.rating??0)||null,outOfStock:inStore||online?0:1,outOfEcomStock:online?0:1,
  ecomQuantityOnHand:Number(h.ecomQuantity??0),stores,availability,priceLastChanged:h.priceLastChanged??null,
  source:'CeX Algolia search feed'
 };
}

async function algoliaPage(page){
 const params=new URLSearchParams({
  query:'',page:String(page),hitsPerPage:String(HITS_PER_PAGE),
  facetFilters:JSON.stringify([[`categoryId:${CATEGORY_ID}`]]),
  filters:'boxVisibilityOnWeb=1',facets:'["*"]',maxValuesPerFacet:'1000'
 });
 const body={requests:[{indexName:INDEX,params:params.toString()}]};
 const j=await fetchJson(SEARCH_API,{method:'POST',body:JSON.stringify(body)});
 const result=arr(j?.results)[0]||{};
 return {hits:arr(result.hits),nbHits:Number(result.nbHits||0),nbPages:Number(result.nbPages||0),index:result.index||INDEX};
}

async function main(){
 const category=await discover();const totalBoxes=Number(category.totalBoxes||0);
 console.log(`Category: ${category.categoryFriendlyName} (${CATEGORY_ID})`);console.log(`Metadata listings: ${totalBoxes}`);
 const byId=new Map(),diagnostics=[];
 let reportedHits=0;
 for(let page=0;page<MAX_PAGES;page++){
  const started=Date.now();
  const r=await algoliaPage(page);reportedHits=r.nbHits;
  let added=0,maxSeen=null;
  for(const h of r.hits){
   const price=Number(h.sellPrice);if(Number.isFinite(price))maxSeen=maxSeen==null?price:Math.max(maxSeen,price);
   const p=normaliseHit(h);if(p&&!byId.has(p.boxId)){byId.set(p.boxId,p);added++}
  }
  diagnostics.push({page,hits:r.hits.length,nbHits:r.nbHits,nbPages:r.nbPages,added,maxSeen,ms:Date.now()-started});
  console.log(`Algolia page ${page}: ${r.hits.length} hits; total=${r.nbHits}; added<=£${MAX_PRICE}=${added}; max=${maxSeen}`);
  if(!r.hits.length||page+1>=r.nbPages)break;
  if(maxSeen!=null&&maxSeen>MAX_PRICE)break;
  await sleep(100);
 }
 const products=[...byId.values()].sort((a,b)=>a.sellPrice-b.sellPrice);
 const payload={generatedAt:new Date().toISOString(),source:SEARCH_API,scope:'Computing > Graphics and Capture Cards > PCI-Express Graphics Cards',mode:'direct-algolia',maxPrice:MAX_PRICE,category:{id:CATEGORY_ID,name:category.categoryFriendlyName,totalBoxes},catalogueListings:reportedHits||totalBoxes,productCount:products.length,boxesBlocked:false,diagnostics,products};
 await mkdir('data',{recursive:true});await writeFile(OUT,JSON.stringify(payload,null,2));
 console.log(`Wrote ${products.length} PCI-Express graphics cards priced at £${MAX_PRICE} or less to ${OUT}`);
 if(!products.length)process.exitCode=2;
}
main().catch(err=>{console.error(err);process.exit(1)});
