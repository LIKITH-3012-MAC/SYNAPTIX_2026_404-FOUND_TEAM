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
                scrollWheelZoom: !('ontouchstart' in window), // Disable scroll zoom on mobile to prevent page scroll hijack
                preferCanvas: true, 
                wheelDebounceTime: 150, 
                zoomAnimation: true,
                tap: false, 
                bounceAtZoomLimits: false,
                touchZoom: true
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

            // Elite Cluster Group Configuration
            _clusterGroup = L.markerClusterGroup({
                showCoverageOnHover: false,
                zoomToBoundsOnClick: true,
                spiderfyOnMaxZoom: true,
                removeOutsideVisibleBounds: true,
                animate: true,
                animateAddingMarkers: true,
                maxClusterRadius: 80, // Balanced for visual density
                disableClusteringAtZoom: 18,
                chunkedLoading: true, // Performance for large datasets
                iconCreateFunction: (cluster) => {
                    const markers = cluster.getAllChildMarkers();
                    let maxScore = 0;
                    markers.forEach(m => {
                        const s = m.options.priorityScore || 0;
                        maxScore = Math.max(maxScore, s);
                    });

                    const count = cluster.getChildCount();
                    
                    // Intelligent Sizing Logic
                    let size = 48;
                    if (count > 100) size = 72;
                    else if (count > 50) size = 64;
                    else if (count > 10) size = 56;

                    // Priority Visualization
                    let glowClass = 'glow-low';
                    if (maxScore >= 80) glowClass = 'glow-critical';
                    else if (maxScore >= 55) glowClass = 'glow-high';
                    else if (maxScore >= 30) glowClass = 'glow-medium';

                    const isHigh = maxScore >= 60;

                    return L.divIcon({
                        html: `
                            <div class="premium-cluster" style="width:${size}px; height:${size}px;">
                                <div class="cluster-glow ${glowClass}"></div>
                                ${isHigh ? '<div class="cluster-orbit"></div>' : ''}
                                <div class="cluster-glass-shell" style="width:${size - 8}px; height:${size - 8}px;">
                                    <span class="cluster-count" style="pointer-events:none;">${count}</span>
                                </div>
                            </div>`,
                        className: 'cluster-premium-wrapper',
                        iconSize: L.point(size, size),
                        iconAnchor: [size / 2, size / 2]
                    });
                }
            });

            // Interaction: Trigger Intelligence Panel on Cluster Click
            _clusterGroup.on('clusterclick', (a) => {
                if (_map.dragging && _map.dragging.moved()) return;
                a.layer.zoomToBounds({ padding: [20, 20] });
                const markers = a.layer.getAllChildMarkers();
                if (typeof window.openClusterIntel === 'function') {
                    const delay = ('ontouchstart' in window) ? 300 : 0;
                    setTimeout(() => window.openClusterIntel(markers), delay);
                }
            });

            // Handle individual marker clicks (even inside clusters)
            _clusterGroup.on('click', (a) => {
                const issue = a.layer.options?.issueData;
                if (issue && typeof DetailManager !== 'undefined') {
                    DetailManager.open(issue.id);
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

            // RE-APPLY SELECTION: If an issue is open in DetailManager, ensure its marker is highlighted
            if (window.DetailManager && window.DetailManager.currentIssueId) {
                this.highlightSelectedMarker(window.DetailManager.currentIssueId);
            }
        },

        highlightSelectedMarker(issueId) {
            _clusterGroup.eachLayer(m => {
                const id = m.options?.issueData?.id;
                if (id === issueId) {
                    const el = m.getElement();
                    if (el) el.classList.add('marker-selected-active');
                }
            });
        },

        injectGlobalMapStyles() {
            if (document.getElementById('map-manager-premium-base')) return;
            const style = document.createElement('style');
            style.id = 'map-manager-premium-base';
            style.textContent = `
                .cluster-premium-wrapper {
                    background: transparent !important;
                    border: none !important;
                }
                .leaflet-container {
                    background: #0f172a !important; /* Premium dark void background */
                }
                /* Hide default cluster group styles to prevent flicker */
                .marker-cluster { background: none !important; }
                .marker-cluster div { background: none !important; }

                /* Selection Glow Effect */
                .marker-selected-active {
                    filter: drop-shadow(0 0 12px var(--accent)) brightness(1.2);
                    z-index: 1000 !important;
                    animation: marker-pulse-glow 2s infinite;
                }
                @keyframes marker-pulse-glow {
                    0%, 100% { transform: scale(1); filter: drop-shadow(0 0 12px var(--accent)); }
                    50% { transform: scale(1.15); filter: drop-shadow(0 0 20px var(--accent)); }
                }

                /* Mobile Performance Hardening */
                @media (max-width: 768px) {
                    .glass-card-premium { backdrop-filter: blur(8px) !important; box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important; }
                    .premium-cluster { transform: scale(0.85); transition: none !important; }
                    .cluster-orbit { display: none !important; } /* Heavy animation */
                    .cluster-glow { opacity: 0.4 !important; }
                    .leaflet-zoom-animated { will-change: transform; transition-duration: 150ms !important; }
                    
                    /* Force Touch Smoothness */
                    * { -webkit-overflow-scrolling: touch; }
                }
            `;
            document.head.appendChild(style);
        }
    };
})();

window.MapManager = MapManager;
