import {webcrypto} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {discoverMonthly} from './browser-discovery.mjs';
import {fetchMonthlyFile,monthlyFileUrl,publicationPeriods,registryPage,registryVersion} from './public-core.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const expected=new Map([
  ['files_databases_drugs_new_israeli_drugs_01012026.xlsx','8fa37795317aa8fc38651c13fa7ec35d7b29618c71a12a8740bac4418f8089fd'],
  ['files_databases_drugs_new_israeli_drugs_12042026.xlsx','cd414102e677c11e658bee68af19bcb269d05a966d1f2c99e1fc6614d46b783e'],
  ['files_databases_drugs_new_israeli_drugs_04062026.xlsx','ec70c06c871faa3809cfb193375f886733c145abaa8f62152775defe5bf46355'],
  ['files_databases_drugs_new_israeli_drugs_05072026.xlsx','5901f3e41a731e2bf9ffcfc14111d56de9d6308fa4712428ff4de527de779aa1'],
  ['files_databases_drugs_new_israeli_drugs_16082026.xlsx','c69285ba94c2d15e419567d350a6a536a841b14f08270763b7e91e236a34c399'],
  ['files_databases_drugs_new_israeli_drugs_03092026.xlsx','0c2167eb5f2ccc323988629596425469e6ff5afc311163bb90b791d61221e7dd'],
  ['files_databases_drugs_new_israeli_drugs_07102026.xlsx','6b7e1a7ca4519fafe43b2ed73692bb503f1829612ef74bcd90729b4747042cd3']
]);
const headed=process.env.MOH_BROWSER_MODE==='headed';
async function discoverAssociation(chromium){
  const source='https://psi.org.il/he/pharma-rules';
  const browser=await chromium.launch({channel:'chrome',headless:!headed,timeout:25000});
  try{
    const context=await browser.newContext(),page=await context.newPage();
    const response=await page.goto(source,{waitUntil:'domcontentloaded',timeout:25000});
    if(!response?.ok())throw Error('Association discovery page HTTP '+response?.status());
    await page.waitForSelector('a[href*="/BlobFolder/dynamiccollectorresultitem/"]',{state:'attached',timeout:15000});
    const anchors=await page.locator('a[href]').evaluateAll(elements=>elements.map(a=>({url:a.href,label:(a.textContent||'').trim()})));
    const releases=[],seen=new Set();
    for(const anchor of anchors){
      const url=monthlyFileUrl(anchor.url);
      if(!url||seen.has(url)||!anchor.label.includes('תכשירים חדשים שנרשמו'))continue;
      const periods=publicationPeriods(anchor.label);
      if(periods.at(-1)<'2025-12')continue;
      seen.add(url);releases.push({url,label:anchor.label,periods,publicationDate:null,publicationDateMissing:true,discoverySource:source});
    }
    if(!releases.length||releases.length>16)throw Error('Association contains no bounded set of official monthly links');
    releases.sort((a,b)=>a.periods.at(-1).localeCompare(b.periods.at(-1)));
    return {source,discoveryType:'Third-party public link directory; downloads remain original government files',coverageComplete:false,publicationDatesComplete:false,releases};
  }finally{await browser.close();}
}
const report={startedAt:new Date().toISOString(),executedIn:process.env.GITHUB_ACTIONS==='true'?'GitHub-hosted standard Ubuntu runner':'Local test',browserMode:headed?'headed Chrome with virtual display':'headless Chrome',sourceAccessPassed:false,catalogPassed:false,downloadsPassed:false,registryAccessPassed:false,companyWorkbookAccess:false,monthlyRefreshWorking:false,monthlyScheduleEnabled:false};
let phase='browser-discovery';
try{
  const {chromium}=await import('playwright');
  try{
    report.catalog=await discoverMonthly(()=>chromium.launch({channel:'chrome',headless:!headed,timeout:25000}));
    report.catalogPassed=true;
  }catch(error){
    report.directGovernmentDiscoveryError=String(error.message||error).slice(0,1500);
    phase='association-link-discovery';
    report.catalog=await discoverAssociation(chromium);
    report.alternateDiscoveryPassed=true;
  }
  if(report.catalog.releases.length>16)throw Error('Source acquisition exceeds the bounded test size');
  phase='exact-monthly-downloads';report.files=[];
  await mkdir('test-output/files',{recursive:true});
  for(const release of report.catalog.releases){
    const file=await fetchMonthlyFile(release),name=new URL(release.url).pathname.split('/').at(-1),known=expected.get(name);
    if(known&&known!==file.proof.sha256)throw Error('Previously verified official file changed; retain for review: '+name);
    await writeFile('test-output/files/'+file.proof.sha256+'.xlsx',file.bytes);
    report.files.push({...file.proof,matchesPreviouslyVerifiedSource:known?true:null});
  }
  report.downloadsPassed=true;
  phase='registry-access';
  const before=await registryVersion(),page=await registryPage(0),after=await registryVersion();
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Registry version changed during access test');
  report.registry={version:before,totalRecords:page.total,sampledRecords:page.records,pageSha256:page.sha256,completeRegistryCollection:false};
  report.registryAccessPassed=true;report.sourceAccessPassed=report.catalogPassed;phase='complete';
  if(!report.catalogPassed){report.coverageAcceptancePassed=false;report.remainingDiscoveryIssue='Public directory found genuine official files, but does not establish a complete government release catalog or every original publication date';process.exitCode=2;}
}catch(error){report.failedPhase=phase;report.error=String(error.message||error).slice(0,1500);process.exitCode=2;}
report.finishedAt=new Date().toISOString();
report.remainingAcceptance=['Complete stable registry capture','Official monthly worksheet/schema validation','Microsoft 365 source transport/readback','Private master merge and conflict verification','Coordinated workbook/dashboard publication and rollback','Unattended recurring execution acceptance'];
await mkdir('test-output',{recursive:true});
await writeFile('test-output/report.json',JSON.stringify(report,null,2));
const publicReport=JSON.stringify(report,null,2);
console.log('PUBLIC_SOURCE_PROBE_RESULT '+JSON.stringify(report));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'# Public monthly source access test\n\n```json\n'+publicReport.replace(/`/g,'\\u0060')+'\n```\n');
