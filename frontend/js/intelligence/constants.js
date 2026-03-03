/**
 * ELITE URBAN INTELLIGENCE - Constants & Configuration
 */

export const PRIORITY_LEVELS = {
    HIGH: {
        id: 'High',
        color: '#ff2e2e',
        gradient: 'linear-gradient(135deg, #ff2e2e 0%, #a70000 100%)',
        label: 'Critical / Emergency',
        weight: 1.0,
        pulseSpeed: '1.2s'
    },
    MEDIUM: {
        id: 'Medium',
        color: '#ff8c00',
        gradient: 'linear-gradient(135deg, #ff8c00 0%, #b86500 100%)',
        label: 'Action Required',
        weight: 0.6,
        pulseSpeed: '0s'
    },
    LOW: {
        id: 'Low',
        color: '#00e676',
        gradient: 'linear-gradient(135deg, #00e676 0%, #008a46 100%)',
        label: 'Monitoring',
        weight: 0.2,
        pulseSpeed: '0s'
    }
};

export const MAP_CONFIG = {
    DEFAULT_CENTER: { lat: 12.9716, lng: 77.5946, altitude: 2000 },
    DEFAULT_RANGE: 5000,
    DEFAULT_TILT: 45,
    DEFAULT_HEADING: 0,
    ATTRIBUTION: '© Google | Photorealistic 3D Mesh — Elite Urban Intelligence'
};

export const CLUSTER_CONFIG = {
    MAX_RADIUS: 80,
    ANIMATE: true,
    SPIDERFY_ON_MAX_ZOOM: true,
    SHOW_COVERAGE_ON_HOVER: false,
    ZOOM_TO_BOUNDS_ON_CLICK: true
};

export const HEATMAP_CONFIG = {
    RADIUS: 25,
    BLUR: 15,
    MAX_OPACITY: 0.8,
    MIN_OPACITY: 0.1,
    GRADIENT: {
        0.2: '#00e676',
        0.5: '#ff8c00',
        1.0: '#ff2e2e'
    }
};
