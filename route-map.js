
Loading older messages…
now the trip time and distance is not working on the routes.
I see what's happening. The trip distance and time are calculated from the AWS response, but the previous change only addressed route geometry. We need to check the response summary separately.

AWS returns:

Distance: in meters.

Duration: in seconds.

Route summary: under Routes[0].Summary or individual leg summaries, depending on the response structure. 

Amazon Location Service
+1

Your current code reads:

const summaries = calculatedRouteCache.get(route.id).summary;

const distance = summaries.reduce(
  (total, summary) => total + (summary?.Distance || 0),
  0
);

const duration = summaries.reduce(
  (total, summary) => total + (summary?.Duration || 0),
  0
);

The problem is that the response may provide DurationSeconds, not Duration.

Replace the summary calculation
Inside calculateRoadRoute(), replace the if (showInfo) block with:

if (showInfo) {
  const routeData = data.Routes?.[0];

  const summaries = routeData?.Legs || [];

  const distance = summaries.reduce(
    (total, leg) =>
      total + (leg?.Summary?.Distance ?? leg?.Distance ?? 0),
    0
  );

  const duration = summaries.reduce(
    (total, leg) =>
      total + (
        leg?.Summary?.Duration ??
        leg?.Summary?.DurationSeconds ??
        leg?.Duration ??
        leg?.DurationSeconds ??
        0
      ),
    0
  );

  const distanceMiles = (distance / 1609.344).toFixed(1);
  const durationMinutes = Math.round(duration / 60);

  showSummary(
    true,
    `${route.name} · ${distanceMiles} miles · ${durationMinutes} min`
  );
}

This handles both common summary structures.

One thing before we change anything else: Test one route, such as Wyview. If the numbers still show as zero or blank, send me the Console response from the AWS request. Then we can match the code to the exact response instead of guessing.

give me the entire code
I'll give you the complete route-map.js with both fixes:

LegGeometryFormat: 'Simple' so AWS returns coordinates your map can draw.

Updated distance and duration handling so the route summary reads the AWS leg summaries correctly.

Your route-data.js waypoints and stop coordinates should remain unchanged.

The important correction is that AWS Routes V2 provides the overall route summary under Routes[0].Summary, not Legs[].Summary. Its distance unit is specified by DistanceUnit, and duration is in seconds. 

Amazon Location Service
+2

I don't want to give you another supposedly complete file that accidentally changes your map or search functionality. Your uploaded route-map.js is the source of truth.

Make these two replacements in that file.

1. Replace the calculatedRouteCache.set section with:

calculatedRouteCache.set(route.id, {
  coordinates,
  summary: data.Routes?.[0]?.Summary || null
});

2. Replace the entire if (showInfo) block with:

if (showInfo) {
  const summary = data.Routes?.[0]?.Summary;

  if (!summary) {
    showSummary(true, `${route.name} · Trip information unavailable`);
    return;
  }

  const distance = summary.Distance || 0;
  const distanceUnit = summary.DistanceUnit || 'Kilometers';
  const duration = summary.Duration || 0;

  const distanceMiles = distanceUnit === 'Kilometers'
    ? distance / 1.609344
    : distanceUnit === 'Meters'
      ? distance / 1609.344
      : distance;

  const durationMinutes = Math.round(duration / 60);

  showSummary(
    true,
    `${route.name} · ${distanceMiles.toFixed(1)} miles · ${durationMinutes} min`
  );
}

This uses AWS's overall route summary, rather than trying to add up individual leg summaries.

Leave everything else unchanged, especially route-data.js and all your waypoint coordinates.


Pasted text(20261108-053514).txt
Document
this is what i have. give me the new code in copy and past form



I reviewed your current route-map.js. The issue is in the trip-summary calculation: your code is looking for distance and duration inside each leg, instead of reading the route-level summary. There’s also a cache issue that can prevent the trip information from appearing when you select a route a second time.

The replacement below keeps your existing map, route tabs, stop markers, AWS place search, and home marker. It changes the route-summary handling and makes sure cached routes still display their trip information.

Replace your entire current route-map.js file with this code. Don't change route-data.js or index.html for this fix.


wheres the codee?
You're right — I accidentally left out the code. Sorry about that.

Here is the complete, updated route-map.js file, ready to copy into your project:

Complete file
Open the updated route-map.js code

Replace your existing route-map.js contents with this file. It preserves your existing map and search functionality while fixing the trip distance/time summary and cached-route display.

I also checked the JavaScript syntax; it passes node --check.


route-map-fixed.js
Code
it doesnt let me downlaod it

Worked for 16s
Sorry about that. Try this plain-text version instead:

Download route-map-fixed.txt

Or try the JavaScript file directly:

Download route-map-fixed.js

If neither link works, tell me and I'll paste the entire code directly into the chat in multiple parts so you can copy it into VS Code.


route-map-fixed.txt
Document

route-map-fixed.js
Code
This might also interest you.








/* BYU Ryde — clean MapLibre route-map implementation.
 * Owns one map instance, one base-route source, one stop source,
 * one calculated-route source, and all route-map event handlers.
 */
(() => {
  'use strict';

  const REGION = 'us-east-2';
  const MAP_CONTAINER = 'routeMap';
  const SOURCE_ROUTES = 'byu-routes';
  const SOURCE_STOPS = 'byu-stops';
  const SOURCE_CALCULATED = 'byu-calculated-route';
  const LAYER_ROUTES = 'byu-route-lines';
  const LAYER_STOPS = 'byu-route-stops';
  const LAYER_CALCULATED = 'byu-calculated-route-line';
  const START = [-111.64585807083019, 40.24776213721756];
  const ROUTES = window.BYU_RYDE_ROUTES || [];

  let map = null;
  let activeRouteId = null;
  let requestId = 0;
  let placeMarkers = [];
  let homeMarker = null;
  let pendingHome = null;
  let suggestTimer = null;
  let suggestRequestId = 0;
  const routeStopMarkers = new Map();
  const calculatedRouteCache = new Map();
  let listenersAttached = false;

  const el = id => document.getElementById(id);
  const apiKey = () => window.BYU_RYDE_AWS_API_KEY || '';

  const routeFeatureCollection = routes => ({
    type: 'FeatureCollection',
    features: routes
      .filter(route => !route.useCalculatedGeometry && route.id !== '104')
      .map(route => ({
        type: 'Feature',
        properties: {
          id: route.id,
          name: route.name,
          color: route.color
        },
        geometry: {
          type: 'LineString',
          coordinates: route.points.map(([lat, lon]) => [lon, lat])
        }
      }))
  });

  const stopFeatureCollection = routes => ({
    type: 'FeatureCollection',
    features: routes
      .filter(route => route.id !== '104' && !route.useCalculatedGeometry)
      .flatMap(route => route.points
        .filter((point, index) =>
          index === 0 ||
          index === route.points.length - 1 ||
          index % 3 === 0
        )
        .map(([lat, lon]) => ({
          type: 'Feature',
          properties: {
            id: route.id,
            color: route.color
          },
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          }
        }))
      )
  });

  function createRouteStopMarkers() {
    if (!map) return;

    ROUTES.filter(route => Array.isArray(route.stops)).forEach(route => {
      if (routeStopMarkers.has(route.id)) return;

      const markers = [];

      route.stops.forEach(stop => {
        const point = route.points[stop.waypoint - 1];
        if (!point) return;

        const [lat, lon] = point;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'king-henry-stop-marker';
        button.setAttribute(
          'aria-label',
          `${stop.label}: student pickup and drop-off`
        );

        const icon = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'svg'
        );
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');

        const path = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'path'
        );
        path.setAttribute(
          'd',
          'M5 16.5V18a1 1 0 0 0 1 1h1v-2.5M17 16.5V19h1a1 1 0 0 0 1-1v-1.5M4 11h16M7 7h.01M17 7h.01M6 3.5h12A2.5 2.5 0 0 1 20.5 6v9A2.5 2.5 0 0 1 18 17.5H6A2.5 2.5 0 0 1 3.5 15V6A2.5 2.5 0 0 1 6 3.5Z'
        );

        icon.appendChild(path);
        button.appendChild(icon);

        const popupContent = document.createElement('div');
        popupContent.className = 'king-henry-popup-content';

        const heading = document.createElement('strong');
        heading.textContent = stop.label;

        const description = document.createElement('span');
        description.textContent = 'Student pickup & drop-off';

        popupContent.append(heading, description);

        const popup = new maplibregl.Popup({
          offset: 24,
          closeButton: true,
          closeOnClick: true,
          className: 'king-henry-popup'
        }).setDOMContent(popupContent);

        const marker = new maplibregl.Marker({
          element: button,
          anchor: 'center'
        })
          .setLngLat([lon, lat])
          .setPopup(popup)
          .addTo(map);

        marker.getElement().style.display = 'none';
        markers.push(marker);
      });

      routeStopMarkers.set(route.id, markers);
    });
  }

  function setRouteStopVisibility(routeId) {
    routeStopMarkers.forEach((markers, id) => {
      markers.forEach(marker => {
        const visible = id === routeId;

        marker.getElement().style.display = visible ? '' : 'none';

        if (!visible) marker.getPopup()?.remove();
      });
    });

    const legend = el('kingHenryStopLegend');

    if (legend) {
      legend.hidden = !routeId || !routeStopMarkers.has(routeId);

      const route = ROUTES.find(item => item.id === routeId);
      const heading = legend.querySelector('strong');

      if (heading && route) {
        heading.textContent = `${route.name} pickup & drop-off`;
      }
    }
  }

  function status(message) {
    const node = el('awsPlaceStatus');
    if (node) node.textContent = message || '';
  }

  function showSummary(show, message) {
    const panel = el('rydeNavPanel');
    if (panel) panel.hidden = !show;

    const summary = el('rydeNavSummary');
    if (summary && message) summary.textContent = message;
  }

  function setSelectedTab(routeId) {
    const tabs = el('routeTabs');
    if (!tabs) return;

    tabs.querySelectorAll('[data-route-id], [data-show-all]')
      .forEach(button => {
        const selected = button.hasAttribute('data-show-all')
          ? !routeId
          : button.dataset.routeId === routeId;

        button.setAttribute('aria-selected', String(selected));
      });
  }

  function addOrUpdateSource(sourceId, data) {
    const existing = map.getSource(sourceId);

    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data
      });
    }
  }

  function ensureBaseLayers() {
    addOrUpdateSource(
      SOURCE_ROUTES,
      routeFeatureCollection(ROUTES)
    );

    addOrUpdateSource(
      SOURCE_STOPS,
      stopFeatureCollection(ROUTES)
    );

    if (!map.getLayer(LAYER_ROUTES)) {
      map.addLayer({
        id: LAYER_ROUTES,
        type: 'line',
        source: SOURCE_ROUTES,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 5,
          'line-opacity': 0.92
        }
      });
    }

    if (!map.getLayer(LAYER_STOPS)) {
      map.addLayer({
        id: LAYER_STOPS,
        type: 'circle',
        source: SOURCE_STOPS,
        paint: {
          'circle-radius': 4,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2
        }
      });
    }
  }

  function removeCalculatedRoute() {
    if (!map) return;

    if (map.getLayer(LAYER_CALCULATED)) {
      map.removeLayer(LAYER_CALCULATED);
    }

    if (map.getSource(SOURCE_CALCULATED)) {
      map.removeSource(SOURCE_CALCULATED);
    }
  }

  function renderCalculatedRoutes(routeIds) {
    if (!map) return;

    const features = routeIds.flatMap(id => {
      const route = ROUTES.find(item => item.id === id);
      const cached = calculatedRouteCache.get(id);

      if (!route || !cached || cached.coordinates.length < 2) {
        return [];
      }

      return [{
        type: 'Feature',
        properties: {
          id: route.id,
          name: route.name,
          color: route.color
        },
        geometry: {
          type: 'LineString',
          coordinates: cached.coordinates
        }
      }];
    });

    const data = {
      type: 'FeatureCollection',
      features
    };

    const existing = map.getSource(SOURCE_CALCULATED);

    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(SOURCE_CALCULATED, {
        type: 'geojson',
        data
      });
    }

    if (!map.getLayer(LAYER_CALCULATED)) {
      map.addLayer({
        id: LAYER_CALCULATED,
        type: 'line',
        source: SOURCE_CALCULATED,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 7,
          'line-opacity': 0.98
        }
      });
    }
  }

  function fitToRoutes(routes) {
    const coordinates = routes.flatMap(route =>
      route.points.map(([lat, lon]) => [lon, lat])
    );

    if (!coordinates.length) return;

    const bounds = coordinates.reduce(
      (result, point) => result.extend(point),
      new maplibregl.LngLatBounds(
        coordinates[0],
        coordinates[0]
      )
    );

    map.fitBounds(bounds, {
      padding: {
        top: 75,
        bottom: 120,
        left: 30,
        right: 30
      },
      maxZoom: 15,
      duration: 600
    });
  }

  function renderTabs() {
    const tabs = el('routeTabs');
    if (!tabs) return;

    tabs.innerHTML =
      '<button class="route-tab show-all-routes" type="button" data-show-all aria-selected="true">Show all routes</button>' +
      ROUTES.map(route =>
        `<button class="route-tab" type="button" data-route-id="${route.id}" style="--route:${route.color}" aria-selected="false"><span class="route-line"></span><span>${route.name}</span></button>`
      ).join('');
  }

  function showAllRoutes() {
    if (!map || !map.isStyleLoaded()) return;

    requestId++;
    activeRouteId = null;

    showSummary(false);
    setSelectedTab(null);
    setRouteStopVisibility(null);
    ensureBaseLayers();

    map.setFilter(LAYER_ROUTES, null);
    map.setFilter(LAYER_STOPS, null);

    fitToRoutes(ROUTES);

    const calculatedRoutes = ROUTES.filter(
      route => route.useCalculatedGeometry || route.id === '104'
    );

    renderCalculatedRoutes([...calculatedRouteCache.keys()]);

    calculatedRoutes
      .filter(route => !calculatedRouteCache.has(route.id))
      .forEach(route =>
        calculateRoadRoute(route, requestId, false)
      );
  }

  async function selectRoute(routeId) {
    const route = ROUTES.find(item => item.id === routeId);

    if (!route || !map || !map.isStyleLoaded()) return;

    activeRouteId = routeId;
    setSelectedTab(routeId);
    setRouteStopVisibility(routeId);

    requestId++;

    removeCalculatedRoute();
    ensureBaseLayers();

    map.setFilter(
      LAYER_ROUTES,
      ['==', ['get', 'id'], routeId]
    );

    map.setFilter(
      LAYER_STOPS,
      ['==', ['get', 'id'], routeId]
    );

    fitToRoutes([route]);

    if (route.useCalculatedGeometry || route.id === '104') {
      await calculateRoadRoute(route, requestId, true);
    } else {
      showSummary(false);
    }
  }

  function readRouteGeometry(data) {
    const legs = data?.Routes?.[0]?.Legs || [];
    const coordinates = [];

    for (const leg of legs) {
      const line = leg?.Geometry?.LineString;

      if (Array.isArray(line)) {
        for (const point of line) {
          if (Array.isArray(point) && point.length >= 2) {
            coordinates.push(point);
          }
        }
      }
    }

    return coordinates;
  }

  function formatRouteSummary(route, summary) {
    if (!summary) {
      return `${route.name} · Trip information unavailable`;
    }

    const distance = Number(summary.Distance);
    const duration = Number(summary.Duration);
    const unit = summary.DistanceUnit || 'Kilometers';

    if (!Number.isFinite(distance) || !Number.isFinite(duration)) {
      return `${route.name} · Trip information unavailable`;
    }

    let distanceMiles;

    if (unit === 'Miles') {
      distanceMiles = distance;
    } else if (unit === 'Meters') {
      distanceMiles = distance / 1609.344;
    } else {
      // Amazon Location Routes commonly reports distance in kilometers.
      distanceMiles = distance / 1.609344;
    }

    return `${route.name} · ${distanceMiles.toFixed(1)} miles · ${Math.round(duration / 60)} min`;
  }

  async function calculateRoadRoute(route, currentRequest, showInfo) {
    if (!route?.awsRequest || !apiKey()) return;

    if (calculatedRouteCache.has(route.id)) {
      const cached = calculatedRouteCache.get(route.id);

      renderCalculatedRoutes(
        activeRouteId ? [route.id] : [...calculatedRouteCache.keys()]
      );

      if (showInfo && currentRequest === requestId) {
        showSummary(true, formatRouteSummary(route, cached.summary));
      }

      return;
    }

    try {
      const response = await fetch(
        `https://routes.geo.${REGION}.amazonaws.com/v2/routes?key=${encodeURIComponent(apiKey())}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...route.awsRequest,
            LegGeometryFormat: 'Simple',
            Origin: route.awsRequest.Origin,
            Destination: route.awsRequest.Destination,
            TravelMode: route.awsRequest.TravelMode || 'Car',
            OptimizeRoutingFor:
              route.awsRequest.OptimizeRoutingFor || 'FastestRoute',
            Traffic: route.awsRequest.Traffic || {
              Usage: 'UseTrafficData'
            },
            TravelStepType:
              route.awsRequest.TravelStepType || 'TurnByTurn',
            Instructions: true,
            LegAdditionalFeatures: ['Summary']
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
          data.Message ||
          `Amazon Routes returned HTTP ${response.status}.`
        );
      }

      const routeResult = data.Routes?.[0];
      const coordinates = readRouteGeometry(data);

      if (coordinates.length < 2) {
        throw new Error('AWS did not return usable route geometry.');
      }

      // Prefer the route-level summary. Fall back to adding leg summaries
      // when the response only contains per-leg summary data.
      let summary = routeResult?.Summary || null;

      if (!summary) {
        const legSummaries = (routeResult?.Legs || [])
          .map(leg => leg.Summary)
          .filter(Boolean);

        if (legSummaries.length) {
          summary = {
            Distance: legSummaries.reduce(
              (total, item) => total + (Number(item.Distance) || 0),
              0
            ),
            Duration: legSummaries.reduce(
              (total, item) => total + (Number(item.Duration) || 0),
              0
            ),
            DistanceUnit: legSummaries[0].DistanceUnit || 'Kilometers'
          };
        }
      }

      calculatedRouteCache.set(route.id, {
        coordinates,
        summary
      });

      if (currentRequest !== requestId) return;

      const visibleIds = activeRouteId
        ? [activeRouteId]
        : [...calculatedRouteCache.keys()];

      renderCalculatedRoutes(visibleIds);

      if (showInfo) {
        showSummary(true, formatRouteSummary(route, summary));
      }
    } catch (error) {
      console.error(`Could not calculate ${route.name} route:`, error);

      if (currentRequest === requestId && showInfo) {
        showSummary(true, `Unable to calculate ${route.name} right now.`);
      }
    }
  }

  function clearPlaceMarkers() {
    placeMarkers.forEach(marker => marker.remove());
    placeMarkers = [];
  }

  function displayPlaces(results) {
    if (!map) return;

    clearPlaceMarkers();

    const bounds = new maplibregl.LngLatBounds();
    let markerCount = 0;

    (results || []).forEach((item, index) => {
      const place = item.Place || item;
      const position = place.Position || item.Position;

      if (!Array.isArray(position) || position.length < 2) return;

      const [lng, lat] = position;

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      const title =
        place.Title ||
        item.Title ||
        place.Address?.Label ||
        `Place ${index + 1}`;

      const marker = new maplibregl.Marker({
        color: '#d62828'
      })
        .setLngLat([lng, lat])
        .setPopup(
          new maplibregl.Popup({ offset: 24 }).setText(title)
        )
        .addTo(map);

      placeMarkers.push(marker);
      bounds.extend([lng, lat]);
      markerCount++;
    });

    if (markerCount) {
      status(`${markerCount} location${markerCount === 1 ? '' : 's'} found.`);
    } else {
      status('No locations with map coordinates were found.');
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: 70,
        maxZoom: 16
      });
    }
  }

  function clearSuggestions() {
    const list = el('awsPlaceSuggestions');

    if (list) {
      list.replaceChildren();
      list.hidden = true;
    }
  }

  function renderSuggestions(items, query, thisRequest) {
    const list = el('awsPlaceSuggestions');

    if (!list || thisRequest !== suggestRequestId) return;

    list.replaceChildren();

    const placeItems = (items || []).filter(
      item => item.Place?.PlaceId || item.PlaceId
    );

    if (!placeItems.length) {
      const message = document.createElement('div');
      message.className = 'suggestion-message';
      message.textContent = items?.length
        ? 'No selectable places found. Try a more specific search.'
        : 'No matching places found.';

      list.appendChild(message);
      list.hidden = false;
      return;
    }

    placeItems.forEach(item => {
      const place = item.Place || item;
      const placeId = place.PlaceId || item.PlaceId;

      const title =
        item.Title ||
        place.Title ||
        place.Address?.Label ||
        'Suggested place';

      const address = place.Address?.Label || '';

      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');

      const titleNode = document.createElement('span');
      titleNode.textContent = title;
      button.appendChild(titleNode);

      if (address && address !== title) {
        const addressNode = document.createElement('small');
        addressNode.textContent = address;
        button.appendChild(addressNode);
      }

      button.addEventListener('click', () =>
        selectSuggestedPlace(placeId, title)
      );

      list.appendChild(button);
    });

    list.hidden = false;
  }

  async function requestSuggestions(query) {
    const thisRequest = ++suggestRequestId;

    if (!map || query.length < 2) {
      clearSuggestions();
      return;
    }

    const list = el('awsPlaceSuggestions');

    if (list) {
      list.replaceChildren();

      const loading = document.createElement('div');
      loading.className = 'suggestion-message';
      loading.textContent = 'Finding places…';

      list.appendChild(loading);
      list.hidden = false;
    }

    try {
      if (!apiKey()) {
        throw new Error('Amazon Location API key is missing.');
      }

      const response = await fetch(
        `https://places.geo.${REGION}.amazonaws.com/v2/suggest?key=${encodeURIComponent(apiKey())}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            QueryText: query,
            BiasPosition: map.getCenter().toArray(),
            MaxResults: 6,
            AdditionalFeatures: ['Core'],
            IntendedUse: 'SingleUse'
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
          data.Message ||
          `Amazon Suggest returned HTTP ${response.status}.`
        );
      }

      if (thisRequest !== suggestRequestId) return;

      renderSuggestions(
        data.ResultItems || [],
        query,
        thisRequest
      );
    } catch (error) {
      if (thisRequest !== suggestRequestId) return;

      console.error('Amazon Location suggestions failed:', error);

      if (list) {
        list.replaceChildren();

        const message = document.createElement('div');
        message.className = 'suggestion-message';
        message.textContent =
          error.message || 'Unable to load suggestions.';

        list.appendChild(message);
        list.hidden = false;
      }
    }
  }

  async function selectSuggestedPlace(placeId, fallbackTitle) {
    if (!placeId) return;

    clearSuggestions();
    status('Loading place details…');

    try {
      if (!apiKey()) {
        throw new Error('Amazon Location API key is missing.');
      }

      const response = await fetch(
        `https://places.geo.${REGION}.amazonaws.com/v2/place/${encodeURIComponent(placeId)}?key=${encodeURIComponent(apiKey())}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        }
      );

      const place = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          place.message ||
          place.Message ||
          `Amazon GetPlace returned HTTP ${response.status}.`
        );
      }

      if (!Array.isArray(place.Position) || place.Position.length < 2) {
        throw new Error(
          'AWS returned place details without map coordinates.'
        );
      }

      if (!place.Title) {
        place.Title =
          fallbackTitle ||
          place.Address?.Label ||
          'Selected place';
      }

      displayPlaces([place]);

      map.flyTo({
        center: place.Position,
        zoom: 16,
        essential: true
      });
    } catch (error) {
      console.error('Amazon GetPlace failed:', error);

      status(
        error.message || 'Unable to load the selected place.'
      );
    }
  }

  async function searchPlaces(nearby = false) {
    if (!map) return;

    const query = el('awsPlaceQuery')?.value.trim() || '';

    if (!nearby && !query) return;

    clearSuggestions();

    status(
      nearby
        ? 'Searching nearby places…'
        : 'Searching places…'
    );

    try {
      const endpoint = nearby
        ? 'search-nearby'
        : 'search-text';

      const body = nearby
        ? {
            QueryPosition: map.getCenter().toArray(),
            MaxResults: 10
          }
        : {
            QueryText: query,
            BiasPosition: map.getCenter().toArray(),
            MaxResults: 8
          };

      const response = await fetch(
        `https://places.geo.${REGION}.amazonaws.com/v2/${endpoint}?key=${encodeURIComponent(apiKey())}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
          `Amazon Places returned HTTP ${response.status}.`
        );
      }

      displayPlaces(data.Results || data.ResultItems || []);
    } catch (error) {
      console.error('Amazon Places search failed:', error);

      status(error.message || 'Unable to search places.');
    }
  }

  function showHome(place) {
    pendingHome = place || null;

    if (!map) return;

    if (homeMarker) {
      homeMarker.remove();
      homeMarker = null;
    }

    if (!place) return;

    const lng = Number(place.lng);
    const lat = Number(place.lat);

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    homeMarker = new maplibregl.Marker({
      color: '#002e5d'
    })
      .setLngLat([lng, lat])
      .setPopup(
        new maplibregl.Popup({ offset: 24 })
          .setText(`Home · ${place.label || ''}`)
      )
      .addTo(map);
  }

  function attachEvents() {
    if (listenersAttached) return;

    listenersAttached = true;

    const tabs = el('routeTabs');

    tabs?.addEventListener('click', event => {
      const button = event.target.closest(
        '[data-show-all], [data-route-id]'
      );

      if (!button) return;

      if (button.hasAttribute('data-show-all')) {
        showAllRoutes();
      } else {
        selectRoute(button.dataset.routeId);
      }
    });

    el('rydeNavClose')?.addEventListener('click', () =>
      showSummary(false)
    );

    el('awsPlaceSearch')?.addEventListener('click', () =>
      searchPlaces(false)
    );

    el('awsNearbySearch')?.addEventListener('click', () =>
      searchPlaces(true)
    );

    el('awsPlaceQuery')?.addEventListener('input', event => {
      const query = event.target.value.trim();

      clearTimeout(suggestTimer);

      if (query.length < 2) {
        suggestRequestId++;
        clearSuggestions();
        return;
      }

      suggestTimer = setTimeout(
        () => requestSuggestions(query),
        250
      );
    });

    el('awsPlaceQuery')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        const firstSuggestion = el('awsPlaceSuggestions')
          ?.querySelector('button[role="option"]');

        if (
          firstSuggestion &&
          !el('awsPlaceSuggestions')?.hidden
        ) {
          event.preventDefault();
          firstSuggestion.click();
        } else {
          searchPlaces(false);
        }
      }

      if (event.key === 'Escape') {
        clearSuggestions();
      }
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('.aws-place-search')) {
        clearSuggestions();
      }
    });
  }

  function initialize() {
    if (map) {
      map.resize();
      return;
    }

    if (!window.maplibregl) {
      status(
        'MapLibre failed to load. Refresh the page and try again.'
      );
      return;
    }

    if (!apiKey()) {
      status('Amazon Location API key is missing.');
      return;
    }

    renderTabs();
    attachEvents();

    const style =
      `https://maps.geo.${REGION}.amazonaws.com/v2/styles/Standard/descriptor?key=${encodeURIComponent(apiKey())}&color-scheme=Light`;

    map = new maplibregl.Map({
      container: MAP_CONTAINER,
      style,
      center: START,
      zoom: 14.5,
      attributionControl: true
    });

    window.rydeMap = map;

    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: false,
        visualizePitch: false
      }),
      'top-right'
    );

    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true
        },
        trackUserLocation: true,
        showUserHeading: true
      }),
      'top-right'
    );

    map.on('load', () => {
      ensureBaseLayers();
      createRouteStopMarkers();
      showHome(pendingHome);

      map.on('click', LAYER_ROUTES, event => {
        const id = event.features?.[0]?.properties?.id;

        if (id) selectRoute(id);
      });

      showAllRoutes();
      map.resize();
    });

    map.on('error', event => {
      if (event.error) {
        console.error('BYU Ryde map error:', event.error);
      }
    });
  }

  // Compatibility entry points used by the existing application shell.
  window.initRydeRouteMap = initialize;
  window.resizeRydeMap = () => {
    if (map) map.resize();
  };
  window.clearRydePlaceResults = clearPlaceMarkers;
  window.showRydeHome = showHome;
})();
