'use strict';
(() => {
 const definitions={
  users:{fields:[['name','Name'],['net_id','Net ID'],['email','Email','email'],['password','Password','password']],keys:['user_id'],columns:['user_id','name','net_id','email']},
  routes:{fields:[['route_name','Route name']],keys:['route_id'],columns:['route_id','route_name']},
  favorites:{fields:[['user_id','User','user'],['route_id','Route','route']],keys:['user_id','route_id'],columns:['user_id','route_id']},
  homes:{fields:[['user_id','User','user'],['label','Label'],['lat','Latitude','number'],['lng','Longitude','number']],keys:['user_id'],columns:['user_id','label','lat','lng','updated_at']},
  calendar:{fields:[['start_date','Start date','date'],['end_date','End date','date'],['label','Label'],['source_url','Source URL','url']],keys:['start_date','end_date'],columns:['start_date','end_date','label','source_url']}
 };
 const status=document.querySelector('#admin-status');
 const request=async(type,method='GET',body)=>{const r=await fetch('/api/admin/'+type,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Ryde-Request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})}); if(!r.ok){let msg='Request failed.';try {msg=(await r.json()).error||msg;}catch{} throw Error(msg);}return r.status===204?null:r.json();};
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 async function render(type,container) {
  container.replaceChildren(); status.textContent='Loading…';
  try {
   const [rows,users,routes]=await Promise.all([request(type),['favorites','homes'].includes(type)?request('users'):[],type==='favorites'?request('routes'):[]]);
   status.textContent=''; const spec=definitions[type];
   const form=node('form');form.className='admin-form';form.hidden=true;const heading=node('h3','Add record');form.append(heading);let editing=null;const inputs={};
   for(const [key,label,kind] of spec.fields){const wrap=node('label',label+' ');let input;
    if(kind==='user'||kind==='route'){input=node('select');input.append(new Option('Choose…',''));for(const item of kind==='user'?users:routes){const value=kind==='user'?item.user_id:item.route_id;input.append(new Option(kind==='user'?`${item.name} (${item.net_id})`:item.route_name,value));}}
    else {input=node('input');input.type=kind||'text';if(kind==='number')input.step='any';if(kind==='password')input.autocomplete='new-password';}
    input.name=key; input.required=kind!=='password';wrap.append(input);form.append(wrap);inputs[key]=input;
   }
   const save=node('button','Save');save.type='submit';const cancel=node('button','Cancel');cancel.type='button';cancel.onclick=()=>{form.hidden=true;};form.append(save,cancel);container.append(form);
   const add=node('button',type==='users'?'Add User':'Add New');add.type='button';add.onclick=()=>{editing=null;form.reset();inputs.password&&(inputs.password.required=true);heading.textContent='Add record';form.hidden=false;};container.append(add);
   const wrap=node('div');wrap.className='table-wrap';const table=node('table');const head=node('tr');for(const col of [...spec.columns,'Actions'])head.append(node('th',col.replaceAll('_',' ')));table.append(head);
   for(const row of rows){const tr=node('tr');for(const col of spec.columns){let value=row[col];if(col==='user_id'&&type!=='users')value=users.find(u=>String(u.user_id)===String(value))?.name||value;if(col==='route_id'&&type==='favorites')value=routes.find(r=>String(r.route_id)===String(value))?.route_name||value;tr.append(node('td',String(value??'')));}
    const actions=node('td');const edit=node('button','Edit');edit.type='button';edit.onclick=()=>{editing=spec.keys.map(k=>row[k]);form.reset();for(const [key,,kind] of spec.fields)if(kind!=='password')inputs[key].value=row[key]??'';if(inputs.password)inputs.password.required=false;heading.textContent='Edit record';form.hidden=false;form.scrollIntoView({block:'nearest'});};
    const del=node('button','Delete');del.type='button';del.onclick=async()=>{if(!confirm(type==='users'?'Delete this user and their associated favorites, home and sessions?':'Delete this record?'))return;try{await request(type,'DELETE',{keys:spec.keys.map(k=>row[k])});status.textContent='Record deleted.';await render(type,container);}catch(e){status.textContent=e.message;}};actions.append(edit,del);tr.append(actions);table.append(tr);
   } wrap.append(table);container.append(wrap);
   form.onsubmit=async event=>{event.preventDefault();const values={};for(const [key,,kind] of spec.fields){let value=inputs[key].value;if(kind==='number')value=Number(value);if(kind==='password'&&!value)continue;values[key]=value;}try{await request(type,editing?'PUT':'POST',{...(editing?{keys:editing}:{}),values});await render(type,container);status.textContent='Record saved.';}catch(e){status.textContent=e.message;}};
  }catch(e){status.textContent=e.message;}
 }
 document.querySelectorAll('[data-panel]').forEach(button=>button.onclick=()=>{const panel=button.dataset.panel;for(const name of ['monitor','users','records'])document.querySelector('#panel-'+name).hidden=name!==panel;status.textContent='';if(panel==='users')render('users',document.querySelector('#users-content'));if(panel==='records')render(document.querySelector('#record-type').value,document.querySelector('#records-content'));});
 document.querySelector('#record-type').onchange=event=>render(event.target.value,document.querySelector('#records-content'));
 document.querySelector('#admin-logout').onclick=async()=>{try{await request('session','DELETE',{});location.assign('/okr');}catch(e){status.textContent='Logout failed. '+e.message;}};
})();
