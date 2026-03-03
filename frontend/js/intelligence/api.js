/**
 * ELITE URBAN INTELLIGENCE - API Data Layer
 */

import { PRIORITY_LEVELS } from './constants.js';

const PRODUCTION_URL = "https://synaptix-2026-404-found-team.onrender.com";
const BASE_URL = (() => {
    const host = window.location.hostname;
    if (!host || host === "localhost" || host === "127.0.0.1") return "http://localhost:8000";
    return PRODUCTION_URL;
})();

export class IntelligenceAPI {
    constructor() {
        this.cache = null;
        this.lastFetch = 0;
        this.debounceTimeout = null;
    }

    /**
     * Debounced fetch to prevent API spam during rapid transitions
     */
    async fetchIssues(debounceMs = 300) {
        return new Promise((resolve, reject) => {
            if (this.debounceTimeout) clearTimeout(this.debounceTimeout);

            this.debounceTimeout = setTimeout(async () => {
                try {
                    const token = localStorage.getItem("resolvit_token");
                    const headers = { "Content-Type": "application/json" };
                    if (token) headers["Authorization"] = `Bearer ${token}`;

                    const response = await fetch(`${BASE_URL}/api/issues?limit=5000`, { headers });
                    if (!response.ok) throw new Error('Network response was not ok');

                    const data = await response.json();

                    // Normalize data to ensure it has latitude, longitude, and mapped priority
                    const normalizedData = data.map(issue => ({
                        ...issue,
                        lat: issue.latitude,
                        lng: issue.longitude,
                        priority: this.mapPriority(issue.priority_score || issue.priority)
                    })).filter(i => i.lat && i.lng);

                    this.cache = normalizedData;
                    this.lastFetch = Date.now();
                    resolve(normalizedData);
                } catch (error) {
                    console.error('IntelligenceAPI Error:', error);
                    resolve(this.cache || []);
                }
            }, debounceMs);
        });
    }

    /**
     * Maps priority scores or labels to internal PRIORITY_LEVELS
     */
    mapPriority(val) {
        if (typeof val === 'string') {
            const up = val.toUpperCase();
            if (up.includes('HIGH') || up.includes('CRITICAL')) return PRIORITY_LEVELS.HIGH;
            if (up.includes('MEDIUM')) return PRIORITY_LEVELS.MEDIUM;
            return PRIORITY_LEVELS.LOW;
        }

        // Assuming score 0-100
        if (val >= 80) return PRIORITY_LEVELS.HIGH;
        if (val >= 40) return PRIORITY_LEVELS.MEDIUM;
        return PRIORITY_LEVELS.LOW;
    }

    getCachedData() {
        return this.cache;
    }
}
