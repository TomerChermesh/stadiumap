import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMapEvents } from 'react-leaflet';
import { Icon, LatLngBoundsExpression } from 'leaflet';
import { Trophy, MapPin, Users, Info, CheckCircle, X, Loader2, Search, Radar, LogIn, User, LogOut } from 'lucide-react';
import { INITIAL_STADIUMS } from './constants';
import { Stadium, UserState, AIInsight, Coordinates } from './types';
import { MapController } from './components/MapController';
import { fetchStadiumInsights, fetchStadiumsInArea } from './services/geminiService';
import { AuthModal } from './components/AuthModal';

// Define custom marker icons
const createCustomIcon = (isVisited: boolean, isSelected: boolean) => {
  const color = isSelected ? '#e11d48' : (isVisited ? '#22c55e' : '#3b82f6');
  const scale = isSelected ? 1.5 : 1;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" fill="white" />
    </svg>
  `;

  return new Icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
    iconSize: [32 * scale, 32 * scale],
    iconAnchor: [16 * scale, 32 * scale],
    popupAnchor: [0, -32 * scale],
  });
};

// Component to handle map events (drag/zoom)
const MapEvents = ({ onBoundsChange }: { onBoundsChange: (bounds: any, zoom: number) => void }) => {
  const map = useMapEvents({
    moveend: () => {
      onBoundsChange(map.getBounds(), map.getZoom());
    },
    zoomend: () => {
      onBoundsChange(map.getBounds(), map.getZoom());
    }
  });
  return null;
};

// Haversine formula to calculate distance between two points in meters
const getDistanceFromLatLonInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in meters
  return d;
};

const deg2rad = (deg: number) => {
  return deg * (Math.PI / 180);
};

function App() {
  // State
  const [allStadiums, setAllStadiums] = useState<Stadium[]>(INITIAL_STADIUMS);
  const [visitedIds, setVisitedIds] = useState<string[]>([]);
  const [selectedStadium, setSelectedStadium] = useState<Stadium | null>(null);
  const [insights, setInsights] = useState<Record<string, AIInsight>>({});
  const [isLoadingInsight, setIsLoadingInsight] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentZoom, setCurrentZoom] = useState<number>(3);
  
  // Auth State
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  // Refs for debouncing and deduplication
  const scannedAreas = useRef<Set<string>>(new Set());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load User Session
  useEffect(() => {
    const savedUser = localStorage.getItem('stadiumap_current_user');
    if (savedUser) {
      setCurrentUser(savedUser);
    }
  }, []);

  // Load visited data whenever currentUser changes
  useEffect(() => {
    let storageKey = 'stadiumap_visited_guest'; // Default for non-logged in
    if (currentUser) {
      storageKey = `stadiumap_visited_${currentUser}`;
    }

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        setVisitedIds(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse visited stadiums", e);
        setVisitedIds([]);
      }
    } else {
      setVisitedIds([]);
    }
  }, [currentUser]);

  // Handle Login
  const handleLogin = (username: string) => {
    setCurrentUser(username);
    localStorage.setItem('stadiumap_current_user', username);
  };

  // Handle Logout
  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('stadiumap_current_user');
    setSelectedStadium(null);
  };

  // Toggle Visited Status
  const toggleVisited = (id: string) => {
    let newVisited;
    if (visitedIds.includes(id)) {
      newVisited = visitedIds.filter(v => v !== id);
    } else {
      newVisited = [...visitedIds, id];
    }
    setVisitedIds(newVisited);
    
    const storageKey = currentUser ? `stadiumap_visited_${currentUser}` : 'stadiumap_visited_guest';
    localStorage.setItem(storageKey, JSON.stringify(newVisited));
  };

  // Fetch AI insights when a stadium is selected
  const handleStadiumSelect = async (stadium: Stadium) => {
    setSelectedStadium(stadium);
    // If we don't have insights yet, fetch them
    if (!insights[stadium.id]) {
      setIsLoadingInsight(true);
      try {
        const insight = await fetchStadiumInsights(stadium);
        setInsights(prev => ({ ...prev, [stadium.id]: insight }));
      } finally {
        setIsLoadingInsight(false);
      }
    }
  };

  // Helper to normalize longitude to -180 to 180
  const normalizeLng = (lng: number) => {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  };

  // Handle Map Bounds Change (Scanning Logic)
  const handleBoundsChange = (bounds: any, zoom: number) => {
    setCurrentZoom(zoom);

    // Only scan if we are zoomed in enough (level 6+)
    if (zoom < 6) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(async () => {
      const center = bounds.getCenter();
      // Bucket key to prevent re-scanning same viewport roughly
      const areaKey = `${center.lat.toFixed(1)},${center.lng.toFixed(1)},${zoom}`;
      
      if (scannedAreas.current.has(areaKey)) return;

      setIsScanning(true);
      try {
        const north = bounds.getNorth();
        const south = bounds.getSouth();
        const east = normalizeLng(bounds.getEast());
        const west = normalizeLng(bounds.getWest());

        const newStadiums = await fetchStadiumsInArea({
          north,
          south,
          east,
          west
        });

        if (newStadiums.length > 0) {
          setAllStadiums(prev => {
            const existingStadiums = prev;
            
            // Filter out new stadiums that are duplicates
            const uniqueNew = newStadiums.filter(newS => {
              // 1. Check ID duplication (basic)
              const idExists = existingStadiums.some(exS => exS.id === newS.id);
              if (idExists) return false;

              // 2. Check Geographic Proximity (Advanced Deduplication)
              // If a stadium is within 1000 meters of an existing one, assume it's the same.
              const isDuplicateGeo = existingStadiums.some(exS => {
                const dist = getDistanceFromLatLonInMeters(
                  newS.coordinates.lat, 
                  newS.coordinates.lng, 
                  exS.coordinates.lat, 
                  exS.coordinates.lng
                );
                return dist < 1000; // 1km threshold
              });

              return !isDuplicateGeo;
            });

            return [...prev, ...uniqueNew];
          });
        }
        scannedAreas.current.add(areaKey);
      } catch (e) {
        console.error("Scan failed", e);
      } finally {
        setIsScanning(false);
      }
    }, 1000); // 1s debounce
  };

  const filteredStadiums = useMemo(() => {
    // 1. Filter by search term
    let results = allStadiums;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      results = results.filter(s => 
        s.name.toLowerCase().includes(lower) || 
        s.city.toLowerCase().includes(lower) ||
        s.homeTeams.some(t => t.toLowerCase().includes(lower))
      );
    }

    // 2. Filter by Zoom Level (Level of Detail)
    // Zoom < 5: Show only Initial Major Stadiums (to avoid clutter when zoomed out)
    // Zoom >= 5: Show All
    if (currentZoom < 5 && !searchTerm) {
      const initialIds = new Set(INITIAL_STADIUMS.map(s => s.id));
      results = results.filter(s => initialIds.has(s.id));
    }

    return results;
  }, [searchTerm, allStadiums, currentZoom]);

  const visitedCount = visitedIds.length;
  const totalCount = allStadiums.length;
  
  const maxBounds: LatLngBoundsExpression = [
    [-90, -180],
    [90, 180]
  ];

  return (
    <div className="flex h-screen w-screen relative bg-slate-950 font-sans">
      
      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
        onLogin={handleLogin} 
      />

      {/* Left Sidebar / Overlay - Desktop */}
      <div className="absolute top-4 left-4 z-[1000] w-80 md:w-96 flex flex-col gap-4 pointer-events-none">
        
        {/* Header Card */}
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700 p-6 rounded-2xl shadow-2xl pointer-events-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500 rounded-lg shadow-lg shadow-emerald-500/20">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
                  Stadiumap
                </h1>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">World Explorer</p>
              </div>
            </div>
            
            {/* User Auth Status */}
            {currentUser ? (
               <button 
                onClick={handleLogout}
                className="flex flex-col items-end group"
                title="Logout"
               >
                 <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-full border border-slate-700 group-hover:border-red-500/50 transition-colors">
                    <span className="text-xs font-semibold text-white">{currentUser}</span>
                    <LogOut className="w-3 h-3 text-slate-400 group-hover:text-red-400" />
                 </div>
               </button>
            ) : (
              <button 
                onClick={() => setIsAuthModalOpen(true)}
                className="p-2 bg-slate-800 hover:bg-emerald-500 text-slate-300 hover:text-white rounded-lg transition-all border border-slate-700 hover:border-emerald-400"
                title="Login to save visits"
              >
                <LogIn className="w-5 h-5" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between bg-slate-800/50 rounded-xl p-4 mb-4 border border-slate-800">
             <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                  <User className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Visited</span>
                  <span className="text-white font-bold">{visitedCount} <span className="text-slate-600 text-xs font-normal">Stadiums</span></span>
                </div>
             </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search stadium, city or team..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-slate-600"
            />
          </div>
        </div>

        {/* Scanning Indicator */}
        {isScanning && (
           <div className="bg-blue-900/90 backdrop-blur border border-blue-500/50 p-3 rounded-xl shadow-lg flex items-center gap-3 animate-in slide-in-from-left-5 fade-in duration-300 pointer-events-auto">
              <Radar className="w-5 h-5 text-blue-400 animate-spin-slow" />
              <div>
                 <p className="text-sm font-bold text-white">Scanning Sector...</p>
                 <p className="text-[10px] text-blue-200 uppercase tracking-wide">Discovering local stadiums</p>
              </div>
           </div>
        )}

        {/* Selected Stadium Detail Card */}
        {selectedStadium && (
          <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-left-5 duration-300 pointer-events-auto max-h-[60vh]">
            <div className="relative h-48 w-full group">
              <img 
                src={selectedStadium.imageUrl} 
                alt={selectedStadium.name}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/20 to-transparent opacity-90"></div>
              <button 
                onClick={() => setSelectedStadium(null)}
                className="absolute top-3 right-3 p-2 bg-black/40 hover:bg-black/60 text-white rounded-full backdrop-blur-md transition-all border border-white/10"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="absolute bottom-4 left-5 right-5">
                <h2 className="text-2xl font-bold text-white leading-tight mb-1 drop-shadow-lg">{selectedStadium.name}</h2>
                {selectedStadium.commonName && (
                  <p className="text-sm text-emerald-400 font-bold tracking-wide">{selectedStadium.commonName}</p>
                )}
              </div>
            </div>

            <div className="p-5 overflow-y-auto custom-scrollbar">
              {/* Visited Toggle */}
              <button
                onClick={() => toggleVisited(selectedStadium.id)}
                className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm uppercase tracking-wide transition-all duration-200 mb-6 shadow-lg ${
                  visitedIds.includes(selectedStadium.id)
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/30'
                    : 'bg-white text-slate-900 hover:bg-slate-200 border border-white'
                }`}
              >
                {visitedIds.includes(selectedStadium.id) ? (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Visited
                  </>
                ) : (
                  <>
                    <MapPin className="w-5 h-5" />
                    Mark as Visited
                  </>
                )}
              </button>
              
              {!currentUser && !visitedIds.includes(selectedStadium.id) && (
                  <p className="text-xs text-slate-500 text-center -mt-4 mb-4">Login to save this permanently</p>
              )}

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/50 hover:border-slate-700 transition-colors">
                  <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">
                    <MapPin className="w-3 h-3" />
                    Location
                  </div>
                  <div className="text-slate-200 text-sm font-semibold truncate">{selectedStadium.city}, {selectedStadium.country}</div>
                </div>
                <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/50 hover:border-slate-700 transition-colors">
                  <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">
                    <Users className="w-3 h-3" />
                    Capacity
                  </div>
                  <div className="text-slate-200 text-sm font-semibold">{selectedStadium.capacity.toLocaleString()}</div>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-2">Home Teams</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedStadium.homeTeams.map(team => (
                    <span key={team} className="px-3 py-1 bg-slate-800 text-slate-200 text-xs font-medium rounded-full border border-slate-700">
                      {team}
                    </span>
                  ))}
                </div>
              </div>

              {/* AI Insights Section */}
              <div className="border-t border-slate-800 pt-4">
                 <div className="flex items-center gap-2 mb-3">
                    <div className="p-1 bg-purple-500/20 rounded">
                        <Info className="w-4 h-4 text-purple-400" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-400">Gemini Insights</span>
                 </div>
                 
                 {isLoadingInsight ? (
                   <div className="flex flex-col items-center justify-center py-6 text-slate-500 gap-3 bg-slate-950/30 rounded-xl border border-slate-800 border-dashed">
                      <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                      <span className="text-xs font-medium">Analyzing stadium history...</span>
                   </div>
                 ) : insights[selectedStadium.id] ? (
                   <div className="space-y-3 animate-in fade-in duration-500">
                      <p className="text-sm text-slate-300 leading-relaxed">
                        {insights[selectedStadium.id].description}
                      </p>
                      <div className="bg-gradient-to-br from-purple-900/20 to-slate-900/50 p-4 rounded-xl border border-purple-500/20 relative overflow-hidden">
                        <div className="absolute -right-4 -top-4 w-16 h-16 bg-purple-500/10 rounded-full blur-2xl"></div>
                        <p className="text-[10px] font-bold text-purple-300 uppercase tracking-wider mb-1">Did you know?</p>
                        <p className="text-xs text-slate-300 italic relative z-10">
                          "{insights[selectedStadium.id].funFact}"
                        </p>
                      </div>
                   </div>
                 ) : (
                   <div className="text-center py-2">
                      <p className="text-xs text-slate-500">Insights load automatically.</p>
                   </div>
                 )}
              </div>

            </div>
          </div>
        )}
      </div>

      {/* Map Area */}
      <div className="flex-1 h-full w-full bg-[#0f172a]">
        <MapContainer 
          center={[20, 0]} 
          zoom={3} 
          minZoom={2}
          maxBounds={maxBounds}
          maxBoundsViscosity={1.0}
          scrollWheelZoom={true} 
          style={{ height: '100%', width: '100%', background: '#0f172a' }}
          zoomControl={false}
        >
           {/* Dark Mode Tiles with noWrap to prevent repetition */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            noWrap={true}
          />
          
          <MapController selectedCoordinates={selectedStadium?.coordinates || null} />
          <MapEvents onBoundsChange={handleBoundsChange} />

          {filteredStadiums.map((stadium) => {
            const isVisited = visitedIds.includes(stadium.id);
            const isSelected = selectedStadium?.id === stadium.id;

            return (
              <Marker
                key={stadium.id}
                position={[stadium.coordinates.lat, stadium.coordinates.lng]}
                icon={createCustomIcon(isVisited, isSelected)}
                eventHandlers={{
                  click: () => handleStadiumSelect(stadium),
                }}
              >
                <Tooltip direction="top" offset={[0, -30]} opacity={1} className="custom-tooltip">
                    <span className="font-bold">{stadium.name}</span>
                </Tooltip>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
      
      {/* Footer / Credits */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[999] pointer-events-none">
         <div className="bg-slate-900/80 backdrop-blur px-4 py-2 rounded-full border border-slate-800 shadow-2xl flex items-center gap-2">
            <span className="text-[10px] font-medium text-slate-400 tracking-wide">
               © 2025 by Tomer Chermesh with <span className="text-purple-400 font-bold">Gemini 3 Pro</span>
            </span>
         </div>
      </div>

      {/* Mobile Instruction Overlay */}
      <div className="absolute bottom-16 right-6 z-[999] md:block hidden pointer-events-none">
         <div className="bg-slate-900/80 backdrop-blur text-slate-400 text-xs px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2 shadow-xl">
            {currentZoom < 6 ? (
                <>
                    <span>Zoom in to reveal more stadiums</span>
                    <Search className="w-3 h-3 text-slate-500" />
                </>
            ) : (
                <>
                    <span>Scanning Active</span>
                    <Radar className="w-3 h-3 text-emerald-500 animate-pulse" />
                </>
            )}
         </div>
      </div>

    </div>
  );
}

export default App;