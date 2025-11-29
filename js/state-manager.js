/**
 * js/state-manager.js
 * Central State Management for Audio Physics Lab
 * Handles synchronization between tools and LocalStorage persistence.
 */
(function() {
    const STORAGE_KEY = 'audio_lab_project_v1';
    
    // Default values if nothing is stored
    const defaultState = {
        room: { width: 5.0, length: 6.0, height: 2.4 },
        listener: { x: 2.5, y: 3.5, z: 1.1 }, // Z is ear height
        speakers: {
            left: { x: 1.25, y: 1.0, z: 1.0 }, // Z is acoustic center
            right: { x: 3.75, y: 1.0, z: 1.0 },
            sub: { x: 1.25, y: 0.5, z: 0.3 }
        },
        // For future imperial unit support
        settings: {
            unit: 'metric' // 'metric' or 'imperial'
        }
    };

    // Helper for deep merging objects to ensure we don't overwrite missing keys
    function deepMerge(target, source) {
        for (const key in source) {
            if (source[key] instanceof Object && key in target) {
                Object.assign(source[key], deepMerge(target[key], source[key]));
            }
        }
        Object.assign(target || {}, source);
        return target;
    }

    class StateManager {
        constructor() {
            this.state = JSON.parse(JSON.stringify(defaultState)); // Deep copy
            this.init();
        }

        init() {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Merge saved data with defaults (handles new fields in future updates)
                    this.state = deepMerge(this.state, parsed);
                    console.log('Audio Lab: State loaded from LocalStorage');
                } catch (e) {
                    console.error('Audio Lab: Corrupt state reset');
                }
            }
        }

        get() {
            return this.state;
        }

        /**
         * Updates part of the state and notifies listeners
         * @param {Object} partialState - e.g. { room: { width: 5.5 } }
         */
        update(partialState) {
            this.state = deepMerge(this.state, partialState);
            this.save();
            
            // Dispatch event for other tools to react
            window.dispatchEvent(new CustomEvent('app-state-updated', { 
                detail: this.state 
            }));
        }

        save() {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        }

        // Utility to calculate 3D distance between two points
        getDistance(p1, p2) {
            return Math.hypot(p1.x - p2.x, p1.y - p2.y, (p1.z || 0) - (p2.z || 0));
        }
    }

    // Initialize globally
    window.appState = new StateManager();
})();