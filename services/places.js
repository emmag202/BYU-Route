// Trip-assistant workstream: turns a phrase from a rider's message into one exact place.
// Nested categorisation, so the model never has to know an address:
//   1. The model names the place as the rider wrote it and picks the approximate AREA (trip-assistant.js).
//   2. This file collects candidates: known Ryde stops + Amazon Location text search biased to that area,
//      using both the model's full name for the place and the rider's own words.
//   3. The model picks the exact candidate (or none, which becomes a clarifying question for the rider).
const fs = require('node:fs');
const path = require('node:path');
const { inValley } = require('./trip-planner');

// Approximate centres, used only to bias the Amazon search. Exact coordinates always come from
// Amazon Location or from route-data.js, never from this table.
const AREAS = {
  byu_campus: { label: 'BYU campus', hint: 'BYU buildings, campus housing, the MTC, LaVell Edwards Stadium', center: [40.2518, -111.6493] },
  provo_downtown: { label: 'Downtown and central Provo', hint: 'Center Street, Joaquin neighborhood, Provo library, Provo Central station, Rec Center', center: [40.2338, -111.6585] },
  provo_south: { label: 'South Provo', hint: 'Provo Towne Centre mall, East Bay, south of 600 South', center: [40.2170, -111.6610] },
  provo_north: { label: 'North Provo', hint: 'Riverwoods, Edgemont, north of 2230 North, Provo Canyon mouth', center: [40.2985, -111.6575] },
  provo_west: { label: 'West Provo', hint: 'Provo Airport, Utah Lake State Park, west of I-15', center: [40.2300, -111.7050] },
  orem_west: { label: 'West Orem', hint: 'UVU, Orem Central station, west of State Street', center: [40.2787, -111.7143] },
  orem_east: { label: 'East and central Orem', hint: 'University Place mall, Orem city center, State Street and east', center: [40.2850, -111.6850] },
  vineyard: { label: 'Vineyard', hint: 'Vineyard, Vineyard station, the lakeshore', center: [40.3040, -111.7460] },
  lindon_pg: { label: 'Lindon and Pleasant Grove', hint: 'Lindon, Pleasant Grove', center: [40.3640, -111.7385] },
  american_fork: { label: 'American Fork, Highland, Alpine', hint: 'American Fork, The Meadows, Highland, Alpine, Cedar Hills', center: [40.3769, -111.7958] },
  lehi: { label: 'Lehi', hint: 'Lehi, Thanksgiving Point, Traverse Mountain', center: [40.3916, -111.8508] },
  west_lake: { label: 'Saratoga Springs and Eagle Mountain', hint: 'Saratoga Springs, Eagle Mountain', center: [40.3491, -111.9047] },
  springville: { label: 'Springville and Mapleton', hint: 'Springville, Mapleton', center: [40.1652, -111.6107] },
  spanish_fork: { label: 'Spanish Fork and south', hint: 'Spanish Fork, Salem, Payson, Santaquin', center: [40.1150, -111.6549] },
};
const DEFAULT_AREA = 'byu_campus';

function areaCriteria() {
  const criteria = Object.fromEntries(Object.entries(AREAS).map(([id, a]) => [id, `${a.label}: ${a.hint}`]));
  criteria.outside = 'Somewhere outside Utah Valley (Salt Lake, the airport in Salt Lake, Park City, another state)';
  criteria.unknown = 'The message does not say enough to tell';
  return criteria;
}

// Every Ryde stop with coordinates, one entry per stop name.
function rydeStopPlaces(routes) {
  const seen = new Map();
  for (const route of routes) for (const s of route.stops) {
    if (s.lat === null || seen.has(s.name)) continue;
    seen.set(s.name, { label: `${s.name} (Ryde stop)`, lat: s.lat, lng: s.lng, source: 'ryde' });
  }
  return [...seen.values()];
}

function publicAmazonKey(root = path.join(__dirname, '..')) {
  try {
    const text = fs.readFileSync(path.join(root, 'public/js/aws-config.js'), 'utf8');
    return text.match(/BYU_RYDE_AWS_API_KEY\s*=\s*'([^']+)'/)?.[1] || '';
  } catch { return ''; }
}

function createPlaceSearch({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 6000 } = {}) {
  // Same Amazon Location key the map already ships to browsers; a server-only key can override it.
  const key = env.AMAZON_LOCATION_API_KEY || publicAmazonKey();
  const region = env.AMAZON_LOCATION_REGION || 'us-east-2';
  let warned = false;
  async function searchOne(phrase, lat, lng) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(
        `https://places.geo.${region}.amazonaws.com/v2/search-text?key=${encodeURIComponent(key)}`,
        {
          method: 'POST', signal: controller.signal,
          // The key may be restricted to the site's own pages, so identify as the site.
          headers: { 'Content-Type': 'application/json', ...(env.APP_ORIGIN ? { Referer: `${env.APP_ORIGIN}/` } : {}) },
          body: JSON.stringify({ QueryText: phrase, BiasPosition: [lng, lat], MaxResults: 8 }),
        },
      );
      if (!response.ok) {
        // Say why once, so a blocked key is not mistaken for "no such place".
        if (!warned) { warned = true; console.warn(`Amazon Location place search failed: HTTP ${response.status}. Check the API key's allowed referers and actions.`); }
        return [];
      }
      const data = await response.json().catch(() => ({}));
      return (data.ResultItems || data.Results || []).map((item) => {
        const place = item.Place || item;
        const pos = place.Position || item.Position;
        const title = place.Title || item.Title || '';
        const address = place.Address?.Label || item.Address?.Label || '';
        const label = address && !address.startsWith(title) ? `${title}, ${address}` : (address || title);
        return { label: String(label).slice(0, 200), lat: Number(pos?.[1]), lng: Number(pos?.[0]), source: 'amazon' };
      }).filter((p) => p.label && inValley(p));
    } catch {
      if (!warned) { warned = true; console.warn('Amazon Location place search failed: no response.'); }
      return [];
    } finally { clearTimeout(timer); }
  }
  // `queries` is one phrase or several ways of naming the same place; results are merged, best first.
  return async function searchPlaces(queries, areaId) {
    const list = (Array.isArray(queries) ? queries : [queries]).filter(Boolean).slice(0, 3);
    if (!key || !list.length) return [];
    const [lat, lng] = (AREAS[areaId] || AREAS[DEFAULT_AREA]).center;
    const seen = new Set();
    return (await Promise.all(list.map((q) => searchOne(q, lat, lng)))).flat()
      .filter((p) => !seen.has(p.label) && seen.add(p.label)).slice(0, 12);
  };
}

module.exports = { AREAS, DEFAULT_AREA, areaCriteria, rydeStopPlaces, createPlaceSearch };
