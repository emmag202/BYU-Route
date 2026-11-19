// The identifiers below are fixed server-side; browser data is always parameterized.
const express = require('express');
const access = require('./okr-access');
const protectedRoutes = ['West Route','Wyview Route','Branbury Route','King Henry Route','South/Joaquin Route','Heritage Overflow Parking','Wymount Route'];
const tables = {
 users: { table:'appuser', keys:['user_id'], fields:['name','net_id','email'], select:'user_id,name,net_id,email' },
 routes: { table:'route', keys:['route_id'], fields:['route_name'], select:'route_id,route_name' },
 favorites: { table:'favoriteroute', keys:['user_id','route_id'], fields:['user_id','route_id'], select:'user_id,route_id' },
 homes: { table:'user_home', keys:['user_id'], fields:['user_id','label','lat','lng'], select:'user_id,label,lat::float AS lat,lng::float AS lng,updated_at' },
 calendar: { table:'academic_no_class_day', keys:['start_date','end_date'], fields:['start_date','end_date','label','source_url'], select:"to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date,label,source_url" }
};
const id = x => /^\d{1,10}$/.test(String(x)) && Number(x)>0 && Number(x)<=2147483647;
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
function validate(type, body, create) {
 if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
 const spec=tables[type]; const allowed=[...spec.fields,...(type==='users'?['password']:[])];
 if (Object.keys(body).some(k=>!allowed.includes(k))) return false;
 if (spec.fields.some(k=>body[k]===undefined)) return false;
 const text=(v,n)=>typeof v==='string' && v.trim().length>0 && v.length<=n;
 if(type==='users') return text(body.name,100)&&text(body.net_id,50)&&text(body.email,100)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) && (!create && !body.password || typeof body.password==='string' && body.password.length>=8 && body.password.length<=128);
 if(type==='routes') return text(body.route_name,100) && !protectedRoutes.includes(body.route_name.trim());
 if(type==='favorites') return id(body.user_id)&&id(body.route_id);
 if(type==='homes') return id(body.user_id)&&text(body.label,200)&&typeof body.lat==='number'&&Number.isFinite(body.lat)&&Math.abs(body.lat)<=90&&typeof body.lng==='number'&&Number.isFinite(body.lng)&&Math.abs(body.lng)<=180;
 if(type==='calendar') { let url; try { url=new URL(body.source_url); } catch { return false; } return date(body.start_date)&&date(body.end_date)&&body.end_date>=body.start_date&&text(body.label,160)&&body.source_url.length<=2048&&url.protocol==='https:'&&!url.username&&!url.password; }
 return false;
}
function keyValid(type, keys) { return Array.isArray(keys)&&keys.length===tables[type].keys.length&&keys.every((v,i)=>tables[type].keys[i].includes('date')?date(v):id(v)); }
function createAdminRouter({pool, makePasswordHash}) {
 const router=express.Router();
 router.use((req,res,next)=>{ res.set('Cache-Control','no-store'); if(!access.authorized(req.get('cookie'))) return res.status(401).json({error:'Administrator sign-in required.'}); next(); });
 // Only Render can create a session: the purpose-specific proof is never sent to the browser.
 router.post('/session', async (req,res,next)=>{ try { const token=access.readToken(req.get('cookie')); if (!access.equal(req.body?.proof || '',access.proof(token))) return res.sendStatus(403); await pool.query('DELETE FROM ryde_demo.admin_session WHERE expires_at <= CURRENT_TIMESTAMP'); await pool.query('INSERT INTO ryde_demo.admin_session (token_hash,expires_at) VALUES ($1,to_timestamp($2 / 1000.0))',[access.hash(token),Number(token.split('.')[0])]); res.sendStatus(204); } catch(e){next(e);} });
 router.use(async(req,res,next)=>{ try { const token=access.readToken(req.get('cookie')); const result=await pool.query('SELECT 1 FROM ryde_demo.admin_session WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP',[access.hash(token)]); if(!result.rows.length) return res.status(401).json({error:'Administrator session expired or revoked.'}); next(); } catch(e){next(e);} });
 router.get('/session',(_req,res)=>res.sendStatus(204));
 router.delete('/session',async(req,res,next)=>{try { await pool.query('DELETE FROM ryde_demo.admin_session WHERE token_hash = $1',[access.hash(access.readToken(req.get('cookie')))]); res.sendStatus(204); } catch(e){next(e);} });
 router.all('/:type',async(req,res,next)=>{ try {
   const type=req.params.type, spec=tables[type]; if(!spec) return res.sendStatus(404);
   if(req.method==='GET') { const result=await pool.query(`SELECT ${spec.select} FROM ryde_demo.${spec.table} ORDER BY ${spec.keys.join(',')}`); return res.json(result.rows); }
   if(!['POST','PUT','DELETE'].includes(req.method)) return res.sendStatus(405);
   const keys=req.body?.keys, values=req.body?.values;
   if(req.method!=='POST'&&!keyValid(type,keys)) return res.status(400).json({error:'Invalid record identifier.'});
   if(req.method!=='DELETE'&&!validate(type,values,req.method==='POST')) return res.status(400).json({error:'Invalid record fields.'});
   // Published routes are referenced by name by the public application; never rename or delete them.
   const where=spec.keys.map((k,i)=>`${k} = $${i+1}`).join(' AND ');
   if(type==='routes'&&req.method!=='POST') { const existing=await pool.query(`SELECT route_name FROM ryde_demo.route WHERE ${where}`,keys); if(existing.rows[0]&&protectedRoutes.includes(existing.rows[0].route_name)) return res.status(409).json({error:'Published routes cannot be changed.'}); }
   let result;
   if(req.method==='DELETE') result=await pool.query(`DELETE FROM ryde_demo.${spec.table} WHERE ${where} RETURNING ${spec.keys.join(',')}`,keys);
   else {
     const columns=[...spec.fields]; const vals=columns.map(k=>typeof values[k]==='string'?values[k].trim():values[k]);
     if(type==='users'&&values.password) { columns.push('password_hash'); vals.push(await makePasswordHash(values.password)); }
     if(req.method==='POST') result=await pool.query(`INSERT INTO ryde_demo.${spec.table} (${columns.join(',')}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(',')}) RETURNING ${spec.select}`,vals);
     else result=await pool.query(`UPDATE ryde_demo.${spec.table} SET ${columns.map((c,i)=>`${c} = $${i+1}`).join(',')} WHERE ${spec.keys.map((k,i)=>`${k} = $${columns.length+i+1}`).join(' AND ')} RETURNING ${spec.select}`,[...vals,...keys]);
   }
   if(!result.rows.length) return res.status(404).json({error:'Record not found.'});
   return res.status(req.method==='POST'?201:200).json(result.rows[0]);
 } catch(e) { if(e.code==='23505') return res.status(409).json({error:'A record with those unique values already exists.'}); if(e.code==='23503') return res.status(409).json({error:'This record is referenced by another record, or a selected record no longer exists.'}); next(e); } });
 return router;
}
module.exports={createAdminRouter,validate,tables};
