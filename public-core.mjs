// Source-only acquisition. Never accepts a company workbook or company credentials.
export const MONTHLY_PAGE = 'https://www.gov.il/he/departments/dynamiccollectors/new-israeli-drugs?skip=0';
export const REGISTRY_ORIGIN = 'https://registries.health.gov.il';
export const REGISTRY_URL = REGISTRY_ORIGIN + '/api/Medicines/GetMedicines';
export const PAGE_SIZE = 100;
export const MAX_REGISTRY_ROWS = 30000;
export const MAX_REGISTRY_PAGE_BYTES = 450000;
export const REGISTRY_TTL = 3 * 86400;
export const FILE_TTL = 180 * 86400;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const canonical = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
export const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n=>n.toString(16).padStart(2,'0')).join('');
export const bytesOf = value => encoder.encode(typeof value==='string'?value:canonical(value));
export function monthlyFileUrl(value) {
  try {
    const url = new URL(value, MONTHLY_PAGE);
    if(url.protocol!=='https:' || url.hostname!=='www.gov.il' || url.username || url.password || url.search || url.hash) return null;
    if(!/^\/BlobFolder\/dynamiccollectorresultitem\/[^/]+\/he\/[^/]+\.xlsx$/i.test(url.pathname))return null;
    return url.href;
  } catch {return null;}
}
const months = [
  ['january','ינואר'],['february','פברואר'],['march','מרץ','מרס'],['april','אפריל'],
  ['may','מאי'],['june','יוני'],['july','יולי'],['august','אוגוסט'],
  ['september','ספטמבר'],['october','אוקטובר'],['november','נובמבר'],['december','דצמבר']
];
export function publicationPeriods(label) {
  // The release title, never the URL/filename or publication-date text, determines
  // reporting months. Distinct publication dates are kept separately.
  const text=String(label).normalize('NFKC').toLowerCase();
  const years=[...new Set(text.match(/\b20\d{2}\b/g)||[])];
  if(years.length!==1)throw Error('Release title has no unique reporting year');
  const found=months.flatMap((names,index)=>names.some(name=>new RegExp('(^|[^a-zא-ת])'+name+'(?=$|[^a-zא-ת])','u').test(text))?[index+1]:[]);
  if(!found.length||found.length>3)throw Error('Release title has no unambiguous month(s)');
  const ordered=[...new Set(found)].sort((a,b)=>a-b);
  if(ordered.some((m,i)=>i>0&&m!==ordered[i-1]+1))throw Error('Nonconsecutive combined release requires review');
  return ordered.map(m=>years[0]+'-'+String(m).padStart(2,'0'));
}
export function publicationDateFromText(text) {
  const values=[...String(text).matchAll(/(?:תאריך|published|publication date)\s*:?\s*(\d{1,2})[./](\d{1,2})[./](20\d{2})/giu)];
  if(values.length!==1)return null;
  const [,day,month,year]=values[0],value=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value?value:null;
}
export function normalizeCatalog(items, baseline='2025-12') {
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(baseline))throw Error('Invalid inclusive baseline period');
  const releases=[],seen=new Set();let previous=null,boundary=false;
  for(const item of items) {
    const url=monthlyFileUrl(item.url||item.href);
    if(!url)continue;
    if(seen.has(url))continue;
    seen.add(url);
    const label=String(item.label||item.text||'').trim();
    const periods=publicationPeriods(label), latest=periods.at(-1);
    if(previous && latest>previous)throw Error('Listing is not ordered by descending reporting period');
    previous=latest;
    if(latest<baseline){boundary=true;break;}
    const publicationDate=item.publicationDate||publicationDateFromText(item.rawPublicationText||'');
    if(publicationDate!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(publicationDate))throw Error('Unrecognized publication date');
    releases.push({url,label,periods,publicationDate,publicationDateMissing:publicationDate===null,rawPublicationText:String(item.rawPublicationText||'').slice(0,2000)});
  }
  if(!boundary)throw Error('No verified release below the baseline; catalog coverage incomplete');
  if(!releases.length)throw Error('No release at or after baseline');
  return {baselineInclusive:baseline,coverageComplete:true,boundaryObserved:true,publicationDatesComplete:releases.every(x=>!x.publicationDateMissing),releases:releases.reverse()};
}
export async function readBounded(response,limit) {
  if(!response.ok)throw Error('Official source HTTP '+response.status);
  const reader=response.body?.getReader();if(!reader)throw Error('No source response body');
  const parts=[];let size=0;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error('Public source exceeds configured free-plan size bound');parts.push(part.value);}}
  finally {await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  return bytes;
}
export function validateXlsxPackage(input) {
  // Validate central directory, bounds, no encrypted/path-traversing entries and
  // required OOXML parts. Worksheet values/schema/period are consumer checks.
  const b=input instanceof Uint8Array?input:new Uint8Array(input),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(b.length<22||v.getUint32(0,true)!==0x04034b50)throw Error('Source is not an XLSX ZIP package');
  let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0||end+22+v.getUint16(end+20,true)!==b.length)throw Error('ZIP end record missing or inconsistent');
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==v.getUint16(end+10,true))throw Error('Multi-volume ZIP unsupported');
  const count=v.getUint16(end+10,true),length=v.getUint32(end+12,true),offset=v.getUint32(end+16,true);
  if(!count||count>100||offset+length!==end)throw Error('XLSX archive directory is invalid or exceeds bound');
  let p=offset,totalUncompressed=0;const parts=new Set();
  for(let i=0;i<count;i++){
    if(p+46>end||v.getUint32(p,true)!==0x02014b50)throw Error('Invalid ZIP directory entry');
    const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),compressed=v.getUint32(p+20,true),uncompressed=v.getUint32(p+24,true),nameLen=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),local=v.getUint32(p+42,true);
    if(p+46+nameLen+extra+comment>end)throw Error('ZIP entry exceeds central directory');
    const name=decoder.decode(b.subarray(p+46,p+46+nameLen));
    if(flags&1||![0,8].includes(method)||name.includes('..')||name.startsWith('/')||name.includes('\\')||parts.has(name))throw Error('Unsafe, encrypted or duplicate ZIP entry');
    if(local+30>=offset||v.getUint32(local,true)!==0x04034b50||local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true)+compressed>offset)throw Error('ZIP local entry bounds invalid');
    totalUncompressed+=uncompressed;if(totalUncompressed>16*1024*1024)throw Error('XLSX uncompressed contents exceed bound');
    parts.add(name);p+=46+nameLen+extra+comment;
  }
  if(p!==end||!['[Content_Types].xml','xl/workbook.xml','xl/_rels/workbook.xml.rels'].every(x=>parts.has(x))||![...parts].some(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x)))throw Error('Required XLSX parts are missing');
  return {zipDirectoryValidated:true,entries:count,uncompressedBytes:totalUncompressed,worksheetValuesValidated:false,reportingPeriodValidatedFromWorksheet:false};
}
export async function fetchMonthlyFile(release,fetcher=fetch) {
  if(!monthlyFileUrl(release.url))throw Error('Unapproved monthly file URL');
  const response=await fetcher(release.url,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  const bytes=await readBounded(response,2*1024*1024),packageProof=validateXlsxPackage(bytes);
  return {bytes,proof:{...release,sha256:await digest(bytes),bytes:bytes.byteLength,fetchedAt:new Date().toISOString(),packageProof}};
}
async function officialJson(url,init={},fetcher=fetch,limit=MAX_REGISTRY_PAGE_BYTES) {
  const u=new URL(url);if(u.origin!==REGISTRY_ORIGIN||!['/api/Registries/GetAllRegistries','/api/Medicines/GetMedicines'].includes(u.pathname))throw Error('Unapproved registry endpoint');
  const response=await fetcher(url,{...init,redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Registry response is not JSON');
  const bytes=await readBounded(response,limit),value=JSON.parse(decoder.decode(bytes));
  if(value.statusCode!==200||!value.returnObject)throw Error('Registry envelope reports failure');
  return value.returnObject;
}
export async function registryVersion(fetcher=fetch) {
  const catalogs=await officialJson(REGISTRY_ORIGIN+'/api/Registries/GetAllRegistries',{},fetcher);
  const matches=catalogs.filter(x=>x.enTitle==='Medicines');if(matches.length!==1)throw Error('Official Medicines catalog is ambiguous');
  const c=matches[0],version={activeRecords:c.numberOfRecordsInRegistrie,updatedAt:c.internalUpdateDate||c.updateDate};
  if(!Number.isInteger(version.activeRecords)||version.activeRecords<1||!version.updatedAt)throw Error('Missing registry version');
  return version;
}
export async function registryPage(pageNumber,expectedTotal=null,fetcher=fetch) {
  if(!Number.isInteger(pageNumber)||pageNumber<0||pageNumber>=Math.ceil(MAX_REGISTRY_ROWS/PAGE_SIZE))throw Error('Registry page outside free-plan bound');
  const data=await officialJson(REGISTRY_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sortBy:'tradeNameHeb',sortDirection:'asc',maxResult:PAGE_SIZE,pageNumber,includeActive:true,includeCanceled:true})},fetcher);
  if(!Number.isInteger(data.totalRows)||data.totalRows<1||data.totalRows>MAX_REGISTRY_ROWS||(expectedTotal!==null&&data.totalRows!==expectedTotal)||data.pageNumber!==pageNumber||data.maxResults!==PAGE_SIZE)throw Error('Registry pagination/version changed');
  const rows=data.medicinesList,expected=Math.min(PAGE_SIZE,data.totalRows-pageNumber*PAGE_SIZE);
  if(!Array.isArray(rows)||expected<1||rows.length!==expected)throw Error('Missing registry records on a page');
  const ids=new Set(),summaries=[];
  for(const row of rows){
    if(!Number.isInteger(row.medicineId)||row.medicineId<1||ids.has(row.medicineId)||![0,1].includes(row.active)||!['כן','לא'].includes(row.canceled))throw Error('Missing/duplicate identity or unsupported registry status');
    ids.add(row.medicineId);
    summaries.push({medicineId:row.medicineId,active:row.active,cancelled:row.canceled,identityMissing:!(/^\d{12}$/.test(String(row.regNumber||'').replace(/\D/g,''))&&row.tradeName&&row.ownerName&&row.manufacturerName)?1:0,categoryMissing:row.medicineType==null?1:0,statusDisagreement:(row.active===1&&row.canceled==='כן')||(row.active===0&&row.canceled==='לא')?1:0});
  }
  const bytes=bytesOf(rows);if(bytes.byteLength>MAX_REGISTRY_PAGE_BYTES)throw Error('Registry page exceeds free-plan/transport bound');
  return {rows,summaries,bytes,total:data.totalRows,pageNumber,records:rows.length,sha256:await digest(bytes),fetchedAt:new Date().toISOString()};
}
export const xmlEscape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function rss(payload,id,publishedAt,link) {
  const data=canonical(payload),date=new Date(publishedAt).toUTCString();
  if(bytesOf(data).byteLength>1000000)throw Error('Feed payload exceeds safe RSS size');
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Official public MOH source transport</title><link>'+xmlEscape(link)+'</link><description>Public source facts only</description><item><guid isPermaLink="false">'+xmlEscape(id)+'</guid><title>'+xmlEscape(id)+'</title><link>'+xmlEscape(link)+'</link><pubDate>'+date+'</pubDate><description>'+xmlEscape(data)+'</description></item></channel></rss>';
}
