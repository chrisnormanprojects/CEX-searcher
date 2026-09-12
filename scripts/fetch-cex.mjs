import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ATTRIBUTES, splitPartition, normaliseHit, reconcileCategories } from './catalogue-core.mjs';
const META='https://wss2.cex.uk.webuy.io/v3',SEARCH='https://search.webuy.io/1/indexes/*/queries';
const INDEX='prod_cex_uk_price_asc', PAGE_SIZE=100, BATCH_SIZE=12;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const data=j=>j?.response?.data||{};
const arr=x=>Array.isArray(x)?x:[];
async function fetchJson(url,options={},attempt=1) {
  try {
    const r=await fetch(url,{...options,signal:AbortSignal.timeout(45000),headers:{accept:'application/json','content-type':'application/json','user-agent':'Mozilla/5.0 (compatible; CEX-searcher/4.0)'}});
    if(!r.ok){const e=new Error(`HTTP ${r.status} from ${url}`);e.status=r.status;throw e;}
    return await r.json();
  } catch(e) {
    if(attempt<4 && (e.status===429||e.status>=500||e.name==='TimeoutError'||e.name==='TypeError')){await sleep(attempt*1500);return fetchJson(url,options,attempt+1);}
    throw e;
  }
}
async function metadata(previous) {
  const superCats=arr(data(await fetchJson(`${META}/supercats`)).superCats);
  if(!superCats.length)throw new Error('No departments');
  const lines=new Map(),cats=new Map();
  for(const s of superCats) {
    const ps=arr(data(await fetchJson(`${META}/productlines?superCatIds=${encodeURIComponent(JSON.stringify([Number(s.superCatId)]))}`)).productLines);
    if(!ps.length)throw new Error(`No product lines for ${s.superCatId}`);
    for(const p of ps) lines.set(Number(p.productLineId),{...p,superCatId:Number(p.superCatId??s.superCatId)});
  }
  for(const p of lines.values()) {
    const cs=arr(data(await fetchJson(`${META}/categories?productLineIds=${encodeURIComponent(JSON.stringify([Number(p.productLineId)]))}`)).categories);
    for(const c of cs) cats.set(Number(c.categoryId),{id:Number(c.categoryId),name:c.categoryFriendlyName??c.categoryName,categoryName:c.categoryName??'',productLineId:Number(c.productLineId??p.productLineId),productLineName:c.productLineName??p.productLineName??p.productLineFriendlyName??'',superCatId:Number(c.superCatId??p.superCatId),totalBoxes:Number(c.totalBoxes)||0});
  }
  if(!cats.size)throw new Error('No categories');
  // A failed metadata branch must never silently remove a department/category.
  const missing=(previous?.categories||[]).filter(c=>!cats.has(c.id));
  if(missing.length)throw new Error(`Metadata omitted ${missing.length} previous categories (${missing.map(c=>c.id).join(',')}); review retirement before publishing`);
  return {superCategories:superCats.map(s=>({id:Number(s.superCatId),name:s.superCatFriendlyName??s.superCatName})),categories:[...cats.values()],productLineCount:lines.size};
}
function requestFor(item) {
  return {indexName:INDEX,params:new URLSearchParams({query:'',page:String(item.page||0),hitsPerPage:String(PAGE_SIZE),
    facetFilters:JSON.stringify(item.filters),filters:'boxVisibilityOnWeb=1',numericFilters:JSON.stringify(['sellPrice>=0','sellPrice<=50']),
    facets:item.leaf?'[]':'["*"]',maxValuesPerFacet:'100',attributesToRetrieve:JSON.stringify(ATTRIBUTES),attributesToHighlight:'[]',attributesToSnippet:'[]'}).toString()};
}
export async function collect(categories, query=async requests=>(await fetchJson(SEARCH,{method:'POST',body:JSON.stringify({requests})})).results, pause=sleep) {
  let queue=categories.map(c=>({categoryId:c.id,filters:[`categoryId:${c.id}`],depth:0,page:0})),requests=0,partitions=0;
  const products=new Map(),roots=new Map(),leaves=[];
  while(queue.length) {
    const next=[];
    for(let i=0;i<queue.length;i+=BATCH_SIZE) {
      const batch=queue.slice(i,i+BATCH_SIZE);
      const results=await query(batch.map(requestFor));
      if(!Array.isArray(results)||results.length!==batch.length)throw new Error('Incomplete search response');
      requests++;
      for(let k=0;k<batch.length;k++) {
        const item=batch[k],r=results[k],n=Number(r.nbHits),hits=arr(r.hits);
        if(r.message||r.error||!Number.isFinite(n))throw new Error(`Search error: ${r.message||r.error||'missing count'}`);
        if(item.depth===0&&!item.leaf)roots.set(item.categoryId,{sourceReportedListings:n,sourceCountExact:r.exhaustiveNbHits===true});
        if(!item.leaf && (n>900 || r.exhaustiveNbHits!==true)) {
          if(item.depth>=40)throw new Error(`Partition depth exceeded for ${item.categoryId}`);
          for(const filters of splitPartition(r,item.filters))next.push({categoryId:item.categoryId,filters,depth:item.depth+1,page:0});
          partitions++;continue;
        }
        let leaf=item.leaf;
        if(!leaf){leaf={expected:n,ids:new Set(),categoryId:item.categoryId};leaves.push(leaf);}
        if(n!==leaf.expected||r.exhaustiveNbHits!==true)throw new Error(`Source changed while paging category ${item.categoryId}; retry refresh`);
        for(const h of hits) {
          const p=normaliseHit(h);
          if(p.categoryId!==item.categoryId)throw new Error('Source ignored category filter');
          leaf.ids.add(p.boxId);products.set(p.boxId,p);
        }
        if((item.page+1)*PAGE_SIZE<n)next.push({...item,leaf,page:item.page+1});
      }
      console.log(`Batch ${requests}: ${products.size} products, ${partitions} splits`);
      await pause(100);
    }
    queue=next;
  }
  for(const leaf of leaves)if(leaf.ids.size!==leaf.expected)throw new Error(`Incomplete category ${leaf.categoryId}: ${leaf.ids.size}/${leaf.expected}`);
  if(leaves.reduce((n,l)=>n+l.ids.size,0)!==products.size)throw new Error('Products crossed partitions during collection; retry refresh');
  if(!products.size)throw new Error('Empty catalogue; preserving previous data');
  return {products:[...products.values()],roots,requests,partitions};
}
async function main() {
  let previous;try{previous=JSON.parse(await readFile('data/catalog.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const meta=await metadata(previous);
  console.log(`Metadata: ${meta.superCategories.length} departments, ${meta.productLineCount} unique product lines, ${meta.categories.length} categories`);
  const result=await collect(meta.categories);
  const categories=reconcileCategories(meta.categories,result.products,meta.superCategories);
  const generatedAt=new Date().toISOString(),byCategory=new Map(categories.map(c=>[c.id,[]]));
  for(const p of result.products)byCategory.get(p.categoryId).push(p);
  await mkdir('data/items',{recursive:true});
  const keep=new Set((previous?.categories||[]).flatMap(c=>c.files||[]).map(f=>f.split('/').pop()));
  for(const c of categories) {
    const products=byCategory.get(c.id).sort((a,b)=>a.sellPrice-b.sellPrice||a.boxName.localeCompare(b.boxName));
    Object.assign(c,result.roots.get(c.id),{coverage:'complete',files:[]});
    for(let i=0;i<products.length;i+=500) {
      const body=JSON.stringify({categoryId:c.id,products:products.slice(i,i+500)});
      const hash=createHash('sha256').update(body).digest('hex').slice(0,16),name=`${c.id}-${i/500}-${hash}.json`;
      await writeFile(`data/items/${name}`,body);c.files.push(`items/${name}`);keep.add(name);
    }
  }
  const superCategories=meta.superCategories.map(s=>({...s,categoryCount:categories.filter(c=>c.superCatId===s.id).length,productCount:categories.filter(c=>c.superCatId===s.id).reduce((sum,c)=>sum+c.cheapListings,0)}));
  const manifest={schemaVersion:2,generatedAt,source:SEARCH,scope:'CeX UK metadata categories; visible products priced at £50 or less',mode:'partitioned-category-shards',coverage:'complete',maxPrice:50,superCategoryCount:superCategories.length,productLineCount:meta.productLineCount,categoryCount:categories.length,productCount:result.products.length,requestCount:result.requests,partitionCount:result.partitions,superCategories,categories};
  await writeFile('data/catalog.json',JSON.stringify(manifest));
  // Keep the previous manifest's content-addressed shards for already-open pages.
  for(const name of await readdir('data/items'))if(!keep.has(name))await rm(`data/items/${name}`);
  await rm('data/super',{recursive:true,force:true});
  console.log(`Validated and wrote ${result.products.length} products in ${categories.length} categories (${result.partitions} partitions)`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exit(1);});
