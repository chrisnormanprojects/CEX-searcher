import { mkdir, writeFile, rm } from 'node:fs/promises';

const META_API='https://wss2.cex.uk.webuy.io/v3';
const SEARCH_API='https://search.webuy.io/1/indexes/*/queries';
const PRIMARY_INDEX='prod_cex_uk_price_asc';
const FALLBACK_INDEX='prod_cex_uk';
const DATA_DIR='data';
const SUPER_DIR=`${DATA_DIR}/super`; 
const MANIFEST=`${DATA_DIR}/catalog.json`;
const MAX_PRICE=50,HITS_PER_PAGE=100,QUERY_BATCH_SIZE=35,MAX_PAGES_PER_CATEGORY=20;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arr=x=>Array.isArray(x)?x:[];
const data=j=>j?.response?.data||{};
const slug=s=>String(s||'other').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'other';

async function fetchJson(url,options={},timeout=25000,attempt=1){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
 try{const r=await fetch(url,{...options,signal:c.signal,headers:{accept:'application/json','content-type':'application/json','user-agent':'Mozilla/5.0 (compatible; CEX-searcher/3.1)',...(options.headers||{})}});const text=await r.text();if(!r.ok){const e=new Error(`HTTP ${r.status}: ${text.slice(0,180)}`);e.status=r.status;throw e}return JSON.parse(text)}
 catch(e){if(attempt<3&&(e.status===429||e.status>=500||e.name==='AbortError')){await sleep(800*attempt);return fetchJson(url,options,timeout,attempt+1)}throw e}finally{clearTimeout(timer)}
}

async function discoverMetadata(){
 const sj=await fetchJson(`${META_API}/supercats`),superCategories=arr(data(sj).superCats),productLines=[];
 for(const sc of superCategories){try{const pj=await fetchJson(`${META_API}/productlines?superCatIds=${encodeURIComponent(JSON.stringify([Number(sc.superCatId)]))}`);for(const p of arr(data(pj).productLines))productLines.push({...p,superCatId:Number(p.superCatId??sc.superCatId),superCatFriendlyName:p.superCatFriendlyName??sc.superCatFriendlyName})}catch(e){console.warn(e.message)}}
 const categories=[];
 for(const p of productLines){try{const cj=await fetchJson(`${META_API}/categories?productLineIds=${encodeURIComponent(JSON.stringify([Number(p.productLineId)]))}`);for(const c of arr(data(cj).categories))categories.push({...c,productLineId:Number(c.productLineId??p.productLineId),productLineName:c.productLineName??p.productLineName??p.productLineFriendlyName??'',superCatId:Number(c.superCatId??p.superCatId),superCatFriendlyName:c.superCatFriendlyName??p.superCatFriendlyName??''})}catch(e){console.warn(e.message)}}
 const by=new Map();for(const c of categories){const id=Number(c.categoryId);if(Number.isFinite(id))by.set(id,c)}
 const unique=[...by.values()];if(!unique.length)throw new Error('No categories');
 console.log(`Metadata: ${superCategories.length} super-categories, ${productLines.length} product lines, ${unique.length} categories`);return {superCategories,productLines,categories:unique};
}
function paramsFor(categoryId,page,index){const p=new URLSearchParams({query:'',page:String(page),hitsPerPage:String(HITS_PER_PAGE),facetFilters:JSON.stringify([[`categoryId:${categoryId}`]]),filters:'boxVisibilityOnWeb=1',facets:'[]',numericFilters:JSON.stringify([`sellPrice<=${MAX_PRICE}`])});return {indexName:index,params:p.toString()}}
async function queryBatch(items,index){const j=await fetchJson(SEARCH_API,{method:'POST',body:JSON.stringify({requests:items.map(x=>paramsFor(x.categoryId,x.page,index))})},30000);const r=arr(j?.results);if(r.length!==items.length)throw new Error('Incomplete Algolia batch');return r}
function normaliseHit(h,metaById){const categoryId=Number(h.categoryId),sellPrice=Number(h.sellPrice);if(!Number.isFinite(categoryId)||!Number.isFinite(sellPrice)||sellPrice>MAX_PRICE)return null;const boxId=String(h.boxId??h.objectID??'').trim();if(!boxId)return null;const m=metaById.get(categoryId)||{},availability=arr(h.availability).map(String),stores=arr(h.stores).map(String),online=availability.includes('In Stock Online')||Number(h.ecomQuantity??0)>0,inStore=availability.includes('In Stock In Store')||stores.length>0;return {boxId,boxName:h.boxName??boxId,categoryId,categoryName:h.categoryName??m.categoryName??'',categoryFriendlyName:h.categoryFriendlyName??m.categoryFriendlyName??h.categoryName??`Category ${categoryId}`,productLineId:Number(h.productLineId??m.productLineId??0)||null,productLineName:h.productLineName??m.productLineName??'',superCatId:Number(h.scId??h.superCatId??m.superCatId??0)||null,superCatName:h.superCatName??m.superCatFriendlyName??'',superCatFriendlyName:h.superCatFriendlyName??m.superCatFriendlyName??h.superCatName??'',imageUrls:h.imageUrls??{},sellPrice,cashPrice:Number(h.cashPriceCalculated??h.cashBuyPrice??0),exchangePrice:Number(h.exchangePriceCalculated??h.exchangePrice??0),boxRating:Number(h.rating??0)||null,outOfStock:inStore||online?0:1,outOfEcomStock:online?0:1,ecomQuantityOnHand:Number(h.ecomQuantity??0),stores,availability,priceLastChanged:h.priceLastChanged??null};}
async function collectAll(categories,index){const metaById=new Map(categories.map(c=>[Number(c.categoryId),c])),byId=new Map(),stats=new Map();let queue=categories.map(c=>({categoryId:Number(c.categoryId),page:0})),requests=0;while(queue.length){const next=[];for(let i=0;i<queue.length;i+=QUERY_BATCH_SIZE){const batch=queue.slice(i,i+QUERY_BATCH_SIZE),results=await queryBatch(batch,index);requests++;results.forEach((r,k)=>{const item=batch[k],hits=arr(r?.hits),nbHits=Number(r?.nbHits||0),nbPages=Number(r?.nbPages||0);stats.set(item.categoryId,{categoryId:item.categoryId,cheapListings:nbHits});for(const h of hits){const p=normaliseHit(h,metaById);if(p)byId.set(p.boxId,p)}if(item.page+1<nbPages&&item.page+1<MAX_PAGES_PER_CATEGORY)next.push({categoryId:item.categoryId,page:item.page+1})});console.log(`${index}: batch ${requests}, products=${byId.size}`);await sleep(120)}queue=next}return {products:[...byId.values()].sort((a,b)=>a.sellPrice-b.sellPrice||String(a.boxName).localeCompare(String(b.boxName))),stats,requests}}

async function main(){
 const meta=await discoverMetadata();let result,mode='super-category-files-price-asc';try{result=await collectAll(meta.categories,PRIMARY_INDEX);if(!result.products.length)throw new Error('No products')}catch(e){console.warn(`Primary failed: ${e.message}`);mode='super-category-files-generic';result=await collectAll(meta.categories,FALLBACK_INDEX)}
 await mkdir(DATA_DIR,{recursive:true});await rm(SUPER_DIR,{recursive:true,force:true});await mkdir(SUPER_DIR,{recursive:true});
 const categories=meta.categories.map(c=>({id:Number(c.categoryId),name:c.categoryFriendlyName??c.categoryName??`Category ${c.categoryId}`,categoryName:c.categoryName??'',productLineId:Number(c.productLineId)||null,productLineName:c.productLineName??'',superCatId:Number(c.superCatId)||null,superCatName:c.superCatFriendlyName??'',totalBoxes:Number(c.totalBoxes||0)||null,cheapListings:Number(result.stats.get(Number(c.categoryId))?.cheapListings||0)}));
 const groups=new Map();for(const p of result.products){const id=Number(p.superCatId)||0;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p)}
 const superCategories=[];
 for(const s of meta.superCategories){const id=Number(s.superCatId),name=s.superCatFriendlyName??s.superCatName??`Department ${id}`,products=groups.get(id)||[],file=`super/${id}-${slug(name)}.json`,cats=categories.filter(c=>c.superCatId===id);const payload={generatedAt:new Date().toISOString(),superCatId:id,superCatName:name,maxPrice:MAX_PRICE,productCount:products.length,categories:cats,products};await writeFile(`${DATA_DIR}/${file}`,JSON.stringify(payload));superCategories.push({id,name,file,productCount:products.length,categoryCount:cats.length});console.log(`${name}: ${products.length} products -> data/${file}`)}
 const generatedAt=new Date().toISOString();const manifest={generatedAt,source:SEARCH_API,scope:'All CeX UK catalogue categories, split by super-category',mode,maxPrice:MAX_PRICE,superCategoryCount:superCategories.length,productLineCount:meta.productLines.length,categoryCount:categories.length,productCount:result.products.length,requestCount:result.requests,superCategories,categories};await writeFile(MANIFEST,JSON.stringify(manifest));console.log(`Wrote manifest + ${superCategories.length} super-category files; ${result.products.length} products across ${categories.length} categories`);
}
main().catch(e=>{console.error(e);process.exit(1)});
