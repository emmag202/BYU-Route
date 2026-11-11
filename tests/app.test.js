const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Never use a developer's real backend settings when running offline tests.
Object.assign(process.env, { AWS_LAMBDA_FUNCTION_NAME: '', RYDE_LAMBDA_FUNCTION_ARN: '', RYDE_LAMBDA_TIMEOUT_MS: '20000' });
const { app } = require('../server');
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(r => server.close(r)));
test('EJS preserves the original page shell, styling and browser program', async () => {
  const original = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
  const response = await fetch(base); assert.equal(response.status, 200);
  const rendered = await response.text();
  const ids = text => [...text.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const shell = text => text.slice(text.indexOf('<body>'), text.indexOf('<script src='));
  assert.deepEqual(ids(shell(rendered)), ids(shell(original)));
  assert.equal(fs.readFileSync('public/css/style.css','utf8').replace(/\r\n/g, '\n').split('\n').slice(1).join('\n'), original.match(/<style>([\s\S]*?)<\/style>/)[1]);
  const scripts = [...rendered.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(scripts.slice(1), ['/js/aws-config.js','/js/route-data.js','/js/route-map.js','/js/app.js']);
  for (const asset of scripts.slice(1).concat('/css/style.css')) { const r = await fetch(base+asset); assert.equal(r.status,200); }
  for (const name of ['route-map.js','route-data.js','aws-config.js']) assert.deepEqual(fs.readFileSync(`public/js/${name}`),fs.readFileSync(name));
  const alias = await fetch(base+'/index.html'); assert.equal(alias.status,200);
});
test('seven routes and browser syntax remain valid', () => {
  const context = {window:{}}; vm.runInNewContext(fs.readFileSync('public/js/route-data.js','utf8'),context);
  assert.equal(context.window.BYU_RYDE_ROUTES.length,7);
  for (const file of ['app.js','route-map.js','route-data.js','aws-config.js']) new vm.Script(fs.readFileSync(`public/js/${file}`,'utf8'));
  const appJs=fs.readFileSync('public/js/app.js','utf8'); assert.match(appJs,/const API_BASE_URL="";/);
});
test('health is honest and all personal-data methods fail closed', async () => {
  const h=await (await fetch(base+'/api/health')).json(); assert.equal(h.ok,true); assert.equal(h.profiles,'unavailable');
  for (const [method,path] of [['GET','/api/users/by-net-id/example'],['POST','/api/users'],['GET','/api/users/1/favorites'],['POST','/api/users/1/favorites'],['DELETE','/api/users/1/favorites/101'],['GET','/api/users/1/home'],['PUT','/api/users/1/home'],['DELETE','/api/users/1/home']]) {
    const r=await fetch(base+path,{method}); assert.equal(r.status,503); assert.equal(r.headers.get('cache-control'),'no-store'); assert.match((await r.json()).error,/unavailable/);
  }
});
test('private files are not served, API 404 and malformed requests are JSON errors',async()=>{
  for(const path of ['/.env','/server.js','/package.json','/home-address.sql','/global-bundle.pem']) assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/api/unknown')).status,404);
  assert.equal((await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:'a'.repeat(22000)})})).status,413);
});

test('Lambda handler still serves health without opening a local listener',async()=>{
  const { handler }=require('../server');
  const response=await handler({version:'2.0',routeKey:'$default',rawPath:'/api/health',rawQueryString:'',headers:{host:'localhost'},requestContext:{http:{method:'GET',path:'/api/health',sourceIp:'127.0.0.1',protocol:'HTTP/1.1'}},isBase64Encoded:false},{});
  assert.equal(response.statusCode,200);
  assert.equal(JSON.parse(response.body).ok,true);
});

test('account forms preserve Emma controls and never store session secrets',()=>{
  const source=fs.readFileSync('public/js/app.js','utf8');
  const content={innerHTML:''},modal={classList:{remove(){}}};
  const context={currentUser:null,$:id=>id==='profileContent'?content:modal};
  const forms=source.slice(source.indexOf('function showCreateAccountForm()'),source.indexOf('const addSheetHandle='));
  vm.runInNewContext(forms,context);
  context.openProfile(); assert.match(content.innerHTML,/id="showCreateAccount"/); assert.match(content.innerHTML,/id="showSignIn"/);
  context.showCreateAccountForm();
  for(const name of ['name','net_id','email','password','confirm_password']) assert.match(content.innerHTML,new RegExp(`name="${name}"`));
  assert.match(content.innerHTML,/autocomplete="new-password"/); assert.match(content.innerHTML,/>Username<input/);
  assert.doesNotMatch(source,/School demo only|fictional|Demo username|example\.test|isDemoEmail/);
  context.showSignInForm(); assert.match(content.innerHTML,/id="signInForm"/); assert.match(content.innerHTML,/autocomplete="current-password"/);
  assert.doesNotMatch(source,/localStorage\.setItem\("ryde_(auth_token|net_id)"/);
  assert.doesNotMatch(source,/headers\.Authorization|Bearer /);
  assert.match(source,/Passwords do not match/);
});

test('scrypt passwords use independent salts, reject wrong passwords and malformed hashes',async()=>{
  const {makePasswordHash,verifyPassword,hashSessionToken,sessionCookieOptions}=require('../server').authInternals;
  const a=await makePasswordHash('test-only-password'),b=await makePasswordHash('test-only-password');
  assert.notEqual(a,b);assert.equal(await verifyPassword('test-only-password',a),true);assert.equal(await verifyPassword('wrong',a),false);
  for(const bad of ['', 'scrypt$00$ff',a+'$extra']) assert.equal(await verifyPassword('test-only-password',bad),false);
  assert.equal(hashSessionToken('token').length,64);
  const opts=sessionCookieOptions();assert.equal(opts.httpOnly,true);assert.equal(opts.sameSite,'strict');
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';assert.equal(sessionCookieOptions().secure,true);if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;
});

test('session authorization rejects missing, expired and foreign sessions without real DB calls',async()=>{
  const {buildRequireAuth,hashSessionToken}=require('../server').authInternals;
  let queryCount=0,rows=[];const auth=buildRequireAuth({query:async(sql,args)=>{queryCount++;assert.match(sql,/expires_at > CURRENT_TIMESTAMP/);assert.deepEqual(args,[hashSessionToken('a'.repeat(43))]);return {rows};}});
  async function attempt(cookie,userId){let status=200,next=false;const res={status(code){status=code;return this;},json(){}};await auth({get:()=>cookie,params:{userId}},res,err=>{assert.ifError(err);next=true;});return {status,next};}
  assert.equal((await attempt('', '1')).status,401);assert.equal(queryCount,0);
  assert.equal((await attempt('ryde_session='+'a'.repeat(43),'1')).status,401);
  rows=[{user_id:1}];assert.equal((await attempt('ryde_session='+'a'.repeat(43),'2')).status,403);
  assert.equal((await attempt('ryde_session='+'a'.repeat(43),'1')).next,true);
});

