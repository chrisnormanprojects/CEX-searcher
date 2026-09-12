import { mkdir, writeFile } from 'node:fs/promises';

const API = 'https://wss2.cex.uk.webuy.io/v3';
const OUT = 'data/catalog.json';
const MAX_PRICE = 50;
const PER_CATEGORY = 100;
const MAX_CATEGORIES = 140;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(path, attempt = 1) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: {
        'accept': 'application/json,text/plain,*/*',
        'user-agent': 'Mozilla/5.0 (compatible; CEX-searcher/1.0; +https://github.com/chrisnormanprojects/CEX-searcher)'
      }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    const text = await r.text();
    if (text.trim().startsWith('<')) throw new Error(`HTML response ${url}`);
    return JSON.parse(text);
  } catch (err) {
    if (attempt < 3) {
      await sleep(1000 * attempt);
      return getJson(path, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function arr(x) { return Array.isArray(x) ? x : []; }
function data(j) { return j?.response?.data || {}; }
function online(p) {
  return Number(p?.outOfEcomStock) === 0 || Number(p?.ecomQuantityOnHand || 0) > 0;
}

async function discoverCategories() {
  const sc = await getJson('/supercats');
  const supercats = arr(data(sc).superCats || data(sc).supercats);
  if (!supercats.length) throw new Error('No supercategories returned');

  const ids = supercats.map(x => x.superCatId ?? x.id).filter(x => x != null);
  const pl = await getJson(`/productlines?superCatIds=${encodeURIComponent(JSON.stringify(ids))}`);
  const productLines = arr(data(pl).productLines || data(pl).productlines);
  const plIds = productLines.map(x => x.productLineId ?? x.id).filter(x => x != null);
  if (!plIds.length) throw new Error('No product lines returned');

  const cat = await getJson(`/categories?productLineIds=${encodeURIComponent(JSON.stringify(plIds))}`);
  const categories = arr(data(cat).categories);
  if (!categories.length) throw new Error('No categories returned');
  return categories;
}

async function fetchCategory(category) {
  const id = category.categoryId ?? category.id;
  const url = `/boxes?categoryIds=${encodeURIComponent(JSON.stringify([id]))}&firstRecord=1&count=${PER_CATEGORY}&sortBy=sellprice&sortOrder=asc`;
  const j = await getJson(url);
  return arr(data(j).boxes).map(p => ({ ...p, _categoryId: id }));
}

async function fallbackSearches() {
  const terms = ['game','dvd','blu-ray','phone','tablet','laptop','controller','console','headphones','speaker','camera','watch','keyboard','mouse','music','film'];
  const all = [];
  for (const q of terms) {
    try {
      const j = await getJson(`/boxes?q=${encodeURIComponent(q)}&firstRecord=1&count=100&sortBy=sellprice&sortOrder=asc`);
      all.push(...arr(data(j).boxes));
    } catch (e) {
      console.warn(`Fallback search failed for ${q}: ${e.message}`);
    }
    await sleep(250);
  }
  return all;
}

async function main() {
  let categories = [];
  let products = [];
  let mode = 'categories';

  try {
    categories = await discoverCategories();
    console.log(`Discovered ${categories.length} categories`);
    for (const category of categories.slice(0, MAX_CATEGORIES)) {
      const id = category.categoryId ?? category.id;
      try {
        const got = await fetchCategory(category);
        products.push(...got);
        console.log(`Category ${id}: ${got.length}`);
      } catch (e) {
        console.warn(`Category ${id} failed: ${e.message}`);
      }
      await sleep(175);
    }
  } catch (e) {
    console.warn(`Category discovery failed: ${e.message}`);
    mode = 'fallback-searches';
    products = await fallbackSearches();
  }

  const byId = new Map();
  for (const p of products) {
    const id = p.boxId || p.boxName;
    const price = Number(p.sellPrice);
    if (!id || !Number.isFinite(price) || price > MAX_PRICE) continue;
    if (!online(p) && Number(p.outOfStock) !== 0) continue;
    const old = byId.get(id);
    if (!old || Number(p.ecomQuantityOnHand || 0) > Number(old.ecomQuantityOnHand || 0)) byId.set(id, p);
  }

  const list = [...byId.values()].sort((a,b) => Number(a.sellPrice) - Number(b.sellPrice));
  const payload = {
    generatedAt: new Date().toISOString(),
    source: API,
    mode,
    maxPrice: MAX_PRICE,
    categoryCount: categories.length,
    productCount: list.length,
    products: list
  };

  await mkdir('data', { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${list.length} products to ${OUT}`);
  if (!list.length) process.exitCode = 2;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
