import {webcrypto} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {discoverMonthly} from './browser-discovery.mjs';
import {fetchMonthlyFile,registryPage,registryVersion} from './public-core.mjs';
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
const report={startedAt:new Date().toISOString(),executedIn:process.env.GITHUB_ACTIONS==='true'?'GitHub-hosted standard Ubuntu runner':'Local test',sourceAccessPassed:false,catalogPassed:false,downloadsPassed:false,registryAccessPassed:false,companyWorkbookAccess:false,monthlyRefreshWorking:false,monthlyScheduleEnabled:false};
let phase='browser-discovery';
try{
  const {chromium}=await import('playwright');
  report.catalog=await discoverMonthly(()=>chromium.launch({channel:'chrome',headless:true,timeout:25000}));
  report.catalogPassed=true;
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
  report.registryAccessPassed=true;report.sourceAccessPassed=true;phase='complete';
}catch(error){report.failedPhase=phase;report.error=String(error.message||error).slice(0,1500);process.exitCode=2;}
report.finishedAt=new Date().toISOString();
report.remainingAcceptance=['Complete stable registry capture','Official monthly worksheet/schema validation','Microsoft 365 source transport/readback','Private master merge and conflict verification','Coordinated workbook/dashboard publication and rollback','Unattended recurring execution acceptance'];
await mkdir('test-output',{recursive:true});
await writeFile('test-output/report.json',JSON.stringify(report,null,2));
const publicReport=JSON.stringify(report,null,2);
console.log('PUBLIC_SOURCE_PROBE_RESULT '+JSON.stringify(report));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'# Public monthly source access test\n\n```json\n'+publicReport.replace(/`/g,'\\u0060')+'\n```\n');
