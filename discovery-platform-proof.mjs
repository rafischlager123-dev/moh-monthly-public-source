// Public source proof only. No secondary directory, private data, or source seed
// is used for discovery. Expected hashes are independent post-discovery checks.
import {webcrypto} from 'node:crypto';
import {readFile,appendFile} from 'node:fs/promises';
import {discoverMonthly} from './browser-discovery.mjs';
import {fetchMonthlyFile,digest,bytesOf} from './public-core.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='rafischlager123-dev/moh-monthly-public-source')throw Error('Dedicated public cloud test only');
const engineName=process.env.MOH_BROWSER_ENGINE||'chromium';
if(!['chromium','firefox','webkit'].includes(engineName))throw Error('Unknown official browser engine');
const report={schema:'public-moh-direct-discovery-proof-v1',runId:process.env.GITHUB_RUN_ID,runnerOS:process.env.RUNNER_OS,runnerArch:process.env.RUNNER_ARCH,browserEngine:engineName,browserChannel:process.env.MOH_BROWSER_CHANNEL,startedAt:new Date().toISOString(),sourceDiscoveryPassed:false,originalDownloadsPassed:false,companyWorkbookAccess:false,monthlyRefreshWorking:false};
// This revision tests the official API from an actual, newly opened government
// page. Browser-generated Origin/Referer are used; no header impersonation,
// imported profile/cookies, verification-control interaction, or private data.
const publicApiProofOnly=process.env.MOH_PROOF_MODE==='api';
const launchOptions={headless:false,timeout:30000,...(engineName==='chromium'&&process.env.MOH_BROWSER_CHANNEL?{channel:process.env.MOH_BROWSER_CHANNEL}:{})};
async function publicApiProof(browserType){
  const browser=await browserType.launch(launchOptions);
  try{
    const context=await browser.newContext(),page=await context.newPage();
    const response=await page.goto('https://www.gov.il/',{waitUntil:'domcontentloaded',timeout:30000});
    const title=await page.title();
    if(!response?.ok()||/just a moment|attention required|security verification/i.test(title))return {homepageStatus:response?.status(),homepageTitle:title,passed:false,reason:'Ordinary government homepage unavailable; no verification interaction attempted'};
    const api=await page.evaluate(async()=>{
      const r=await fetch('/he/api/DynamicCollector',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({DynamicTemplateID:'3b2873b6-ed0b-4156-9986-d30261c9a8db',QueryFilters:{skip:{Query:0}},From:0})});
      return {status:r.status,contentType:r.headers.get('content-type'),body:(await r.text()).slice(0,45000)};
    });
    const gateway=await page.evaluate(async()=>{
      try{
        const r=await fetch('/CollectorsWebApi/client-config.js'),text=await r.text(),m=text.match(/=\s*(\{[\s\S]+?\})\s*;/);
        if(!r.ok||!m)return {configStatus:r.status};
        const c=JSON.parse(m[1]);if(!String(c.dataCollectorWebApi).startsWith('https://openapi-gc.digital.gov.il/'))return {error:'Unexpected public collector API base'};
        const results=[];
        for(const name of ['publications','new-israeli-drugs']){
          const url=new URL('api/DataCollector/GetLayoutCollectorModel',c.dataCollectorWebApi);url.searchParams.set('collectorId',name);url.searchParams.set('culture','he');
          const result=await fetch(url,{headers:{'x-client-id':c.clientId}});
          results.push({collector:name,status:result.status,body:(await result.text()).slice(0,22000)});
        }
        return {results};
      }catch(error){return {error:String(error.message||error)}}
    });
    return {homepageStatus:response.status(),homepageTitle:title,api,gateway,passed:api.status===200&&String(api.contentType).includes('json'),completeCatalogVerified:false};
  }finally{await browser.close();}
}
try{
  const engines=await import('playwright'),browserType=engines[engineName];
  if(publicApiProofOnly){
    report.publicApiProof=await publicApiProof(browserType);
    report.publicApiAccessPassed=report.publicApiProof.passed;
    report.discoveryAndDownloadAcceptanceStillRequired=true;
    if(!report.publicApiAccessPassed)process.exitCode=2;
  }else{
  const catalog=await discoverMonthly(()=>browserType.launch(launchOptions),{pageUrl:'https://www.gov.il/he/Departments/DynamicCollectors/new-israeli-drugs?skip=0',budgetMs:150000,standardPageLoading:true});
  report.catalog=catalog;report.catalogSnapshotSha256=await digest(bytesOf(catalog.listingSnapshot));report.sourceDiscoveryPassed=true;
  const known=JSON.parse(await readFile(new URL('./verified-catalog-seed.json',import.meta.url),'utf8'));
  const expected=new Map(known.releases.map(r=>[r.url,r.sha256]));report.files=[];
  for(const release of catalog.releases){
    const file=await fetchMonthlyFile(release),prior=expected.get(release.url);
    if(prior&&prior!==file.proof.sha256)throw Error('Known official source changed; requires reconciliation');
    report.files.push(file.proof);
  }
  report.originalDownloadsPassed=true;
  const heldOut=known.releases.at(-1);
  report.heldOutLatestRelease={previousStateExcludesPeriod:heldOut.periods,discoveredWithoutSeed:catalog.releases.some(r=>r.url===heldOut.url),downloadedOriginalSha256:report.files.find(f=>f.url===heldOut.url)?.sha256||null};
  if(!report.heldOutLatestRelease.discoveredWithoutSeed)throw Error('Live catalog missed the independently known latest release');
  }
}catch(error){report.error=String(error.message||error).slice(0,1800);report.discoveryDiagnostics=error.discoveryDiagnostics||null;process.exitCode=2;}
report.finishedAt=new Date().toISOString();
console.log('DIRECT_DISCOVERY_RESULT '+JSON.stringify(report));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'# Direct official release discovery proof\n\n```json\n'+JSON.stringify(report,null,2).replace(/`/g,'\\u0060')+'\n```\n');
