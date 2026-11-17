const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/app.js', 'utf8');
const part = (a,b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
function node() { return { innerHTML:'', textContent:'', disabled:false, scrollTop:0, isConnected:true,
  classList:{add(){},remove(){},toggle(){},contains(){return false}},
  setAttribute(){},removeAttribute(){},addEventListener(){},focus(){} }; }
function setup() {
  const nodes=new Map(); const $=id=>{if(id==='favoriteConfirm'&&!nodes.has(id))return null;if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
  const controls=new Map(); const dialog=node(); dialog.querySelector=selector=>{if(!controls.has(selector))controls.set(selector,node());return controls.get(selector)};
  dialog.showModal=()=>{dialog.open=true}; dialog.close=()=>{dialog.open=false};
  const calls=[], events={};
  const context={ $, R:[{id:'101',name:'West',color:'#123',stops:[['Home'],['Campus']],toCampus:[0],fromCampus:[1],campusStop:'Campus'}, {id:'102',name:'Wyview',color:'#234',stops:[],toCampus:[],fromCampus:[]}],
    currentUser:{user_id:7},favoriteRouteIds:new Set(),esc:String,
    document:{createElement:()=>dialog,body:{append:d=>nodes.set(d.id,d)},querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>events[name]=fn},
    openProfile:()=>calls.push(['profile']),apiRequest:async(path,options={})=>{calls.push([path,options]);return []},
    location:{hash:'#/'},history:{state:null,pushState(a,_b,h){this.state=a;context.location.hash=h},replaceState(a,_b,h){this.state=a;context.location.hash=h}},
    URLSearchParams,window:{addEventListener(){},scrollTo(){},showRydeTrip:trip=>calls.push(['map',trip])},sheet:node(),screen:1,sel:null,startState:null,showRoutes(){},view(){},fit(){},gStops:node(),addSheetHandle(){},layout(n){context.screen=n},
    q:{value:''},routeMatches:(r,f)=>!f||r.name.toLowerCase().includes(f),didYouMean:()=>null,showWelcomeIntro:()=>false,noClassDaysNoticeHTML:()=>'',nearYouHTML:()=>'<section>Nearby Trips</section>',dirBannerHTML:()=>'',cardHTML:r=>`<article>${r.name}</article>`,informationPanel:()=>'',routeWalkingLinksHTML:()=>'<div>Walking directions</div>',schedulePanel:()=>'<div>Full schedule</div>',
    dirOverride:null,autoDir:()=>'to',getDir:()=>context.dirOverride||'to',routeNext:()=>({next:{j:0}}),upcoming:()=>[{time:'08:00',min:480,ahead:0}],arrivalAfter:(_r,_j,t)=>({...t,min:t.min+5}),nextTimeText:()=> '8:00 AM',fmtDeparture:t=>t,dayTag:()=>'',youAreHereHTML:()=>'<b>You are here</b>',recordEvent:type=>calls.push(['event',type]),
    SCHED_DAYS:[['mth','Mon-Thu'],['fri','Friday'],['wkd','Weekend']],todaySchedDay:()=>'mth',runDays:()=>'',housing:()=>[],timetableHTML:(r,k)=>`${r.name}:${k}` };
  vm.createContext(context);
  vm.runInContext(part('async function toggleFavorite(', 'function showCreateAccountForm()'),context);
  vm.runInContext(part('let allTimesOpen=', 'function noClassDaysNoticeHTML()'),context);
  vm.runInContext(part('function home(', 'function mapPage('),context);
  vm.runInContext(part('function mapPage(', '// ---- Start screen:'),context);
  vm.runInContext(part('function tripPlan(', 'function googleMapsWalkLink('),context);
  vm.runInContext(part('function renderStart()', '/* ---- events ---- */'),context);
  vm.runInContext(part('function refreshScreen()', '// Re-render only'),context);
  vm.runInContext(part('let routing=false;', 'function recordEvent('),context);
  vm.runInContext(part('function refreshHome()', '/* ---- screens ---- */'),context);
  return {context,calls,nodes,$,dialog,controls,events};
}
test('favorite confirmation cancels, saves, removes and handles failures through the existing API',async()=>{
  const {context:c,calls,dialog,controls}=setup();c.syncFavoriteViews=()=>calls.push(['sync']);
  c.confirmFavorite('101',node());assert.match(dialog.innerHTML,/Save as favorite route\?/);
  controls.get('[data-cancel]').onclick();assert.equal(calls.length,0);
  c.confirmFavorite('101',node());await controls.get('[data-confirm]').onclick();
  assert.equal(calls[0][0],'/api/users/7/favorites');assert.equal(calls[0][1].method,'POST');assert.equal(calls[0][1].body,'{"route_key":"101"}');assert.ok(c.favoriteRouteIds.has('101'));
  c.confirmFavorite('101',node());assert.match(dialog.innerHTML,/Remove favorite route\?/);await controls.get('[data-confirm]').onclick();
  assert.equal(calls[2][0],'/api/users/7/favorites/101');assert.equal(calls[2][1].method,'DELETE');assert.equal(c.favoriteRouteIds.size,0);
  c.apiRequest=async()=>{throw Error('Offline')};c.confirmFavorite('101',node());await controls.get('[data-confirm]').onclick();
  assert.equal(c.favoriteRouteIds.size,0);assert.equal(dialog.open,true);assert.equal(controls.get('.formMessage').textContent,'Offline');
  c.currentUser=null;c.confirmFavorite('101',node());assert.deepEqual(calls.at(-1),['profile']);
});
test('combined details retain favorites, schedule and View Trip without a Plan Trip screen',()=>{
  const {context:c}=setup();assert.match(c.favoriteButton(c.R[0]),/aria-pressed="false"/);
  c.detail('101');assert.match(c.sheet.innerHTML,/Save as Favorite/);assert.match(c.sheet.innerHTML,/Full schedule/);assert.match(c.sheet.innerHTML,/data-view-trip/);assert.doesNotMatch(c.sheet.innerHTML,/data-start=|>Plan trip</);
  c.favoriteRouteIds.add('101');c.detail('101');assert.match(c.sheet.innerHTML,/Favorited - Remove Favorite/);assert.match(c.favoriteButton(c.R[0]),/is-saved/);
  assert.equal(c.location.hash,'#/route/101');
});
test('homepage keeps favorites, nearby, directory order and searches saved routes',()=>{
  const {context:c}=setup();c.favoriteRouteIds.add('101');c.home();
  const html=c.sheet.innerHTML;assert.ok(html.indexOf('Favorite Routes')<html.indexOf('Nearby Trips'));assert.ok(html.indexOf('Nearby Trips')<html.indexOf('All Routes'));
  assert.equal((html.match(/<article>West<\/article>/g)||[]).length,1);
  c.home('west');assert.match(c.sheet.innerHTML,/<article>West<\/article>/);assert.doesNotMatch(c.sheet.innerHTML,/<article>Wyview/);
});
test('All Times renders directly from hash, survives background refresh, and filters existing schedules',()=>{
  const {context:c}=setup();c.location.hash='#/times';c.renderFromHash();assert.match(c.sheet.innerHTML,/<h1>All Times/);
  c.refreshHome();assert.equal(c.location.hash,'#/times');assert.match(c.sheet.innerHTML,/<h1>All Times/);
  vm.runInContext("allTimesRoute='101';allTimesDay='fri'",c);assert.match(c.allTimesBody(),/West:fri/);assert.doesNotMatch(c.allTimesBody(),/Wyview:fri/);
  c.location.hash='#/route/101';c.renderFromHash();assert.match(c.sheet.innerHTML,/Full schedule/);
  c.location.hash='#/times';c.renderFromHash();assert.match(c.sheet.innerHTML,/<h1>All Times/);
});
test('star event stops route navigation; CSS supports keyboard and touch visibility',()=>{
  const {context:c,events}=setup();let id,stopped=false;
  c.confirmFavorite=value=>{id=value};
  vm.runInContext(part('document.addEventListener("change"', '$("back").onclick'),c);
  events.click({target:{closest:selector=>selector==='[data-favorite]'?{dataset:{favorite:'101'}}:null},preventDefault(){},stopPropagation(){stopped=true}});
  assert.equal(id,'101');assert.equal(stopped,true);
  const css=fs.readFileSync('public/css/style.css','utf8');assert.match(css,/:focus-within/);assert.match(css,/@media\(hover:none\),\(pointer:coarse\)/);
});

test('favorite synchronization updates details, duplicate stars, homepage and open profile together',()=>{
 const {context:c,calls}=setup();
 const star={dataset:{favorite:'101',favoriteDetails:'false'}},details={dataset:{favorite:'101',favoriteDetails:'true'}};
 c.document.querySelectorAll=()=>[star,details];c.favoriteRouteIds.add('101');c.syncFavoriteViews();
 assert.match(star.outerHTML,/is-saved/);assert.match(details.outerHTML,/Favorited - Remove Favorite/);assert.match(c.sheet.innerHTML,/<article>West/);assert.deepEqual(calls.at(-1),['profile']);
 c.favoriteRouteIds.delete('101');c.syncFavoriteViews();assert.match(details.outerHTML,/Save as Favorite/);assert.doesNotMatch(star.outerHTML,/is-saved/);
});

test('selected direction, stops and duration reach the trip map, and browser back restores them',()=>{
 const {context:c,calls,events}=setup();
 c.R[0].stops=[['Home A'],['Home B'],['Campus']];c.R[0].toCampus=[0,1];c.R[0].fromCampus=[2];
 c.detail('101');
 vm.runInContext(part('document.addEventListener("change"', '$("back").onclick'),c);
 const click=(selector,dataset)=>events.click({target:{closest:s=>s===selector?{dataset}:null}});
 click('[data-trip-board]',{tripBoard:'1'});assert.equal(c.tripPlan(c.R[0]).board,1);
 click('[data-dir-set]',{dirSet:'from'});click('[data-trip-dest]',{tripDest:'1'});
 assert.match(c.sheet.innerHTML,/data-trip-dest="1" aria-pressed="true"/);
 const routeState=c.history.state;
 click('[data-view-trip]',{estimatedMinutes:'5'});
 const trip=calls.findLast(call=>call[0]==='map')[1];
 assert.equal(trip.routeId,'101');assert.equal(trip.direction,'from');assert.equal(trip.board,2);assert.equal(trip.dest,1);assert.equal(trip.originLabel,'Campus');assert.equal(trip.destinationLabel,'Home B');assert.equal(trip.estimatedMinutes,5);
 c.history.state=routeState;c.location.hash='#/route/101';c.renderFromHash();
 assert.equal(c.tripPlan(c.R[0]).dest,1);assert.equal(c.tripPlan(c.R[0]).d,'from');
 assert.equal(calls.filter(call=>call[0]==='event').length,1);
 c.location.hash='#/start/101';c.renderFromHash();assert.equal(c.location.hash,'#/route/101');assert.match(c.sheet.innerHTML,/Full schedule/);
});
