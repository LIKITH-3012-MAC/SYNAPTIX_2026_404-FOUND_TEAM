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

    // Carto Light tiles - Neutral Infrastructure
    const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
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
                scrollWheelZoom: true
            }).setView(coords, 13);

            // Lockdown Title Style: Always Light
            _baseLayer = L.tileLayer(TILE_URL, {
                attribution: TILE_ATTRIB,
                maxZoom: 20
            }).addTo(_map);

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

                    if (maxScore >= 100) { priorityClass = 'cluster-blink-critical'; type = 'high'; }
                    else if (maxScore >= 80) { priorityClass = 'cluster-pulse-high'; type = 'high'; }
                    else if (maxScore >= 50) { priorityClass = 'cluster-pulse-medium'; type = 'medium'; }

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

        /**
         * Clear all data from the map.
         */
        clear() {
            if (_clusterGroup) _clusterGroup.clearLayers();
            if (_map) {
                _map.eachLayer(layer => {
                    if (layer instanceof L.Marker || layer instanceof L.Circle) {
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
                .cluster-high-priority { background: var(--red, #dc2626) !important; border-color: #ffcccc; }
                .cluster-medium-priority { background: var(--orange, #f97316) !important; border-color: #ffe4cc; }
                .cluster-low-priority { background: var(--green, #16a34a) !important; border-color: #ccffcc; }
                
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
