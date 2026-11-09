const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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
  const h=await (await fetch(base+'/api/health')).json(); assert.equal(h.ok,true); assert.equal(h.profiles,'disabled-pending-authentication');
  for (const [method,path] of [['GET','/api/users/by-net-id/example'],['POST','/api/users'],['GET','/api/users/1/favorites'],['POST','/api/users/1/favorites'],['DELETE','/api/users/1/favorites/101'],['GET','/api/users/1/home'],['PUT','/api/users/1/home'],['DELETE','/api/users/1/home']]) {
    const r=await fetch(base+path,{method}); assert.equal(r.status,503); assert.equal(r.headers.get('cache-control'),'no-store'); assert.match((await r.json()).error,/secure sign-in/);
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
