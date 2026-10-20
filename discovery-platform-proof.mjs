// Public source proof only. No secondary directory, private data, or source seed
// is used for discovery. Expected hashes are independent post-discovery checks.
import {webcrypto} from 'node:crypto';
import {readFile,appendFile} from 'node:fs/promises';
import {discoverMonthly} from './browser-discovery.mjs';
import {fetchMonthlyFile,digest,bytesOf} from './public-core.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='rafischlager123-dev/moh-monthly-public-source')throw Error('Dedicated public cloud test only');
const report={schema:'public-moh-direct-discovery-proof-v1',runId:process.env.GITHUB_RUN_ID,runnerOS:process.env.RUNNER_OS,runnerArch:process.env.RUNNER_ARCH,browserChannel:process.env.MOH_BROWSER_CHANNEL,startedAt:new Date().toISOString(),sourceDiscoveryPassed:false,originalDownloadsPassed:false,companyWorkbookAccess:false,monthlyRefreshWorking:false};
try{
  const {chromium}=await import('playwright');
  const catalog=await discoverMonthly(()=>chromium.launch({channel:process.env.MOH_BROWSER_CHANNEL,headless:false,timeout:30000}),{pageUrl:'https://www.gov.il/he/Departments/DynamicCollectors/new-israeli-drugs?skip=0',budgetMs:110000});
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
}catch(error){report.error=String(error.message||error).slice(0,1800);process.exitCode=2;}
report.finishedAt=new Date().toISOString();
console.log('DIRECT_DISCOVERY_RESULT '+JSON.stringify(report));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'# Direct official release discovery proof\n\n```json\n'+JSON.stringify(report,null,2).replace(/`/g,'\\u0060')+'\n```\n');
