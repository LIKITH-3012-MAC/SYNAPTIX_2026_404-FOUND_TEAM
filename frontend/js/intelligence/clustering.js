/**
 * ELITE URBAN INTELLIGENCE - Cluster Engine & Priority Logic
 */

import { PRIORITY_LEVELS } from './constants.js';

export class ClusterEngine {
    constructor(map) {
        this.map = map;
        this.clusterGroup = null;
    }

    /**
     * Initializes the marker cluster group with custom logic
     */
    init(config) {
        if (this.clusterGroup) {
            this.map.removeLayer(this.clusterGroup);
        }

        this.clusterGroup = L.markerClusterGroup({
            ...config,
            iconCreateFunction: (cluster) => this.createClusterIcon(cluster)
        });

        this.map.addLayer(this.clusterGroup);
        return this.clusterGroup;
    }

    /**
     * Advanced Priority Decision Engine
     * Logic: Extract markers -> Count priorities -> Determine dominant -> Tie resolution (High > Medium > Low)
     */
    createClusterIcon(cluster) {
        const markers = cluster.getAllChildMarkers();
        const counts = { High: 0, Medium: 0, Low: 0 };
        const total = markers.length;

        // Extract child markers and count priorities
        markers.forEach(marker => {
            const priorityId = marker.options.priority?.id || 'Low';
            counts[priorityId]++;
        });

        // Determine dominant class with tie resolution
        let dominant;
        if (counts.High > 0 && (counts.High >= counts.Medium && counts.High >= counts.Low)) {
            dominant = PRIORITY_LEVELS.HIGH;
        } else if (counts.Medium > 0 && counts.Medium >= counts.Low) {
            dominant = PRIORITY_LEVELS.MEDIUM;
        } else {
            dominant = PRIORITY_LEVELS.LOW;
        }

        // Dynamic sizing based on density
        const size = this.calculateClusterSize(total);
        const isHigh = dominant.id === 'High';

        // Custom HTML for the cluster icon
        const html = `
            <div class="cluster-icon-wrapper animate-scale-in cluster-hover-glow ${isHigh ? 'animate-pulse-high' : ''}" 
                 style="width: ${size}px; height: ${size}px;">
                <div class="cluster-inner" style="background: ${dominant.gradient};">
                    <span class="cluster-count">${total}</span>
                </div>
                <div class="cluster-glass-overlay"></div>
            </div>
        `;

        return L.divIcon({
            html: html,
            className: 'custom-cluster-icon',
            iconSize: L.point(size, size)
        });
    }

    /**
     * Dynamic sizing logic based on issue density
     */
    calculateClusterSize(count) {
        if (count < 10) return 40;
        if (count < 100) return 50;
        if (count < 500) return 60;
        return 70;
    }

    /**
     * Higher-level render function
     */
    render(issues, role = 'citizen') {
        if (!this.clusterGroup) return;
        this.clusterGroup.clearLayers();

        issues.forEach(issue => {
            const marker = this.createIndividualMarker(issue, role);
            this.clusterGroup.addLayer(marker);
        });
    }

    /**
     * Renders individual markers when zoomed in or not clustered
     */
    createIndividualMarker(issue, role) {
        const priority = issue.priority || PRIORITY_LEVELS.LOW;

        const icon = L.divIcon({
            html: `
                <div class="individual-marker-wrapper animate-scale-in" style="background: ${priority.gradient};">
                    <div class="marker-pulse" style="background: ${priority.color};"></div>
                </div>
            `,
            className: 'custom-individual-marker',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        const marker = L.marker([issue.lat, issue.lng], {
            icon,
            priority: priority,
            issueData: issue
        });

        // Basic popup for now, can be extended with more detailed UI
        marker.bindPopup(`
            <div class="intelligence-popup">
                <h4>${issue.title}</h4>
                <div class="priority-badge" style="background: ${priority.color}">${priority.label}</div>
                <p>${issue.description || 'No description provided.'}</p>
                <div class="popup-footer">
                    <span>📍 ${issue.lat.toFixed(4)}, ${issue.lng.toFixed(4)}</span>
                    <a href="issue.html?id=${issue.id}" class="view-btn">View Details</a>
                </div>
            </div>
        `, {
            className: 'elite-leaflet-popup'
        });

        return marker;
    }
}
