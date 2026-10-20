import {MONTHLY_PAGE,monthlyFileUrl,normalizeCatalog} from './public-core.mjs';

export function allowedBrowserUrl(value) {
  // The last two hosts are script sources actually published in the official
  // listing DOM. Let the ordinary page load its own dependencies normally.
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.gov.il','gov.il','cdn.gov.il','cdn.gbqofs.com','analytics.egov.gov.il'].includes(u.hostname);}
  catch {return false;}
}

// Ordinary Playwright/Chrome. No proxy, stealth, identity spoofing or challenge handling.
export async function discoverMonthly(launch,{baseline='2025-12',budgetMs=90000,pageUrl=MONTHLY_PAGE}={}) {
  const target=new URL(pageUrl);
  if(!allowedBrowserUrl(target.href)||target.hostname!=='www.gov.il'||target.pathname.toLowerCase()!=='/he/departments/dynamiccollectors/new-israeli-drugs'||target.search!=='?skip=0'||target.hash)throw Error('Discovery must use the official monthly listing');
  let browser,context,page,expired=false,closePromise,timer;
  const blockedResources=[],failedResponses=[];
  const started=Date.now(),items=[],seen=new Set();
  const close=()=>closePromise??=(browser?Promise.resolve(browser.close()).catch(()=>{}):Promise.resolve());
  const remaining=max=>{const n=budgetMs-(Date.now()-started);if(expired||n<=0)throw Error('Browser discovery time budget exceeded');return Math.max(1,Math.min(max,n));};
  const operation=(async()=>{
    browser=await launch();
    // A launcher that settles after the deadline must close its late browser.
    if(expired){closePromise=undefined;await close();throw Error('Browser launch exceeded time budget');}
    context=await browser.newContext();
    if(typeof context.on==='function')context.on('response',r=>{if(r.status()>=400&&failedResponses.length<30){const u=new URL(r.url());failedResponses.push({url:u.origin+u.pathname,status:r.status()});}});
    await context.route('**/*',route=>{
      const request=route.request();
      if(!allowedBrowserUrl(request.url())||['image','font','media'].includes(request.resourceType())){
        if(['document','script','stylesheet','xhr','fetch'].includes(request.resourceType())&&blockedResources.length<30){const u=new URL(request.url());blockedResources.push({url:u.origin+u.pathname,type:request.resourceType()});}
        return route.abort();
      }
      return route.continue();
    });
    page=await context.newPage();
    const response=await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:remaining(25000)});
    if(!response||response.status()>=400)throw Error('Official listing blocked: HTTP '+(response?.status()??'unknown'));
    for(let n=0;n<3;n++){
      await page.waitForSelector('a[href*="/BlobFolder/dynamiccollectorresultitem/"]',{timeout:remaining(15000)});
      const state=await page.evaluate(()=>{
        const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
        const anchors=[...document.querySelectorAll('a[href*="/BlobFolder/dynamiccollectorresultitem/"]')].filter(visible);
        const found=anchors.map(a=>{
          let parent=a,label='';
          for(let k=0;parent&&k<7;k++,parent=parent.parentElement){
            const headings=[...parent.querySelectorAll('h2,h3,h4,[role="heading"]')].filter(visible);
            if(headings.length===1&&parent.querySelectorAll('a[href*="/BlobFolder/dynamiccollectorresultitem/"]').length<=2){label=headings[0].innerText.trim();break;}
          }
          if(!label)label=(a.innerText||a.getAttribute('aria-label')||'').trim();
          return {url:a.href,label,rawPublicationText:parent?.innerText?.slice(0,2000)||''};
        });
        const controls=[...document.querySelectorAll('a,button,[role="button"]')];
        const nextIndex=controls.findIndex(a=>visible(a)&&!a.disabled&&a.getAttribute('aria-disabled')!=='true'&&(a.rel==='next'||/^(next|next page|הבא|לעמוד הבא)$/i.test((a.getAttribute('aria-label')||a.innerText||'').trim())));
        return {items:found,nextIndex,nextUrl:nextIndex<0?null:controls[nextIndex].href||null,pageTitle:document.querySelector('h1')?.innerText||document.title};
      });
      const first=state.items.find(x=>monthlyFileUrl(x.url))?.url;
      if(!first||seen.has(first))throw Error('Listing has no new accepted publication links');
      seen.add(first);items.push(...state.items);
      try {return {...normalizeCatalog(items,baseline),source:target.href,pagesVisited:seen.size,pageTitle:state.pageTitle,listingSnapshot:items,observedAt:new Date().toISOString(),discoverySeconds:Math.ceil((Date.now()-started)/1000)};}
      catch(error){if(!String(error.message).includes('No verified release below the baseline'))throw error;}
      if(state.nextIndex<0)throw Error('No next-page control before baseline boundary');
      if(state.nextUrl){const u=new URL(state.nextUrl);if(u.origin!=='https://www.gov.il'||u.pathname.toLowerCase()!=='/he/departments/dynamiccollectors/new-israeli-drugs')throw Error('Pagination escaped official listing');}
      await page.locator('a,button,[role="button"]').nth(state.nextIndex).click({timeout:remaining(10000)});
      await page.waitForFunction(previous=>{
        const a=[...document.querySelectorAll('a[href*="/BlobFolder/dynamiccollectorresultitem/"]')].find(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);
        return a&&a.href!==previous;
      },first,{timeout:remaining(20000)});
    }
    throw Error('Catalog exceeds the three-page test bound');
  })();
  const deadline=new Promise((_resolve,reject)=>{timer=setTimeout(()=>{expired=true;void close();reject(Error('Browser discovery time budget exceeded'));},budgetMs);});
  try{return await Promise.race([operation,deadline]);}
  catch(error){
    // Public page diagnostics only, captured before closing the disposable cloud
    // browser. Never act on a challenge or inspect a user's authenticated state.
    if(!expired&&page&&typeof page.title==='function'){
      try{error.discoveryDiagnostics={title:await page.title(),url:page.url(),bodyText:(await page.locator('body').innerText({timeout:2000})).slice(0,5000),scriptUrls:await page.locator('script[src]').evaluateAll(es=>es.map(e=>e.src)),blockedResources,failedResponses};}catch{}
    }
    throw error;
  }
  finally{clearTimeout(timer);await close();if(expired)void operation.catch(()=>{});}
}
