// Trip-assistant workstream: loads the published Ryde timetable and stop coordinates for server-side planning.
// Single source of truth stays in the browser files (public/js/app.js `const R=[...]` and public/js/route-data.js);
// this module only reads them, so the route cards and the assistant can never disagree.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SERVICE_DAY_START = 180; // 3 AM, same rule as app.js: a 12:00 AM bus belongs to the evening before.

function loadRydeData(root = path.join(__dirname, '..')) {
  const appJs = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  const match = appJs.match(/const R=(\[[\s\S]*?\n\]);/);
  if (!match) throw new Error('Could not find the route table (const R=[...]) in public/js/app.js.');
  const table = JSON.parse(match[1]);
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/route-data.js'), 'utf8'), sandbox);
  const geometry = sandbox.window.BYU_RYDE_ROUTES || [];

  return table.map((r) => {
    const geo = geometry.find((g) => String(g.id) === String(r.id));
    const last = r.stops.length - 1;
    // route-data.js lists the campus stop first, then the pickups in order; the timetable lists the
    // pickups first and campus last. Map by position: geo stop 0 -> campus, geo stop k -> pickup k-1.
    const point = (j) => {
      const s = geo?.stops?.[j === last ? 0 : j + 1];
      const p = s && geo.points?.[s.waypoint - 1];
      return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
    };
    const stops = r.stops.map((s, j) => {
      const p = point(j);
      return { index: j, name: s[0], campus: j === last, lat: p ? p[0] : null, lng: p ? p[1] : null };
    });
    // Minutes on the service day; a time earlier than the one before it in its column has passed midnight.
    const timetable = r.timetable.map((col) => {
      let prev = -1;
      return col.map((t) => {
        const [h, m] = t.time.split(':').map(Number);
        let min = h * 60 + m;
        while (min < prev) min += 1440;
        if (min < SERVICE_DAY_START) min += 1440;
        prev = min;
        return { time: t.time, days: t.days, min };
      });
    });
    return { id: String(r.id), name: r.name, service: r.service, stops, timetable };
  });
}

module.exports = { loadRydeData, SERVICE_DAY_START };
