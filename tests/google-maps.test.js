const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/app.js','utf8');
const context={window:{},URL,esc:s=>String(s).replace(/&/g,'&amp;')};
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/js/route-data.js','utf8'),context);
vm.runInContext(source.slice(source.indexOf('function googleMapsWalkLink('),source.indexOf('// Refresh the same route-details page')),context);
test('Emma walking links preserve exact destinations and external-link behavior for all route stops',()=>{
 const routes=context.window.BYU_RYDE_ROUTES;
 assert.equal(routes.length,7);
 for(const geo of routes){
  const r={id:geo.id,stops:geo.stops.map(s=>[s.label])};
  const html=context.routeWalkingLinksHTML(r);
  assert.equal((html.match(/data-directions/g)||[]).length,geo.stops.length);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g)||[]).length,geo.stops.length);
  geo.stops.forEach((stop,i)=>{
   const link=new URL(context.googleMapsWalkLink(r,i));
   assert.equal(link.origin,'https://www.google.com');assert.equal(link.pathname,'/maps/dir/');
   assert.equal(link.searchParams.get('destination'),geo.points[stop.waypoint-1].join(','));
   assert.equal(link.searchParams.get('travelmode'),'walking');assert.equal(link.searchParams.get('api'),'1');
   assert.ok(html.includes('Walk to '+stop.label));assert.ok(html.includes('Walking directions in Google Maps'));
  });
 }
 assert.equal(context.googleMapsWalkLink({id:'missing'},0),'');
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
