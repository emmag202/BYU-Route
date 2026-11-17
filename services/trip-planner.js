// Trip-assistant workstream: deterministic planner. Every time shown to a rider comes from the published
// timetable through this file; the AI model never produces a time.
const { SERVICE_DAY_START } = require('./ryde-data');

const MAX_STOP_WALK_MI = 0.75; // farthest we send someone on foot to or from a Ryde stop
const EASY_WALK_MIN = 12;      // at or under this, walking the whole way beats waiting for a bus
const SHORT_WALK_MIN = 20;      // a walk this short wins whenever it also arrives first
const WALK_MARGIN_MIN = 10;     // walking must beat the bus by this much to be recommended over it
const MAX_WALK_MIN = 45;        // never recommend a longer walk than this over a bus
const DEFAULT_DWELL_MIN = 60;  // time assumed at each stop of a multi-stop day
// Utah Valley only (Santaquin to Lehi, Utah Lake to the canyons). Anything outside is refused.
const VALLEY = { south: 39.95, north: 40.50, west: -112.05, east: -111.50 };

const inValley = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) &&
  p.lat >= VALLEY.south && p.lat <= VALLEY.north && p.lng >= VALLEY.west && p.lng <= VALLEY.east;

function milesBetween(a, b) {
  const R0 = 3958.8, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R0 * Math.asin(Math.sqrt(h));
}
// Same estimate as the route cards: straight line x1.25 for streets, at 3 mph.
const walkMinutes = (mi) => Math.max(1, Math.round(mi * 1.25 * 20));

// Provo service day and minute for a Date (3 AM rollover), matching provoNow() in app.js.
function serviceMoment(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (k) => parts.find((x) => x.type === k)?.value;
  let day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
  let minutes = Number(get('hour')) * 60 + Number(get('minute'));
  if (minutes < SERVICE_DAY_START) { day = (day + 6) % 7; minutes += 1440; }
  return { day, minutes };
}

function fmtMinutes(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function departuresOn(route, j, day, from) {
  if (route.service !== 'daily' && (day === 0 || day === 6)) return [];
  return route.timetable[j].filter((t) => !(day === 5 && t.days === 'Mon-Thu') && t.min >= from);
}

// Stops a bus reaches after boarding at `board`, in riding order. Pickups run toward campus;
// from campus the bus loops back out through the pickups.
function ridePath(route, board, alight) {
  const last = route.stops.length - 1;
  if (board === alight) return null;
  if (board === last) return [last, ...route.stops.slice(0, alight + 1).map((s) => s.index)];
  if (alight > board) { const p = []; for (let j = board; j <= alight; j++) p.push(j); return p; }
  return null;
}

// Earliest ride on one route between two stop columns, leaving no earlier than `ready`.
function rideTimes(route, board, alight, day, ready) {
  const path = ridePath(route, board, alight);
  if (!path) return null;
  const last = route.stops.length - 1;
  let t = departuresOn(route, path[0], day, ready)[0];
  if (!t) return null;
  const boardT = t;
  for (let i = 1; i < path.length; i++) {
    const prev = t;
    // Later stops: the first time listed there after the bus left the previous stop (app.js arrivalAfter).
    t = departuresOn(route, path[i], day, prev.min)[0];
    if (path[i] === last && board !== last) {
      // The timetable lists when buses LEAVE campus, not when they arrive, and that can be a long layover.
      // Estimate the drive in as equal to the drive out (campus departure -> first pickup), and never
      // later than that next listed campus departure.
      const firstPickup = route.timetable[0].filter((x) => x.min <= boardT.min).at(-1);
      const leftCampus = firstPickup && route.timetable[last].filter((x) => x.min <= firstPickup.min).at(-1);
      const driveOut = leftCampus ? firstPickup.min - leftCampus.min : null;
      if (driveOut !== null && driveOut <= 30) {
        const estimate = prev.min + Math.max(driveOut, 2);
        if (!t || estimate < t.min) t = { min: estimate };
      }
    }
    if (!t) return null;
  }
  return { board: boardT, arrive: t, stopsRidden: path.length - 1 };
}

function rydeOptions(routes, from, to, when) {
  const out = [];
  const direct = milesBetween(from, to);
  for (const route of routes) {
    let best = null;
    for (const b of route.stops) {
      if (b.lat === null) continue;
      const toStop = milesBetween(from, b);
      if (toStop > MAX_STOP_WALK_MI) continue;
      for (const a of route.stops) {
        if (a.lat === null || a.index === b.index) continue;
        const fromStop = milesBetween(a, to);
        // The ride has to save walking overall, or it is not worth boarding.
        if (fromStop > MAX_STOP_WALK_MI || toStop + fromStop >= direct) continue;
        const walkTo = walkMinutes(toStop), walkFrom = walkMinutes(fromStop);
        const ride = rideTimes(route, b.index, a.index, when.day, when.minutes + walkTo);
        if (!ride) continue;
        const arriveMin = ride.arrive.min + walkFrom;
        // Walking minutes count twice when comparing, so a slightly later bus beats a long walk.
        const cost = arriveMin + walkTo + walkFrom;
        if (!best || cost < best.cost) {
          best = {
            cost,
            mode: 'ryde', routeId: route.id, routeName: route.name,
            board: b.name, alight: a.name, walkToMin: walkTo, walkFromMin: walkFrom,
            boardMin: ride.board.min, boardTime: fmtMinutes(ride.board.min),
            offMin: ride.arrive.min, offTime: fmtMinutes(ride.arrive.min),
            arriveMin, arriveTime: fmtMinutes(arriveMin), stopsRidden: ride.stopsRidden,
          };
        }
      }
    }
    if (best) out.push(best);
  }
  return out.sort((x, y) => x.cost - y.cost).slice(0, 2).map(({ cost, ...option }) => option);
}

function transitLink(from, to) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', `${from.lat},${from.lng}`);
  url.searchParams.set('destination', `${to.lat},${to.lng}`);
  url.searchParams.set('travelmode', 'transit');
  return url.toString();
}

// One leg. `when` is {day, minutes} on the Provo service day.
function planLeg(routes, from, to, when) {
  const miles = milesBetween(from, to);
  const walk = { mode: 'walk', miles: Number(miles.toFixed(2)), minutes: walkMinutes(miles) };
  walk.arriveMin = when.minutes + walk.minutes;
  walk.arriveTime = fmtMinutes(walk.arriveMin);
  const ryde = rydeOptions(routes, from, to, when);
  // UTA has no schedule data in this app yet: hand off to a live planner and never state a UTA time.
  const transit = { mode: 'transit', url: transitLink(from, to), allowMin: Math.round(miles * 5) + 15 };
  // Walk when it is short, or when it clearly beats the next bus; otherwise ride; otherwise hand off to UTA.
  let best;
  if (walk.minutes <= EASY_WALK_MIN) best = 'walk';
  else if (ryde[0]) {
    const r = ryde[0];
    const sooner = walk.arriveMin <= r.arriveMin;
    const walkWins = (sooner && walk.minutes <= SHORT_WALK_MIN) ||                          // quicker and not far
      (walk.minutes <= MAX_WALK_MIN && walk.arriveMin + WALK_MARGIN_MIN <= r.arriveMin) ||  // much quicker
      (sooner && r.walkToMin + r.walkFromMin >= walk.minutes - 2);                         // the bus saves no walking
    best = walkWins ? 'walk' : 'ryde';
  }
  else best = walk.minutes <= 25 ? 'walk' : 'transit';
  const arriveMin = best === 'ryde' ? ryde[0].arriveMin : best === 'walk' ? walk.arriveMin : when.minutes + transit.allowMin;
  return {
    from: from.label, to: to.label, departMin: when.minutes, departTime: fmtMinutes(when.minutes),
    best, arriveMin, arriveApprox: best === 'transit', ryde, walk, transit,
  };
}

// A day of stops in order: each leg leaves after the previous arrival plus time spent there.
function planDay(routes, places, when, dwell = DEFAULT_DWELL_MIN) {
  const legs = [];
  let minutes = when.minutes;
  for (let i = 1; i < places.length; i++) {
    const leg = planLeg(routes, places[i - 1], places[i], { day: when.day, minutes });
    legs.push(leg);
    minutes = leg.arriveMin + dwell;
  }
  return { day: when.day, legs, dwellMin: places.length > 2 ? dwell : 0 };
}

module.exports = {
  planLeg, planDay, rydeOptions, serviceMoment, fmtMinutes, milesBetween, walkMinutes, inValley, transitLink,
  MAX_STOP_WALK_MI, DEFAULT_DWELL_MIN, VALLEY,
};
