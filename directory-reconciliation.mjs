// Source discovery from already published association HTML, without a browser.
// This does not claim an authoritative government publication catalog.
import {monthlyFileUrl,publicationPeriods} from './public-core.mjs';
const entities={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
const decode=text=>text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_m,key)=>key[0]==='#'?String.fromCodePoint(parseInt(key.slice(key[1]?.toLowerCase()==='x'?2:1),key[1]?.toLowerCase()==='x'?16:10)):entities[key.toLowerCase()]);
export function originalLinksFromHtml(html,baseline='2025-12'){
  if(typeof html!=='string'||Buffer.byteLength(html)>2000000)throw Error('Directory HTML exceeds the reviewed source bound');
  const found=new Map();
  for(const anchor of html.matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi)){
    const href=anchor[1].match(/(?:^|\s)href\s*=\s*(["'])(.*?)\1/i)?.[2];
    if(!href)continue;
    const url=monthlyFileUrl(decode(href));
    const label=decode(anchor[2].replace(/<[^>]*>/g,' ')).normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!url||!label.includes('תכשירים חדשים שנרשמו'))continue;
    const periods=publicationPeriods(label);if(periods.at(-1)<baseline)continue;
    const old=found.get(url);if(old&&JSON.stringify(old.periods)!==JSON.stringify(periods))throw Error('Contradictory directory release labels');
    found.set(url,{url,label,periods,publicationDate:null,publicationDateMissing:true});
  }
  if(!found.size||found.size>60)throw Error('No bounded monthly original-link set in live directory');
  return [...found.values()].sort((a,b)=>a.periods[0].localeCompare(b.periods[0]));
}
export function reconcileNewRegistrationCoverage(registryRows,sourceFiles,{baseline='2025-12',through}={}){
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(through||'')||through<baseline)throw Error('Invalid coverage window');
  const expected=new Map(),actual=new Map();
  for(const r of registryRows){
    const period=String(r.regDate||'').slice(0,7);if(period<baseline||period>through||r.newMedicine!==1)continue;
    const key=String(r.regNumber||'').replace(/\D/g,'');
    if(!/^\d{12}$/.test(key)||expected.has(key))throw Error('Ambiguous expected registry identity');
    expected.set(key,period);
  }
  for(const file of sourceFiles){
    if(!Array.isArray(file.periods)||!Array.isArray(file.registrations))throw Error('Missing original-file record audit');
    for(const key of file.registrations){
      if(!/^\d{12}$/.test(key)||actual.has(key))throw Error('Duplicate or invalid original-file registration');
      actual.set(key,file.periods);
    }
  }
  const missing=[],unexpected=[],wrongPeriod=[];
  for(const [key,period]of expected){if(!actual.has(key))missing.push(key);else if(!actual.get(key).includes(period))wrongPeriod.push(key);}
  for(const key of actual.keys())if(!expected.has(key))unexpected.push(key);
  return {schema:'public-moh-registration-coverage-v1',baselineInclusive:baseline,through,expectedNewRegistrations:expected.size,monthlyRegistrations:actual.size,missing,unexpected,wrongPeriod,recordCoveragePassed:expected.size>0&&!missing.length&&!unexpected.length&&!wrongPeriod.length,officialPublicationCatalogComplete:false};
}
