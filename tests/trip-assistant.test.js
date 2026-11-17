const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { loadRydeData } = require('../services/ryde-data');
const { planLeg, planDay, inValley } = require('../services/trip-planner');
const { answerQuestion, createTripAssistant, cleanParse } = require('../services/trip-assistant');
const { createGemini } = require('../services/gemini');
const { createPlaceSearch } = require('../services/places');

const routes = loadRydeData();
const stop = (name) => { const s = routes.flatMap(r => r.stops).find(x => x.name === name); return { label: name, lat: s.lat, lng: s.lng }; };
const MONDAY_8AM = { day: 1, minutes: 480 };
const LIBRARY = { label: 'Provo City Library, 550 N University Ave, Provo, UT', lat: 40.2412, lng: -111.6585, source: 'amazon' };
const MALL = { label: 'University Place, 575 E University Pkwy, Orem, UT', lat: 40.2752, lng: -111.6810, source: 'amazon' };

// Stand-in for Gemini: returns scripted JSON for the "parse" step and candidate numbers for the "pick" step.
function fakeModel(parse, picks = {}) {
  const calls = [];
  return {
    configured: true, calls,
    async json({ task, prompt, schema }) {
      calls.push({ task, prompt, schema });
      if (task === 'parse') return { origin_kind: 'none', origin_name: '', origin_area: 'unknown', stops: [], day: 'none', hour: -1, minute: 0, ...parse };
      // Pick the numbered candidate line whose label starts with the scripted text, else -1.
      return Object.fromEntries(Object.keys(schema.properties).map((slot) => {
        const block = prompt.split(`${slot}: the rider wrote`)[1]?.split('\n\n')[0] || '';
        const line = block.split('\n').find((l) => picks[slot] && l.trim().replace(/^\d+: /, '').startsWith(picks[slot]));
        return [slot, line ? Number(line.trim().split(':')[0]) : -1];
      }));
    },
  };
}

test('timetable and stop coordinates load from the browser files', () => {
  assert.equal(routes.length, 7);
  for (const r of routes) {
    assert.equal(r.timetable.length, r.stops.length);
    assert.ok(r.stops.at(-1).campus);
    for (const s of r.stops) assert.ok(inValley(s), `${r.name} / ${s.name} has coordinates`);
  }
  // Pickups and campus must not share a point: guards the campus-first ordering in route-data.js.
  const wyview = routes.find(r => r.id === '102');
  assert.notDeepEqual([wyview.stops[0].lat, wyview.stops[0].lng], [wyview.stops[2].lat, wyview.stops[2].lng]);
});

test('a Ryde leg uses the first published departure the rider can reach', () => {
  const wyview = routes.find(r => r.id === '102');
  const leg = planLeg(routes, stop('Wyview'), stop('MOA'), MONDAY_8AM);
  assert.equal(leg.best, 'ryde');
  assert.equal(leg.ryde[0].routeId, '102');
  assert.equal(leg.ryde[0].board, 'Wyview');
  const expected = wyview.timetable[0].find(t => t.min >= 480 + leg.ryde[0].walkToMin);
  assert.equal(leg.ryde[0].boardMin, expected.min);
  assert.ok(leg.ryde[0].arriveMin > leg.ryde[0].boardMin);
  assert.match(leg.transit.url, /travelmode=transit/);
});

test('a short walk that arrives first beats a bus that needs nearly as much walking', () => {
  const brickOven = { label: 'Brick Oven', lat: 40.2447, lng: -111.6565 };
  const leg = planLeg(routes, brickOven, stop('WILK'), { day: 1, minutes: 614 });
  assert.ok(leg.ryde.length > 0);
  assert.ok(leg.walk.arriveMin < leg.ryde[0].arriveMin);
  assert.equal(leg.best, 'walk');
});

test('campus to housing rides outbound, and weekends fall back without inventing times', () => {
  const out = planLeg(routes, stop('MOA'), stop('Raintree'), MONDAY_8AM);
  assert.equal(out.ryde[0].board, 'MOA');
  assert.equal(out.ryde[0].alight, 'Raintree');
  const saturday = planLeg(routes, stop('Wyview'), stop('MOA'), { day: 6, minutes: 600 });
  assert.ok(!saturday.ryde.some(o => o.routeId === '102'));
  assert.notEqual(saturday.best, 'ryde');
});

test('a multi-stop day chains legs in order and sends uncovered legs to transit', () => {
  const day = planDay(routes, [stop('Wyview'), stop('MOA'), MALL], MONDAY_8AM);
  assert.equal(day.legs.length, 2);
  assert.ok(day.legs[1].departMin >= day.legs[0].arriveMin + 60);
  assert.equal(day.legs[1].best, 'transit');
  assert.equal(day.legs[1].ryde.length, 0);
});

test('model output is coerced to known values before anything uses it', () => {
  const cleaned = cleanParse({ intent: 'hack', origin_kind: 'named', origin_name: '  Wyview \n Park ', origin_area: 'mars',
    stops: [{ name: 'a'.repeat(300), area: 'lehi' }, { name: '', area: 'lehi' }, 'x', { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }], day: 'someday', hour: 99, minute: 30 });
  assert.equal(cleaned.intent, 'other');
  assert.equal(cleaned.originName, 'Wyview Park');
  // Street addresses the model adds are dropped; name, city and state stay.
  assert.equal(cleanParse({ origin_search: 'Alpine Village Apartments, 385 N 200 W, Provo, UT' }).originSearch, 'Alpine Village Apartments, Provo, UT');
  assert.equal(cleanParse({ stops: [{ name: 'x', search: '111 E 800 N, Provo' }] }).stops[0].search, 'Provo');
  assert.equal(cleaned.originArea, 'unknown');
  assert.equal(cleaned.stops[0].name.length, 80);
  assert.ok(cleaned.stops.length <= 4 && cleaned.stops.every(x => x.name));
  assert.deepEqual([cleaned.day, cleaned.hour, cleaned.minute], ['none', null, 0]);
  assert.equal(cleanParse(null).intent, 'other');
});

test('question -> nested place pick -> plan, with rider coordinates never sent to the model', async () => {
  const message = 'Plan my day from home to the Provo library then University Place Monday at 9';
  const model = fakeModel({ intent: 'day', origin_kind: 'home',
    stops: [{ name: 'Provo library', area: 'provo_downtown' }, { name: 'University Place', area: 'orem_east' }], day: 'mon', hour: 9, minute: 0 },
  { stop1: 'Provo City Library', stop2: 'University Place' });
  const searched = [];
  const searchPlaces = async (queries, area) => { searched.push([queries, area]); return queries[0] === 'Provo library' ? [LIBRARY] : [MALL]; };
  const home = { label: 'My apartment', lat: 40.26096, lng: -111.65995 };
  const result = await answerQuestion({ message, home }, { model, routes, searchPlaces });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.understood.places.map(p => p.label), ['Home (My apartment)', LIBRARY.label, MALL.label]);
  assert.equal(result.understood.day, 'Monday');
  assert.equal(result.understood.time, '9:00 AM');
  assert.equal(result.plan.legs.length, 2);
  assert.deepEqual(searched.sort(), [[['Provo library'], 'provo_downtown'], [['University Place'], 'orem_east']]);
  assert.deepEqual(model.calls.map(c => c.task), ['parse', 'pick']);
  for (const call of model.calls) { assert.ok(call.prompt.includes(JSON.stringify(message))); assert.ok(!call.prompt.includes('40.26096') && !call.prompt.includes('My apartment')); }
});

test('unsure, off-topic and out-of-valley questions do not produce a plan', async () => {
  const searchPlaces = async () => [LIBRARY];
  const parse = { intent: 'route', origin_kind: 'named', origin_name: 'Wyview', origin_area: 'byu_campus', stops: [{ name: 'library', area: 'provo_downtown' }] };
  const unsure = await answerQuestion({ message: 'Wyview to the library' }, { model: fakeModel(parse, { origin: 'Wyview (Ryde stop)' }), routes, searchPlaces });
  assert.equal(unsure.status, 'clarify');
  assert.equal(unsure.slot, 'stop1');
  assert.deepEqual(unsure.candidates, [{ label: LIBRARY.label, lat: LIBRARY.lat, lng: LIBRARY.lng }]);
  const chosen = await answerQuestion({ message: 'Wyview to the library', resolved: { stop1: unsure.candidates[0] } }, { model: fakeModel(parse, { origin: 'Wyview (Ryde stop)' }), routes, searchPlaces });
  assert.equal(chosen.status, 'ok');
  assert.equal((await answerQuestion({ message: 'write my essay' }, { model: fakeModel({ intent: 'other' }), routes, searchPlaces })).status, 'unsupported');
  assert.equal((await answerQuestion({ message: 'Wyview to the airport in Salt Lake' }, { model: fakeModel({ ...parse, stops: [{ name: 'airport', area: 'outside' }] }), routes, searchPlaces })).status, 'outside-valley');
  const noStart = await answerQuestion({ message: 'get me to the library' }, { model: fakeModel({ intent: 'route', stops: [{ name: 'library', area: 'unknown' }] }), routes, searchPlaces });
  assert.equal(noStart.reason, 'no-origin');
  assert.equal((await answerQuestion({ message: 'from Wyview' }, { model: fakeModel({ ...parse, stops: [] }), routes, searchPlaces })).reason, 'no-destination');
  const far = await answerQuestion({ message: 'Wyview to the library', resolved: { stop1: { label: 'Salt Lake', lat: 40.76, lng: -111.89 } } }, { model: fakeModel(parse, { origin: 'Wyview (Ryde stop)' }), routes, searchPlaces });
  assert.equal(far.status, 'outside-valley');
  // An out-of-range candidate number from the model is treated as "not sure", never as a place.
  const wild = { configured: true, async json({ task }) { return task === 'parse' ? { ...parse, day: 'none', hour: -1, minute: 0 } : { origin: 9999, stop1: 'zero' }; } };
  assert.equal((await answerQuestion({ message: 'Wyview to the library' }, { model: wild, routes, searchPlaces })).status, 'clarify');
});

test('a place the map search cannot find is never located by the model: the rider is asked', async () => {
  // Even if the model volunteers coordinates, they are ignored.
  const parse = { intent: 'route', origin_kind: 'named', origin_name: 'brick oven', origin_area: 'byu_campus', origin_search: 'Brick Oven Restaurant, 111 E 800 N, Provo, UT', origin_lat: 40.2449, origin_lng: -111.6566,
    stops: [{ name: 'tanner building', area: 'byu_campus', search: 'N. Eldon Tanner Building, BYU, Provo, UT', lat: 40.2503, lng: -111.6525 }] };
  const queries = [];
  const none = async (q) => { queries.push(q); return []; };
  const tried = { origin: [], stop1: [] }; // the browser searched too and found nothing
  const result = await answerQuestion({ message: 'start at brick oven and end up next to the tanner building', found: tried }, { model: fakeModel(parse), routes, searchPlaces: none });
  assert.equal(result.status, 'clarify');
  assert.equal(result.slot, 'origin');
  assert.equal(result.phrase, 'brick oven');
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(queries[0], ['Brick Oven Restaurant, Provo, UT', 'brick oven']);
  assert.ok(!JSON.stringify(result).includes('40.2449'));
  // When the map search does find places, an unsure pick offers them to the rider.
  const ask = await answerQuestion({ message: 'x' }, { model: fakeModel(parse), routes, searchPlaces: async () => [LIBRARY] });
  assert.equal(ask.status, 'clarify');
  assert.equal(ask.candidates.length, 1);
});

test('when the server search finds nothing the browser is asked to search, without a second model call', async () => {
  const parse = { intent: 'day', origin_kind: 'named', origin_name: 'alpine the apartments', origin_area: 'byu_campus', origin_search: 'Alpine Village Apartments, Provo, UT',
    stops: [{ name: 'the Wilk', area: 'byu_campus', search: 'Wilkinson Student Center, BYU, Provo, UT' }], day: 'mon', hour: 9, minute: 0 };
  const model = fakeModel(parse, { origin: 'Alpine Village', stop1: 'WILK (Ryde stop)' });
  const deps = { model, routes, searchPlaces: async () => [], region: 'us-east-2' };
  const first = await answerQuestion({ message: 'm' }, deps);
  assert.equal(first.status, 'lookup');
  assert.equal(first.region, 'us-east-2');
  assert.deepEqual(first.lookups.map(l => l.slot), ['origin', 'stop1']);
  assert.deepEqual(first.lookups[0].queries, ['Alpine Village Apartments, Provo, UT', 'alpine the apartments']);
  assert.deepEqual(first.lookups[0].bias, [-111.6493, 40.2518]);
  const alpine = { label: 'Alpine Village, 1378 N Freedom Blvd, Provo, UT', lat: 40.2515, lng: -111.6625 };
  const second = await answerQuestion({ message: 'm', state: first.state, found: { origin: [alpine], stop1: [] } }, deps);
  assert.equal(second.status, 'ok');
  assert.deepEqual(second.understood.places.map(p => p.label), [alpine.label, 'WILK (Ryde stop)']);
  assert.equal(second.understood.time, '9:00 AM');
  assert.deepEqual(model.calls.map(c => c.task), ['parse', 'pick']);
  // Results from the browser are checked like any other input.
  const junk = await answerQuestion({ message: 'm', state: { intent: 'route', origin_kind: 'named', origin_name: 'x', stops: [{ name: 'y' }], hour: 'soon' }, found: { origin: [], stop1: [] } }, deps);
  assert.equal(junk.status, 'clarify');
});

test('Gemini client asks for JSON, falls back if the format setting is rejected, and hides upstream errors', async () => {
  const reply = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
  const sent = [];
  const ok = createGemini({ env: { GEMINI_API_KEY: 'k' }, fetchImpl: async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return sent.length === 1 ? { ok: false, status: 400 } : reply('```json\n{"a":1}\n```'); } });
  assert.deepEqual(await ok.json({ prompt: 'p', schema: { type: 'object' } }), { a: 1 });
  assert.equal(sent[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(sent[0].init.headers['x-goog-api-key'], 'k');
  assert.ok(!sent[0].url.includes('k=') && !sent[0].url.includes('key'));
  assert.equal(sent[0].body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.equal(sent[1].body.generationConfig, undefined);
  assert.match(sent[1].body.contents[0].parts[0].text, /^p\n\nReply with one JSON object only/);
  const warn = console.warn; const warnings = []; console.warn = (m) => warnings.push(m);
  try {
    const fail = (status, error) => createGemini({ env: { GEMINI_API_KEY: 'k' }, retryDelayMs: 1, fetchImpl: async () => ({ ok: false, status, json: async () => ({ error }) }) }).json({ prompt: 'p', schema: {} });
    await assert.rejects(fail(403, { status: 'PERMISSION_DENIED', message: 'bad key' }), { status: 502 });
    await assert.rejects(fail(429, { status: 'RESOURCE_EXHAUSTED', message: 'quota' }), { status: 429 });
    await assert.rejects(createGemini({ env: { GEMINI_API_KEY: 'k' }, fetchImpl: async () => reply('sorry, no') }).json({ prompt: 'p', schema: {} }), { status: 502 });
    // A brief overload is retried once and can succeed.
    let n = 0;
    const flaky = createGemini({ env: { GEMINI_API_KEY: 'k' }, retryDelayMs: 1, fetchImpl: async () => (++n === 1 ? { ok: false, status: 503 } : reply('{"ok":true}')) });
    assert.deepEqual(await flaky.json({ prompt: 'p', schema: {} }), { ok: true });
    assert.equal(n, 2);
  } finally { console.warn = warn; }
  assert.match(warnings[0], /HTTP 403 PERMISSION_DENIED bad key/);
  assert.match(warnings[1], /HTTP 429 RESOURCE_EXHAUSTED/);
  assert.match(warnings[2], /not JSON/);
  assert.ok(!warnings.join(' ').includes('k '));
  assert.equal(createGemini({ env: {} }).configured, false);
  assert.equal(createGemini({ env: { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.8-flash' }, fetchImpl: async (url) => { sent.push({ url }); return reply('{}'); } }).configured, true);
});

test('Amazon place search keeps only Utah Valley results and survives failures', async () => {
  const items = { ResultItems: [{ Title: 'Provo City Library', Address: { Label: '550 N University Ave, Provo, UT' }, Position: [-111.6585, 40.2412] }, { Title: 'Library', Address: { Label: 'Salt Lake City, UT' }, Position: [-111.89, 40.76] }] };
  let body;
  const search = createPlaceSearch({ env: { AMAZON_LOCATION_API_KEY: 'pub' }, fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => items }; } });
  const found = await search('library', 'provo_downtown');
  assert.equal(found.length, 1);
  assert.equal(found[0].label, 'Provo City Library, 550 N University Ave, Provo, UT');
  assert.deepEqual(body, { QueryText: 'library', BiasPosition: [-111.6585, 40.2338], MaxResults: 8 });
  const merged = await createPlaceSearch({ env: { AMAZON_LOCATION_API_KEY: 'pub' }, fetchImpl: async () => ({ ok: true, json: async () => items }) })(['Provo City Library', 'library'], 'provo_downtown');
  assert.equal(merged.length, 1);
  const warn = console.warn; const warnings = []; console.warn = (m) => warnings.push(m);
  try {
    assert.deepEqual(await createPlaceSearch({ env: { AMAZON_LOCATION_API_KEY: 'pub' }, fetchImpl: async () => { throw new Error('down'); } })('library', 'x'), []);
    assert.deepEqual(await createPlaceSearch({ env: { AMAZON_LOCATION_API_KEY: 'pub' }, fetchImpl: async () => ({ ok: false, status: 403 }) })(['a', 'b'], 'x'), []);
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /HTTP 403/);
});

let server, base;
const ORIGIN = 'http://localhost:3000';
before(async () => {
  const app = express();
  app.use(express.json({ limit: '20kb' }));
  app.post('/api/chat', createTripAssistant({
    model: fakeModel({ intent: 'route', origin_kind: 'named', origin_name: 'Wyview', origin_area: 'byu_campus', stops: [{ name: 'MOA', area: 'byu_campus' }] }, { origin: 'Wyview (Ryde stop)', stop1: 'MOA (Ryde stop)' }),
    routes, searchPlaces: async () => [], origin: ORIGIN, production: false,
  }));
  app.post('/api/off', createTripAssistant({ model: createGemini({ env: {} }), routes, searchPlaces: async () => [], origin: ORIGIN, production: false }));
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Ryde-Request': '1', ...headers }, body: JSON.stringify(body) });

test('POST /api/chat validates origin and input, and returns a plan', async () => {
  assert.equal((await post('/api/off', { message: 'hi' })).status, 503);
  assert.equal((await post('/api/chat', { message: 'Wyview to MOA' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/chat', { message: '' })).status, 400);
  assert.equal((await post('/api/chat', { message: 'x'.repeat(281) })).status, 400);
  assert.equal((await post('/api/chat', { message: 'Wyview to MOA', here: { label: 'x', lat: 'no', lng: 1 } })).status, 400);
  assert.equal((await post('/api/chat', { message: 'Wyview to MOA', resolved: { bogus: { label: 'x', lat: 40.2, lng: -111.6 } } })).status, 400);
  assert.equal((await post('/api/chat', { message: 'Wyview to MOA', found: { origin: [{ label: 'x', lat: 'a', lng: 1 }] } })).status, 400);
  assert.equal((await post('/api/chat', { message: 'Wyview to MOA', found: { nope: [] } })).status, 400);
  const asked = await (await post('/api/chat', { message: 'Wyview to MOA' })).json();
  assert.equal(asked.status, 'lookup');
  const response = await post('/api/chat', { message: 'Wyview to MOA', state: asked.state, found: { origin: [], stop1: [] } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.plan.legs[0].to, 'MOA (Ryde stop)');
});
