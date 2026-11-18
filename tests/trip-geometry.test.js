const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const routeDataSource = fs.readFileSync('public/js/route-data.js', 'utf8');
const routeMapSource = fs.readFileSync('public/js/route-map.js', 'utf8');
const appSource = fs.readFileSync('public/js/app.js', 'utf8');

const dataContext = { window: {} };
vm.runInNewContext(routeDataSource, dataContext);
const routes = dataContext.window.BYU_RYDE_ROUTES;

const geometryFunctions = routeMapSource.slice(
  routeMapSource.indexOf('  function tripPointRange('),
  routeMapSource.indexOf('  async function selectTrip(')
);
const geometryContext = {};
vm.createContext(geometryContext);
vm.runInContext(
  `${geometryFunctions}\nthis.tripPointRange = tripPointRange; this.tripCoordinates = tripCoordinates; this.tripStopWaypoints = tripStopWaypoints;`,
  geometryContext
);

const markerFunctionStart = appSource.indexOf('function tripMapStopIndexes(');
const markerFunctionEnd = appSource.indexOf('function googleMapsWalkLink(', markerFunctionStart);
const markerContext = {};
vm.createContext(markerContext);
vm.runInContext(
  `${appSource.slice(markerFunctionStart, markerFunctionEnd)}\nthis.tripMapStopIndexes = tripMapStopIndexes;`,
  markerContext
);

const distanceFunctionStart = routeMapSource.indexOf('  function routePointDistanceMiles(');
const distanceFunctionEnd = routeMapSource.indexOf('  function formatRouteSummary(', distanceFunctionStart);
const distanceContext = {};
vm.createContext(distanceContext);
vm.runInContext(
  `${routeMapSource.slice(distanceFunctionStart, distanceFunctionEnd)}\nthis.routePointDistanceMiles = routePointDistanceMiles; this.approximateMinutesFromDistance = approximateMinutesFromDistance;`,
  distanceContext
);
const summaryFunctionStart = routeMapSource.indexOf('  function formatRouteSummary(');
const summaryFunctionEnd = routeMapSource.indexOf('  function buildRouteSummary(', summaryFunctionStart);
const approximateFunctionStart = routeMapSource.indexOf('  function approximateMinutesFromDistance(');
const approximateFunctionEnd = routeMapSource.indexOf('  function formatRouteSummary(', approximateFunctionStart);
const summaryNodes = new Map([
  ['rydeNavDistance', { textContent: '' }],
  ['rydeNavTime', { textContent: '' }],
  ['rydeNavTitle', { textContent: '' }]
]);
const summaryContext = { el: id => summaryNodes.get(id), console };
vm.createContext(summaryContext);
vm.runInContext(
  `${routeMapSource.slice(approximateFunctionStart, approximateFunctionEnd)}\n${routeMapSource.slice(summaryFunctionStart, summaryFunctionEnd)}\nthis.formatRouteSummary = formatRouteSummary;`,
  summaryContext
);

const routeCases = [
  { id: '101', name: 'West', stopPointIndexes: [2, 3, 0] },
  { id: '102', name: 'Wyview', stopPointIndexes: [2, 3, 0] },
  { id: '103', name: 'Branbury', stopPointIndexes: [3, 4, 0] },
  { id: '104', name: 'King Henry', stopPointIndexes: [4, 5, 0] },
  { id: '105', name: 'South/Joaquin', stopPointIndexes: [2, 3, 0] },
  { id: '106', name: 'Heritage Overflow Parking', stopPointIndexes: [1, 2, 0] },
  { id: '107', name: 'Wymount', stopPointIndexes: [1, 3, 0] }
];

const toCampusMarkers = board => Array.from({ length: 3 - board }, (_, index) => board + index);
const fromCampusMarkers = destination => [2, ...Array.from({ length: 2 - destination }, (_, index) => 1 - index)];
const pointSequence = (origin, destination) => {
  const step = origin < destination ? 1 : -1;
  const points = [];
  for (let index = origin; ; index += step) {
    points.push(index);
    if (index === destination) return points;
  }
};

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkTrip(route, trip, expectedIndexes, expectedMarkerIndexes, visibleWaypoints) {
  const range = geometryContext.tripPointRange(route, trip);
  assert.ok(range, `${route.name} ${trip.direction} trip has a valid point range`);
  const request = geometryContext.tripCoordinates(route, trip, range);
  const actualCoordinates = [
    request.Origin,
    ...request.Waypoints.map(waypoint => waypoint.Position),
    request.Destination
  ];
  const expectedCoordinates = expectedIndexes.map(index => {
    const [lat, lon] = route.points[index];
    return [lon, lat];
  });
  assert.deepEqual(plain(actualCoordinates), expectedCoordinates, `${route.name} ${trip.direction} road points and direction`);

  const selectedMarkers = route.stops.filter(stop => visibleWaypoints.has(Number(stop.waypoint)));
  assert.deepEqual(
    plain(selectedMarkers.map(stop => Number(stop.scheduleIndex)).sort((a, b) => a - b)),
    expectedMarkerIndexes.slice().sort((a, b) => a - b),
    `${route.name} ${trip.direction} passenger markers`
  );
  for (const stop of selectedMarkers) {
    const [lat, lon] = route.points[Number(stop.waypoint) - 1];
    const endpointOrInteriorIsOnSegment = expectedCoordinates.some(([x, y]) => x === lon && y === lat);
    assert.ok(endpointOrInteriorIsOnSegment, `${route.name} marker ${stop.label} matches the selected trip geometry`);
  }
}

test('View Trip uses schedule mappings, bounded road geometry, and relevant markers for all routes', async t => {
  assert.equal(routes.length, 7);

  for (const routeCase of routeCases) {
    await t.test(`${routeCase.id} ${routeCase.name}`, async routeTest => {
      const route = routes.find(item => String(item.id) === routeCase.id);
      assert.ok(route, 'route exists in source data');
      assert.deepEqual(route.points[0], route.points.at(-1), 'route has a closing point at its starting location');

      const scheduledStops = routeCase.stopPointIndexes.map((pointIndex, scheduleIndex) => {
        const stop = route.stops.find(item => Number(item.scheduleIndex) === scheduleIndex);
        assert.ok(stop, `schedule index ${scheduleIndex} has a geographic stop mapping`);
        assert.equal(Number(stop.waypoint) - 1, pointIndex, `${stop.label} maps to route.points[${pointIndex}]`);
        return stop;
      });
      assert.equal(Number(scheduledStops.at(-1).scheduleIndex), 2, 'highest schedule index is the campus endpoint');

      const scheduleRoute = { stops: [{}, {}, {}], toCampus: [0, 1] };
      const trips = [
        {
          label: 'to campus from first stop',
          trip: { routeId: routeCase.id, direction: 'to', board: 0, dest: 2 },
          pointIndexes: pointSequence(routeCase.stopPointIndexes[0], route.points.length - 1),
          markerIndexes: toCampusMarkers(0)
        },
        {
          label: 'home to first stop',
          trip: { routeId: routeCase.id, direction: 'from', board: 2, dest: 0 },
          pointIndexes: pointSequence(route.points.length - 1, routeCase.stopPointIndexes[0]),
          markerIndexes: fromCampusMarkers(0)
        },
        {
          label: 'to campus boarding at the intermediate stop',
          trip: { routeId: routeCase.id, direction: 'to', board: 1, dest: 2 },
          pointIndexes: pointSequence(routeCase.stopPointIndexes[1], route.points.length - 1),
          markerIndexes: toCampusMarkers(1)
        },
        {
          label: 'home ending at the intermediate stop',
          trip: { routeId: routeCase.id, direction: 'from', board: 2, dest: 1 },
          pointIndexes: pointSequence(route.points.length - 1, routeCase.stopPointIndexes[1]),
          markerIndexes: fromCampusMarkers(1)
        }
      ];

      for (const scenario of trips) {
        await routeTest.test(scenario.label, () => {
          const trip = scenario.trip;
          const scheduledMarkerIndexes = markerContext.tripMapStopIndexes(scheduleRoute, {
            d: trip.direction,
            board: trip.board,
            dest: trip.dest
          });
          assert.deepEqual(plain(scheduledMarkerIndexes), scenario.markerIndexes, 'app selects only stops traveled in this trip');
          const selectedTrip = { ...trip, stopIndexes: scheduledMarkerIndexes };
          const visibleWaypoints = geometryContext.tripStopWaypoints(route, selectedTrip);
          const expectedVisibleWaypoints = route.stops
            .filter(stop => scenario.markerIndexes.includes(Number(stop.scheduleIndex)))
            .map(stop => Number(stop.waypoint)).sort((a, b) => a - b);
          assert.deepEqual(plain([...visibleWaypoints].sort((a, b) => a - b)), plain(expectedVisibleWaypoints), 'map displays only the scheduled passenger stops');
          checkTrip(route, trip, scenario.pointIndexes, scenario.markerIndexes, visibleWaypoints);
        });
      }
    });
  }
});

test('normal full-route map still uses every route point and the complete AWS route request', () => {
  const fitStart = routeMapSource.indexOf('function fitToRoutes(');
  const fitEnd = routeMapSource.indexOf('function renderTabs(', fitStart);
  assert.match(routeMapSource.slice(fitStart, fitEnd), /route\.points\.map/);
  assert.match(routeMapSource, /function showAllRoutes\(\)[\s\S]*?fitToRoutes\(ROUTES\)/);

  const calculateStart = routeMapSource.indexOf('async function calculateRoadRoute(');
  const calculateEnd = routeMapSource.indexOf('function clearPlaceMarkers(', calculateStart);
  assert.match(routeMapSource.slice(calculateStart, calculateEnd), /\.\.\.route\.awsRequest/);
});

test('trip time no longer receives schedule-derived minutes and distance fallback stays monotonic', async t => {
  assert.doesNotMatch(appSource, /scheduledRideMinutes|data-estimated-minutes|estimatedMinutes/);
  assert.match(routeMapSource, /formatRouteSummary\(route, summary, tripDistanceMiles\)/);
  assert.match(routeMapSource, /LegAdditionalFeatures: \['Summary'\]/);

  summaryNodes.get('rydeNavDistance').textContent = '';
  summaryNodes.get('rydeNavTime').textContent = '';
  const apiLabel = summaryContext.formatRouteSummary(
    { name: 'Test route' },
    { Distance: 1609.344, DurationSeconds: 480, DistanceUnit: 'Meters' },
    2
  );
  assert.equal(summaryNodes.get('rydeNavDistance').textContent, '1.0 mi');
  assert.equal(summaryNodes.get('rydeNavTime').textContent, '~8 min');
  assert.match(apiLabel, /Approximate travel time/);

  summaryNodes.get('rydeNavDistance').textContent = '';
  summaryNodes.get('rydeNavTime').textContent = '';
  const fallbackLabel = summaryContext.formatRouteSummary({ name: 'Test route' }, null, 2);
  assert.equal(summaryNodes.get('rydeNavDistance').textContent, '2.0 mi');
  assert.equal(summaryNodes.get('rydeNavTime').textContent, '~7 min');
  assert.match(fallbackLabel, /route distance/);

  for (const routeCase of routeCases) {
    await t.test(`${routeCase.id} ${routeCase.name}`, () => {
      const route = routes.find(item => String(item.id) === routeCase.id);
      const inboundFull = geometryContext.tripPointRange(route, {
        direction: 'to', board: 0, dest: 2
      });
      const inboundIntermediate = geometryContext.tripPointRange(route, {
        direction: 'to', board: 1, dest: 2
      });
      const returnFull = geometryContext.tripPointRange(route, {
        direction: 'from', board: 2, dest: 0
      });
      const returnIntermediate = geometryContext.tripPointRange(route, {
        direction: 'from', board: 2, dest: 1
      });

      for (const [full, segment, label] of [
        [inboundFull, inboundIntermediate, 'inbound'],
        [returnFull, returnIntermediate, 'return']
      ]) {
        const fullDistance = distanceContext.routePointDistanceMiles(route, full);
        const segmentDistance = distanceContext.routePointDistanceMiles(route, segment);
        assert.ok(segmentDistance > 0 && segmentDistance < fullDistance, `${label} intermediate segment is shorter than full route`);
        const fullMinutes = distanceContext.approximateMinutesFromDistance(fullDistance);
        const segmentMinutes = distanceContext.approximateMinutesFromDistance(segmentDistance);
        assert.ok(segmentMinutes <= fullMinutes, `${label} intermediate segment estimate does not exceed full-route estimate`);
      }
    });
  }
});
