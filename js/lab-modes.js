/**
 * js/lab-modes.js
 * Inneholder logikken for hver visningsmodus (Room, Speaker, Reflection).
 * Oppdatert funksjonalitet:
 * - X-akse er nå 'linear' for piksel-perfekt Hz-plassering.
 * - Smart Y-skalering: Ignorerer rolloff-haler.
 * - SEPARAT nivåmatching (Gain) for Sub og Mains mot Target Curve i deres respektive pass-band.
 * - Visning av Sub, Mains og Combined.
 * - Dynamisk "Culling" av data (viser ikke data < -35dB).
 * - FIX: Implementert ekte Linkwitz-Riley 4 (LR4) filterformel for å unngå +6dB boost ved crossover.
 */

// --- BASE CLASS ---
class LabMode {
    constructor(stateManager, renderer) {
        this.state = stateManager;
        this.renderer = renderer;
        this.active = false;
    }

    onEnter() { this.active = true; }
    onExit() { this.active = false; }
    
    // Metoder som overstyres av subklasser
    getSidebarHTML() { return ''; }
    getBottomPanelHTML() { return ''; }
    bindEvents() {} 
    draw(ctx) {} 
    updateChart() {} 
}

// ============================================================================
// 1. ROOM MODE (Physics Engine)
// ============================================================================
class RoomMode extends LabMode {
    constructor(s, r) {
        super(s, r);
        this.chart = null;
        
        this.heatmap = { 
            active: false, 
            data: [], 
            cols: 30, // 30x30 Grid
            rows: 30
        };
        
        this.C = 343; 

        this.settings = {
            crossover: 80,
            targetCurve: 0, 
            couchMode: false,
            damping: 10,
            maxFreq: 150 
        };

        // Visibility toggles
        this.visibility = {
            sub: true,
            mains: true,
            combined: true,
            target: true
        };
        
        this.cachedModes = [];
        this.lastRoomDims = { w: 0, l: 0, h: 0 };
    }

    getSidebarHTML() {
        return `
            <div class="control-card p-4 rounded-xl bg-blue-950/20 border border-blue-900/30 space-y-4">
                <h3 class="text-xs font-bold text-blue-400 uppercase">Optimization</h3>
                
                <!-- Target Curve -->
                <div>
                    <label class="text-[10px] text-slate-400 block mb-1">Target Curve</label>
                    <select id="rmInputTarget" class="input-dark w-full rounded p-1.5 text-xs bg-slate-900 border border-slate-700 text-white">
                        <option value="0" ${this.settings.targetCurve === 0 ? 'selected' : ''}>Flat (0dB)</option>
                        <option value="3" ${this.settings.targetCurve === 3 ? 'selected' : ''}>Harman (+3dB)</option>
                        <option value="6" ${this.settings.targetCurve === 6 ? 'selected' : ''}>Harman (+6dB)</option>
                        <option value="9" ${this.settings.targetCurve === 9 ? 'selected' : ''}>Harman (+9dB)</option>
                        <option value="12" ${this.settings.targetCurve === 12 ? 'selected' : ''}>Harman (+12dB)</option>
                    </select>
                </div>

                <!-- Crossover -->
                <div>
                    <label class="text-[10px] text-slate-400 block mb-1">Crossover (Hz)</label>
                    <input type="range" id="rmInputXover" min="40" max="150" value="${this.settings.crossover}" class="range-slider w-full">
                    <div class="flex justify-between text-[10px] text-slate-500"><span>40Hz</span><span id="rmDispXover" class="text-white">${this.settings.crossover}Hz</span><span>150Hz</span></div>
                </div>

                <!-- Max Freq View -->
                <div>
                    <label class="text-[10px] text-slate-400 block mb-1">Max Frequency View</label>
                    <input type="range" id="rmInputMaxF" min="100" max="300" step="10" value="${this.settings.maxFreq}" class="range-slider w-full">
                    <div class="flex justify-between text-[10px] text-slate-500"><span>100Hz</span><span id="rmDispMaxF" class="text-white">${this.settings.maxFreq}Hz</span><span>300Hz</span></div>
                </div>

                <!-- Graph Toggles -->
                <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/50">
                    <label class="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer">
                        <input type="checkbox" id="rmToggleSub" ${this.visibility.sub ? 'checked' : ''} class="accent-blue-500"> Subwoofer
                    </label>
                    <label class="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer">
                        <input type="checkbox" id="rmToggleMains" ${this.visibility.mains ? 'checked' : ''} class="accent-amber-500"> Mains
                    </label>
                    <label class="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer">
                        <input type="checkbox" id="rmToggleComb" ${this.visibility.combined ? 'checked' : ''} class="accent-purple-400"> Combined
                    </label>
                    <label class="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer">
                        <input type="checkbox" id="rmToggleTarget" ${this.visibility.target ? 'checked' : ''} class="accent-slate-500"> Target
                    </label>
                </div>

                <!-- Couch Mode -->
                <div class="flex items-center justify-between pt-2 border-t border-slate-800/50">
                    <label class="text-xs text-slate-300">Couch Mode (Avg 3 seats)</label>
                    <input type="checkbox" id="rmCheckCouch" ${this.settings.couchMode ? 'checked' : ''} class="accent-blue-500">
                </div>

                <button id="rmBtnHeatmap" class="btn-action w-full py-2 rounded text-xs font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]">
                    GENERATE HEATMAP
                </button>
                
                <div id="rmLegend" class="${this.heatmap.active ? '' : 'hidden'} pt-2 transition-all">
                    <div class="flex justify-between text-[10px] text-slate-400 mb-1"><span>Bad</span><span>Good</span></div>
                    <div class="h-2 w-full bg-gradient-to-r from-red-600 via-yellow-500 to-green-500 rounded-full border border-slate-700"></div>
                </div>
            </div>
            
            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-3">Physics & Position</h3>
                
                <div class="mb-3">
                     <label class="text-[10px] text-slate-400 block mb-1">Wall Damping: <span id="rmDispQ" class="text-white">${this.settings.damping}</span></label>
                     <input type="range" id="rmInputQ" min="5" max="30" value="${this.settings.damping}" class="range-slider w-full">
                </div>

                <div class="space-y-2 pt-2 border-t border-slate-700/50">
                    <div><label class="text-[10px] text-slate-400 block">Sub Height (m)</label><input type="number" id="rmInputSubZ" step="0.05" class="input-dark w-full rounded p-1 text-sm bg-slate-900 border border-slate-700 text-white"></div>
                    <div><label class="text-[10px] text-slate-400 block">Listener Height (m)</label><input type="number" id="rmInputListZ" step="0.05" class="input-dark w-full rounded p-1 text-sm bg-slate-900 border border-slate-700 text-white"></div>
                </div>
            </div>

            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-3">Layout & Mirroring</h3>
                <div class="flex items-center justify-between mb-2">
                    <label class="text-xs text-slate-300">Link Speakers</label>
                    <input type="checkbox" id="rmCheckMirror" class="accent-blue-500">
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-[10px] text-slate-400">Mirror Around</label>
                    <select id="rmSelectMirrorMode" class="input-dark text-[10px] rounded p-1 w-28 bg-slate-900 border border-slate-700 text-white">
                        <option value="room">Room Center</option>
                        <option value="listener">Listener</option>
                    </select>
                </div>
            </div>
        `;
    }

    getBottomPanelHTML() {
        return `<div class="relative w-full h-full p-2"><canvas id="rmFreqChart"></canvas></div>`;
    }

    bindEvents() {
        // Settings listeners
        document.getElementById('rmInputTarget').addEventListener('change', (e) => {
            this.settings.targetCurve = parseInt(e.target.value);
            this.updateChart();
        });

        document.getElementById('rmInputXover').addEventListener('input', (e) => {
            this.settings.crossover = parseInt(e.target.value);
            document.getElementById('rmDispXover').innerText = this.settings.crossover + 'Hz';
            this.updateChart();
        });

        document.getElementById('rmInputMaxF').addEventListener('input', (e) => {
            this.settings.maxFreq = parseInt(e.target.value);
            document.getElementById('rmDispMaxF').innerText = this.settings.maxFreq + 'Hz';
            this.updateChart();
        });

        document.getElementById('rmCheckCouch').addEventListener('change', (e) => {
            this.settings.couchMode = e.target.checked;
            this.updateChart();
            this.renderer.resize(); 
        });

        document.getElementById('rmInputQ').addEventListener('input', (e) => {
            this.settings.damping = parseInt(e.target.value);
            document.getElementById('rmDispQ').innerText = this.settings.damping;
            this.updateChart();
        });

        // Visibility Toggles
        const bindToggle = (id, key) => {
            document.getElementById(id).addEventListener('change', (e) => {
                this.visibility[key] = e.target.checked;
                this.updateChart();
            });
        };
        bindToggle('rmToggleSub', 'sub');
        bindToggle('rmToggleMains', 'mains');
        bindToggle('rmToggleComb', 'combined');
        bindToggle('rmToggleTarget', 'target');
        
        // Heatmap Button
        const btn = document.getElementById('rmBtnHeatmap');
        btn.addEventListener('click', () => {
            btn.innerText = "CALCULATING...";
            btn.disabled = true;
            setTimeout(() => this.generateHeatmap(btn), 50);
        });

        // Mirroring logic
        const checkMirror = document.getElementById('rmCheckMirror');
        const selMirror = document.getElementById('rmSelectMirrorMode');
        const updateMirrorSettings = () => {
            this.renderer.mirrorSettings = { enabled: checkMirror.checked, mode: selMirror.value };
        };
        checkMirror.addEventListener('change', updateMirrorSettings);
        selMirror.addEventListener('change', updateMirrorSettings);
        this.renderer.mirrorSettings = { enabled: false, mode: 'room' }; 

        // Z-height sync
        const subZ = document.getElementById('rmInputSubZ');
        const listZ = document.getElementById('rmInputListZ');
        const s = this.state.get();
        subZ.value = s.speakers.sub.z || 0.3;
        listZ.value = s.listener.z || 1.1;

        const syncZ = () => {
            const currentS = this.state.get();
            this.state.update({
                speakers: { sub: { ...currentS.speakers.sub, z: parseFloat(subZ.value) || 0 } },
                listener: { ...currentS.listener, z: parseFloat(listZ.value) || 0 }
            });
            this.updateChart();
        };
        subZ.addEventListener('input', syncZ);
        listZ.addEventListener('input', syncZ);
        
        window.addEventListener('app-state-updated', () => this.updateChart());

        this.initChart();
        this.updateChart();
    }

    draw(ctx) {
        // Draw Heatmap
        if (this.heatmap.active && this.heatmap.data.length > 0) {
            this.heatmap.data.forEach(cell => {
                const px = this.renderer.toPx(cell.x - cell.w/2, 'x');
                const py = this.renderer.toPx(cell.y - cell.h/2, 'y');
                const pw = this.renderer.toPx(cell.w, 'x') - this.renderer.toPx(0, 'x');
                const ph = this.renderer.toPx(cell.h, 'y') - this.renderer.toPx(0, 'y');

                const hue = cell.val * 120; 
                ctx.fillStyle = `hsla(${hue}, 70%, 45%, 0.5)`; 
                ctx.fillRect(px, py, pw, ph);
                
                ctx.strokeStyle = 'rgba(0,0,0,0.1)'; 
                ctx.lineWidth = 0.5;
                ctx.strokeRect(px, py, pw, ph);
            });
        }

        // Draw Couch/Listener Ghosts
        if (this.settings.couchMode) {
            const s = this.state.get();
            const offset = 0.5;
            const drawGhost = (mx) => {
                const px = this.renderer.toPx(mx, 'x');
                const py = this.renderer.toPx(s.listener.y, 'y');
                ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI*2);
                ctx.fillStyle = 'rgba(34, 197, 94, 0.2)'; ctx.fill();
                ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)'; ctx.setLineDash([2,2]); ctx.stroke(); ctx.setLineDash([]);
            };
            drawGhost(Math.max(0.1, s.listener.x - offset));
            drawGhost(Math.min(s.room.width - 0.1, s.listener.x + offset));
        }
    }

    // --- PHYSICS (Max F changed to 300 to support extended view) ---
    calculateModes(width, length, height) {
        if (this.lastRoomDims.w === width && this.lastRoomDims.l === length && this.lastRoomDims.h === height && this.cachedModes.length > 0) {
            return this.cachedModes;
        }
        
        const modes = [];
        const L = width; const W = length; const H = height;
        const maxOrder = 20; const tanLim = 8; const maxF = 400; // Increased limit for simulation

        // 1. Axial
        for (let n = 1; n <= maxOrder; n++) {
            let f = (this.C / 2) * (n / L); if (f < maxF) modes.push({ f, nx: n, ny: 0, nz: 0 });
            f = (this.C / 2) * (n / W); if (f < maxF) modes.push({ f, nx: 0, ny: n, nz: 0 });
            f = (this.C / 2) * (n / H); if (f < maxF) modes.push({ f, nx: 0, ny: 0, nz: n });
        }
        // 2. Tangential XY
        for (let x = 1; x <= tanLim; x++) for (let y = 1; y <= tanLim; y++) {
            const f = (this.C / 2) * Math.sqrt((x / L) ** 2 + (y / W) ** 2);
            if (f < maxF) modes.push({ f, nx: x, ny: y, nz: 0 });
        }
        // 3. Tangential XZ/YZ
        for (let x = 1; x <= tanLim; x++) for (let z = 1; z <= tanLim; z++) {
            const f = (this.C / 2) * Math.sqrt((x / L) ** 2 + (z / H) ** 2);
            if (f < maxF) modes.push({ f, nx: x, ny: 0, nz: z });
        }
        for (let y = 1; y <= tanLim; y++) for (let z = 1; z <= tanLim; z++) {
            const f = (this.C / 2) * Math.sqrt((y / W) ** 2 + (z / H) ** 2);
            if (f < maxF) modes.push({ f, nx: 0, ny: y, nz: z });
        }
        // Oblique
        for (let x = 1; x <= 4; x++) for (let y = 1; y <= 4; y++) for (let z = 1; z <= 4; z++) {
             const f = (this.C / 2) * Math.sqrt((x / L) ** 2 + (y / W) ** 2 + (z / H) ** 2);
             if (f < maxF) modes.push({ f, nx: x, ny: y, nz: z });
        }
        
        modes.sort((a, b) => a.f - b.f);
        this.cachedModes = modes;
        this.lastRoomDims = { w: width, l: length, h: height };
        return modes;
    }

    getTargetCurveData(length, maxBoost) {
        const data = [];
        for (let i = 0; i < length; i++) {
            const f = 20 + i;
            let val = 0;
            if (maxBoost > 0) {
                const lowCorner = 45; const highCorner = 150; 
                if (f <= lowCorner) val = maxBoost;
                else if (f < highCorner) {
                    const ratio = (f - lowCorner) / (highCorner - lowCorner);
                    val = maxBoost * (1 - (1 - Math.cos(ratio * Math.PI)) / 2);
                }
            }
            // Push coordinates for linear scale
            data.push({ x: f, y: val });
        }
        return data;
    }

    simulatePoint(modes, srcPos, recPos, width, length, height, maxFCalc = 300) {
        const data = [];
        const minF = 20; 
        
        const dist = Math.hypot(srcPos.x - recPos.x, srcPos.y - recPos.y, (srcPos.z||0) - (recPos.z||0)) || 0.1;
        const dirScale = 100 / dist; 

        for (let f = minF; f <= maxFCalc; f++) {
            let r = 0; let i = 0;
            const k = (2 * Math.PI * f) / this.C;
            
            r += dirScale * Math.cos(-k * dist);
            i += dirScale * Math.sin(-k * dist);

            modes.forEach(m => {
                if (m.f > 400) return;
                const src = Math.cos(m.nx * Math.PI * srcPos.x / width) * Math.cos(m.ny * Math.PI * srcPos.y / length) * Math.cos(m.nz * Math.PI * (srcPos.z||0) / height);
                const rec = Math.cos(m.nx * Math.PI * recPos.x / width) * Math.cos(m.ny * Math.PI * recPos.y / length) * Math.cos(m.nz * Math.PI * (recPos.z||0) / height);
                const num = src * rec;
                const dr = (m.f ** 2) - (f ** 2);
                const di = (f * m.f) / this.settings.damping; 
                const mag = dr ** 2 + di ** 2;
                const scl = 50000; 
                r += (num * dr * scl) / mag;
                i += (num * (-di) * scl) / mag;
            });
            
            let db = 20 * Math.log10(Math.sqrt(r ** 2 + i ** 2) + 1e-6);
            if (!isFinite(db)) db = -60;
            data.push(db); // Return raw dB values, coordinates added in updateChart
        }
        return data;
    }

    initChart() {
        const ctx = document.getElementById('rmFreqChart').getContext('2d');
        
        const crossoverLinePlugin = {
            id: 'crossoverLine',
            afterDraw: (chart) => {
                if(!this.visibility.sub && !this.visibility.mains) return; 

                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;
                // Linear scale handles values directly
                const xVal = xAxis.getPixelForValue(this.settings.crossover);

                if (xVal >= xAxis.left && xVal <= xAxis.right) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(xVal, yAxis.top);
                    ctx.lineTo(xVal, yAxis.bottom);
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = 'rgba(147, 197, 253, 0.5)';
                    ctx.setLineDash([4, 4]);
                    ctx.stroke();
                    ctx.fillStyle = 'rgba(147, 197, 253, 0.7)';
                    ctx.textAlign = 'right';
                    ctx.font = '10px sans-serif';
                    ctx.fillText(`XO ${this.settings.crossover}Hz`, xVal - 4, yAxis.top + 10);
                    ctx.restore();
                }
            }
        };

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    // 0: Subwoofer
                    {
                        label: 'Subwoofer',
                        data: [],
                        borderColor: '#60a5fa',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        order: 2
                    },
                    // 1: Mains
                    {
                        label: 'Main Speakers',
                        data: [],
                        borderColor: '#fbbf24', 
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        order: 3
                    },
                    // 2: Combined
                    {
                        label: 'Combined',
                        data: [],
                        borderColor: '#c084fc', 
                        borderWidth: 3,
                        pointRadius: 0,
                        tension: 0.3,
                        order: 1 
                    },
                    // 3: Target
                    {
                        label: 'Target',
                        data: [],
                        borderColor: 'rgba(255, 255, 255, 0.5)',
                        borderWidth: 2,
                        borderDash: [6, 4],
                        pointRadius: 0,
                        order: 4
                    },
                    // 4: Target High
                    {
                        label: 'Target High',
                        data: [],
                        borderColor: 'transparent',
                        borderWidth: 0,
                        pointRadius: 0,
                        fill: false,
                        order: 5
                    },
                    // 5: Target Low
                    {
                        label: 'Target Band',
                        data: [],
                        borderColor: 'transparent',
                        borderWidth: 0,
                        pointRadius: 0,
                        backgroundColor: 'rgba(34, 197, 94, 0.1)', 
                        fill: '-1', 
                        order: 6
                    },
                    // 6: 0dB
                    {
                        label: '0dB',
                        data: [],
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        borderWidth: 1,
                        pointRadius: 0,
                        order: 10
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { 
                        type: 'linear', // Critical change for correct 20Hz alignment
                        min: 20, 
                        max: 150,
                        ticks: { 
                            stepSize: 20, 
                            color: '#64748b'
                        }, 
                        grid: { color: '#1e293b' } 
                    },
                    y: { 
                        grid: { color: '#1e293b' }, 
                        ticks: { color: '#64748b' } 
                    } 
                },
                plugins: { legend: { display: false } }
            },
            plugins: [crossoverLinePlugin]
        });
    }

    updateChart() {
        if(!this.chart) return;
        const s = this.state.get();
        const modes = this.calculateModes(s.room.width, s.room.length, s.room.height);
        
        // Helper
        const getSpeakerResponse = (speakerPos) => {
            if (!speakerPos) return Array(this.settings.maxFreq + 1).fill(-60);

            // Calculate up to Max Freq
            let data = this.simulatePoint(modes, speakerPos, s.listener, s.room.width, s.room.length, s.room.height, this.settings.maxFreq);

            if (this.settings.couchMode) {
                const offset = 0.5;
                const lPos = { ...s.listener, x: Math.max(0.1, s.listener.x - offset) };
                const rPos = { ...s.listener, x: Math.min(s.room.width - 0.1, s.listener.x + offset) };
                const dataL = this.simulatePoint(modes, speakerPos, lPos, s.room.width, s.room.length, s.room.height, this.settings.maxFreq);
                const dataR = this.simulatePoint(modes, speakerPos, rPos, s.room.width, s.room.length, s.room.height, this.settings.maxFreq);
                
                const averaged = [];
                for(let i=0; i<data.length; i++) {
                    averaged.push((data[i] + dataL[i] + dataR[i]) / 3);
                }
                data = averaged;
            }
            return data;
        };

        // --- CALCULATE DATA ---
        const rawSubData = getSpeakerResponse(s.speakers.sub);

        const leftData = getSpeakerResponse(s.speakers.left);
        const rightData = getSpeakerResponse(s.speakers.right);
        const rawMainsData = [];
        for (let i = 0; i < leftData.length; i++) {
            rawMainsData.push((leftData[i] + rightData[i]) / 2);
        }

        // Note: targetData returned from helper are already {x,y}
        const targetData = this.getTargetCurveData(this.settings.maxFreq + 1, this.settings.targetCurve);

        // HELPER: Gain Match Offset Logic
        const getGainMatchOffset = (rawData, targetData, minHz, maxHz) => {
            let sumDiff = 0;
            let count = 0;
            const startIdx = Math.max(0, minHz - 20); // index 0 is 20Hz
            const endIdx = Math.min(rawData.length - 1, maxHz - 20);

            for (let i = startIdx; i <= endIdx; i++) {
                if (i < rawData.length && isFinite(rawData[i])) {
                    // diff = measure - target
                    const diff = rawData[i] - targetData[i].y;
                    sumDiff += diff;
                    count++;
                }
            }
            return count > 0 ? sumDiff / count : 0;
        };

        // 1. Calculate Offsets (Gain Matching)
        // Sub: Match within passband (20Hz to Crossover)
        const offsetSub = getGainMatchOffset(rawSubData, targetData, 20, this.settings.crossover);
        
        // Mains: Match within passband (Crossover to Max View)
        const offsetMains = getGainMatchOffset(rawMainsData, targetData, this.settings.crossover, this.settings.maxFreq);
        
        // Final Arrays (Coordinates)
        const finalSub = [];
        const finalMains = [];
        const finalCombined = [];
        
        const targetHigh = [];
        const targetLow = [];
        const zeroLine = [];

        // Scale helpers
        let minVal = Infinity;
        let maxVal = -Infinity;
        
        // Threshold for hiding line
        const CULL_THRESHOLD = -35; 
        const XO_MARGIN = 10; 

        // Filter Constants for LR4
        const fc = this.settings.crossover;

        for(let i=0; i<rawSubData.length; i++) {
            const freq = 20 + i;
            if (freq > this.settings.maxFreq) break; 
            
            // --- LINKWITZ-RILEY 4th Order Implementation ---
            // Magnitude Response Calculations (Proper summing to flat)
            const ratio = freq / fc;
            
            // LP Magnitude (Squared for power sum, then back to dB... actually we work in dB)
            // Linear Magnitude Transfer Function for LR4 Low Pass: 1 / (1 + ratio^4)
            // Convert to dB attenuation: 20 * log10(Mag)
            const lpGainLin = 1 / (1 + Math.pow(ratio, 4));
            const lpAttenDB = 20 * Math.log10(lpGainLin);

            // HP Magnitude Transfer Function for LR4 High Pass: ratio^4 / (1 + ratio^4)
            const hpGainLin = Math.pow(ratio, 4) / (1 + Math.pow(ratio, 4));
            // Prevent log10(0) at 0Hz
            const hpAttenDB = (freq === 0) ? -60 : 20 * Math.log10(hpGainLin);


            // 1. Process Sub
            let valSub = rawSubData[i] - offsetSub + lpAttenDB;
            if (valSub < CULL_THRESHOLD) valSub = null;
            if (valSub !== null) finalSub.push({ x: freq, y: valSub });

            // 2. Process Mains
            let valMains = rawMainsData[i] - offsetMains + hpAttenDB;
            if (valMains < CULL_THRESHOLD) valMains = null;
            if (valMains !== null) finalMains.push({ x: freq, y: valMains });

            // 3. Process Combined
            // Summation assumes phase alignment (magnitude sum)
            let valComb = null;
            const subLin = (valSub !== null) ? Math.pow(10, valSub / 20) : 0;
            const mainLin = (valMains !== null) ? Math.pow(10, valMains / 20) : 0;
            
            if (subLin > 0 || mainLin > 0) {
                 valComb = 20 * Math.log10(subLin + mainLin);
            }
            if (valComb !== null && valComb < CULL_THRESHOLD) valComb = null;
            if (valComb !== null) finalCombined.push({ x: freq, y: valComb });

            // 4. SMART SCALING LOGIC
            if (this.visibility.sub && valSub !== null) {
                if (freq <= (this.settings.crossover + XO_MARGIN)) {
                    if (valSub < minVal) minVal = valSub;
                    if (valSub > maxVal) maxVal = valSub;
                }
            }

            if (this.visibility.mains && valMains !== null) {
                if (freq >= (this.settings.crossover - XO_MARGIN)) {
                    if (valMains < minVal) minVal = valMains;
                    if (valMains > maxVal) maxVal = valMains;
                }
            }

            if (this.visibility.combined && valComb !== null) {
                 if (freq <= (this.settings.crossover + XO_MARGIN) || freq >= (this.settings.crossover - XO_MARGIN)) {
                    if (valComb < minVal) minVal = valComb;
                    if (valComb > maxVal) maxVal = valComb;
                 }
            }

            const tVal = targetData[i].y;
            const tLow = tVal - 3;
            const tHigh = tVal + 3;

            if (minVal !== Infinity) {
                 if (tLow < minVal && tLow > (minVal - 10)) minVal = tLow;
                 if (tHigh > maxVal && tHigh < (maxVal + 10)) maxVal = tHigh;
            } else {
                 minVal = -10; maxVal = 10;
            }

            targetHigh.push({ x: freq, y: tVal + 3 });
            targetLow.push({ x: freq, y: tVal - 3 });
            zeroLine.push({ x: freq, y: 0 });
        }

        // Apply Smart Y-Scaling
        if (minVal !== Infinity && maxVal !== -Infinity) {
            const lower = minVal - 2; 
            const upper = maxVal + 2;
            this.chart.options.scales.y.min = Math.floor(lower);
            this.chart.options.scales.y.max = Math.ceil(upper);
        } else {
            this.chart.options.scales.y.min = -15;
            this.chart.options.scales.y.max = 15;
        }
        
        this.chart.options.scales.x.max = this.settings.maxFreq;

        const ds = this.chart.data.datasets;
        
        ds[0].hidden = !this.visibility.sub;
        ds[0].data = finalSub;
        
        ds[1].hidden = !this.visibility.mains;
        ds[1].data = finalMains;
        
        ds[2].hidden = !this.visibility.combined;
        ds[2].data = finalCombined;
        
        ds[3].hidden = !this.visibility.target;
        ds[3].data = targetData.slice(0, finalSub.length); 
        
        ds[4].hidden = !this.visibility.target;
        ds[4].data = targetHigh;
        
        ds[5].hidden = !this.visibility.target;
        ds[5].data = targetLow;
        
        ds[6].data = zeroLine;
        
        this.chart.update('none');
    }

    generateHeatmap(btn) {
        const s = this.state.get();
        const modes = this.calculateModes(s.room.width, s.room.length, s.room.height);
        
        const rows = this.heatmap.rows; 
        const cols = this.heatmap.cols;
        const sx = s.room.width / cols; 
        const sy = s.room.length / rows;
        this.heatmap.data = [];
        let minScore = Infinity; let maxScore = -Infinity;

        // Note: For heatmap calculation we use the raw array data internally
        // We need to strip the {x,y} structure from targetData here or reuse logic
        // Re-implementing simplified target fetch for heatmap to avoid breaking changes
        const getRawTarget = (len, boost) => {
             const d = [];
             for(let i=0; i<len; i++) {
                 const f = 20+i;
                 let val = 0;
                 if (boost > 0) {
                    if (f <= 45) val = boost;
                    else if (f < 150) {
                        const r = (f - 45) / (150 - 45);
                        val = boost * (1 - (1 - Math.cos(r * Math.PI)) / 2);
                    }
                 }
                 d.push(val);
             }
             return d;
        };

        const targetData = getRawTarget(181, this.settings.targetCurve);
        const limit = Math.min(this.settings.crossover - 20, 180); 

        for(let y=0; y<rows; y++) {
            for(let x=0; x<cols; x++) {
                const cx = x*sx + sx/2;
                const cy = y*sy + sy/2;
                const tempSub = { x: cx, y: cy, z: s.speakers.sub.z };
                
                let resp = this.simulatePoint(modes, tempSub, s.listener, s.room.width, s.room.length, s.room.height);
                
                if (this.settings.couchMode) {
                    const offset = 0.5;
                    const lPos = { ...s.listener, x: Math.max(0.1, s.listener.x - offset) };
                    const rPos = { ...s.listener, x: Math.min(s.room.width - 0.1, s.listener.x + offset) };
                    const respL = this.simulatePoint(modes, tempSub, lPos, s.room.width, s.room.length, s.room.height);
                    const respR = this.simulatePoint(modes, tempSub, rPos, s.room.width, s.room.length, s.room.height);
                    for(let i=0; i<resp.length; i++) {
                        resp[i] = (resp[i] + respL[i] + respR[i]) / 3;
                    }
                }

                let sumHigh = 0; let countHigh = 0;
                for (let i = 90; i < 130; i++) { 
                    if(i < resp.length && isFinite(resp[i])) { sumHigh += resp[i]; countHigh++; }
                }
                const off = (countHigh > 0) ? sumHigh / countHigh : 0;

                let err = 0;
                let mv = Infinity;

                for(let i=0; i<=limit; i++) {
                    const v = resp[i] - off; 
                    const diff = v - targetData[i]; 

                    if (diff < 0) err += (diff * diff) * 2.0; 
                    else err += (diff * diff) * 0.5; 

                    if (v < mv) mv = v;
                }
                
                const weightedRMSE = Math.sqrt(err / (limit + 1));
                const deepNullPenalty = Math.max(0, -mv - 10) * 0.5;
                const score = 1000 / (weightedRMSE + deepNullPenalty + 0.1);

                if (score < minScore) minScore = score;
                if (score > maxScore) maxScore = score;
                
                this.heatmap.data.push({ x: cx, y: cy, w: sx, h: sy, raw: score });
            }
        }
        
        const range = maxScore - minScore;
        this.heatmap.data.forEach(d => {
            if (range === 0) d.val = 0;
            else d.val = (d.raw - minScore) / range;
        });
        
        this.heatmap.active = true;
        document.getElementById('rmLegend').classList.remove('hidden');
        btn.innerText = "REFRESH HEATMAP";
        btn.disabled = false;
        this.renderer.resize(); 
    }
}

// ============================================================================
// 2. SPEAKER MODE (Unchanged)
// ============================================================================
class SpeakerMode extends LabMode {
    constructor(s, r) {
        super(s, r);
        this.chart = null;
        this.params = { toeIn: 10 }; 
    }

    getSidebarHTML() {
        return `
            <div class="control-card p-4 rounded-xl bg-green-950/20 border border-green-900/30">
                <h3 class="text-xs font-bold text-green-400 mb-3">SPEAKER ALIGNMENT</h3>
                
                <label class="text-[10px] text-slate-400 block mb-1">Toe-In Angle</label>
                <div class="flex items-center gap-3">
                    <input type="range" id="spInputToe" min="0" max="45" value="${this.params.toeIn}" class="range-slider flex-1">
                    <span id="spDispToe" class="text-xs font-mono w-8 text-right text-white">${this.params.toeIn}°</span>
                </div>
            </div>

            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-3">Layout & Mirroring</h3>
                
                <div class="flex items-center justify-between mb-2">
                    <label class="text-xs text-slate-300">Link Speakers</label>
                    <input type="checkbox" id="spCheckMirror" class="accent-green-500">
                </div>
                
                <div class="flex items-center justify-between">
                    <label class="text-[10px] text-slate-400">Mirror Around</label>
                    <select id="spSelectMirrorMode" class="input-dark text-[10px] rounded p-1 w-28 bg-slate-900 border border-slate-700 text-white">
                        <option value="room">Room Center</option>
                        <option value="listener">Listener</option>
                    </select>
                </div>
            </div>

            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
                 <h3 class="text-xs font-bold text-slate-300 mb-3">SBIR Info</h3>
                 <p class="text-[10px] text-slate-400 leading-relaxed">
                   Lines on canvas show direct path (Yellow) vs wall reflections (Red). 
                 </p>
            </div>
        `;
    }

    getBottomPanelHTML() {
        return `<div class="relative w-full h-full p-2"><canvas id="spSbirChart"></canvas></div>`;
    }

    bindEvents() {
        const rng = document.getElementById('spInputToe');
        const disp = document.getElementById('spDispToe');
        rng.addEventListener('input', (e) => {
            this.params.toeIn = parseInt(e.target.value);
            disp.innerText = this.params.toeIn + "°";
            this.renderer.resize(); 
        });
        
        const checkMirror = document.getElementById('spCheckMirror');
        const selMirror = document.getElementById('spSelectMirrorMode');
        
        const updateMirrorSettings = () => {
            this.renderer.mirrorSettings = {
                enabled: checkMirror.checked,
                mode: selMirror.value
            };
        };

        checkMirror.addEventListener('change', updateMirrorSettings);
        selMirror.addEventListener('change', updateMirrorSettings);
        
        this.renderer.mirrorSettings = { enabled: false, mode: 'room' };

        window.addEventListener('app-state-updated', () => this.updateChart());

        this.initChart();
        this.updateChart();
    }

    draw(ctx) {
        const s = this.state.get();
        const drawCone = (spk, label) => {
            const px = this.renderer.toPx(spk.x, 'x');
            const py = this.renderer.toPx(spk.y, 'y');
            const toeRad = this.params.toeIn * (Math.PI/180);
            let baseAngle = Math.PI/2; 
            if (label === 'left') baseAngle -= toeRad; 
            else baseAngle += toeRad; 

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(baseAngle - Math.PI/2);
            ctx.fillStyle = 'rgba(234, 179, 8, 0.15)'; 
            ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-40, 300); ctx.lineTo(40, 300); ctx.fill();
            ctx.restore();
        };

        if(s.speakers.left) drawCone(s.speakers.left, 'left');
        if(s.speakers.right) drawCone(s.speakers.right, 'right');

        const lx = this.renderer.toPx(s.listener.x, 'x');
        const ly = this.renderer.toPx(s.listener.y, 'y');
        
        ['left', 'right'].forEach(side => {
            const spk = s.speakers[side];
            if(!spk) return;
            const sx = this.renderer.toPx(spk.x, 'x');
            const sy = this.renderer.toPx(spk.y, 'y');
            ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(lx,ly);
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)'; ctx.setLineDash([5,5]); ctx.stroke();
            const wallX = side === 'left' ? this.renderer.toPx(0, 'x') : this.renderer.toPx(s.room.width, 'x');
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(wallX, (sy+ly)/2); ctx.lineTo(lx, ly);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)'; ctx.setLineDash([]); ctx.stroke();
        });
    }

    calculateSBIR(spk, wallDist) {
        const data = [];
        const cancelFreq = 343 / (4 * wallDist);
        for(let f=20; f<=500; f+=5) {
            let val = 0;
            const bandwidth = f * 0.5;
            if (Math.abs(f - cancelFreq) < bandwidth) {
                const dist = Math.abs(f - cancelFreq);
                val = -10 * Math.cos((dist/bandwidth) * Math.PI/2);
            }
            data.push(val);
        }
        return data;
    }

    initChart() {
        const ctx = document.getElementById('spSbirChart').getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: { 
                labels: Array.from({length:97}, (_,i)=>20+i*5), 
                datasets: [
                    { label:'Left Speaker', data:[], borderColor:'#3b82f6', borderWidth:2, pointRadius:0 },
                    { label:'Right Speaker', data:[], borderColor:'#ef4444', borderWidth:2, pointRadius:0 }
                ] 
            },
            options: { 
                responsive:true, maintainAspectRatio:false, animation: false,
                scales: { x: { ticks:{color:'#64748b'}, grid:{color:'#1e293b'} }, y: { suggestedMin:-20, suggestedMax:5, grid:{color:'#1e293b'} } },
                plugins: { legend: { labels: { color: '#94a3b8' } } }
            }
        });
    }
    
    updateChart() {
        if(!this.chart) return;
        const s = this.state.get();
        const distL = s.speakers.left.x;
        const distR = s.room.width - s.speakers.right.x;
        this.chart.data.datasets[0].data = this.calculateSBIR(s.speakers.left, distL);
        this.chart.data.datasets[1].data = this.calculateSBIR(s.speakers.right, distR);
        this.chart.update('none');
    }
}

// ============================================================================
// 3. REFLECTION MODE (Unchanged)
// ============================================================================
class ReflectionMode extends LabMode {
    constructor(s, r) {
        super(s, r);
        this.walls = { side: true, front: false, back: false };
    }

    getSidebarHTML() {
        return `
            <div class="control-card p-4 rounded-xl bg-orange-950/20 border border-orange-900/30 space-y-3">
                <h3 class="text-xs font-bold text-orange-400 mb-2">FIRST REFLECTIONS</h3>
                <div class="flex justify-between items-center text-xs">
                    <span class="text-slate-300">Side Walls</span>
                    <input type="checkbox" id="rfCheckSide" ${this.walls.side ? 'checked' : ''} class="accent-orange-500">
                </div>
                <div class="flex justify-between items-center text-xs">
                    <span class="text-slate-300">Front Wall</span>
                    <input type="checkbox" id="rfCheckFront" ${this.walls.front ? 'checked' : ''} class="accent-orange-500">
                </div>
                <div class="flex justify-between items-center text-xs">
                    <span class="text-slate-300">Back Wall</span>
                    <input type="checkbox" id="rfCheckBack" ${this.walls.back ? 'checked' : ''} class="accent-orange-500">
                </div>
            </div>
            
            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
                 <h3 class="text-xs font-bold text-slate-300 mb-2">Acoustic Treatment</h3>
                 <p class="text-[10px] text-slate-400">
                   Orange dots indicate where to place absorption panels to kill first reflections.
                 </p>
            </div>
        `;
    }

    getBottomPanelHTML() {
        return `
            <div class="w-full h-full overflow-auto p-4 custom-scrollbar">
                <table class="w-full text-left text-[10px] md:text-xs text-slate-400">
                    <thead class="text-slate-500 font-bold uppercase border-b border-slate-700">
                        <tr>
                            <th class="py-2">Path Source</th>
                            <th class="py-2">Reflect. Surface</th>
                            <th class="py-2">Total Dist</th>
                            <th class="py-2">Delay</th>
                            <th class="py-2 text-right">Atten.</th>
                        </tr>
                    </thead>
                    <tbody id="rfTableBody" class="font-mono divide-y divide-slate-800/50">
                        </tbody>
                </table>
            </div>
        `;
    }

    bindEvents() {
        ['Side', 'Front', 'Back'].forEach(w => {
            const el = document.getElementById(`rfCheck${w}`);
            if(el) el.addEventListener('change', (e) => {
                this.walls[w.toLowerCase()] = e.target.checked;
                this.renderer.resize(); 
                this.updateTable();
            });
        });
        this.renderer.mirrorSettings = { enabled: false, mode: 'room' };
        window.addEventListener('app-state-updated', () => this.updateTable());
        this.updateTable();
    }

    draw(ctx) {
        const s = this.state.get();
        const lx = s.listener.x; const ly = s.listener.y;

        const drawRay = (spk, wall, color) => {
            let rx, ry; 
            if(wall === 'left') {
                const m = (ly - spk.y) / (-lx - spk.x); 
                ry = spk.y - m * spk.x; rx = 0;
            } else if (wall === 'right') {
                const mirrorLx = s.room.width + (s.room.width - lx);
                const m = (ly - spk.y) / (mirrorLx - spk.x);
                ry = spk.y + m * (s.room.width - spk.x); rx = s.room.width;
            } else if (wall === 'front') {
                const m = (-ly - spk.y) / (lx - spk.x);
                rx = spk.x - spk.y / m; ry = 0;
            } else if (wall === 'back') {
                const mirrorLy = s.room.length + (s.room.length - ly);
                 const m2 = (mirrorLy - spk.y) / (lx - spk.x);
                 rx = (s.room.length - spk.y)/m2 + spk.x;
                 ry = s.room.length;
            }
            
            const pxS = this.renderer.toPx(spk.x, 'x');
            const pxR = this.renderer.toPx(rx, 'x');
            const pyR = this.renderer.toPx(ry, 'y');
            const pxL = this.renderer.toPx(lx, 'x');
            const pyS = this.renderer.toPx(spk.y, 'y');
            const pyL = this.renderer.toPx(ly, 'y');

            ctx.strokeStyle = color; ctx.setLineDash([4,4]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pxS, pyS); ctx.lineTo(pxR, pyR); ctx.lineTo(pxL, pyL); ctx.stroke();
            ctx.fillStyle = color; ctx.beginPath(); ctx.arc(pxR, pyR, 4, 0, Math.PI*2); ctx.fill();
        };

        if(this.walls.side) {
            if(s.speakers.left) drawRay(s.speakers.left, 'left', '#f97316');
            if(s.speakers.right) drawRay(s.speakers.right, 'right', '#f97316');
        }
        if(this.walls.front) {
            if(s.speakers.left) drawRay(s.speakers.left, 'front', '#fdba74');
            if(s.speakers.right) drawRay(s.speakers.right, 'front', '#fdba74');
        }
        if(this.walls.back) {
            if(s.speakers.left) drawRay(s.speakers.left, 'back', '#fb923c');
            if(s.speakers.right) drawRay(s.speakers.right, 'back', '#fb923c');
        }
    }
    
    updateTable() {
        const tbody = document.getElementById('rfTableBody');
        if(!tbody) return;
        const s = this.state.get();
        let rows = '';
        const C = 343;

        const calcPath = (spk, wall, name) => {
            if(!spk) return;
            const dDirect = Math.hypot(spk.x - s.listener.x, spk.y - s.listener.y);
            let dReflect = 0;
            if(wall === 'left') dReflect = Math.hypot(spk.x - (-s.listener.x), spk.y - s.listener.y);
            if(wall === 'right') dReflect = Math.hypot(spk.x - (2*s.room.width - s.listener.x), spk.y - s.listener.y);
            if(wall === 'front') dReflect = Math.hypot(spk.x - s.listener.x, spk.y - (-s.listener.y));
            if(wall === 'back') dReflect = Math.hypot(spk.x - s.listener.x, spk.y - (2*s.room.length - s.listener.y));

            const delay = ((dReflect - dDirect) / C) * 1000; 
            const atten = 20 * Math.log10(dDirect / dReflect);
            
            rows += `
                <tr class="hover:bg-slate-800/50 transition-colors">
                    <td class="py-2 pl-2 text-white">${name}</td>
                    <td class="py-2 text-orange-400">${wall.charAt(0).toUpperCase() + wall.slice(1)} Wall</td>
                    <td class="py-2">${dReflect.toFixed(2)}m</td>
                    <td class="py-2 font-bold text-slate-200">+${delay.toFixed(1)}ms</td>
                    <td class="py-2 pr-2 text-right text-slate-500">${atten.toFixed(1)} dB</td>
                </tr>
            `;
        };

        if(this.walls.side) {
            calcPath(s.speakers.left, 'left', 'Left Spk');
            calcPath(s.speakers.right, 'right', 'Right Spk');
        }
        if(this.walls.front) {
            calcPath(s.speakers.left, 'front', 'Left Spk');
            calcPath(s.speakers.right, 'front', 'Right Spk');
        }
        if(this.walls.back) {
            calcPath(s.speakers.left, 'back', 'Left Spk');
            calcPath(s.speakers.right, 'back', 'Right Spk');
        }

        if(rows === '') rows = '<tr><td colspan="5" class="py-4 text-center text-slate-600 italic">Enable walls in sidebar to see data</td></tr>';
        tbody.innerHTML = rows;
    }
}