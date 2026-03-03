/**
 * ELITE URBAN INTELLIGENCE - Photorealistic 3D Engine (Google Maps 3D)
 */

import { MAP_CONFIG, PRIORITY_LEVELS } from './constants.js';
import { ENV } from './config.js';
import { IntelligenceAPI } from './api.js';
import { Animations } from './animations.js';

class UrbanIntelligence {
    constructor() {
        this.map3D = null;
        this.api = new IntelligenceAPI();
        this.data = [];
        this.markers = [];
    }

    /**
     * Google Maps JS API Bootstrapper
     */
    async bootstrap() {
        const g = { key: ENV.GOOGLE_MAPS_KEY, v: "alpha" };
        var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
        b = b[c] || (b[c] = {});
        var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => {
            await (a = m.createElement("script"));
            e.set("libraries", [...r] + "");
            for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]);
            e.set("callback", c + ".maps." + q);
            a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
            d[q] = f;
            a.onerror = () => h = n(Error(p + " could not load."));
            a.nonce = m.querySelector("script[nonce]")?.nonce || "";
            m.head.append(a)
        }));
        if (!d[l]) d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
    }

    async init() {
        // 1. Inject internal animations and dashboard styles
        Animations.injectStyles();

        // 2. Bootstrap Google Maps
        await this.bootstrap();

        const { Map3DElement, MapMode, Marker3DInteractiveElement } = await google.maps.importLibrary("maps3d");
        const { PinElement } = await google.maps.importLibrary('marker');

        // 3. Initialize Photorealistic 3D Map
        this.map3D = new Map3DElement({
            center: { lat: 12.9716, lng: 77.5946, altitude: 2000 }, // Bangalore
            range: 5000,
            tilt: 45,
            heading: 0,
            mode: MapMode.HYBRID
        });

        document.getElementById('map-view').append(this.map3D);

        // 4. Setup Click Listener for Camera Diagnostics
        this.map3D.addEventListener('gmp-click', (event) => {
            console.log("3D Camera Diagnostic:", {
                center: this.map3D.center,
                range: this.map3D.range,
                tilt: this.map3D.tilt,
                heading: this.map3D.heading
            });
            console.log("Surface Click Position:", event.position);

            // Stop camera animation on interaction
            this.map3D.stopCameraAnimation();
        });

        // 5. Initial Data Fetch & Render
        await this.refreshData();

        // 6. Finalize UI
        this.hideLoader();
    }

    async refreshData() {
        const issues = await this.api.fetchIssues();
        this.data = issues;
        await this.renderMarkers();
    }

    async renderMarkers() {
        const { Marker3DInteractiveElement } = await google.maps.importLibrary("maps3d");
        const { PinElement } = await google.maps.importLibrary('marker');

        // Clear existing markers if any (though currently appending)
        this.markers.forEach(m => m.remove());
        this.markers = [];

        this.data.forEach(issue => {
            const priority = issue.priority.id.toUpperCase();
            const color = PRIORITY_LEVELS[priority]?.color || '#ffffff';

            // Create Interactive 3D Marker
            const marker = new Marker3DInteractiveElement({
                position: { lat: issue.lat, lng: issue.lng, altitude: 50 },
                label: issue.title,
                altitudeMode: 'RELATIVE_TO_GROUND',
                extruded: true,
            });

            // Create Visual Pin
            const pin = new PinElement({
                background: color,
                borderColor: '#ffffff',
                glyphColor: '#ffffff',
                scale: 1.2
            });

            marker.append(pin);

            // Fly-to animation on click
            marker.addEventListener('gmp-click', (event) => {
                this.map3D.flyCameraTo({
                    endCamera: {
                        center: marker.position,
                        tilt: 65,
                        range: 500,
                        heading: 0,
                    },
                    durationMillis: 2500,
                });
                event.stopPropagation();
            });

            this.map3D.append(marker);
            this.markers.push(marker);
        });
    }

    hideLoader() {
        const loader = document.getElementById('loading-overlay');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 500);
        }
    }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    new UrbanIntelligence().init().catch(err => {
        console.error('3D INITIALIZATION FAILED:', err);
        const text = document.querySelector('.loading-text');
        if (text) text.innerHTML = `<span style="color:#ef4444">CRITICAL SYSTEM ERROR: CHECK CONSOLE</span>`;
    });
});
