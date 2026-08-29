import React, { useEffect, useRef, useState } from 'react';
import { TrackedItem, JourneyPoint } from '../types/index.js';
import { SymbolIcon } from './SymbolIcon.js';

interface TrackingMapGoogleProps {
  items: TrackedItem[];
  selectedItem: TrackedItem | null;
  onSelectItem: (item: TrackedItem) => void;
  playbackRoutePoints: JourneyPoint[] | null;
  playbackCurrentPoint: JourneyPoint | null;
  isPlaybackActive: boolean;
  googleMapsApiKey: string;
}

declare global {
  interface Window {
    google?: any;
    __googleMapsLoadingPromise?: Promise<void>;
  }
}

export const TrackingMapGoogle: React.FC<TrackingMapGoogleProps> = ({
  items,
  selectedItem,
  onSelectItem,
  playbackRoutePoints,
  playbackCurrentPoint,
  isPlaybackActive,
  googleMapsApiKey,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylinesRef = useRef<any[]>([]);
  const playbackMarkerRef = useRef<any>(null);

  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 1. Dynamic Script Loader for Google Maps
  useEffect(() => {
    if (!googleMapsApiKey || googleMapsApiKey.trim().length === 0) {
      setLoadError('A Google Maps API Key has not been configured yet.');
      return;
    }

    setLoadError(null);

    if (window.google?.maps) {
      setIsLoaded(true);
      return;
    }

    if (!window.__googleMapsLoadingPromise) {
      window.__googleMapsLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&libraries=places,geometry`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Google Maps API script'));
        document.head.appendChild(script);
      });
    }

    window.__googleMapsLoadingPromise
      .then(() => setIsLoaded(true))
      .catch((err) => setLoadError(err.message || 'Google Maps failed to load'));
  }, [googleMapsApiKey]);

  // 2. Initialize Google Map Instance
  useEffect(() => {
    if (!isLoaded || !mapContainerRef.current || mapInstanceRef.current || !window.google?.maps) return;

    const darkStyle = [
      { elementType: 'geometry', stylers: [{ color: '#181b26' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#181b26' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#8892b0' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a3148' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1e2336' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d111d' }] },
      { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1c2233' }] },
      { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#242b3d' }] },
    ];

    const map = new window.google.maps.Map(mapContainerRef.current, {
      center: { lat: 51.505, lng: -0.09 },
      zoom: 12,
      styles: darkStyle,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: false,
    });

    mapInstanceRef.current = map;
  }, [isLoaded]);

  // 3. Render Live Markers
  useEffect(() => {
    if (!isLoaded || !mapInstanceRef.current || !window.google?.maps) return;
    const map = mapInstanceRef.current;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (isPlaybackActive) return;

    const bounds = new window.google.maps.LatLngBounds();
    let hasCoords = false;

    items.forEach((item) => {
      if (item.last_lat === null || item.last_lng === null) return;

      const isSelected = selectedItem?.id === item.id;
      const isVehicle = item.category === 'Vehicles';
      const isMoving = item.status === 'moving';

      const position = { lat: item.last_lat, lng: item.last_lng };
      bounds.extend(position);
      hasCoords = true;

      const marker = new window.google.maps.Marker({
        position,
        map,
        title: item.name,
        label: {
          text: isVehicle ? '🚗' : '📱',
          fontSize: '18px',
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: isSelected ? 22 : 18,
          fillColor: isSelected ? '#3b82f6' : isMoving ? '#10b981' : '#334155',
          fillOpacity: 0.9,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });

      marker.addListener('click', () => {
        onSelectItem(item);
      });

      markersRef.current.push(marker);
    });

    if (hasCoords && !selectedItem) {
      map.fitBounds(bounds);
    } else if (selectedItem && selectedItem.last_lat !== null && selectedItem.last_lng !== null) {
      map.setCenter({ lat: selectedItem.last_lat, lng: selectedItem.last_lng });
      map.setZoom(15);
    }
  }, [isLoaded, items, selectedItem, isPlaybackActive, onSelectItem]);

  // 4. Render Route Polylines
  useEffect(() => {
    if (!isLoaded || !mapInstanceRef.current || !window.google?.maps) return;
    const map = mapInstanceRef.current;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!playbackRoutePoints || playbackRoutePoints.length === 0) return;

    const bounds = new window.google.maps.LatLngBounds();

    for (let i = 0; i < playbackRoutePoints.length - 1; i++) {
      const p1 = playbackRoutePoints[i];
      const p2 = playbackRoutePoints[i + 1];
      const isSpeeding = p1.is_speeding || p2.is_speeding;

      const path = [
        { lat: p1.latitude, lng: p1.longitude },
        { lat: p2.latitude, lng: p2.longitude },
      ];

      bounds.extend(path[0]);
      bounds.extend(path[1]);

      const polyline = new window.google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: isSpeeding ? '#ef4444' : '#06b6d4',
        strokeOpacity: 0.85,
        strokeWeight: isSpeeding ? 6 : 5,
        map,
      });

      polylinesRef.current.push(polyline);
    }

    map.fitBounds(bounds);
  }, [isLoaded, playbackRoutePoints]);

  // 5. Update Playback Moving Marker
  useEffect(() => {
    if (!isLoaded || !mapInstanceRef.current || !window.google?.maps) return;
    const map = mapInstanceRef.current;

    if (!playbackCurrentPoint) {
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setMap(null);
        playbackMarkerRef.current = null;
      }
      return;
    }

    const { latitude, longitude, is_speeding } = playbackCurrentPoint;
    const pos = { lat: latitude, lng: longitude };

    if (!playbackMarkerRef.current) {
      playbackMarkerRef.current = new window.google.maps.Marker({
        position: pos,
        map,
        label: {
          text: selectedItem?.category === 'Devices' ? '📱' : '🚗',
          fontSize: '20px',
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 24,
          fillColor: is_speeding ? '#ef4444' : '#3b82f6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        zIndex: 9999,
      });
    } else {
      playbackMarkerRef.current.setPosition(pos);
    }

    if (isPlaybackActive) {
      map.panTo(pos);
    }
  }, [isLoaded, playbackCurrentPoint, isPlaybackActive, selectedItem]);

  if (loadError) {
    return (
      <div className="relative w-full h-full min-h-[400px] rounded-2xl border border-slate-800 bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-xl shadow-amber-500/5">
          <SymbolIcon name="map.fill" className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Google Maps API Key Required</h3>
        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
          Google Maps is currently selected as your map provider, but no valid API Key was found. Configure your Google Maps API Key in Settings or switch back to Leaflet.
        </p>
        <div className="flex items-center gap-3">
          <a
            href="/settings"
            className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-medium text-sm transition-all shadow-lg shadow-brand-500/20"
          >
            Configure in Settings &rarr;
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[400px] overflow-hidden rounded-2xl border border-slate-800 shadow-2xl bg-slate-950">
      <div ref={mapContainerRef} className="w-full h-full z-0" />
    </div>
  );
};
