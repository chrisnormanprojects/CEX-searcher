export const ATTRIBUTES = ['boxId','objectID','boxName','categoryId','categoryName','categoryFriendlyName','scId','superCatId','imageUrls','sellPrice','cashPriceCalculated','cashBuyPrice','exchangePriceCalculated','exchangePrice','rating','availability','stores','ecomQuantity'];

// A positive OR group and its negative complement are disjoint even for
// multi-valued facets. The complement also retains records without that facet.
export function splitPartition(result, filters) {
  const total = Number(result.nbHits);
  const choices = [];
  for (const [field, values] of Object.entries(result.facets || {})) {
    if (field === 'categoryId') continue;
    const entries = Object.entries(values).filter(([, n]) => n > 0 && n < total);
    if (!entries.length) continue;
    entries.sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
    const selected=[]; let count=0;
    for(const [value,n] of entries) {
      if (!selected.length || Math.abs(total/2-count-n)<Math.abs(total/2-count)) {selected.push(value);count+=n;}
      if(selected.length>=20) break;
    }
    choices.push({field,selected,score:Math.abs(total/2-count)/total + (field==='stores'?0.2:0)});
  }
  choices.sort((a,b)=>a.score-b.score || a.field.localeCompare(b.field));
  if(!choices.length) throw new Error(`Cannot safely partition ${total} matches; keeping the previous catalogue`);
  const {field,selected}=choices[0];
  const positive=selected.map(v=>`${field}:${v.startsWith('-')?'\\'+v:v}`);
  const negative=selected.map(v=>`${field}:-${v}`);
  return [[...filters,positive],[...filters,...negative]];
}

export function normaliseHit(h) {
  const categoryId=Number(h.categoryId),sellPrice=Number(h.sellPrice),boxId=String(h.boxId??h.objectID??'').trim();
  if(!boxId || !Number.isFinite(categoryId) || !Number.isFinite(sellPrice) || sellPrice<0 || sellPrice>50) throw new Error('Invalid product in source response');
  const stores=Array.isArray(h.stores)?h.stores.map(String):[];
  const availability=Array.isArray(h.availability)?h.availability:[];
  const online=availability.includes('In Stock Online')||Number(h.ecomQuantity)>0;
  return {boxId,boxName:h.boxName||boxId,categoryId,superCatId:Number(h.scId??h.superCatId)||null,sellPrice,
    cashPrice:Number(h.cashPriceCalculated??h.cashBuyPrice??0),exchangePrice:Number(h.exchangePriceCalculated??h.exchangePrice??0),
    boxRating:Number(h.rating)||null,imageUrls:{medium:h.imageUrls?.medium||h.imageUrls?.small||''},
    outOfStock:online||stores.length||availability.includes('In Stock In Store')?0:1,outOfEcomStock:online?0:1,
    ecomQuantityOnHand:Number(h.ecomQuantity)||0,stores};
}

export function reconcileCategories(categories, products, departments) {
  const byId=new Map(categories.map(c=>[c.id,{...c,cheapListings:0}]));
  const parents=new Map();
  for(const p of products) {
    const c=byId.get(p.categoryId);if(!c)throw new Error(`Unknown category ${p.categoryId}`);
    const id=p.superCatId||c.superCatId;
    if(!departments.some(s=>s.id===id))throw new Error(`Unknown department ${id}`);
    if(parents.has(c.id)&&parents.get(c.id)!==id)throw new Error(`Conflicting departments for category ${c.id}`);
    parents.set(c.id,id);c.cheapListings++;
  }
  for(const c of byId.values()) {
    c.superCatId=parents.get(c.id)??c.superCatId;
    c.superCatName=departments.find(s=>s.id===c.superCatId)?.name;
    if(!c.superCatName)throw new Error(`Category ${c.id} has no department`);
  }
  return [...byId.values()];
}
