import {readFile,realpath,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const repository='rafischlager123-dev/moh-monthly-public-source';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!==repository||!process.env.GH_TOKEN)throw Error('Publish only inside the dedicated public source repository');
const headers={Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
async function api(resource,body){
  const response=await fetch('https://api.github.com/repos/'+repository+resource,{method:body?'POST':'GET',headers:{...headers,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('Public repository API '+resource+' returned HTTP '+response.status);
  return response.json();
}
const repo=await api('');if(repo.private||repo.default_branch!=='main')throw Error('Expected a public repository with main as its default branch');
const ref=await api('/git/ref/heads/main');
if(ref.object.sha!==process.env.GITHUB_SHA)throw Error('Source code changed during collection; keep previous published collection');
const commit=await api('/git/commits/'+ref.object.sha),root=await realpath('collection-output');
const files=JSON.parse(await readFile(path.join(root,'publication-files.json'),'utf8'));
if(!Array.isArray(files)||files.length<10||files.length>1500)throw Error('Public publication set exceeds reviewed bounds');
const tree=[];
for(const file of files){
  if(!/^public\/(?:monthly\/[a-f0-9]{64}\.(?:xml|xlsx)|runs\/\d+\/(?:registry-\d{3}\.xml|package-\d{3}\.xml|package-index\.xml|manifest\.json)|catalog\.json|latest\.xml|package-latest\.xml|attempt\.(?:json|xml))$/.test(file.path))throw Error('Publication contains a non-source path');
  const name=await realpath(path.join(root,file.path));if(!name.startsWith(root+path.sep))throw Error('Public source path escapes generated collection');
  const bytes=await readFile(name);
  if(bytes.length!==file.bytes||bytes.length>4*1024*1024||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Generated public source changed before publishing');
  const blob=await api('/git/blobs',{encoding:'base64',content:bytes.toString('base64')});
  tree.push({path:file.path,mode:'100644',type:'blob',sha:blob.sha});
}
const newTree=await api('/git/trees',{base_tree:commit.tree.sha,tree});
const next=await api('/git/commits',{message:'Collect public MOH monthly originals and complete registry '+process.env.GITHUB_RUN_ID,tree:newTree.sha,parents:[ref.object.sha]});
const response=await fetch('https://api.github.com/repos/'+repository+'/git/refs/heads/main',{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({sha:next.sha,force:false}),redirect:'error',signal:AbortSignal.timeout(25000)});
if(!response.ok)throw Error('Atomic public collection publication failed: HTTP '+response.status);
const actual=await api('/git/ref/heads/main');if(actual.object.sha!==next.sha)throw Error('Public collection commit readback failed');
const manifest=JSON.parse(await readFile(path.join(root,'public/catalog.json'),'utf8'));
const result={publicSourceCollectionPublished:true,publicCommit:next.sha,officialExcelFiles:manifest.releases.length,registryRecords:manifest.registry.totalRecords,registryComplete:manifest.registry.complete,monthlyRecordCoveragePassed:manifest.monthlyRecordCoverage?.recordCoveragePassed===true,monthlyRegistrationsChecked:manifest.monthlyRecordCoverage?.monthlyRegistrations,coverageThrough:manifest.monthlyRecordCoverage?.through,discoveryCoverageReviewRequired:manifest.discoveryCoverageReviewRequired,companyWorkbookAccess:false,monthlyRefreshWorking:false};
console.log(JSON.stringify(result));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'# Public source collection\n\n```json\n'+JSON.stringify(result,null,2)+'\n```\n\nOnly public government sources were collected. Private Microsoft 365 import and workbook publication remain separate acceptance steps.\n');
