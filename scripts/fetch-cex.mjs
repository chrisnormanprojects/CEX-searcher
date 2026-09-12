import { mkdir, writeFile } from 'node:fs/promises';

const META_API='https://wss2.cex.uk.webuy.io/v3';
const SEARCH_API='https://search.webuy.io/1/indexes/*/queries';
const PRIMARY_INDEX='prod_cex_uk_price_asc';
const FALLBACK_INDEX='prod_cex_uk';
const OUT='data/catalog.json';
const MAX_PRICE=50;
const HITS_PER_PAGE=100;
const QUERY_BATCH_SIZE=35;
const MAX_PAGES_PER_CATEGORY=20;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arr=x=>Array.isArray(x)?x:[];
const data=j=>j?.response?.data||{};

async function fetchJson(url,options={},timeout=25000,attempt=1){
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);
 try{
  const r=await fetch(url,{...options,signal:c.signal,headers:{accept:'application/json','content-type':'application/json','user-agent':'Mozilla/5.0 (compatible; CEX-searcher/3.0; +https://github.com/chrisnormanprojects/CEX-searcher)',...(options.headers||{})}});
  const text=await r.text();
  if(!r.ok){const e=new Error(`HTTP ${r.status} ${url}: ${text.slice(0,180)}`);e.status=r.status;throw e}
  return JSON.parse(text);
 }catch(e){
  if(attempt<3&&(e.status===429||e.status>=500||e.name==='AbortError')){await sleep(800*attempt);return fetchJson(url,options,timeout,attempt+1)}
  throw e;
 }finally{clearTimeout(timer)}
}

async function discoverMetadata(){
 const sj=await fetchJson(`${META_API}/supercats`);
 const superCategories=arr(data(sj).superCats);
 const productLines=[];
 for(const sc of superCategories){
  try{
   const pj=await fetchJson(`${META_API}/productlines?superCatIds=${encodeURIComponent(JSON.stringify([Number(sc.superCatId)]))}`);
   for(const p of arr(data(pj).productLines))productLines.push({...p,superCatId:Number(p.superCatId??sc.superCatId),superCatFriendlyName:p.superCatFriendlyName??sc.superCatFriendlyName});
  }catch(e){console.warn(`Product-line metadata failed for ${sc.superCatFriendlyName}: ${e.message}`)}
 }
 const categories=[];
 for(const p of productLines){
  try{
   const cj=await fetchJson(`${META_API}/categories?productLineIds=${encodeURIComponent(JSON.stringify([Number(p.productLineId)]))}`);
   for(const c of arr(data(cj).categories))categories.push({...c,productLineId:Number(c.productLineId??p.productLineId),productLineName:c.productLineName??p.productLineName??p.productLineFriendlyName??'',superCatId:Number(c.superCatId??p.superCatId),superCatFriendlyName:c.superCatFriendlyName??p.superCatFriendlyName??''});
  }catch(e){console.warn(`Category metadata failed for product line ${p.productLineId}: ${e.message}`)}
 }
 const byCategory=new Map();
 for(const c of categories){const id=Number(c.categoryId);if(Number.isFinite(id))byCategory.set(id,c)}
 const uniqueCategories=[...byCategory.values()].sort((a,b)=>String(a.superCatFriendlyName).localeCompare(String(b.superCatFriendlyName))||String(a.categoryFriendlyName).localeCompare(String(b.categoryFriendlyName)));
 if(!uniqueCategories.length)throw new Error('CeX category metadata returned no categories');
 console.log(`Metadata: ${superCategories.length} super-categories, ${productLines.length} product lines, ${uniqueCategories.length} categories`);
 return {superCategories,productLines,categories:uniqueCategories};
}

function paramsFor(categoryId,page,index){
 const params=new URLSearchParams({query:'',page:String(page),hitsPerPage:String(HITS_PER_PAGE),facetFilters:JSON.stringify([[`categoryId:${categoryId}`]]),filters:'boxVisibilityOnWeb=1',facets:'[]',maxValuesPerFacet:'20'});
 params.set('numericFilters',JSON.stringify([`sellPrice<=${MAX_PRICE}`]));
 return {indexName:index,params:params.toString()};
}

async function queryBatch(items,index){
 const body={requests:items.map(x=>paramsFor(x.categoryId,x.page,index))};
 const j=await fetchJson(SEARCH_API,{method:'POST',body:JSON.stringify(body)},30000);
 const results=arr(j?.results);
 if(results.length!==items.length)throw new Error(`Algolia returned ${results.length} results for ${items.length} category queries`);
 return results;
}

function normaliseHit(h,metaById){
 const categoryId=Number(h.categoryId);if(!Number.isFinite(categoryId))return null;
 const sellPrice=Number(h.sellPrice);if(!Number.isFinite(sellPrice)||sellPrice>MAX_PRICE)return null;
 const boxId=String(h.boxId??h.objectID??'').trim();if(!boxId)return null;
 const m=metaById.get(categoryId)||{};
 const availability=arr(h.availability).map(String),stores=arr(h.stores).map(String);
 const online=availability.includes('In Stock Online')||Number(h.ecomQuantity??h.ecomQuantityOnHand??0)>0;
 const inStore=availability.includes('In Stock In Store')||stores.length>0;
 return {
  boxId,boxName:h.boxName??h.name??boxId,categoryId,
  categoryName:h.categoryName??m.categoryName??'',categoryFriendlyName:h.categoryFriendlyName??m.categoryFriendlyName??h.categoryName??`Category ${categoryId}`,
  productLineId:Number(h.productLineId??m.productLineId??0)||null,productLineName:h.productLineName??m.productLineName??'',
  superCatId:Number(h.scId??h.superCatId??m.superCatId??0)||null,superCatName:h.superCatName??m.superCatFriendlyName??'',superCatFriendlyName:h.superCatFriendlyName??m.superCatFriendlyName??h.superCatName??'',
  imageUrls:h.imageUrls??{},sellPrice,
  cashPrice:Number(h.cashPriceCalculated??h.cashBuyPrice??h.cashPrice??0),exchangePrice:Number(h.exchangePriceCalculated??h.exchangePrice??0),
  boxRating:Number(h.rating??h.boxRating??0)||null,outOfStock:inStore||online?0:1,outOfEcomStock:online?0:1,
  ecomQuantityOnHand:Number(h.ecomQuantity??h.ecomQuantityOnHand??0),stores,availability,priceLastChanged:h.priceLastChanged??null,
  source:'CeX Algolia search feed'
 };
}

async function collectAll(categories,index){
 const metaById=new Map(categories.map(c=>[Number(c.categoryId),c]));
 const byId=new Map(),categoryStats=new Map();
 let queue=categories.map(c=>({categoryId:Number(c.categoryId),page:0}));
 let requestCount=0;
 while(queue.length){
  const next=[];
  for(let i=0;i<queue.length;i+=QUERY_BATCH_SIZE){
   const batch=queue.slice(i,i+QUERY_BATCH_SIZE);
   const started=Date.now();
   const results=await queryBatch(batch,index);requestCount++;
   results.forEach((r,k)=>{
    const item=batch[k],hits=arr(r?.hits),nbHits=Number(r?.nbHits||0),nbPages=Number(r?.nbPages||0);
    const stat=categoryStats.get(item.categoryId)||{categoryId:item.categoryId,cheapListings:nbHits,pagesFetched:0,hitsFetched:0};
    stat.cheapListings=nbHits;stat.pagesFetched++;stat.hitsFetched+=hits.length;categoryStats.set(item.categoryId,stat);
    for(const h of hits){const p=normaliseHit(h,metaById);if(p)byId.set(p.boxId,p)}
    if(item.page+1<nbPages&&item.page+1<MAX_PAGES_PER_CATEGORY)next.push({categoryId:item.categoryId,page:item.page+1});
   });
   console.log(`${index}: batch ${requestCount}, ${batch.length} category queries, ${Date.now()-started}ms, products=${byId.size}`);
   await sleep(120);
  }
  queue=next;
 }
 return {products:[...byId.values()].sort((a,b)=>a.sellPrice-b.sellPrice||String(a.boxName).localeCompare(String(b.boxName))),categoryStats:[...categoryStats.values()],requestCount};
}

async function main(){
 const meta=await discoverMetadata();
 let result,mode='all-categories-batched-price-asc';
 try{
  result=await collectAll(meta.categories,PRIMARY_INDEX);
  if(!result.products.length)throw new Error('Price-sorted index returned no products');
 }catch(e){
  console.warn(`Primary index failed: ${e.message}`);
  mode='all-categories-batched-generic';
  result=await collectAll(meta.categories,FALLBACK_INDEX);
 }
 if(!result.products.length)throw new Error('CeX search returned no bargain products');
 const statsById=new Map(result.categoryStats.map(s=>[s.categoryId,s]));
 const categories=meta.categories.map(c=>({
  id:Number(c.categoryId),name:c.categoryFriendlyName??c.categoryName??`Category ${c.categoryId}`,
  categoryName:c.categoryName??'',productLineId:Number(c.productLineId)||null,productLineName:c.productLineName??'',
  superCatId:Number(c.superCatId)||null,superCatName:c.superCatFriendlyName??'',
  totalBoxes:Number(c.totalBoxes||0)||null,cheapListings:Number(statsById.get(Number(c.categoryId))?.cheapListings||0)
 }));
 const superCategories=meta.superCategories.map(s=>({id:Number(s.superCatId),name:s.superCatFriendlyName}));
 const metadataListings=categories.reduce((n,c)=>n+(Number(c.totalBoxes)||0),0);
 const payload={
  generatedAt:new Date().toISOString(),source:SEARCH_API,scope:'All CeX UK catalogue categories',mode,maxPrice:MAX_PRICE,
  superCategoryCount:superCategories.length,productLineCount:meta.productLines.length,categoryCount:categories.length,
  catalogueListings:metadataListings||null,productCount:result.products.length,boxesBlocked:false,requestCount:result.requestCount,
  superCategories,categories,products:result.products
 };
 await mkdir('data',{recursive:true});await writeFile(OUT,JSON.stringify(payload,null,2));
 console.log(`Wrote ${result.products.length} CeX products priced at £${MAX_PRICE} or less across ${categories.length} categories to ${OUT}`);
}
main().catch(err=>{console.error(err);process.exit(1)});
