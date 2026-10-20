// Public source health only. This module never reads company files or credentials.
import {rss} from './public-core.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const repository='rafischlager123-dev/moh-monthly-public-source';
export function sourceAttempt({state,runId,codeCommit,completedAt,packageSha256=null}){
 if(!['Ready','Held'].includes(state)||!/^\d+$/.test(runId||'')||!/^[a-f0-9]{40}$/.test(codeCommit||'')||!Number.isFinite(Date.parse(completedAt))||(state==='Ready'&&!/^[a-f0-9]{64}$/.test(packageSha256||''))||(state==='Held'&&packageSha256!==null))throw Error('Invalid public collection attempt');
 return {schema:'public-moh-source-attempt-v1',state,runId,codeCommit,completedAt,packageSha256,reason:state==='Ready'?'Exact originals and complete registry passed validation':'Source collection or publication failed; retain the last good package and retry',companyWorkbookAccess:false,productionPublicationPerformed:false};
}
export function sourceAttemptFeed(attempt){return rss(attempt,'public-source-attempt-'+attempt.runId,attempt.completedAt,'https://github.com/'+repository+'/actions/runs/'+attempt.runId);}
export function olderThanPublished(attempt,prior){return !!prior&&/^\d+$/.test(prior.runId||'')&&BigInt(attempt.runId)<BigInt(prior.runId);}
async function publishHeldAttempt(){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!==repository||!process.env.GH_TOKEN)throw Error('Publish health only inside the dedicated public source job');
 const attempt=sourceAttempt({state:'Held',runId:process.env.GITHUB_RUN_ID,codeCommit:process.env.GITHUB_SHA,completedAt:new Date().toISOString()});
 const headers={Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','content-type':'application/json'};
 async function api(route,body,method=body?'POST':'GET',allowMissing=false){const r=await fetch('https://api.github.com/repos/'+repository+route,{method,headers,...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});if(allowMissing&&r.status===404)return null;if(!r.ok)throw Error('Public health publication HTTP '+r.status);return r.json();}
 const repo=await api('');if(repo.private||repo.default_branch!=='main')throw Error('Public source repository required');
 const ref=await api('/git/ref/heads/main'),commit=await api('/git/commits/'+ref.object.sha),old=await api('/contents/public/attempt.json?ref='+ref.object.sha,null,'GET',true);
 const prior=old?JSON.parse(Buffer.from(old.content.replace(/\s/g,''),'base64').toString('utf8')):null;
 if(olderThanPublished(attempt,prior)){console.log(JSON.stringify({olderAttemptPreservedNewerStatus:true,runId:attempt.runId}));return;}
 const tree=[];for(const [name,content]of [['attempt.json',JSON.stringify(attempt,null,2)],['attempt.xml',sourceAttemptFeed(attempt)]]){const blob=await api('/git/blobs',{encoding:'base64',content:Buffer.from(content).toString('base64')});tree.push({path:'public/'+name,mode:'100644',type:'blob',sha:blob.sha});}
 const nextTree=await api('/git/trees',{base_tree:commit.tree.sha,tree}),next=await api('/git/commits',{message:'Record held public collection attempt '+attempt.runId,tree:nextTree.sha,parents:[ref.object.sha]});
 await api('/git/refs/heads/main',{sha:next.sha,force:false},'PATCH');const actual=await api('/git/ref/heads/main');if(actual.object.sha!==next.sha)throw Error('Public source hold readback changed');
 console.log(JSON.stringify({publicSourceAttempt:'Held',runId:attempt.runId,previousPackageRetained:true,publicCommit:next.sha,companyWorkbookAccess:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv[2]!=='held')throw Error('Only failure health may be published independently');await publishHeldAttempt();}
