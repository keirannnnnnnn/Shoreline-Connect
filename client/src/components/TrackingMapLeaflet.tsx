import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { TrackedItem, JourneyPoint } from '../types/index.js';

interface TrackingMapLeafletProps {
  items: TrackedItem[];
  selectedItem: TrackedItem | null;
  onSelectItem: (item: TrackedItem) => void;
  playbackRoutePoints: JourneyPoint[] | null;
  playbackCurrentPoint: JourneyPoint | null;
  isPlaybackActive: boolean;
}

export const TrackingMapLeaflet: React.FC<TrackingMapLeafletProps> = ({
  items,
  selectedItem,
  onSelectItem,
  playbackRoutePoints,
  playbackCurrentPoint,
  isPlaybackActive,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const playbackMarkerRef = useRef<L.Marker | null>(null);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([51.505, -0.09], 12);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Dark Matter tile layer for sleek dark theme
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Render Tracked Items Live Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    // If route playback is active, hide live markers
    if (isPlaybackActive) return;

    const bounds: L.LatLngExpression[] = [];

    items.forEach((item) => {
      if (item.last_lat === null || item.last_lng === null) return;

      const isSelected = selectedItem?.id === item.id;
      const isVehicle = item.category === 'Vehicles';
      const isMoving = item.status === 'moving';

      const iconHtml = `
        <div class="relative flex items-center justify-center cursor-pointer transition-transform transform ${isSelected ? 'scale-125 z-50' : 'hover:scale-110'}">
          <div class="w-10 h-10 rounded-2xl flex items-center justify-center shadow-xl border-2 transition-all ${
            isSelected
              ? 'bg-brand-600 border-white text-white shadow-brand-500/50 ring-4 ring-brand-500/30'
              : isMoving
              ? 'bg-emerald-600 border-emerald-300 text-white shadow-emerald-900/50 animate-pulse'
              : 'bg-slate-800 border-slate-600 text-slate-300 shadow-black/60'
          }">
            <span class="text-xs font-bold">${isVehicle ? '🚗' : '📱'}</span>
          </div>
          ${
            item.last_heading !== null && isMoving
              ? `<div class="absolute -top-2 w-3 h-3 bg-white rounded-full border border-slate-900 transform rotate-${Math.round(item.last_heading)} shadow"></div>`
              : ''
          }
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-leaflet-marker',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      const marker = L.marker([item.last_lat, item.last_lng], { icon: customIcon });

      marker.on('click', () => {
        onSelectItem(item);
      });

      marker.bindTooltip(
        `<div class="font-sans text-xs">
          <div class="font-bold text-slate-100">${item.name}</div>
          <div class="text-slate-400 capitalize">${item.status} ${item.last_speed ? `• ${Math.round(item.last_speed)} km/h` : ''}</div>
        </div>`,
        { direction: 'top', offset: [0, -20], className: 'custom-leaflet-tooltip' }
      );

      markersLayer.addLayer(marker);
      bounds.push([item.last_lat, item.last_lng]);
    });

    if (bounds.length > 0 && !selectedItem) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [60, 60], maxZoom: 15 });
    } else if (selectedItem && selectedItem.last_lat !== null && selectedItem.last_lng !== null) {
      map.setView([selectedItem.last_lat, selectedItem.last_lng], 15, { animate: true });
    }
  }, [items, selectedItem, isPlaybackActive, onSelectItem]);

  // 3. Render Route Polylines & Animated Playback Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;

    routeLayer.clearLayers();

    if (!playbackRoutePoints || playbackRoutePoints.length === 0) return;

    const latLngs = playbackRoutePoints.map((p) => [p.latitude, p.longitude] as [number, number]);

    // Draw route segments color-coded by speeding
    for (let i = 0; i < playbackRoutePoints.length - 1; i++) {
      const p1 = playbackRoutePoints[i];
      const p2 = playbackRoutePoints[i + 1];
      const isSpeeding = p1.is_speeding || p2.is_speeding;

      const segment = L.polyline(
        [
          [p1.latitude, p1.longitude],
          [p2.latitude, p2.longitude],
        ],
        {
          color: isSpeeding ? '#ef4444' : '#06b6d4',
          weight: isSpeeding ? 6 : 5,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round',
        }
      );
      routeLayer.addLayer(segment);
    }

    // Start & End markers
    const startPoint = playbackRoutePoints[0];
    const endPoint = playbackRoutePoints[playbackRoutePoints.length - 1];

    const startMarker = L.circleMarker([startPoint.latitude, startPoint.longitude], {
      radius: 6,
      fillColor: '#10b981',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 1,
    }).bindTooltip('Start', { permanent: false, direction: 'top' });

    const endMarker = L.circleMarker([endPoint.latitude, endPoint.longitude], {
      radius: 6,
      fillColor: '#ef4444',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 1,
    }).bindTooltip('Finish', { permanent: false, direction: 'top' });

    routeLayer.addLayer(startMarker);
    routeLayer.addLayer(endMarker);

    map.fitBounds(L.latLngBounds(latLngs), { padding: [80, 80] });
  }, [playbackRoutePoints]);

  // 4. Update Moving Playback Vehicle Marker & HUD Position
  useEffect(() => {
    const map = mapInstanceRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;

    if (!playbackCurrentPoint) {
      if (playbackMarkerRef.current) {
        routeLayer.removeLayer(playbackMarkerRef.current);
        playbackMarkerRef.current = null;
      }
      return;
    }

    const { latitude, longitude, heading, is_speeding } = playbackCurrentPoint;

    const vehicleIconHtml = `
      <div class="relative flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2">
        <div class="w-12 h-12 rounded-2xl bg-brand-600 border-2 border-white shadow-2xl flex items-center justify-center text-white ring-4 ${
          is_speeding ? 'ring-red-500/50 bg-red-600' : 'ring-brand-500/40'
        } transition-all">
          <span class="text-base font-bold">${selectedItem?.category === 'Devices' ? '📱' : '🚗'}</span>
        </div>
        ${
          heading !== null
            ? `<div class="absolute -top-3 w-4 h-4 bg-white rounded-full border-2 border-slate-900 shadow transform rotate-${Math.round(
                heading
              )}"></div>`
            : ''
        }
      </div>
    `;

    const icon = L.divIcon({
      html: vehicleIconHtml,
      className: 'playback-moving-vehicle',
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });

    if (playbackMarkerRef.current) {
      playbackMarkerRef.current.setLatLng([latitude, longitude]);
      playbackMarkerRef.current.setIcon(icon);
    } else {
      playbackMarkerRef.current = L.marker([latitude, longitude], { icon, zIndexOffset: 1000 });
      routeLayer.addLayer(playbackMarkerRef.current);
    }

    // Pan map to follow smoothly if active
    if (isPlaybackActive) {
      map.panTo([latitude, longitude], { animate: true, duration: 0.3 });
    }
  }, [playbackCurrentPoint, isPlaybackActive, selectedItem]);

  return (
    <div className="relative w-full h-full min-h-[400px] overflow-hidden rounded-2xl border border-slate-800 shadow-2xl bg-slate-950">
      <div ref={mapContainerRef} className="w-full h-full z-0" />
    </div>
  );
};
