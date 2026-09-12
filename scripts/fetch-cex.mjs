import { mkdir, writeFile } from 'node:fs/promises';

const API = 'https://wss2.cex.uk.webuy.io/v3';
const OUT = 'data/catalog.json';
const MAX_PRICE = 50;
const PER_CATEGORY = 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HARDWARE_WORDS = [
  'pc component','component','memory','ram','graphics','gpu','processor','cpu',
  'motherboard','ssd','hard drive','hdd','storage','power supply','psu',
  'cooling','cooler','fan','sound card','network card','wifi card','optical drive'
];
const SEARCH_TERMS = ['ram','graphics card','gpu','ssd','processor','cpu','motherboard','power supply'];

function arr(x){ return Array.isArray(x) ? x : []; }
function data(j){ return j?.response?.data || {}; }
function text(x){ return String(x || '').toLowerCase(); }
function hardwareMatch(x){ const s=text(x); return HARDWARE_WORDS.some(w=>s.includes(w)); }
function online(p){ return Number(p?.outOfEcomStock) === 0 || Number(p?.ecomQuantityOnHand || 0) > 0; }

async function getJson(path, attempt=1){
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const c = new AbortController();
  const timer = setTimeout(()=>c.abort(),15000);
  try{
    const r = await fetch(url,{signal:c.signal,headers:{
      accept:'application/json,text/plain,*/*',
      'user-agent':'Mozilla/5.0 (compatible; CEX-searcher/1.1; +https://github.com/chrisnormanprojects/CEX-searcher)'
    }});
    if(!r.ok){
      const e = new Error(`HTTP ${r.status} ${url}`);
      e.status = r.status;
      throw e;
    }
    const body = await r.text();
    if(body.trim().startsWith('<')) throw new Error(`HTML response ${url}`);
    return JSON.parse(body);
  }catch(e){
    if(e.status === 403) throw e;
    if(attempt < 3){ await sleep(750 * attempt); return getJson(path,attempt+1); }
    throw e;
  }finally{ clearTimeout(timer); }
}

async function discoverPcComponents(){
  const pl = await getJson('/productlines?superCatIds=%5B3%5D');
  const computingLines = arr(data(pl).productLines || data(pl).productlines)
    .filter(x=>Number(x.superCatId)===3);
  if(!computingLines.length) throw new Error('No Computing product lines returned');

  let selectedLines = computingLines.filter(x=>hardwareMatch(x.productLineName));
  const allIds = computingLines.map(x=>x.productLineId ?? x.id).filter(x=>x!=null);
  const cat = await getJson(`/categories?productLineIds=${encodeURIComponent(JSON.stringify(allIds))}`);
  const computingCategories = arr(data(cat).categories).filter(x=>Number(x.superCatId)===3);

  if(!selectedLines.length){
    const matchingLineIds = new Set(computingCategories.filter(x=>hardwareMatch(x.categoryFriendlyName)).map(x=>x.productLineId));
    selectedLines = computingLines.filter(x=>matchingLineIds.has(x.productLineId));
  }

  const lineIds = new Set(selectedLines.map(x=>x.productLineId ?? x.id));
  let categories = computingCategories.filter(x=>lineIds.has(x.productLineId));
  categories = categories.filter(x=>hardwareMatch(x.categoryFriendlyName) || selectedLines.some(l=>l.productLineId===x.productLineId && hardwareMatch(l.productLineName)));

  return { computingLines, selectedLines, computingCategories, categories };
}

async function fetchCategory(category){
  const id = category.categoryId ?? category.id;
  const j = await getJson(`/boxes?categoryIds=${encodeURIComponent(JSON.stringify([id]))}&firstRecord=1&count=${PER_CATEGORY}&sortBy=sellprice&sortOrder=asc`);
  return arr(data(j).boxes).filter(p=>Number(p.superCatId)===3).map(p=>({...p,_categoryId:id}));
}

async function searchFallback(){
  const out=[];
  for(const q of SEARCH_TERMS){
    try{
      const j=await getJson(`/boxes?q=${encodeURIComponent(q)}&firstRecord=1&count=100&sortBy=sellprice&sortOrder=asc`);
      out.push(...arr(data(j).boxes).filter(p=>Number(p.superCatId)===3));
    }catch(e){
      console.warn(`Fallback ${q} failed: ${e.message}`);
      if(e.status===403) break;
    }
    await sleep(200);
  }
  return out;
}

async function main(){
  const discovered = await discoverPcComponents();
  const {computingLines,selectedLines,computingCategories,categories}=discovered;
  const totalBoxes = categories.reduce((n,c)=>n+Number(c.totalBoxes||0),0);

  console.log(`Computing product lines: ${computingLines.length}`);
  console.log(`PC component product lines: ${selectedLines.length}`);
  console.log(`Computing categories: ${computingCategories.length}`);
  console.log(`PC component categories: ${categories.length}`);
  console.log(`PC component catalogue listings (metadata): ${totalBoxes}`);
  console.log('Selected lines:', selectedLines.map(x=>x.productLineName).join(' | '));
  console.log('Selected categories:', categories.map(x=>`${x.categoryFriendlyName} (${x.totalBoxes||0})`).join(' | '));

  let products=[];
  let blocked=false;
  for(const category of categories){
    try{
      const got=await fetchCategory(category);
      products.push(...got);
      console.log(`Category ${category.categoryId}: ${got.length}`);
    }catch(e){
      console.warn(`Category ${category.categoryId} failed: ${e.message}`);
      if(e.status===403){ blocked=true; break; }
    }
    await sleep(175);
  }

  let mode='pc-component-categories';
  if(blocked || !products.length){
    mode='pc-component-search-fallback';
    products=await searchFallback();
  }

  const byId=new Map();
  for(const p of products){
    const id=p.boxId||p.boxName, price=Number(p.sellPrice);
    if(!id || !Number.isFinite(price) || price>MAX_PRICE) continue;
    if(!online(p) && Number(p.outOfStock)!==0) continue;
    const old=byId.get(id);
    if(!old || Number(p.ecomQuantityOnHand||0)>Number(old.ecomQuantityOnHand||0)) byId.set(id,p);
  }
  const list=[...byId.values()].sort((a,b)=>Number(a.sellPrice)-Number(b.sellPrice));
  const payload={
    generatedAt:new Date().toISOString(),source:API,scope:'Computing > PC components',mode,maxPrice:MAX_PRICE,
    computingProductLineCount:computingLines.length,pcComponentProductLineCount:selectedLines.length,
    computingCategoryCount:computingCategories.length,pcComponentCategoryCount:categories.length,
    pcComponentCatalogueListings:totalBoxes,
    productLines:selectedLines.map(x=>({id:x.productLineId,name:x.productLineName,totalCategories:x.totalCategories})),
    categories:categories.map(x=>({id:x.categoryId,name:x.categoryFriendlyName,totalBoxes:Number(x.totalBoxes||0)})),
    productCount:list.length,boxesBlocked:blocked && !list.length,products:list
  };
  await mkdir('data',{recursive:true});
  await writeFile(OUT,JSON.stringify(payload,null,2));
  console.log(`Wrote ${list.length} PC-component products plus metadata to ${OUT}`);
}

main().catch(err=>{ console.error(err); process.exit(1); });
