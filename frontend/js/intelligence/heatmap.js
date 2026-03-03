/**
 * ELITE URBAN INTELLIGENCE - Weighted Heatmap Engine
 */

import { HEATMAP_CONFIG, PRIORITY_LEVELS } from './constants.js';

export class HeatmapEngine {
    constructor(map) {
        this.map = map;
        this.heatLayer = null;
    }

    /**
     * Initializes or updates the heatmap layer
     */
    init(issues) {
        if (this.heatLayer) {
            this.map.removeLayer(this.heatLayer);
        }

        const heatData = this.prepareHeatData(issues);

        this.heatLayer = L.heatLayer(heatData, {
            radius: HEATMAP_CONFIG.RADIUS,
            blur: HEATMAP_CONFIG.BLUR,
            maxZoom: 15,
            max: 1.0,
            gradient: HEATMAP_CONFIG.GRADIENT
        });

        return this.heatLayer;
    }

    /**
     * Priority-weighted intensity logic:
     * High = 1.0 weight
     * Medium = 0.6 weight
     * Low = 0.2 weight
     */
    prepareHeatData(issues) {
        return issues.map(issue => {
            const weight = issue.priority?.weight || 0.2;
            return [issue.lat, issue.lng, weight];
        });
    }

    /**
     * Mounts the layer to the map
     */
    show() {
        if (this.heatLayer) {
            this.map.addLayer(this.heatLayer);
        }
    }

    /**
     * Unmounts the layer from the map
     */
    hide() {
        if (this.heatLayer) {
            this.map.removeLayer(this.heatLayer);
        }
    }
}
