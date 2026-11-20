const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createAdminRouter}=require('../services/admin-crud');
const sdk=require('@aws-sdk/client-lambda');

test('Render validates both credentials, enforces origin, and revokes copied cookies through Lambda',async()=>{
 Object.assign(process.env,{OKR_ADMIN_EMAIL:'admin@example.test, second@example.test, THIRD@example.test, fourth@example.test',OKR_ADMIN_PASSWORD:'admin-test-password',APP_ORIGIN:'http://localhost:3000',AWS_REGION:'us-east-1',RYDE_LAMBDA_FUNCTION_ARN:'arn:aws:lambda:us-east-1:123456789012:function:byu-ryde-api'});
 delete process.env.AWS_LAMBDA_FUNCTION_NAME;
 const sessions=new Set();const pool={async query(sql,args=[]){if(sql.startsWith('INSERT INTO')){sessions.add(args[0]);return {rows:[]};}if(sql.startsWith('DELETE FROM')){if(args.length)sessions.delete(args[0]);return {rows:[]};}if(sql.startsWith('SELECT 1'))return {rows:sessions.has(args[0])?[{}]:[]};if(sql.includes('FROM ryde_demo.appuser'))return {rows:[]};throw Error(sql);}};
 const lambda=express();lambda.use(express.json());lambda.use('/api/admin',createAdminRouter({pool,makePasswordHash:async()=>''}));
 const backend=lambda.listen(0,'127.0.0.1');await new Promise(r=>backend.once('listening',r));
 sdk.LambdaClient=class {async send(command){const event=JSON.parse(Buffer.from(command.input.Payload));const response=await fetch(`http://127.0.0.1:${backend.address().port}${event.rawPath}`,{method:event.requestContext.http.method,headers:{'content-type':'application/json',cookie:(event.cookies||[]).join('; ')},...(event.body?{body:event.body}:{})});return {StatusCode:200,Payload:Buffer.from(JSON.stringify({statusCode:response.status,body:await response.text()}))};}};
 const {app}=require('../server');const web=app.listen(0,'127.0.0.1');await new Promise(r=>web.once('listening',r));const url=`http://127.0.0.1:${web.address().port}`;
 const login=(email,password,origin='http://localhost:3000')=>fetch(url+'/okr/login',{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({user_email:email,user_password:password})});
 try{
  assert.equal((await login('wrong@example.test','admin-test-password')).status,401);
  for (const email of ['second@example.test','third@example.test','fourth@example.test']) assert.equal((await login(email,'admin-test-password')).status,303);
  assert.equal((await login('admin@example.test','wrong')).status,401);
  assert.equal((await login('admin@example.test','admin-test-password','https://evil.test')).status,403);
  const ok=await login('admin@example.test','admin-test-password');assert.equal(ok.status,303);const cookie=ok.headers.get('set-cookie').split(';')[0];
  assert.match(await (await fetch(url+'/okr',{headers:{cookie}})).text(),/Maintain Users/);
  assert.equal((await fetch(url+'/api/admin/users',{headers:{cookie}})).status,200);
  assert.equal((await fetch(url+'/api/admin/session',{method:'DELETE',headers:{cookie,origin:'https://evil.test','content-type':'application/json','x-ryde-request':'1'},body:'{}'})).status,403);
  const out=await fetch(url+'/api/admin/session',{method:'DELETE',headers:{cookie,origin:'http://localhost:3000','content-type':'application/json','x-ryde-request':'1'},body:'{}'});assert.equal(out.status,204);assert.match(out.headers.get('set-cookie'),/ryde_okr=;/);
  assert.equal((await fetch(url+'/api/admin/users',{headers:{cookie}})).status,401);
  assert.doesNotMatch(await (await fetch(url+'/okr',{headers:{cookie}})).text(),/Maintain Users/);
 }finally{await new Promise(r=>web.close(r));await new Promise(r=>backend.close(r));}
});

