

BYU-Route-main (12).zip
this is my project. in the route map. the trip distance and trip time isn't showing when you click on a specific route

12:07 AM
Fixed the route summary behavior. Selecting a route now immediately shows a calculating message, then displays the trip distance and time when the route response arrives. If the request can’t run, the panel reports that trip information is unavailable instead of staying hidden.

Download the fixed project

12:08 AM
which files did you change

12:09 AM
I changed one file: route-map.js.

12:09 AM

BYU-Route-main%20(9).zip
its still not working. This is the version that was working before i made changes to the search

12:15 AM
The earlier working version confirms the issue: the trip distance and time fields were no longer being updated. I’ve restored updates to both fields and made the selected route name appear in the panel title.

Changed file: route-map.js

Download the updated project

12:16 AM
which files were updated

12:16 AM
Only route-map.js was updated.

12:16 AM



this
BYU-Route-main
route-map.js
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

    // Give the selected route immediate feedback while Amazon Location is
    // calculating its road distance and travel time.
    const title = el('rydeNavTitle');
    if (title) title.textContent = route.name;
    if (el('rydeNavDistance')) el('rydeNavDistance').textContent = '…';
    if (el('rydeNavTime')) el('rydeNavTime').textContent = '…';
    showSummary(true, `${route.name} · Calculating trip distance and time…`);

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
      showSummary(true, `${route.name} · Trip information unavailable`);
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
    const distanceNode = el('rydeNavDistance');
    const timeNode = el('rydeNavTime');
    const title = el('rydeNavTitle');
    if (title) title.textContent = route.name;

    const unavailable = () => {
      if (distanceNode) distanceNode.textContent = '—';
      if (timeNode) timeNode.textContent = '—';
      return `${route.name} · Trip information unavailable`;
    };

    if (!summary) {
      return unavailable();
    }

    const distance = Number(summary.Distance ?? summary.distance);
    const duration = Number(
      summary.DurationSeconds ??
      summary.Duration ??
      summary.durationSeconds ??
      summary.duration
    );
    const unit = String(
      summary.DistanceUnit ?? summary.distanceUnit ?? 'Kilometers'
    ).toLowerCase();

    if (
      !Number.isFinite(distance) || distance <= 0 ||
      !Number.isFinite(duration) || duration <= 0
    ) {
      console.error(`Invalid route summary for ${route.name}:`, summary);
      return `${route.name} · Trip information unavailable`;
      return unavailable();
    }

    let distanceMiles;

    if (unit === 'miles' || unit === 'mile') {
      distanceMiles = distance;
    } else if (unit === 'meters' || unit === 'meter') {
      distanceMiles = distance / 1609.344;
    } else if (unit === 'kilometers' || unit === 'kilometer' || unit === 'km') {
      distanceMiles = distance / 1.609344;
    } else {
      console.error(`Unknown distance unit for ${route.name}:`, summary);
      return `${route.name} · Trip information unavailable`;
      return unavailable();
    }

    // Reject implausible values instead of displaying misleading mileage.
    if (!Number.isFinite(distanceMiles) || distanceMiles <= 0 || distanceMiles > 100) {
      console.error(`Unexpected distance for ${route.name}:`, summary);
      return `${route.name} · Trip information unavailable`;
      return unavailable();
    }

    return `${route.name} · ${distanceMiles.toFixed(1)} miles · ${Math.max(1, Math.round(duration / 60))} min`;
    const minutes = Math.max(1, Math.round(duration / 60));
    if (distanceNode) distanceNode.textContent = `${distanceMiles.toFixed(1)} mi`;
    if (timeNode) timeNode.textContent = `${minutes} min`;
    return `${route.name} · Trip distance and time`;
  }

  function buildRouteSummary(routeResult) {
    // The Routes API normally supplies one summary for the complete route.
    const routeSummary = routeResult?.Summary || routeResult?.summary;
    if (routeSummary) {
      const routeDistance = Number(routeSummary.Distance ?? routeSummary.distance);
      const routeDuration = Number(
        routeSummary.DurationSeconds ?? routeSummary.Duration ??
        routeSummary.durationSeconds ?? routeSummary.duration
      );
      if (
        Number.isFinite(routeDistance) && routeDistance > 0 &&
        Number.isFinite(routeDuration) && routeDuration > 0
      ) {
        return routeSummary;
      }
    }

    // Some responses expose summary values per leg. Support both nested
    // leg.Summary objects and direct Distance/Duration fields on each leg.
    const legs = routeResult?.Legs || routeResult?.legs || [];
    const values = legs.map(leg => {
      const item = leg?.Summary || leg?.summary || leg;
      return {
        Distance: item?.Distance ?? item?.distance,
        Duration: item?.DurationSeconds ?? item?.Duration ??
          item?.durationSeconds ?? item?.duration,
        DistanceUnit: item?.DistanceUnit ?? item?.distanceUnit ??
          leg?.DistanceUnit ?? leg?.distanceUnit ?? 'Kilometers'
      };
    });

    if (!values.length || values.some(item =>
      !Number.isFinite(Number(item.Distance)) || Number(item.Distance) <= 0 ||
      !Number.isFinite(Number(item.Duration)) || Number(item.Duration) <= 0
    )) {
      return null;
    }

    const units = new Set(values.map(item => String(item.DistanceUnit).toLowerCase()));
    if (units.size !== 1) {
      console.error('Route legs returned mixed distance units:', values);
      return null;
    }

    return {
      Distance: values.reduce((total, item) => total + Number(item.Distance), 0),
      Duration: values.reduce((total, item) => total + Number(item.Duration), 0),
      DistanceUnit: values[0].DistanceUnit
    };
  }

  async function calculateRoadRoute(route, currentRequest, showInfo) {
    if (!route) return;

    if (!route.awsRequest || !apiKey()) {
      if (showInfo && currentRequest === requestId) {
        showSummary(true, `${route.name} · Trip information unavailable`);
      }
      return;
    }

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
            DistanceUnit: 'Kilometers',
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

      // Read the complete route summary first. If it is absent, aggregate
      // valid per-leg summaries or direct per-leg distance/duration values.
      const summary = buildRouteSummary(routeResult);

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
