import React, { useState, useEffect } from 'react';
import { Navbar } from '../components/Navbar.js';
import { api } from '../lib/api.js';
import { TrackedItem, TrackingJourney, JourneyPoint, TrackingSettings } from '../types/index.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import { TrackingMapLeaflet } from '../components/TrackingMapLeaflet.js';
import { TrackingMapGoogle } from '../components/TrackingMapGoogle.js';

export const Tracking: React.FC = () => {
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<TrackedItem | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'Vehicles' | 'Devices'>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Settings
  const [settings, setSettings] = useState<TrackingSettings>({
    mapProvider: 'leaflet',
    googleMapsApiKey: '',
    hasGoogleMapsKey: false,
  });

  // Journeys & Playback State
  const [journeys, setJourneys] = useState<TrackingJourney[]>([]);
  const [isJourneysOpen, setIsJourneysOpen] = useState<boolean>(false);
  const [isLoadingJourneys, setIsLoadingJourneys] = useState<boolean>(false);
  const [selectedJourney, setSelectedJourney] = useState<TrackingJourney | null>(null);
  const [routePoints, setRoutePoints] = useState<JourneyPoint[] | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState<boolean>(false);
  const [tokenInfo, setTokenInfo] = useState<{ rawToken: string; ingestUrl: string; sampleCurl: string } | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    category: 'Vehicles' as 'Vehicles' | 'Devices',
    movement_threshold_meters: 25,
    min_speed_kmh: 5,
    stationary_dwell_seconds: 300,
  });

  // 1. Fetch Tracked Items & Settings
  const fetchItems = async () => {
    try {
      const res = await api.tracking.getItems();
      setItems(res.items);
      if (!selectedItem && res.items.length > 0) {
        setSelectedItem(res.items[0]);
      } else if (selectedItem) {
        const updated = res.items.find((i) => i.id === selectedItem.id);
        if (updated) setSelectedItem(updated);
      }
    } catch (err: any) {
      console.error('Failed to load tracked items:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await api.tracking.getSettings();
      setSettings(res);
    } catch {}
  };

  useEffect(() => {
    fetchItems();
    fetchSettings();
    const interval = setInterval(fetchItems, 10000);
    return () => clearInterval(interval);
  }, []);

  // 2. Fetch Journeys when selectedItem changes
  useEffect(() => {
    if (!selectedItem) {
      setJourneys([]);
      return;
    }
    const loadJourneys = async () => {
      setIsLoadingJourneys(true);
      try {
        const res = await api.tracking.getJourneys(selectedItem.id);
        setJourneys(res.journeys);
      } catch (err: any) {
        console.error('Failed to load journeys:', err);
      } finally {
        setIsLoadingJourneys(false);
      }
    };
    loadJourneys();
  }, [selectedItem?.id]);

  // 3. Load Journey Points for Playback
  const handleSelectJourney = async (journey: TrackingJourney) => {
    setSelectedJourney(journey);
    try {
      const res = await api.tracking.getJourneyPoints(journey.id);
      setRoutePoints(res.points);
      setPlaybackIndex(0);
      setIsPlaying(true);
    } catch (err: any) {
      alert('Failed to load journey route points: ' + err.message);
    }
  };

  const handleClosePlayback = () => {
    setSelectedJourney(null);
    setRoutePoints(null);
    setPlaybackIndex(0);
    setIsPlaying(false);
  };

  // 4. Playback Animation Timer
  useEffect(() => {
    if (!isPlaying || !routePoints || routePoints.length === 0) return;

    const intervalMs = Math.max(50, 1000 / playbackSpeed);
    const timer = setInterval(() => {
      setPlaybackIndex((prev) => {
        if (prev >= routePoints.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, routePoints, playbackSpeed]);

  // 5. Add Item Submit
  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.tracking.createItem(formData);
      setItems((prev) => [res.item, ...prev]);
      setSelectedItem(res.item);
      setTokenInfo({
        rawToken: res.rawToken,
        ingestUrl: res.ingestUrl,
        sampleCurl: res.sampleCurl,
      });
      setIsAddModalOpen(false);
      setIsTokenModalOpen(true);
      setFormData({
        name: '',
        category: 'Vehicles',
        movement_threshold_meters: 25,
        min_speed_kmh: 5,
        stationary_dwell_seconds: 300,
      });
    } catch (err: any) {
      alert(err.message || 'Failed to create tracked item');
    }
  };

  // 6. Delete Item
  const handleDeleteItem = async (item: TrackedItem) => {
    if (!confirm(`Are you sure you want to delete "${item.name}" and all its location history?`)) return;
    try {
      await api.tracking.deleteItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (selectedItem?.id === item.id) {
        setSelectedItem(null);
        handleClosePlayback();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete item');
    }
  };

  // 7. Regenerate Token
  const handleRegenerateToken = async (item: TrackedItem) => {
    if (!confirm(`Regenerate token for "${item.name}"? The previous token will immediately stop working.`)) return;
    try {
      const res = await api.tracking.regenerateToken(item.id);
      const protocol = window.location.protocol;
      const host = window.location.host;
      const ingestUrl = `${protocol}//${host}/api/tracking/report`;
      setTokenInfo({
        rawToken: res.rawToken,
        ingestUrl,
        sampleCurl: `curl -X POST ${ingestUrl} -H "Authorization: Bearer ${res.rawToken}" -H "Content-Type: application/json" -d '{"latitude": 51.5074, "longitude": -0.1278, "speed": 45.0, "heading": 180, "battery_level": 92}'`,
      });
      setIsTokenModalOpen(true);
    } catch (err: any) {
      alert(err.message || 'Failed to regenerate token');
    }
  };

  const filteredItems = items.filter((item) => {
    if (categoryFilter === 'all') return true;
    return item.category === categoryFilter;
  });

  const currentPlaybackPoint = routePoints && routePoints[playbackIndex] ? routePoints[playbackIndex] : null;

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar />

      <div className="flex flex-1 h-[calc(100vh-4rem)] overflow-hidden relative">
        {/* LEFT SIDEBAR: Find My-style List */}
        <div className="w-80 md:w-96 border-r border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col z-10 shrink-0">
          {/* Header */}
          <div className="p-4 border-b border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400 shadow-lg shadow-brand-500/10">
                  <SymbolIcon name="location.fill" className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="font-bold text-base text-white tracking-tight">Tracking Hub</h1>
                  <p className="text-xs text-slate-400">Live fleet & telemetry</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-brand-500/20"
              >
                <SymbolIcon name="plus" className="w-3.5 h-3.5" />
                Add Item
              </button>
            </div>

            {/* Category Filter Tabs */}
            <div className="flex bg-slate-950/60 p-1 rounded-xl border border-slate-800 text-xs">
              {(['all', 'Vehicles', 'Devices'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                    categoryFilter === cat
                      ? 'bg-brand-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat === 'all' ? 'All' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Tracked Items List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {isLoading ? (
              <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
                Loading tracked items...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl">
                <SymbolIcon name="location.slash.fill" className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                No tracked items found. Click "+ Add Item" to register one.
              </div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                const isMoving = item.status === 'moving';
                const isVehicle = item.category === 'Vehicles';

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedItem(item);
                      handleClosePlayback();
                    }}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-brand-600/15 border-brand-500/50 shadow-lg shadow-brand-500/5 ring-1 ring-brand-500/30'
                        : 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-900/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center text-base border shadow ${
                            isMoving
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                              : 'bg-slate-800/80 border-slate-700 text-slate-300'
                          }`}
                        >
                          {isVehicle ? '🚗' : '📱'}
                        </div>
                        <div>
                          <h3 className="font-bold text-sm text-slate-100 line-clamp-1">{item.name}</h3>
                          <p className="text-[11px] text-slate-400">{item.category}</p>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          isMoving
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse'
                            : item.status === 'stationary'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/50 mt-2">
                      <div className="flex items-center gap-2">
                        {item.last_speed !== null && (
                          <span className="font-semibold text-slate-200">{Math.round(item.last_speed)} km/h</span>
                        )}
                        {item.last_battery !== null && (
                          <span className="flex items-center gap-1 text-slate-300">
                            <SymbolIcon name="battery.100" className="w-3 h-3 text-emerald-400" />
                            {Math.round(item.last_battery)}%
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          title="Regenerate Token"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRegenerateToken(item);
                          }}
                          className="p-1 text-slate-500 hover:text-amber-400 hover:bg-slate-800 rounded-md transition-colors"
                        >
                          <SymbolIcon name="key.fill" className="w-3 h-3" />
                        </button>
                        <button
                          title="Delete Item"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(item);
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-md transition-colors"
                        >
                          <SymbolIcon name="trash" className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* CENTER / RIGHT AREA: Map & Playback */}
        <div className="flex-1 flex flex-col h-full relative overflow-hidden bg-slate-950">
          {/* Top Info Bar */}
          <div className="h-14 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur px-4 flex items-center justify-between z-10">
            <div className="flex items-center gap-3">
              {selectedItem ? (
                <>
                  <span className="text-xl">{selectedItem.category === 'Vehicles' ? '🚗' : '📱'}</span>
                  <div>
                    <h2 className="font-bold text-sm text-white">{selectedItem.name}</h2>
                    <p className="text-[11px] text-slate-400">
                      {selectedItem.last_lat !== null && selectedItem.last_lng !== null
                        ? `${selectedItem.last_lat.toFixed(4)}, ${selectedItem.last_lng.toFixed(4)}`
                        : 'No GPS fix recorded'}
                    </p>
                  </div>
                </>
              ) : (
                <span className="text-xs text-slate-400">Select a tracked item from the sidebar to view on map</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/80 border border-slate-700 rounded-xl text-[11px] text-slate-300">
                <SymbolIcon name="map.fill" className="w-3.5 h-3.5 text-brand-400" />
                <span>Provider:</span>
                <span className="font-semibold text-white capitalize">{settings.mapProvider}</span>
              </div>

              {selectedItem && (
                <button
                  onClick={() => setIsJourneysOpen(!isJourneysOpen)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    isJourneysOpen
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-500/20'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                  }`}
                >
                  <SymbolIcon name="clock.arrow.circlepath" className="w-3.5 h-3.5" />
                  Journey History ({journeys.length})
                </button>
              )}
            </div>
          </div>

          {/* Map */}
          <div className="flex-1 relative w-full h-full">
            {settings.mapProvider === 'google' ? (
              <TrackingMapGoogle
                items={filteredItems}
                selectedItem={selectedItem}
                onSelectItem={(item) => setSelectedItem(item)}
                playbackRoutePoints={routePoints}
                playbackCurrentPoint={currentPlaybackPoint}
                isPlaybackActive={isPlaying}
                googleMapsApiKey={settings.googleMapsApiKey}
              />
            ) : (
              <TrackingMapLeaflet
                items={filteredItems}
                selectedItem={selectedItem}
                onSelectItem={(item) => setSelectedItem(item)}
                playbackRoutePoints={routePoints}
                playbackCurrentPoint={currentPlaybackPoint}
                isPlaybackActive={isPlaying}
              />
            )}

            {/* PLAYBACK HUD OVERLAY */}
            {selectedJourney && currentPlaybackPoint && (
              <div className="absolute top-4 left-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-700 p-4 rounded-2xl shadow-2xl min-w-[260px]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-400">Live Journey Playback</span>
                  {currentPlaybackPoint.is_speeding ? (
                    <span className="px-2 py-0.5 rounded-md bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-bold animate-pulse">
                      ⚠️ SPEEDING
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-slate-400">Current Speed</div>
                    <div className="text-lg font-black text-white">
                      {Math.round(currentPlaybackPoint.speed || 0)}{' '}
                      <span className="text-xs font-normal text-slate-400">km/h</span>
                    </div>
                  </div>

                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-slate-400">Road Limit (OSM)</div>
                    <div className="text-lg font-black text-slate-200">
                      {currentPlaybackPoint.speed_limit ? (
                        `${currentPlaybackPoint.speed_limit} km/h`
                      ) : (
                        <span className="text-xs text-slate-500 font-normal">No limit tag</span>
                      )}
                    </div>
                  </div>
                </div>

                {currentPlaybackPoint.road_name && (
                  <div className="text-xs text-slate-300 font-medium truncate mb-1">
                    📍 {currentPlaybackPoint.road_name}
                  </div>
                )}
                <div className="text-[10px] text-slate-500">
                  🕒 {new Date(currentPlaybackPoint.timestamp * 1000).toLocaleTimeString()}
                </div>
              </div>
            )}

            {/* BOTTOM ROUTE PLAYBACK CONTROL BAR */}
            {selectedJourney && routePoints && (
              <div className="absolute bottom-6 left-6 right-6 z-20 bg-slate-900/95 backdrop-blur-md border border-slate-700 p-4 rounded-2xl shadow-2xl flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-white text-sm">
                      Route Playback • {selectedJourney.distance_km.toFixed(1)} km
                    </span>
                    <span className="text-slate-400">
                      Duration: {Math.round(selectedJourney.duration_seconds / 60)} mins
                    </span>
                    <span className="text-slate-400">
                      Max Speed: {Math.round(selectedJourney.max_speed_kmh)} km/h
                    </span>
                  </div>
                  <button
                    onClick={handleClosePlayback}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    Exit Playback &times;
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-slate-400">
                    {routePoints[0] ? new Date(routePoints[0].timestamp * 1000).toLocaleTimeString() : ''}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={routePoints.length - 1}
                    value={playbackIndex}
                    onChange={(e) => {
                      setPlaybackIndex(Number(e.target.value));
                      setIsPlaying(false);
                    }}
                    className="flex-1 accent-brand-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                  />
                  <span className="text-[11px] font-mono text-slate-400">
                    {routePoints[routePoints.length - 1]
                      ? new Date(routePoints[routePoints.length - 1].timestamp * 1000).toLocaleTimeString()
                      : ''}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-brand-500/20"
                    >
                      <SymbolIcon name={isPlaying ? 'pause.fill' : 'play.fill'} className="w-3.5 h-3.5" />
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>

                    <button
                      onClick={() => {
                        setPlaybackIndex(0);
                        setIsPlaying(true);
                      }}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors"
                      title="Restart"
                    >
                      <SymbolIcon name="arrow.counterclockwise" className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                    {[1, 2, 5, 10, 20].map((speed) => (
                      <button
                        key={speed}
                        onClick={() => setPlaybackSpeed(speed)}
                        className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                          playbackSpeed === speed
                            ? 'bg-brand-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT DRAWER: JOURNEYS */}
        {isJourneysOpen && (
          <div className="w-80 md:w-96 border-l border-slate-800 bg-slate-900/90 backdrop-blur-md flex flex-col z-20 shrink-0">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-sm text-white">Past Journeys</h2>
                <p className="text-xs text-slate-400">{selectedItem?.name}</p>
              </div>
              <button
                onClick={() => setIsJourneysOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoadingJourneys ? (
                <div className="p-8 text-center text-slate-500 text-xs">Loading journeys...</div>
              ) : journeys.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl">
                  No journeys recorded yet. Drive or move the item to log trips.
                </div>
              ) : (
                journeys.map((j) => {
                  const startDate = new Date(j.start_time * 1000);
                  const endDate = j.end_time ? new Date(j.end_time * 1000) : null;
                  const isSelected = selectedJourney?.id === j.id;

                  return (
                    <div
                      key={j.id}
                      onClick={() => handleSelectJourney(j)}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-brand-600/20 border-brand-500 shadow-lg'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs text-white">{startDate.toLocaleDateString()}</span>
                        {j.has_speeding ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                            Speeding Alert
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400">
                            Normal
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-400 mb-2">
                        🕒 {startDate.toLocaleTimeString()} &rarr; {endDate ? endDate.toLocaleTimeString() : 'In Progress'}
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center text-xs bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                        <div>
                          <div className="text-[10px] text-slate-500">Distance</div>
                          <div className="font-bold text-slate-200">{j.distance_km.toFixed(1)} km</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">Duration</div>
                          <div className="font-bold text-slate-200">{Math.round(j.duration_seconds / 60)} min</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">Max Spd</div>
                          <div className="font-bold text-slate-200">{Math.round(j.max_speed_kmh)} km/h</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* MODAL: ADD ITEM */}
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-1">Add Tracked Item</h3>
              <p className="text-xs text-slate-400 mb-5">Register a vehicle or mobile device to track in real-time.</p>

              <form onSubmit={handleCreateItem} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Item Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ford Transit Van / Delivery Car #1"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500"
                  >
                    <option value="Vehicles">Vehicles (Car, Van, Fleet)</option>
                    <option value="Devices">Devices (Phone, Asset Tracker, Tablet)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Motion Threshold (m)</label>
                    <input
                      type="number"
                      min={5}
                      max={500}
                      value={formData.movement_threshold_meters}
                      onChange={(e) => setFormData({ ...formData, movement_threshold_meters: Number(e.target.value) })}
                      className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Min Speed (km/h)</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={formData.min_speed_kmh}
                      onChange={(e) => setFormData({ ...formData, min_speed_kmh: Number(e.target.value) })}
                      className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-xl hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-brand-500/20"
                  >
                    Create & Generate Token
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: TOKEN INFO */}
        {isTokenModalOpen && tokenInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <SymbolIcon name="key.fill" className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Tracking Authentication Token</h3>
                  <p className="text-xs text-slate-400">Use this token to report location data from any client.</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Bearer Token</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={tokenInfo.rawToken}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-brand-400 selection:bg-brand-500/30"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(tokenInfo.rawToken)}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Ingestion Endpoint (POST)</label>
                  <input
                    type="text"
                    readOnly
                    value={tokenInfo.ingestUrl}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Sample curl Command</label>
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap">
                    {tokenInfo.sampleCurl}
                  </pre>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setIsTokenModalOpen(false)}
                  className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-brand-500/20"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
