const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/app.js','utf8');
test('mobile card boarding label preserves route navigation, stop, time, color and favorite',()=>{
 let next={stop:'MOA',time:'8:00 AM'};
 const c={routeNext:()=>({next}),openCards:new Set(),esc:String,cardNextStop:(_r,rn)=>rn.next?rn.next.stop:'No scheduled departures',nextTimeText:n=>n?n.time:'',favoriteButton:()=>'<button class="favorite-star" data-favorite="101">star</button>'};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function cardHTML('),source.indexOf('function updateCard(')),c);
 const r={id:101,name:'West',color:'#123456'};
 let html=c.cardHTML(r);
 for(const text of ['data-open="101"','--c:#123456','>West<','>MOA<','8:00 AM','favorite-star','>Boarding at<'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/data-card-boarding="101" hidden/);
 next=null;html=c.cardHTML(r);assert.match(html,/data-card-boarding="101" hidden/);assert.match(html,/No scheduled departures/);
 const css=fs.readFileSync('public/css/style.css','utf8');assert.match(css,/@media\(max-width:650px\)\{\s*\.home-body \.rc \.route-name\{color:var\(--navy\)/);
});
