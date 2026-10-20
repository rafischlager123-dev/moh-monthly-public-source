import {webcrypto} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {monthlyFileUrl,publicationPeriods,fetchMonthlyFile,registryVersion,registryPage,rss,digest,bytesOf} from './public-core.mjs';
import {discoverMonthly} from './browser-discovery.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const association='https://psi.org.il/he/pharma-rules';

export function mergeCatalog(seed,prior,direct,alternate){
  if(seed.schema!=='public-moh-verified-catalog-v1'||!Array.isArray(seed.releases))throw Error('Unrecognized verified setup catalog');
  const byUrl=new Map(),byPeriod=new Map();
  const add=(release,origin)=>{
    if(!monthlyFileUrl(release.url)||JSON.stringify(publicationPeriods(release.label))!==JSON.stringify(release.periods))throw Error('Unsafe or contradictory release metadata');
    if(release.sha256&&!/^[a-f0-9]{64}$/.test(release.sha256))throw Error('Invalid retained source hash');
    const old=byUrl.get(release.url);
    if(old&&JSON.stringify(old.periods)!==JSON.stringify(release.periods))throw Error('Same official file has contradictory reporting periods');
    if(old?.sha256&&release.sha256&&old.sha256!==release.sha256)throw Error('Retained official source hash changed');
    for(const period of release.periods){const other=byPeriod.get(period);if(other&&other!==release.url)throw Error('Multiple official source URLs cover one reporting month; retain for review');byPeriod.set(period,release.url);}
    byUrl.set(release.url,{...release,...old,publicationDate:old?.publicationDate||release.publicationDate||null,discoverySources:[...new Set([...(old?.discoverySources||[]),origin])]});
  };
  for(const r of seed.releases)add(r,'Official government listing verified at setup on '+seed.verifiedOn);
  for(const r of prior?.releases||[])add(r,'Previously archived public collection');
  for(const r of direct?.releases||[])add(r,'Current official government listing');
  for(const r of alternate||[])add(r,association);
  const releases=[...byUrl.values()].sort((a,b)=>a.periods[0].localeCompare(b.periods[0]));
  if(!releases.length||releases.length>240)throw Error('Release catalog exceeds the reviewed bound');
  return {schema:'public-moh-catalog-v1',baselineInclusive:seed.baselineInclusive,officialCatalogVerifiedOn:direct?new Date().toISOString().slice(0,10):seed.verifiedOn,officialCatalogCompleteAtCurrentCollection:!!direct,discoveryCoverageReviewRequired:!direct,publicationDatesComplete:releases.every(x=>!!x.publicationDate),releases};
}

async function associationLinks(chromium){
  const browser=await chromium.launch({channel:'chrome',headless:false,timeout:25000});
  try{
    const page=await browser.newPage();
    const response=await page.goto(association,{waitUntil:'domcontentloaded',timeout:25000});
    if(!response?.ok())throw Error('Public pharmacy directory HTTP '+response?.status());
    await page.waitForSelector('a[href*="/BlobFolder/dynamiccollectorresultitem/"]',{state:'attached',timeout:15000});
    const anchors=await page.locator('a[href]').evaluateAll(elements=>elements.map(a=>({url:a.href,label:(a.textContent||'').trim()})));
    const found=[],seen=new Set();
    for(const a of anchors){
      const url=monthlyFileUrl(a.url);if(!url||seen.has(url)||!a.label.includes('תכשירים חדשים שנרשמו'))continue;
      const periods=publicationPeriods(a.label);if(periods.at(-1)<'2025-12')continue;
      seen.add(url);found.push({url,label:a.label,periods,publicationDate:null,publicationDateMissing:true});
    }
    if(!found.length||found.length>60)throw Error('No bounded set of original government Excel links found in public directory');
    return found;
  }finally{await browser.close();}
}

export async function collectRegistry(fetchPage=registryPage,getVersion=registryVersion){
  const before=await getVersion(),first=await fetchPage(0),pages=[first],ids=new Set(),registrations=new Map();
  const totalPages=Math.ceil(first.total/100);
  for(let page=1;page<totalPages;page++)pages.push(await fetchPage(page,first.total));
  const after=await getVersion();
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Official registry changed during collection');
  let rows=0,active=0,statusDisagreements=0,missingIdentity=0,lastMedicineId=0;
  for(const p of pages){
    for(const r of p.rows){
      if(ids.has(r.medicineId))throw Error('Duplicate medicine identity across registry pages');ids.add(r.medicineId);
      if(r.medicineId<=lastMedicineId)throw Error('Official registry no longer follows the requested unique medicine ID order');lastMedicineId=r.medicineId;
      const key=String(r.regNumber||'').replace(/\D/g,'');
      if(/^\d{12}$/.test(key)){const old=registrations.get(key);if(old&&old!==r.medicineId)throw Error('Ambiguous registry registration identity');registrations.set(key,r.medicineId);}
      rows++;if(r.active===1)active++;
    }
    statusDisagreements+=p.summaries.filter(x=>x.statusDisagreement).length;
    missingIdentity+=p.summaries.filter(x=>x.identityMissing).length;
  }
  if(rows!==first.total||active!==before.activeRecords)throw Error('Complete registry counts do not reconcile with official catalog');
  return {schema:'public-moh-registry-capture-v1',sortBy:'medicineId',sortDirection:'asc',version:before,totalRecords:rows,totalPages,uniqueMedicineIds:ids.size,activeRecords:active,statusDisagreements,recordsWithMissingIdentity:missingIdentity,complete:true,pages};
}

export async function runCollection(){
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='rafischlager123-dev/moh-monthly-public-source')throw Error('Collection runs only in the dedicated public source repository');
  const {chromium}=await import('playwright'),startedAt=new Date().toISOString(),runId=process.env.GITHUB_RUN_ID;
  if(!/^\d+$/.test(runId||''))throw Error('Invalid public collection identity');
  const seed=JSON.parse(await readFile(new URL('./verified-catalog-seed.json',import.meta.url),'utf8'));
  let prior=null;
  try{prior=JSON.parse(await readFile('public/catalog.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  let direct=null,directError=null;
  try{direct=await discoverMonthly(()=>chromium.launch({channel:'chrome',headless:false,timeout:25000}));}catch(error){directError=String(error.message||error).slice(0,1000);}
  const alternate=await associationLinks(chromium),catalog=mergeCatalog(seed,prior,direct,alternate);
  const out=path.resolve('collection-output'),snapshot='public/runs/'+runId,files=[];
  const save=async(name,data)=>{if(!/^public\/[A-Za-z0-9_./-]+$/.test(name)||name.includes('..'))throw Error('Invalid public output path');const bytes=Buffer.from(data);if(bytes.length>4*1024*1024)throw Error('Public output exceeds size bound');await mkdir(path.dirname(path.join(out,name)),{recursive:true});await writeFile(path.join(out,name),bytes);files.push({path:name,bytes:bytes.length,sha256:await digest(bytes)});};
  const downloaded=[];
  for(const release of catalog.releases){
    const file=await fetchMonthlyFile(release);
    if(release.sha256&&file.proof.sha256!==release.sha256)throw Error('An archived official release changed; previous publication retained');
    const manifest={schema:'rafa-monthly-source-manifest-v1',url:release.url,label:release.label,periods:release.periods,publicationDate:release.publicationDate||null,sha256:file.proof.sha256,bytes:file.proof.bytes,fetchedAt:file.proof.fetchedAt};
    const feedPath='public/monthly/'+file.proof.sha256+'.xml';
    await save('public/monthly/'+file.proof.sha256+'.xlsx',file.bytes);
    await save(feedPath,rss({schema:'public-moh-monthly-transport-v1',manifest,base64:Buffer.from(file.bytes).toString('base64')},file.proof.sha256,startedAt,release.url));
    downloaded.push({...release,sha256:file.proof.sha256,bytes:file.proof.bytes,fetchedAt:file.proof.fetchedAt,feedPath});
  }
  const registry=await collectRegistry(),registryPages=[];
  for(const page of registry.pages){
    const feedPath=snapshot+'/registry-'+String(page.pageNumber).padStart(3,'0')+'.xml';
    await save(feedPath,rss({schema:'public-moh-registry-page-v1',runId,version:registry.version,totalRecords:registry.totalRecords,pageNumber:page.pageNumber,records:page.records,sha256:page.sha256,rows:page.rows},runId+'-registry-'+page.pageNumber,startedAt,'https://registries.health.gov.il/Medicines'));
    registryPages.push({pageNumber:page.pageNumber,records:page.records,sha256:page.sha256,feedPath});
  }
  const {pages,...registryProof}=registry;
  const manifest={...catalog,runId,startedAt,completedAt:new Date().toISOString(),originalExcelDownloadsPassed:true,companyWorkbookAccess:false,monthlyRefreshWorking:false,directGovernmentDiscoveryError:directError,associationDiscoveredReleaseCount:alternate.length,releases:downloaded,registry:{...registryProof,pages:registryPages}};
  await save('public/catalog.json',JSON.stringify(manifest,null,2));
  await save(snapshot+'/manifest.json',JSON.stringify(manifest,null,2));
  await save('public/latest.xml',rss(manifest,'public-moh-collection-'+runId,manifest.completedAt,'https://github.com/rafischlager123-dev/moh-monthly-public-source'));
  await writeFile(path.join(out,'publication-files.json'),JSON.stringify(files,null,2));
  console.log(JSON.stringify({runId,officialExcelFiles:downloaded.length,registryRecords:registry.totalRecords,registryPages:registry.totalPages,discoveryCoverageReviewRequired:manifest.discoveryCoverageReviewRequired,companyWorkbookAccess:false,monthlyRefreshWorking:false}));
  return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runCollection();
