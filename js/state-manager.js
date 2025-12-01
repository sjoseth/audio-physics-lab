/**
 * js/state-manager.js
 * Central State Management for Audio Physics Lab
 * UPDATED: Added Advanced Speaker Params
 */
(function() {
    const STORAGE_KEY = 'audio_lab_project_v3';
    
    const defaultState = {
        room: { width: 5.0, length: 6.0, height: 2.4 },
        listener: { x: 2.5, y: 3.5, z: 1.1 },
        speakers: {
            left: { x: 1.25, y: 1.0, z: 1.0 },
            right: { x: 3.75, y: 1.0, z: 1.0 },
            sub: { x: 1.25, y: 0.5, z: 0.3 }
        },
        // NEW: Advanced Speaker Physics
        advanced: {
            toeInMode: 'auto', // 'auto' or 'manual'
            toeInAngle: 10,    // degrees
            wooferSize: 6.5,   // inches
            tweeterSize: 1.0,  // inches
            tweeterType: 'dome', // 'dome' or 'horn'
            crossover: 2500,   // Hz
            baffleWidth: 20    // cm
        },
        settings: { unit: 'metric' }
    };

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
            this.state = JSON.parse(JSON.stringify(defaultState));
            this.init();
        }

        init() {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('r')) {
                try {
                    this.loadFromUrl(urlParams);
                    console.log('Audio Lab: State loaded from URL');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    this.save();
                    return; 
                } catch (e) {
                    console.warn('Audio Lab: Invalid URL params, falling back to storage', e);
                }
            }

            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    this.state = deepMerge(this.state, JSON.parse(saved));
                } catch (e) {
                    console.error('Audio Lab: Corrupt state reset');
                }
            }
        }

        getShareableUrl() {
            const s = this.state;
            const p = new URLSearchParams();
            const join = (...vals) => vals.map(v => Number(v).toFixed(2)).join(',');

            p.set('r', join(s.room.width, s.room.length, s.room.height));
            p.set('l', join(s.listener.x, s.listener.y, s.listener.z));
            p.set('sl', join(s.speakers.left.x, s.speakers.left.y, s.speakers.left.z));
            p.set('sr', join(s.speakers.right.x, s.speakers.right.y, s.speakers.right.z));
            p.set('sb', join(s.speakers.sub.x, s.speakers.sub.y, s.speakers.sub.z));
            
            // Order: toeInMode(0=auto,1=man), angle, woofer, tweeter, xover, baffle, type(0=dome,1=horn)
            const mode = s.advanced.toeInMode === 'auto' ? 0 : 1;
            const type = s.advanced.tweeterType === 'dome' ? 0 : 1;
            p.set('adv', `${mode},${s.advanced.toeInAngle},${s.advanced.wooferSize},${s.advanced.tweeterSize},${s.advanced.crossover},${s.advanced.baffleWidth},${type}`);

            return `${window.location.origin}${window.location.pathname}?${p.toString()}`;
        }

        loadFromUrl(params) {
            const parse = (key) => params.get(key).split(',').map(Number);

            if (params.has('r')) {
                const [w, l, h] = parse('r');
                this.state.room = { width: w, length: l, height: h };
            }
            if (params.has('l')) {
                const [x, y, z] = parse('l');
                this.state.listener = { x, y, z };
            }
            if (params.has('sl')) {
                const [x, y, z] = parse('sl');
                this.state.speakers.left = { x, y, z };
            }
            if (params.has('sr')) {
                const [x, y, z] = parse('sr');
                this.state.speakers.right = { x, y, z };
            }
            if (params.has('sb')) {
                const [x, y, z] = parse('sb');
                this.state.speakers.sub = { x, y, z };
            }
            if (params.has('adv')) {
                const [mode, angle, woof, tweet, xo, baf, type] = params.get('adv').split(',');
                this.state.advanced = {
                    toeInMode: parseInt(mode) === 0 ? 'auto' : 'manual',
                    toeInAngle: parseFloat(angle),
                    wooferSize: parseFloat(woof),
                    tweeterSize: parseFloat(tweet),
                    crossover: parseFloat(xo),
                    baffleWidth: parseFloat(baf),
                    tweeterType: parseInt(type) === 1 ? 'horn' : 'dome'
                };
            }
        }

        get() { return this.state; }

        update(partialState) {
            this.state = deepMerge(this.state, partialState);
            this.save();
            window.dispatchEvent(new CustomEvent('app-state-updated', { detail: this.state }));
        }

        save() {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        }

        getDistance(p1, p2) {
            return Math.hypot(p1.x - p2.x, p1.y - p2.y, (p1.z || 0) - (p2.z || 0));
        }
    }

    window.appState = new StateManager();
})();