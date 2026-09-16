import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { atPointer, changedRequest, projectData, replayHeaders, rememberSecrets, previewValue, authenticationFingerprint } from '../browser-to-tool/scripts/browser-data.mjs';
import { openBrowserSession } from '../browser-to-tool/scripts/browser-session.mjs';
import { startBrowser, callBrowser } from '../browser-to-tool/scripts/browser.mjs';

test('嵌套数组/包装字段/耦合页码保真，HTTP2伪头不进入重放',()=>{
  const data={code:0,success:true,data:[{data:[{itemId:{value:'synthetic-1'},amount:{value:1.25}}]}]};
  const root=projectData(data,{allowData:true,arrayPath:'/data/0/data',fields:['itemId.value'],rootFields:['code','success']},new Set()).root;
  assert.deepEqual(root,{code:0,success:true});
  assert.throws(()=>projectData(data,{allowData:true,arrayPath:'/data/0/data',fields:['itemId.value'],rootFields:['token']},new Set()));
  assert.equal(projectData(data,{allowData:true,arrayPath:'/data/0/data',fields:['itemId.value','amount.value']},new Set()).rows[0]['itemId.value'],'synthetic-1');
  for(const path of ['/data/00/data','/data/-1/data','/data/length','/data/0/__proto__'])assert.throws(()=>atPointer(data,path));
  assert.throws(()=>projectData(data,{allowData:true,arrayPath:'/data/0/data',fields:['itemId.constructor']},new Set()));
  const record={url:'https://example.com/list',method:'POST',headers:{'content-type':'application/json'},body:'{"blocks":[{"page":1,"filter":{"pageNo":1},"large":9223372036854775807,"price":0.123456789012345678901}]}'};
  const updated=changedRequest(record,{json:{'blocks.0.page':2,'blocks.0.filter.pageNo':2}});
  assert.equal(updated.body,'{"blocks":[{"page":2,"filter":{"pageNo":2},"large":9223372036854775807,"price":0.123456789012345678901}]}');
  assert.throws(()=>changedRequest(record,{json:{'blocks.0.accountId':2}}),/PATCH_FIELD_DENIED/);
  assert.throws(()=>changedRequest(record,{json:{'blocks.0.__proto__.page':2}}));
  const secrets=new Set();rememberSecrets({pairs:[{name:'cookie',value:'sid=canaryCookie; Path=/'}],authorization:{value:'nested-alpha'}},secrets);
  assert(secrets.has('canaryCookie'));assert(secrets.has('nested-alpha'));
  assert.throws(()=>atPointer({pairs:[{name:'token',value:'short-canary'}]},'/pairs/0/value'),/INVALID_FIELD/);
  assert.equal(previewValue('{"token":"short-canary"}',secrets),'[structured-value]');
  assert.notEqual(authenticationFingerprint({pairs:[{name:'token',value:'canary-a'}]}),authenticationFingerprint({pairs:[{name:'token',value:'canary-b'}]}));
  assert.notEqual(authenticationFingerprint({pairs:[{name:'cookie',value:'canary-a'}]}),authenticationFingerprint({pairs:[{name:'token',value:'canary-a'}]}));
  assert.deepEqual(replayHeaders({':authority':'example.com',':method':'POST',cookie:'synthetic-cookie',authorization:'Bearer synthetic-auth','content-type':'application/json'}),{authorization:'Bearer synthetic-auth','content-type':'application/json'});
});
async function serve(){
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','text/html; charset=utf-8');
    if(req.url==='/api'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
      const block=body.blocks[0];assert.equal(block.page,block.filter.pageNo);
      res.setHeader('content-type','application/json');res.end(JSON.stringify({code:0,success:true,data:[{data:[{itemId:{value:`synthetic-${block.page}`},amount:{value:block.page}}]}]}));return;
    }
    if(req.url==='/login'){res.end('<meta charset="utf-8"><input type="password" value="synthetic-password">');return;}
    res.end(`<meta charset="utf-8"><h1>合成商品页</h1>${Array.from({length:45},(_,i)=>`<button>辅助${i}</button>`).join('')}<div role="button" onclick="query(1)">查询列表</div><span style="cursor:pointer" onclick="query(2)">第二页</span><input aria-label="筛选" value="masked-business-filter"><div id="editable-empty" contenteditable style="width:160px;height:40px">合成备注</div><div id="editable-plain" contenteditable="plaintext-only" style="width:160px;height:40px">合成备注</div><div contenteditable style="position:relative;width:10px;height:10px"><span id="editable-inherited" style="position:absolute;top:30px;left:240px;display:block;width:160px;height:40px">合成继承编辑区</span></div><div id="readonly-region" style="width:160px;height:40px;background:#00aa00"></div><script>async function query(page){return fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({blocks:[{page,filter:{pageNo:page}}]})}).then(r=>r.json())}</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {server,origin:`http://127.0.0.1:${server.address().port}`};
}
test('换标签不销毁登录上下文；显式选页、控件后续批次、请求字段、原地截图', {timeout:60000,skip:process.platform==='win32'},async()=>{
  const temp=mkdtempSync(join(tmpdir(),'browser-regression-'));const {server,origin}=await serve();let browser;
  try{
    browser=await openBrowserSession({profileDir:join(temp,'profile'),url:origin+'/login',headless:true});
    await assert.rejects(browser.execute({action:'screenshot',allowData:true}),/SENSITIVE_PAGE/);
    const original=browser.page,replacement=await browser.context.newPage();await replacement.goto(origin+'/products');await original.close();
    assert.equal(browser.status().closed,false);assert.equal(browser.status().pageClosed,true);
    await assert.rejects(browser.execute({action:'observe'}),/PAGE_CLOSED/);
    const pages=await browser.execute({action:'pages'});assert.equal(pages.pages.length,1);
    await browser.execute({action:'select-page',pageId:pages.pages[0].id,confirmedQuery:true});assert.equal(browser.page,replacement);assert.equal(browser.status().watching,false);
    await browser.execute({action:'observe',reload:false});
    const first=await browser.execute({action:'inspect',allowData:true});assert.equal(first.nextOffset,40);
    const next=await browser.execute({action:'inspect',allowData:true,offset:first.nextOffset});
    const button=next.controls.find(control=>control.label==='查询列表');assert(button);
    await browser.execute({action:'click',element:button.id,confirmedQuery:true});
    let candidate;
    for(let i=0;i<30;i++){candidate=(await browser.execute({action:'candidates',waitMs:50})).items[0];if(candidate)break;}
    assert(candidate);
    const details=await browser.execute({action:'inspect-request',candidate:candidate.id,allowData:true,fields:['blocks.0.page','blocks.0.filter.pageNo']});assert.equal(details.fields['blocks.0.page'],1);
    const byText=await browser.execute({action:'inspect',allowData:true,text:'第二页'});assert.equal(byText.controls.length,1);
    await browser.execute({action:'click',element:byText.controls[0].id,confirmedQuery:true});
    const result=await browser.execute({action:'query',candidate:candidate.id,confirmedQuery:true,patch:{json:{'blocks.0.page':2,'blocks.0.filter.pageNo':2}},projection:{allowData:true,arrayPath:'/data/0/data',fields:['itemId.value'],rootFields:['code','success']}});
    assert.equal(result.preview.rows[0]['itemId.value'],'synthetic-2');assert.deepEqual(result.preview.root,{code:0,success:true});
    const url=browser.page.url(),epoch=browser.status().epoch;
    const image=await browser.execute({action:'screenshot',allowData:true});assert.equal(image.png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(browser.page.url(),url);assert.equal(browser.status().epoch,epoch);
    const pixels=await browser.page.evaluate(async encoded=>{
      const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      return ['editable-empty','editable-plain','editable-inherited','readonly-region'].map(id=>{const box=document.getElementById(id).getBoundingClientRect();return [...ctx.getImageData(Math.floor((box.x+box.width/2)*image.width/innerWidth),Math.floor((box.y+box.height/2)*image.height/innerHeight),1,1).data];});
    },image.png.toString('base64'));
    for(const pixel of pixels.slice(0,3))assert.deepEqual(pixel,[255,0,255,255]);assert.deepEqual(pixels[3],[0,170,0,255]);
    const outside=await browser.context.newPage();
    const out=(await browser.execute({action:'pages'})).pages.find(page=>!page.scope);assert(out);
    await assert.rejects(browser.execute({action:'select-page',pageId:out.id,confirmedQuery:true}),/PAGE_OUT_OF_SCOPE/);await outside.close();
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));rmSync(temp,{recursive:true,force:true});}
});
test('CLI截图原子写PNG且IPC不携带像素，缺批准/缺输出/同名均拒绝', {timeout:60000,skip:process.platform==='win32'},async()=>{
  const temp=mkdtempSync(join(tmpdir(),'browser-image-cli-')),workspace=join(temp,'task');const {server,origin}=await serve();
  mkdirSync(join(workspace,'代码'),{recursive:true});writeFileSync(join(workspace,'工作记录.md'),'合成验证');
  const before=process.env.BROWSER_TO_TOOL_HOME;process.env.BROWSER_TO_TOOL_HOME=join(temp,'state');let started;
  try{
    started=await startBrowser({profile:'image',workspace,url:origin+'/products',headless:true});
    const base={profile:'image',session:started.session};
    await assert.rejects(callBrowser({...base,command:{action:'screenshot',allowData:true}}),/SCREENSHOT_OUTPUT_REQUIRED/);
    await assert.rejects(callBrowser({...base,command:{action:'screenshot'},output:'拒绝.png'}),/DATA_APPROVAL_REQUIRED/);
    const result=await callBrowser({...base,command:{action:'screenshot',allowData:true},output:'当前页.png'});
    assert.equal(result.format,'png');assert(!Object.hasOwn(result,'png'));assert.equal(readFileSync(result.savedTo).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    await assert.rejects(callBrowser({...base,command:{action:'screenshot',allowData:true},output:'当前页.png'}),/OUTPUT_EXISTS/);
  }finally{
    if(started)await callBrowser({profile:'image',session:started.session,command:{action:'stop'}}).catch(()=>{});
    if(before===undefined)delete process.env.BROWSER_TO_TOOL_HOME;else process.env.BROWSER_TO_TOOL_HOME=before;
    await new Promise(resolve=>server.close(resolve));rmSync(temp,{recursive:true,force:true});
  }
});
