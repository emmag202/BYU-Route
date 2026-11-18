const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/app.js','utf8');
const context={window:{},URL,esc:s=>String(s).replace(/&/g,'&amp;')};
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/js/route-data.js','utf8'),context);
const routeDataStart=source.indexOf('const R=[');
const routeDataEnd=source.indexOf('\n];',routeDataStart)+3;
const displayedRoutes=vm.runInContext(`${source.slice(routeDataStart,routeDataEnd)}\nR.map(r=>({id:r.id,name:r.name,stops:r.stops.map(s=>s[0])}))`,context);
vm.runInContext(source.slice(source.indexOf('function googleMapsWalkLink('),source.indexOf('// Refresh the same route-details page')),context);
test('walking links map every displayed stop to its geographic scheduleIndex across all seven routes',()=>{
 const routes=context.window.BYU_RYDE_ROUTES;
 assert.equal(routes.length,7);
 assert.deepEqual(Array.from(displayedRoutes,r=>r.name),['West','Wyview','Branbury','King Henry','South/Joaquin','Heritage Overflow Parking','Wymount']);
 for(const r of displayedRoutes){
  const geo=routes.find(g=>g.id===r.id);
  assert.ok(geo,`geographic data exists for ${r.name}`);
  const html=context.routeWalkingLinksHTML(r);
  assert.equal((html.match(/data-directions/g)||[]).length,r.stops.length);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g)||[]).length,r.stops.length);
  r.stops.forEach(([label],i)=>{
   const mappedStop=geo.stops.find(stop=>stop.scheduleIndex===i);
   assert.ok(mappedStop,`${r.name} displayed stop ${i} has a scheduleIndex match`);
   const link=new URL(context.googleMapsWalkLink(r,i));
   assert.equal(link.origin,'https://www.google.com');assert.equal(link.pathname,'/maps/dir/');
   assert.equal(link.searchParams.get('destination'),geo.points[mappedStop.waypoint-1].join(','));
   assert.equal(link.searchParams.get('travelmode'),'walking');assert.equal(link.searchParams.get('api'),'1');
   assert.ok(html.includes('Walk to '+label));assert.ok(html.includes('Walking directions in Google Maps'));
  });
 }
 assert.equal(context.googleMapsWalkLink({id:'missing'},0),'');
 const first=routes[0],originalStops=first.stops;
 try{
  first.stops=originalStops.filter(stop=>stop.scheduleIndex!==0);
  assert.equal(context.googleMapsWalkLink({id:first.id},0),'');
 }finally{first.stops=originalStops}
 assert.equal(context.googleMapsWalkLink({id:routes[0].id},999),'');
});
test('combined route details keep walking links below the schedule with the existing map destinations',()=>{
 const detail=source.slice(source.indexOf('function detail('),source.indexOf('// ---- Trip state'));
 assert.doesNotMatch(detail,/data-start=|>Plan trip<|stop-strip|strip-stop|youAreHereHTML|Times after boarding/);
 const combined=detail;
 assert.match(combined,/routeWalkingLinksHTML\(r\)/);assert.match(combined,/schedulePanel\(r\)/);assert.match(combined,/data-view-trip/);
 assert.ok(combined.indexOf('schedulePanel(r)')<combined.indexOf('routeWalkingLinksHTML(r)'));
 const refresh=source.slice(source.indexOf('function renderStart()'),source.indexOf('/* ---- events ---- */'));
 assert.match(refresh,/detail\(startState.id,\{refresh:true\}\)/);assert.doesNotMatch(refresh,/sheet.innerHTML|setHash/);
});
