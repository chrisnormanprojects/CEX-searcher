import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API='https://wss2.cex.uk.webuy.io/v3';
const OUT='data/catalog.json';
const CATEGORY_ID=892;
const MAX_PRICE=50;
const MAX_PAGES=120;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arr=x=>Array.isArray(x)?x:[];
const data=j=>j?.response?.data||{};

async function rawFetch(url,timeout=15000){
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);
 try{const r=await fetch(url,{signal:c.signal,headers:{accept:'application/json,text/plain,*/*','user-agent':'Mozilla/5.0 (compatible; CEX-searcher/2.0; +https://github.com/chrisnormanprojects/CEX-searcher)'}});const text=await r.text();return {ok:r.ok,status:r.status,text}}
 finally{clearTimeout(timer)}
}
async function getJson(url){const r=await rawFetch(url);if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);return JSON.parse(r.text)}
async function discover(){const j=await getJson(`${API}/categories?productLineIds=%5B7%5D`);const category=arr(data(j).categories).find(x=>Number(x.categoryId)===CATEGORY_ID);if(!category)throw new Error('PCI-Express Graphics Cards category not returned');return category}

function chromePath(){
 for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  try{return execSync(`command -v ${name}`,{encoding:'utf8'}).trim()}catch{}
 }
 throw new Error('No Chrome/Chromium executable found on runner');
}

function hitsFromJson(j){
 if(Array.isArray(j?.results))return j.results.flatMap(r=>arr(r?.hits));
 if(Array.isArray(j?.hits))return j.hits;
 return [];
}

function normaliseHit(h){
 const categoryId=Number(h.categoryId);
 if(categoryId!==CATEGORY_ID)return null;
 const sellPrice=Number(h.sellPrice ?? h.price ?? h.salePrice);
 if(!Number.isFinite(sellPrice)||sellPrice>MAX_PRICE)return null;
 const boxId=String(h.boxId ?? h.objectID ?? '').trim();
 if(!boxId)return null;
 const availability=arr(h.availability).map(String);
 const online=availability.includes('In Stock Online') || Number(h.ecomQuantity ?? h.ecomQuantityOnHand ?? 0)>0;
 const stores=arr(h.stores).map(String);
 const inStore=availability.includes('In Stock In Store') || stores.length>0;
 return {
  boxId,
  boxName:h.boxName ?? h.name ?? boxId,
  categoryId:CATEGORY_ID,
  categoryName:h.categoryName ?? 'Graphics Cards - PCI-E',
  categoryFriendlyName:h.categoryFriendlyName ?? 'PCI-Express Graphics Cards',
  superCatId:Number(h.scId ?? h.superCatId ?? 3),
  superCatName:h.superCatName ?? 'Computing',
  superCatFriendlyName:h.superCatFriendlyName ?? 'Computing',
  imageUrls:h.imageUrls ?? {},
  sellPrice,
  cashPrice:Number(h.cashPriceCalculated ?? h.cashBuyPrice ?? h.cashPrice ?? 0),
  exchangePrice:Number(h.exchangePriceCalculated ?? h.exchangePrice ?? 0),
  boxRating:Number(h.rating ?? h.boxRating ?? 0) || null,
  outOfStock:inStore||online?0:1,
  outOfEcomStock:online?0:1,
  ecomQuantityOnHand:Number(h.ecomQuantity ?? h.ecomQuantityOnHand ?? 0),
  stores,
  availability,
  priceLastChanged:h.priceLastChanged ?? null,
  source:'CeX Algolia search feed'
 };
}

async function scrapeAlgolia(){
 const browser=await chromium.launch({headless:true,executablePath:chromePath(),args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
 const context=await browser.newContext({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',locale:'en-GB',timezoneId:'Europe/London',viewport:{width:1366,height:768},extraHTTPHeaders:{'Accept-Language':'en-GB,en;q=0.9'}});
 await context.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});globalThis.chrome={runtime:{}}});
 await context.route('**/*',route=>['image','media','font'].includes(route.request().resourceType())?route.abort():route.continue());
 const page=await context.newPage();
 const byId=new Map();
 const diagnostics=[];
 try{
  for(let pageNo=1;pageNo<=MAX_PAGES;pageNo++){
   const url=`https://uk.webuy.com/search?page=${pageNo}&categoryIds=${CATEGORY_ID}&categoryName=PCI-EXPRESS-GRAPHICS-CARDS&sortBy=prod_cex_uk_price_asc`;
   const started=Date.now();
   try{
    const responsePromise=page.waitForResponse(r=>r.url().includes('search.webuy.io')&&r.status()===200,{timeout:30000});
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    const response=await responsePromise;
    const json=await response.json();
    const rawHits=hitsFromJson(json).filter(h=>Number(h.categoryId)===CATEGORY_ID);
    let added=0,maxSeen=null;
    for(const h of rawHits){
     const price=Number(h.sellPrice ?? h.price ?? h.salePrice);
     if(Number.isFinite(price))maxSeen=maxSeen==null?price:Math.max(maxSeen,price);
     const p=normaliseHit(h);if(p&&!byId.has(p.boxId)){byId.set(p.boxId,p);added++}
    }
    diagnostics.push({page:pageNo,http:response.status(),hits:rawHits.length,added,maxSeen,ms:Date.now()-started});
    console.log(`Algolia page ${pageNo}: hits=${rawHits.length}, added<=£${MAX_PRICE}=${added}, max=${maxSeen}, ${Date.now()-started}ms`);
    if(!rawHits.length)break;
    if(maxSeen!=null&&maxSeen>MAX_PRICE)break;
    if(pageNo>1&&added===0)break;
   }catch(e){diagnostics.push({page:pageNo,error:e.message,ms:Date.now()-started});console.warn(`Algolia page ${pageNo} failed: ${e.message}`);break}
   await sleep(150);
  }
  return {products:[...byId.values()].sort((a,b)=>a.sellPrice-b.sellPrice),diagnostics};
 }finally{await browser.close()}
}

async function main(){
 const category=await discover();const totalBoxes=Number(category.totalBoxes||0);
 console.log(`Category: ${category.categoryFriendlyName} (${CATEGORY_ID})`);console.log(`Catalogue listings: ${totalBoxes}`);
 const result=await scrapeAlgolia();
 const payload={generatedAt:new Date().toISOString(),source:'https://search.webuy.io via uk.webuy.com',scope:'Computing > Graphics and Capture Cards > PCI-Express Graphics Cards',mode:'algolia-browser-intercept',maxPrice:MAX_PRICE,category:{id:CATEGORY_ID,name:category.categoryFriendlyName,totalBoxes},catalogueListings:totalBoxes,productCount:result.products.length,boxesBlocked:false,diagnostics:result.diagnostics,products:result.products};
 await mkdir('data',{recursive:true});await writeFile(OUT,JSON.stringify(payload,null,2));console.log(`Wrote ${result.products.length} PCI-Express graphics cards priced at £${MAX_PRICE} or less to ${OUT}`);
 if(!result.products.length)process.exitCode=2;
}
main().catch(err=>{console.error(err);process.exit(1)});
