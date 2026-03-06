/**
 * RESOLVIT - Global Map Infrastructure (map-manager.js)
 * 
 * Single Source of Truth for the map instance and clustering behavior.
 * Enforces Global Map Policy:
 * - One map instance per session.
 * - One cluster group instance.
 * - Neutral cartography lockdown (White/Light tiles).
 * - No theme-based reinitialization.
 */

const MapManager = (() => {
    let _map = null;
    let _clusterGroup = null;
    let _baseLayer = null;
    let _isInitialized = false;

    // Carto Tile URLs
    const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    const TILE_ATTRIB = '© OpenStreetMap contributors, © CARTO';

    return {
        /**
         * Initialize the global map instance.
         * @param {string} elementId - Container ID
         * @param {Array} coords - [lat, lng]
         */
        init(elementId, coords = [14.9282, 79.9900]) {
            if (_map) {
                // If map exists, move it to the new container if necessary
                const el = document.getElementById(elementId);
                if (el && _map.getContainer() !== el) {
                    el.appendChild(_map.getContainer());
                }
                _map.invalidateSize();
                return _map;
            }

            const container = document.getElementById(elementId);
            if (!container) return null;

            _map = L.map(elementId, {
                zoomControl: true,
                dragging: true,
                scrollWheelZoom: true,
                preferCanvas: true, // Extreme performance for rendering many points
                wheelDebounceTime: 150, // Optimize scroll wheel zooms on Mac/touchpads
                zoomAnimation: true
            }).setView(coords, 13);

            // Support Light/Dark Theme dynamically
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            _baseLayer = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, {
                attribution: TILE_ATTRIB,
                maxZoom: 20
            }).addTo(_map);

            window.addEventListener('resolvit-theme-change', (e) => {
                const currentIsDark = e.detail === 'dark';
                if (_baseLayer) _baseLayer.setUrl(currentIsDark ? TILE_DARK : TILE_LIGHT);
            });

            // Universal Cluster Group
            _clusterGroup = L.markerClusterGroup({
                showCoverageOnHover: false,
                maxClusterRadius: 50,
                iconCreateFunction: (cluster) => {
                    const markers = cluster.getAllChildMarkers();
                    let maxScore = 0;
                    markers.forEach(m => {
                        const s = m.options.priorityScore || 0;
                        maxScore = Math.max(maxScore, s);
                    });

                    // Priority-based pulsing logic
                    let priorityClass = 'cluster-pulse-low';
                    let type = 'low';

                    if (maxScore >= 80) { priorityClass = 'cluster-blink-critical'; type = 'high'; }
                    else if (maxScore >= 55) { priorityClass = 'cluster-pulse-high'; type = 'high'; }
                    else if (maxScore >= 30) { priorityClass = 'cluster-pulse-medium'; type = 'medium'; }

                    const count = cluster.getChildCount();
                    return L.divIcon({
                        html: `<div class="cluster-shield cluster-${type}-priority ${priorityClass}"><span>${count}</span></div>`,
                        className: 'cluster-icon-wrapper',
                        iconSize: L.point(40, 40)
                    });
                }
            });

            // Interaction: Trigger Intelligence Panel on Cluster Click
            _clusterGroup.on('clusterclick', (a) => {
                a.layer.zoomToBounds({ padding: [20, 20] }); // Natively spiderfy/zoom
                const markers = a.layer.getAllChildMarkers();
                if (typeof window.openClusterIntel === 'function') {
                    window.openClusterIntel(markers);
                }
            });

            _map.addLayer(_clusterGroup);

            _isInitialized = true;
            this.injectGlobalMapStyles();
            return _map;
        },

        getMap() { return _map; },

        clear() {
            if (_clusterGroup) _clusterGroup.clearLayers();
            if (_map) {
                _map.eachLayer(layer => {
                    if (layer instanceof L.Circle) {
                        _map.removeLayer(layer);
                    } else if (layer instanceof L.Marker && !_clusterGroup) {
                        _map.removeLayer(layer);
                    }
                });
            }
        },

        /**
         * Update the map with fresh issue data.
         * Follows flow: Clear -> Render from Backend
         */
        updateData(issues, role = 'citizen') {
            if (!_isInitialized) return;
            this.clear();

            if (typeof renderUrbanNodes === 'function') {
                renderUrbanNodes(_map, issues, role, _clusterGroup);
            }
            if (typeof renderDensityOverlays === 'function') {
                renderDensityOverlays(_map, issues);
            }
        },

        injectGlobalMapStyles() {
            if (document.getElementById('map-manager-styles')) return;
            const style = document.createElement('style');
            style.id = 'map-manager-styles';
            style.textContent = `
                .cluster-shield {
                    width: 40px;
                    height: 48px;
                    background: var(--accent);
                    margin: auto;
                    color: white;
                    font-weight: 800;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    clip-path: polygon(0% 0%, 100% 0%, 100% 75%, 50% 100%, 0% 75%);
                    font-size: 0.9rem;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    border: 2px solid rgba(255,255,255,0.3);
                }
                .cluster-high-priority { background: var(--red, #dc2626) !important; border-color: #ffcccc; position: relative; }
                .cluster-medium-priority { background: var(--orange, #f97316) !important; border-color: #ffe4cc; position: relative; }
                .cluster-low-priority { background: var(--green, #16a34a) !important; border-color: #ccffcc; position: relative; }
                
                @keyframes pulse-low {
                    0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.4); }
                    70% { box-shadow: 0 0 0 10px rgba(22, 163, 74, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
                }
                @keyframes pulse-medium {
                    0% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.6); }
                    70% { box-shadow: 0 0 0 15px rgba(249, 115, 22, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0); }
                }
                @keyframes pulse-high {
                    0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.8); }
                    70% { box-shadow: 0 0 0 20px rgba(220, 38, 38, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
                }
                @keyframes blink-critical {
                    0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 10px rgba(220, 38, 38, 0.8); }
                    50% { opacity: 0.7; transform: scale(1.1); box-shadow: 0 0 25px rgba(220, 38, 38, 1); }
                }
                
                .cluster-pulse-low { animation: pulse-low 2s infinite; }
                .cluster-pulse-medium { animation: pulse-medium 1.5s infinite; }
                .cluster-pulse-high { animation: pulse-high 1s infinite; }
                .cluster-blink-critical { animation: blink-critical 0.6s infinite; }

                .cluster-icon-wrapper {
                    background: transparent !important;
                    border: none !important;
                }

                /* Lockdown style removal */
                .leaflet-container {
                    filter: none !important; /* No Inversion */
                    background: #f1f5f9 !important;
                }
            `;
            document.head.appendChild(style);
        }
    };
})();

window.MapManager = MapManager;
