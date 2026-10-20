// Public government sources only. One bounded logical package replaces the
// per-registry-page RSS import. No private workbook input is accepted.
import {digest,bytesOf,canonical,xmlEscape} from './public-core.mjs';
const PART_BYTES=1572864,MAX_PACKAGE_BYTES=12582912,MAX_FEED_BYTES=4194304;
const repository='https://github.com/rafischlager123-dev/moh-monthly-public-source';
export function compactRegistryRow(r){
  return {id:r.medicineId,r:r.regNumber,n:r.tradeName,a:r.active,c:r.canceled,d:r.cancelDate??null,v:r.veterinaryUse??null,b:r.basket??null,i:r.dateOfInclusion??null,rd:r.regDate??null,nm:r.newMedicine??null,o:r.ownerName??null,m:r.manufacturerName??null};
}
export function packageFeed(value,id,publishedAt){
  const data=xmlEscape(canonical(value));
  const text='<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Public MOH source package</title><link>'+repository+'</link><description>Public government data only; private workbook processing is separate</description><item><title>'+xmlEscape(id)+'</title><guid isPermaLink="false">'+xmlEscape(id)+'</guid><link>'+repository+'</link><pubDate>'+new Date(publishedAt).toUTCString()+'</pubDate><description>'+data+'</description></item></channel></rss>';
  if(bytesOf(text).length>MAX_FEED_BYTES)throw Error('Serialized public package feed exceeds the connector bound');
  return text;
}
export async function buildCompactPackage({manifest,originals,registryRows}){
  if(manifest.companyWorkbookAccess!==false||!/^\d+$/.test(manifest.runId||'')||!manifest.registry?.complete||!manifest.monthlyRecordCoverage?.recordCoveragePassed)throw Error('Public package requires a complete registry and independently reconciled original files');
  if(!Array.isArray(originals)||originals.length!==manifest.releases.length||originals.length<1||originals.length>240||!Array.isArray(registryRows)||registryRows.length!==manifest.registry.totalRecords)throw Error('Incomplete package source inventory');
  let lastId=0,active=0;
  const rows=registryRows.map(r=>{if(!Number.isInteger(r.medicineId)||r.medicineId<=lastId)throw Error('Registry identities are duplicate or unordered');lastId=r.medicineId;if(r.active===1)active++;return compactRegistryRow(r);});
  if(active!==manifest.registry.activeRecords)throw Error('Registry active total changed before packaging');
  const releases=[];
  for(let n=0;n<originals.length;n++){
    const source=manifest.releases[n],bytes=originals[n];
    if(await digest(bytes)!==source.sha256||bytes.length!==source.bytes)throw Error('Original bytes changed before packaging');
    releases.push({manifest:{schema:'rafa-monthly-source-manifest-v1',url:source.url,label:source.label,periods:source.periods,publicationDate:source.publicationDate??null,sha256:source.sha256,bytes:source.bytes,fetchedAt:source.fetchedAt},base64:Buffer.from(bytes).toString('base64')});
  }
  const data={schema:'public-moh-compact-package-v1',runId:manifest.runId,startedAt:manifest.startedAt,completedAt:manifest.completedAt,baselineInclusive:manifest.baselineInclusive,sourceAcceptanceBasis:'official-excel-plus-registry-gap-check-v1',originalExcelDownloadsPassed:true,companyWorkbookAccess:false,officialPublicationCatalogComplete:manifest.officialCatalogCompleteAtCurrentCollection===true,monthlyRecordCoverage:manifest.monthlyRecordCoverage,releases,registry:{version:manifest.registry.version,complete:true,totalRecords:rows.length,activeRecords:active,sortBy:'medicineId',sortDirection:'asc',rowsSha256:await digest(bytesOf(rows)),sourcePageProofs:manifest.registry.pages.map(p=>({pageNumber:p.pageNumber,records:p.records,sourceRowsSha256:p.sha256})),rows}};
  const bytes=bytesOf(data);if(bytes.length>MAX_PACKAGE_BYTES)throw Error('Public logical package exceeds the reviewed size bound');
  const sha256=await digest(bytes),parts=[],files=[];
  for(let offset=0;offset<bytes.length;offset+=PART_BYTES){
    const part=bytes.slice(offset,offset+PART_BYTES),number=parts.length;
    const partProof={number,bytes:part.length,sha256:await digest(part),feedPath:'public/runs/'+manifest.runId+'/package-'+String(number).padStart(3,'0')+'.xml'};
    parts.push(partProof);
    const envelope={schema:'public-moh-package-part-v1',runId:manifest.runId,packageSha256:sha256,number,bytes:part.length,sha256:partProof.sha256,base64:Buffer.from(part).toString('base64')};
    files.push({path:partProof.feedPath,text:packageFeed(envelope,manifest.runId+'-package-part-'+number,manifest.completedAt)});
  }
  const index={schema:'public-moh-package-index-v1',runId:manifest.runId,completedAt:manifest.completedAt,baselineInclusive:manifest.baselineInclusive,sourceAcceptanceBasis:data.sourceAcceptanceBasis,companyWorkbookAccess:false,originalExcelDownloadsPassed:true,registryComplete:true,registryRecords:rows.length,registryVersion:manifest.registry.version,monthlyRecordCoverage:manifest.monthlyRecordCoverage,originalFiles:releases.length,officialPublicationCatalogComplete:data.officialPublicationCatalogComplete,readyForPrivateStaging:true,privatePublicationPerformed:false,package:{encoding:'base64-json-utf8',sha256,bytes:bytes.length,parts}};
  const indexFeed=packageFeed(index,manifest.runId+'-package-index',manifest.completedAt);
  files.push({path:'public/runs/'+manifest.runId+'/package-index.xml',text:indexFeed},{path:'public/package-latest.xml',text:indexFeed});
  return {index,data,files};
}
