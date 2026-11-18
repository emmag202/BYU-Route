const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createLambdaApi, createAccountProxy } = require('../services/lambda-proxy');
const { readSession, createRateLimit } = require('../services/account-security');
const env = { AWS_REGION: 'us-east-1', RYDE_LAMBDA_FUNCTION_ARN: 'arn:aws:lambda:us-east-1:123456789012:function:byu-ryde-api:review' };
const token = 'a'.repeat(43), origin = 'https://ryde.example';
const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Ryde-Request': '1' };
const login = { net_id: 'test', password: 'test-only-password' };
const encode = result => ({ StatusCode: 200, Payload: Buffer.from(JSON.stringify(result)) });

async function withProxy(options, run) {
  const app=express();app.use(express.json({limit:'20kb'}));app.use(createAccountProxy({origin,production:true,...options}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try {await run(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(r=>server.close(r));}
}

test('IAM adapter targets only configured function, uses synchronous invocation, and omits credentials from payload',async()=>{
  let captured;
  const api=createLambdaApi({env,client:{send:async(command,options)=>{captured=command.input;assert.ok(options.abortSignal);return encode({statusCode:200,body:'[]'});}}});
  assert.equal((await api.invoke({rawPath:'/api/me'})).statusCode,200);
  assert.equal(captured.FunctionName,env.RYDE_LAMBDA_FUNCTION_ARN);assert.equal(captured.InvocationType,'RequestResponse');
  assert.equal(captured.LogType,undefined);assert.deepEqual(JSON.parse(captured.Payload.toString()),{rawPath:'/api/me'});
});

test('missing/wrong AWS target never invokes the SDK',async()=>{
  let calls=0;
  for(const config of [{},{...env,AWS_REGION:'us-west-2'},{...env,RYDE_LAMBDA_FUNCTION_ARN:'https://example.com'},{...env,RYDE_LAMBDA_FUNCTION_ARN:env.RYDE_LAMBDA_FUNCTION_ARN.replace('byu-ryde-api','other')}]){
    const api=createLambdaApi({env:config,client:{send:async()=>{calls++;}}});
    await assert.rejects(api.invoke({}),err=>err.status===503);
  }
  assert.equal(calls,0);
});

test('IAM adapter handles denied credentials, function errors, malformed responses and timeouts safely',async()=>{
  for(const response of [{StatusCode:200,FunctionError:'Unhandled',Payload:Buffer.from('private SQL error')},encode({secret:'bad'}),{StatusCode:202}]){
    const api=createLambdaApi({env,client:{send:async()=>response}});
    await assert.rejects(api.invoke({}),err=>err.status===502&&!err.message.includes('SQL'));
  }
  const denied=createLambdaApi({env,client:{send:async()=>{throw Error('AWS_SECRET_ACCESS_KEY=private');}}});
  await assert.rejects(denied.invoke({}),err=>err.status===503&&!err.message.includes('private'));
  let calls=0,signal;
  const slow=createLambdaApi({env,timeoutMs:10,client:{send:async(_c,opts)=>{calls++;signal=opts.abortSignal;return new Promise(()=>{});}}});
  await assert.rejects(slow.invoke({}),err=>err.status===504);assert.equal(calls,1);assert.equal(signal.aborted,true);
});

test('proxy rejects missing config, CSRF, missing sessions and arbitrary targets without invoking Lambda',async()=>{
  let calls=0;const api={configured:true,invoke:async()=>{calls++;}};
  await withProxy({api:{...api,configured:false}},async base=>assert.equal((await fetch(base+'/api/me')).status,503));
  await withProxy({api},async base=>{
    for(const h of [{}, {...headers,Origin:'https://evil.example'}, {...headers,'X-Ryde-Request':'0'}, {...headers,'Sec-Fetch-Site':'cross-site'}]){
      assert.equal((await fetch(base+'/api/login',{method:'POST',headers:h,body:JSON.stringify(login)})).status,403);
    }
    assert.equal((await fetch(base+'/api/me',{headers:{Authorization:'Bearer fake','X-User-ID':'1'}})).status,401);
    assert.equal((await fetch(base+'/api/users/by-net-id/test')).status,404);
    assert.equal((await fetch(base+'/api/me?user_id=1')).status,404);
    assert.equal((await fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify({...login,user_id:1})})).status,400);
  });assert.equal(calls,0);
});

test('proxy reconstructs secure session cookies and forwards no browser identity headers',async()=>{
  let event;
  await withProxy({api:{configured:true,invoke:async e=>{event=e;return {statusCode:200,body:JSON.stringify({user:{user_id:7,name:'Test'}}),cookies:[`ryde_session=${token}; HttpOnly; Path=/api`]};}}},async base=>{
    const r=await fetch(base+'/api/login',{method:'POST',headers:{...headers,'X-User-ID':'999',Authorization:'Bearer fake'},body:JSON.stringify(login)});
    assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');
    for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/api'])assert.ok(cookie.includes(flag));
    assert.deepEqual(await r.json(),{user:{user_id:7,name:'Test'}});assert.equal(event.headers.authorization,undefined);assert.equal(event.headers['X-User-ID'],undefined);assert.deepEqual(event.cookies,[]);
  });
});

test('proxy leaves student ownership enforcement to Lambda and propagates denial without data',async()=>{
  await withProxy({api:{configured:true,invoke:async event=>{
    assert.equal(event.rawPath,'/api/users/999/home');assert.deepEqual(event.cookies,[`ryde_session=${token}`]);
    return {statusCode:403,body:JSON.stringify({error:'private info'})};
  }}},async base=>{
    const r=await fetch(base+'/api/users/999/home',{headers:{Cookie:`ryde_session=${token}`,'X-User-ID':'999'}});assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/private info/);
  });
});

test('mocked home/favorites success, logout and backend failures are handled without secrets',async()=>{
  await withProxy({api:{configured:true,invoke:async e=>{
    if(e.rawPath.endsWith('/favorites'))return {statusCode:200,body:'["101"]'};
    if(e.rawPath==='/api/logout')return {statusCode:204,body:'',cookies:['ryde_session=; Max-Age=0']};
    return {statusCode:200,body:JSON.stringify({label:'Test address',lat:40,lng:-111})};
  }}},async base=>{
    assert.deepEqual(await(await fetch(base+'/api/users/1/favorites',{headers:{Cookie:`ryde_session=${token}`}})).json(),['101']);
    const home=await fetch(base+'/api/users/1/home',{method:'PUT',headers:{...headers,Cookie:`ryde_session=${token}`},body:JSON.stringify({label:'Test address',lat:40,lng:-111})});assert.equal(home.status,200);
    const out=await fetch(base+'/api/logout',{method:'POST',headers:{...headers,Cookie:`ryde_session=${token}`},body:'{}'});assert.equal(out.status,204);assert.match(out.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
  });
  for(const result of [{statusCode:200,body:'{"token":"secret"}'},{statusCode:200,body:'not json'},{statusCode:302,body:''},{statusCode:500,body:'private SQL'}]){
    await withProxy({api:{configured:true,invoke:async()=>result}},async base=>{
      const r=await fetch(base+'/api/me',{headers:{Cookie:`ryde_session=${token}`}});assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/private SQL|secret/);
    });
  }
  await withProxy({api:{configured:true,invoke:async()=>{throw Object.assign(Error('private'),{status:504});}}},async base=>{
    assert.equal((await fetch(base+'/api/me',{headers:{Cookie:`ryde_session=${token}`}})).status,504);
  });
});

test('duplicate/malformed session cookies fail closed and rate limits expire',async()=>{
  assert.equal(readSession(`ryde_session=${token}; ryde_session=${token}`),null);assert.equal(readSession('ryde_session=invalid'),null);
  let time=0;const limited=createRateLimit({limit:1,windowMs:10,now:()=>time});assert.equal(limited('peer'),true);assert.equal(limited('peer'),false);time=11;assert.equal(limited('peer'),true);
  let calls=0;
  await withProxy({rateLimit:()=>false,api:{configured:true,invoke:async()=>{calls++;}}},async base=>assert.equal((await fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify(login)})).status,429));assert.equal(calls,0);
});

test('50 classmates sharing one IP retain independent verified-user budgets (bounded mocked concurrency)',async()=>{
 const users=Array.from({length:50},(_,i)=>({id:i+1,token:Buffer.from(`classroom-${i}`.padEnd(32,'x')).toString('base64url')}));
 const identities=new Map(users.map(u=>[`ryde_session=${u.token}`,u.id]));
 const api={configured:true,invoke:async e=>{
  const id=identities.get(e.cookies[0]);
  if(!id)return {statusCode:401,body:'{}'};
  if(e.rawPath==='/api/me')return {statusCode:200,body:JSON.stringify({user_id:id})};
  return {statusCode:200,body:'[]'};
 }};
 await withProxy({api},async base=>{
  // Lambda verifies all 50 existing sessions before any per-user identity is trusted.
  const verified=await Promise.all(users.map(u=>fetch(base+'/api/me',{headers:{Cookie:`ryde_session=${u.token}`}})));
  assert.ok(verified.every(r=>r.status===200));
  for(let round=0;round<5;round++){
   const replies=await Promise.all(users.map(u=>fetch(base+`/api/users/${u.id}/favorites`,{headers:{Cookie:`ryde_session=${u.token}`}})));
   assert.ok(replies.every(r=>r.status===200));
  }
  for(let i=0;i<55;i++)assert.equal((await fetch(base+'/api/users/1/favorites',{headers:{Cookie:`ryde_session=${users[0].token}`}})).status,200);
  assert.equal((await fetch(base+'/api/users/1/favorites',{headers:{Cookie:`ryde_session=${users[0].token}`,'X-User-ID':'999','X-Forwarded-For':'203.0.113.1'}})).status,429);
  assert.equal((await fetch(base+'/api/users/2/favorites',{headers:{Cookie:`ryde_session=${users[1].token}`}})).status,200);
 });
});

test('anonymous login and registration keep per-name and shared-IP abuse limits',async()=>{
 const api={configured:true,invoke:async()=>({statusCode:401,body:'{}'})};
 await withProxy({api},async base=>{
  for(const path of ['/api/login','/api/users']){
   const body=path==='/api/login'?login:{...login,name:'Offline Test',email:'offline@example.test'};
   for(let i=0;i<8;i++)assert.equal((await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)})).status,401);
   assert.equal((await fetch(base+path,{method:'POST',headers:{...headers,'X-Forwarded-For':'203.0.113.2','X-User-ID':'7',Cookie:`ryde_session=${token}`},body:JSON.stringify(body)})).status,429);
  }
 });
 await withProxy({api},async base=>{
  // A class of 50 can register and log in from the same socket/IP without colliding.
  for(const path of ['/api/users','/api/login']){
   const responses=await Promise.all(Array.from({length:50},(_,i)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify({...login,net_id:'student'+i,...(path==='/api/users'?{name:'Offline',email:'offline@example.test'}:{})})})));
   assert.ok(responses.every(r=>r.status===401)); // mocked credential denial, never a shared-IP 429
  }
  for(let i=100;i<240;i++)assert.equal((await fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify({...login,net_id:'unique'+i})})).status,401);
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{...headers,'X-Forwarded-For':'203.0.113.10'},body:JSON.stringify({...login,net_id:'another'})})).status,429);
 });
});

test('unverified cookies cannot create per-user budgets; rejected sessions lose cached identity',async()=>{
 const keys=[];let valid=true;
 await withProxy({rateLimit:key=>{keys.push(key);return true},api:{configured:true,invoke:async e=>({statusCode:valid?200:401,body:valid?JSON.stringify({user_id:7}):'{}'})}},async base=>{
  await fetch(base+'/api/me',{headers:{Cookie:`ryde_session=${token}`,'X-User-ID':'999'}});
  assert.deepEqual(keys,[]);
  await fetch(base+'/api/me',{headers:{Cookie:`ryde_session=${token}`}});assert.deepEqual(keys,['user:7']);
  valid=false;assert.equal((await fetch(base+'/api/me',{headers:{Cookie:`ryde_session=${token}`}})).status,401);
  const count=keys.length;
  await fetch(base+'/api/me',{headers:{Cookie:`ryde_session=${token}`}});assert.equal(keys.length,count);
 });
});

test('public shell and published schedules remain available while account calls fail',async()=>{
 const app=express();app.set('view engine','ejs');app.set('views',require('node:path').join(__dirname,'../views'));
 app.get('/',(_q,r)=>r.render('index'));app.use(express.static(require('node:path').join(__dirname,'../public')));
 app.use('/api',createAccountProxy({origin,api:{configured:true,invoke:async()=>{await new Promise(r=>setTimeout(r,30));throw Object.assign(Error('offline'),{status:503})}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  const slow=fetch(base+'/api/me',{headers:{Cookie:`ryde_session=${token}`}});
  const [page,program,data]=await Promise.all(['/', '/js/app.js', '/js/route-data.js'].map(p=>fetch(base+p)));
  assert.equal(page.status,200);assert.match(await page.text(),/navRoutes/);
  assert.equal(program.status,200);assert.match(await program.text(),/function cardHTML/);
  assert.equal(data.status,200);assert.match(await data.text(),/BYU_RYDE_ROUTES/);
  assert.equal((await slow).status,503);
 }finally{await new Promise(r=>server.close(r))}
});
