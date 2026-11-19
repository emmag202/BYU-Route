const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createAdminRouter,validate}=require('../services/admin-crud');
const access=require('../services/okr-access');

test('admin CRUD requires signed, live session and safely handles each business table',async()=>{
 process.env.OKR_ADMIN_PASSWORD='test-admin-secret';
 const sessions=new Set(); const records={appuser:[],route:[],favoriteroute:[],user_home:[],academic_no_class_day:[]}; let sequence=0;
 const db={async query(sql,args=[]){
  if(sql.startsWith('INSERT INTO ryde_demo.admin_session')){sessions.add(args[0]);return {rows:[]};}
  if(sql.startsWith('SELECT 1 FROM ryde_demo.admin_session'))return {rows:sessions.has(args[0])?[{}]:[]};
  if(sql.startsWith('DELETE FROM ryde_demo.admin_session')){if(args.length)sessions.delete(args[0]);return {rows:[]};}
  const table=sql.match(/ryde_demo\.(\w+)/)?.[1];assert.ok(records[table],sql);assert.doesNotMatch(sql,/test@example\.test|Example Route/);
  if(sql.startsWith('SELECT route_name'))return {rows:records.route.filter(r=>String(r.route_id)===String(args[0]))};
  if(sql.startsWith('SELECT'))return {rows:records[table].map(({password_hash,...r})=>r)};
  if(sql.startsWith('INSERT')){const cols=sql.match(/\(([^)]+)\) VALUES/)[1].split(',');const row=Object.fromEntries(cols.map((c,i)=>[c,args[i]]));if(table==='appuser'){if(records.appuser.some(r=>r.email===row.email))throw Object.assign(Error(),{code:'23505'});row.user_id=++sequence;}if(table==='route')row.route_id=++sequence; records[table].push(row);const {password_hash,...safe}=row;return {rows:[safe]};}
  const keys={appuser:['user_id'],route:['route_id'],favoriteroute:['user_id','route_id'],user_home:['user_id'],academic_no_class_day:['start_date','end_date']}[table];
  if(sql.startsWith('DELETE')){const index=records[table].findIndex(r=>keys.every((k,i)=>String(r[k])===String(args[i])));return {rows:index<0?[]:records[table].splice(index,1)};}
  if(sql.startsWith('UPDATE')){const cols=sql.match(/ SET (.+) WHERE /)[1].split(',').map(s=>s.split(' = ')[0]);const keyvals=args.slice(cols.length);const row=records[table].find(r=>keys.every((k,i)=>String(r[k])===String(keyvals[i])));if(!row)return {rows:[]};cols.forEach((c,i)=>row[c]=args[i]);const {password_hash,...safe}=row;return {rows:[safe]};}
  throw Error(sql);
 }};
 const app=express();app.use(express.json());app.use('/api/admin',createAdminRouter({pool:db,makePasswordHash:async p=>'hashed:'+p}));app.use((e,req,res,next)=>res.status(500).json({error:'database error'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/admin/`;
 const token=access.createToken(),cookie=`${access.COOKIE}=${token}`;
 const call=(path,method='GET',body,ck=cookie)=>fetch(base+path,{method,headers:{cookie:ck,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try {
  assert.equal((await call('users','GET',undefined,'ryde_session=student')).status,401);
  assert.equal((await call('users')).status,401);
  assert.equal((await call('session','POST',{proof:'wrong'})).status,403);
  assert.equal((await call('session','POST',{proof:access.proof(token)})).status,204);
  assert.equal((await call('users','GET',undefined,cookie+'tampered')).status,401);
  const oldNow=Date.now; Date.now=()=>oldNow()+13*3600000; try { assert.equal(access.authorized(cookie),false); } finally { Date.now=oldNow; }
  const samples={users:{name:'Test User',net_id:'test',email:'test@example.test',password:'password123'},routes:{route_name:'Example Route'},favorites:{user_id:1,route_id:2},homes:{user_id:1,label:'Test home',lat:40,lng:-111},calendar:{start_date:'2027-02-01',end_date:'2027-02-02',label:'Test',source_url:'https://example.test/'}};
  for(const [type,values] of Object.entries(samples)){
   let r=await call(type,'POST',{values});assert.equal(r.status,201,type);const row=await r.json();assert.equal(JSON.stringify(row).includes('hashed:'),false);
   r=await call(type);assert.equal(r.status,200);assert.equal((await r.json()).length,1);
   const keys={users:[row.user_id],routes:[row.route_id],favorites:[row.user_id,row.route_id],homes:[row.user_id],calendar:[row.start_date,row.end_date]}[type];
   r=await call(type,'PUT',{keys,values});assert.equal(r.status,200,type);
   if(type==='users'){assert.equal((await call(type,'POST',{values})).status,409);assert.equal((await call(type,'POST',{values:{...values,email:'bad'}})).status,400);}
   r=await call(type,'DELETE',{keys});assert.equal(r.status,200,type);assert.equal((await call(type,'DELETE',{keys})).status,404);
  }
  records.route.push({route_id:999,route_name:'West Route'});
  assert.equal((await call('routes','DELETE',{keys:[999]})).status,409);
  assert.equal((await call('session','DELETE',{})).status,204);
  assert.equal((await call('users')).status,401,'copied cookie is revoked');
  assert.equal((await call('session','POST',{proof:'wrong'})).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
test('admin validation rejects invalid relationships, dates, URLs and coordinates',()=>{
 assert.equal(validate('favorites',{user_id:'1 OR 1=1',route_id:1},true),false);
 assert.equal(validate('homes',{user_id:1,label:'x',lat:91,lng:0},true),false);
 assert.equal(validate('calendar',{start_date:'2027-02-30',end_date:'2027-03-01',label:'x',source_url:'https://example.test'},true),false);
 assert.equal(validate('calendar',{start_date:'2027-01-01',end_date:'2027-01-02',label:'x',source_url:'javascript:alert(1)'},true),false);
 assert.equal(validate('routes',{route_name:'West Route'},true),false);
});
