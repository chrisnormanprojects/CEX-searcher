import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPartition,normaliseHit,reconcileCategories} from './catalogue-core.mjs';
const matches=(record,filters)=>filters.every(f=>Array.isArray(f)?f.some(v=>matches(record,[v])):(()=>{const i=f.indexOf(':'),key=f.slice(0,i),value=f.slice(i+1);const vals=record[key]||[];return value.startsWith('-')?!vals.includes(value.slice(1)):vals.includes(value.replace(/^\\-/, '-'));})());
test('facet partitions cover multi-valued and missing attributes exactly once',()=>{
 const rows=[{categoryId:['40'],Genre:['Comedy','Drama']},{categoryId:['40'],Genre:['Comedy']},{categoryId:['40'],Genre:['Drama']},{categoryId:['40']},{categoryId:['40'],Genre:['-Special']}];
 const split=splitPartition({nbHits:5,facets:{Genre:{Comedy:2,Drama:2,'-Special':1}}},['categoryId:40']);
 for(const row of rows)assert.equal(split.filter(s=>matches(row,s)).length,1);
});
test('unsplittable over-limit groups fail instead of reporting complete',()=>assert.throws(()=>splitPartition({nbHits:2000,facets:{categoryId:{40:2000},sellPrice:{1:2000}}},['categoryId:40']),/Cannot safely partition/));
test('Apple dropdown and files use the same source department and actual count',()=>{
 const cats=[{id:967,name:'Apple iPad',superCatId:5}];
 const p=normaliseHit({boxId:'ipad',boxName:'iPad',categoryId:'967',scId:'3',sellPrice:50,availability:['In Stock Online'],stores:[]});
 const result=reconcileCategories(cats,[p],[{id:3,name:'Computing'},{id:5,name:'Electronics'}]);
 assert.equal(result[0].superCatId,3);assert.equal(result[0].superCatName,'Computing');assert.equal(result[0].cheapListings,1);assert.equal(p.outOfStock,0);
 assert.throws(()=>reconcileCategories(cats,[p,{...p,superCatId:5}],[{id:3,name:'Computing'},{id:5,name:'Electronics'}]),/Conflicting/);
});
test('invalid prices cannot enter the catalogue',()=>{
 for(const price of [-1,NaN,Infinity])assert.throws(()=>normaliseHit({boxId:'x',categoryId:1,sellPrice:price}),/Invalid/);
});
import {collect} from './fetch-cex.mjs';
test('collector retrieves all 2,500 equal-price products across capped queries',async()=>{
 const source=Array.from({length:2500},(_,i)=>({boxId:String(i),categoryId:40,scId:2,sellPrice:1,Year:[String(2000+i%10)]}));
 const query=async requests=>requests.map(({params})=>{
   const p=new URLSearchParams(params),filters=JSON.parse(p.get('facetFilters'));
   const found=source.filter(h=>matches({categoryId:['40'],Year:h.Year},filters));
   const page=Number(p.get('page')),per=Number(p.get('hitsPerPage'));
   const facets={Year:{}};for(const h of found)facets.Year[h.Year[0]]=(facets.Year[h.Year[0]]||0)+1;
   return {nbHits:found.length,exhaustiveNbHits:true,facets,hits:found.slice(page*per,Math.min(1000,(page+1)*per))};
 });
 const result=await collect([{id:40}],query,async()=>{});
 assert.equal(result.products.length,2500);assert.equal(new Set(result.products.map(p=>p.boxId)).size,2500);assert.ok(result.partitions>0);
});
test('missing page records prevent successful collection',async()=>{
 await assert.rejects(()=>collect([{id:40}],async()=>[{nbHits:5,exhaustiveNbHits:true,facets:{},hits:[]}],async()=>{}),/Incomplete category/);
});

test('higher-priced products remain in the catalogue, including just above £50',()=>{for(const sellPrice of [50,50.01,51,1000])assert.equal(normaliseHit({boxId:'x',categoryId:1,sellPrice}).sellPrice,sellPrice);});
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('over £50 filter excludes £50 and restores the previous maximum when unticked',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const code=app.slice(app.indexOf('function filtered()'),app.indexOf('function render('));
 const els={over50Only:{checked:true},maxPrice:{value:'20'},query:{value:''},onlineOnly:{checked:false},hideZero:{checked:false},sortBy:{value:'price'}};
 const context={els,products:[20,50,50.01,51,1000].map(sellPrice=>({sellPrice,boxName:String(sellPrice)})),normalise:s=>String(s).toLowerCase()};
 vm.createContext(context);vm.runInContext(code,context);
 assert.equal(JSON.stringify(vm.runInContext('filtered().map(p=>p.sellPrice)',context)),JSON.stringify([50.01,51,1000]));
 els.over50Only.checked=false;
 assert.equal(JSON.stringify(vm.runInContext('filtered().map(p=>p.sellPrice)',context)),JSON.stringify([20]));
 assert.equal(els.maxPrice.value,'20');
});
