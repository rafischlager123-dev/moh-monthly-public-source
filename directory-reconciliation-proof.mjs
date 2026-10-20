// Manual public cloud proof. No browser service, signup, Microsoft credentials,
// company workbook, repository writes, cache/artifact storage, or scheduler.
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fetchMonthlyFile} from './public-core.mjs';
import {collectRegistry} from './collector.mjs';
import {originalLinksFromHtml,reconcileNewRegistrationCoverage} from './directory-reconciliation.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='rafischlager123-dev/moh-monthly-public-source')throw Error('Dedicated public cloud proof only');
const report={schema:'public-moh-directory-coverage-proof-v1',runId:process.env.GITHUB_RUN_ID,startedAt:new Date().toISOString(),companyWorkbookAccess:false,monthlyRefreshWorking:false,officialPublicationCatalogComplete:false};
try{
  const source='https://psi.org.il/he/pharma-rules';
  const response=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Live directory HTTP '+response.status);
  const releases=originalLinksFromHtml(await response.text());
  report.directory={url:source,transport:'ordinary HTTPS, no browser',status:response.status,discoveredReleases:releases};
  // The expected ledger is loaded only AFTER live discovery. The newest release
  // is deliberately withheld from previous state; it cannot supply its URL.
  const known=JSON.parse(await readFile('verified-catalog-seed.json','utf8'));
  const heldOut=known.releases.at(-1),prior=known.releases.slice(0,-1),urls=new Map(prior.map(r=>[r.url,r]));
  if(!releases.some(r=>r.url===heldOut.url))throw Error('Live directory did not discover the withheld latest release');
  for(const r of releases)urls.set(r.url,r);
  const all=[...urls.values()].sort((a,b)=>a.periods[0].localeCompare(b.periods[0]));
  await mkdir('source-http-proof',{recursive:true});report.files=[];
  for(const release of all){
    const downloaded=await fetchMonthlyFile(release),expected=known.releases.find(r=>r.url===release.url);
    if(expected&&downloaded.proof.sha256!==expected.sha256)throw Error('Original differs from the independently verified historical source');
    await writeFile('source-http-proof/'+downloaded.proof.sha256+'.xlsx',downloaded.bytes);report.files.push(downloaded.proof);
  }
  await writeFile('source-http-proof/files.json',JSON.stringify(report.files));
  const fileRows=JSON.parse(execFileSync('python',['public-xlsx-registration-audit.py'],{encoding:'utf8',timeout:60000,maxBuffer:2000000}));
  const registry=await collectRegistry(),rows=registry.pages.flatMap(p=>p.rows),through=all.at(-1).periods.at(-1);
  report.registry={complete:registry.complete,totalRecords:registry.totalRecords,version:registry.version};
  report.coverage=reconcileNewRegistrationCoverage(rows,fileRows,{through});
  if(!report.coverage.recordCoveragePassed)throw Error('Current monthly originals do not cover the independently expected registry records');
  const omitLatest=reconcileNewRegistrationCoverage(rows,fileRows.filter(f=>f.sha256!==heldOut.sha256),{through});
  if(omitLatest.recordCoveragePassed||!omitLatest.missing.length)throw Error('Missing release simulation was not blocked');
  report.missingLatestSimulation={blocked:true,missingRegistrations:omitLatest.missing.length};
  report.heldOutLatestRelease={discoveredWithoutPreviousUrl:true,periods:heldOut.periods,sha256:report.files.find(f=>f.url===heldOut.url).sha256};
  report.liveDirectoryDiscoveryAndOriginalDownloadPassed=true;
  report.recordCoverageAcceptancePassed=true;
  report.limitations=['The association directory is not the official publication catalog','A newly published workbook not linked by the directory can still require further discovery','Registry record-set coverage does not prove discovery of all release revisions','No private workbook merge or publication performed'];
}catch(error){report.error=String(error.message||error).slice(0,2000);process.exitCode=2;}
report.finishedAt=new Date().toISOString();console.log(JSON.stringify(report));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'# Public HTTPS discovery and registration coverage proof\n\n```json\n'+JSON.stringify(report,null,2).replace(/`/g,'\\u0060')+'\n```\n');
