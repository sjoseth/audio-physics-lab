/**
 * js/lab-modes.js
 * Inneholder logikken for hver visningsmodus (Room, Speaker, Reflection, TimeAlign).
 * * OPPDATERT: 
 * - Global speilings-støtte via StateManager.
 * - TimeAlignMode tvinger speiling av.
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

    onEnter() {
        this.active = true;
        // Bruk global mirror state som standard
        this.renderer.mirrorOverride = null;
    }

    getSidebarHTML() {
        const s = this.state.get();
        // Hent speilingsstatus fra global state
        const mirrorEnabled = s.mirror.enabled;
        const mirrorMode = s.mirror.mode;

        return `
            <div class="control-card p-4 rounded-xl bg-blue-950/20 border border-blue-900/30 space-y-4">
                <h3 class="text-xs font-bold text-blue-400 uppercase">Optimization</h3>
                
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

                <div>
                    <label class="text-[10px] text-slate-400 block mb-1">Crossover (Hz)</label>
                    <input type="range" id="rmInputXover" min="40" max="150" value="${this.settings.crossover}" class="range-slider w-full">
                    <div class="flex justify-between text-[10px] text-slate-500"><span>40Hz</span><span id="rmDispXover" class="text-white">${this.settings.crossover}Hz</span><span>150Hz</span></div>
                </div>

                <div>
                    <label class="text-[10px] text-slate-400 block mb-1">Max Frequency View</label>
                    <input type="range" id="rmInputMaxF" min="100" max="300" step="10" value="${this.settings.maxFreq}" class="range-slider w-full">
                    <div class="flex justify-between text-[10px] text-slate-500"><span>100Hz</span><span id="rmDispMaxF" class="text-white">${this.settings.maxFreq}Hz</span><span>300Hz</span></div>
                </div>

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
                    <input type="checkbox" id="rmCheckMirror" class="accent-blue-500" ${mirrorEnabled ? 'checked' : ''}>
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-[10px] text-slate-400">Mirror Around</label>
                    <select id="rmSelectMirrorMode" class="input-dark text-[10px] rounded p-1 w-28 bg-slate-900 border border-slate-700 text-white">
                        <option value="room" ${mirrorMode === 'room' ? 'selected' : ''}>Room Center</option>
                        <option value="listener" ${mirrorMode === 'listener' ? 'selected' : ''}>Listener</option>
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

        // Mirroring logic - UPDATED TO GLOBAL STATE
        const checkMirror = document.getElementById('rmCheckMirror');
        const selMirror = document.getElementById('rmSelectMirrorMode');
        
        const updateMirror = () => {
            this.state.update({ 
                mirror: { 
                    enabled: checkMirror.checked, 
                    mode: selMirror.value 
                } 
            });
        };
        checkMirror.addEventListener('change', updateMirror);
        selMirror.addEventListener('change', updateMirror);

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

    // ... (rest of Physics methods unchanged) ...
    calculateModes(width, length, height) {
        if (this.lastRoomDims.w === width && this.lastRoomDims.l === length && this.lastRoomDims.h === height && this.cachedModes.length > 0) {
            return this.cachedModes;
        }
        const modes = [];
        const L = width; const W = length; const H = height;
        const maxOrder = 20; const tanLim = 8; const maxF = 400;

        for (let n = 1; n <= maxOrder; n++) {
            let f = (this.C / 2) * (n / L); if (f < maxF) modes.push({ f, nx: n, ny: 0, nz: 0 });
            f = (this.C / 2) * (n / W); if (f < maxF) modes.push({ f, nx: 0, ny: n, nz: 0 });
            f = (this.C / 2) * (n / H); if (f < maxF) modes.push({ f, nx: 0, ny: 0, nz: n });
        }
        for (let x = 1; x <= tanLim; x++) for (let y = 1; y <= tanLim; y++) {
            const f = (this.C / 2) * Math.sqrt((x / L) ** 2 + (y / W) ** 2);
            if (f < maxF) modes.push({ f, nx: x, ny: y, nz: 0 });
        }
        for (let x = 1; x <= tanLim; x++) for (let z = 1; z <= tanLim; z++) {
            const f = (this.C / 2) * Math.sqrt((x / L) ** 2 + (z / H) ** 2);
            if (f < maxF) modes.push({ f, nx: x, ny: 0, nz: z });
        }
        for (let y = 1; y <= tanLim; y++) for (let z = 1; z <= tanLim; z++) {
            const f = (this.C / 2) * Math.sqrt((y / W) ** 2 + (z / H) ** 2);
            if (f < maxF) modes.push({ f, nx: 0, ny: y, nz: z });
        }
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
            data.push(db);
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
                const xVal = xAxis.getPixelForValue(this.settings.crossover);
                if (xVal >= xAxis.left && xVal <= xAxis.right) {
                    ctx.save();
                    ctx.beginPath(); ctx.moveTo(xVal, yAxis.top); ctx.lineTo(xVal, yAxis.bottom);
                    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(147, 197, 253, 0.5)'; ctx.setLineDash([4, 4]); ctx.stroke();
                    ctx.fillStyle = 'rgba(147, 197, 253, 0.7)'; ctx.textAlign = 'right'; ctx.font = '10px sans-serif';
                    ctx.fillText(`XO ${this.settings.crossover}Hz`, xVal - 4, yAxis.top + 10);
                    ctx.restore();
                }
            }
        };

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    { label: 'Subwoofer', data: [], borderColor: '#60a5fa', borderWidth: 2, pointRadius: 0, tension: 0.3, order: 2 },
                    { label: 'Main Speakers', data: [], borderColor: '#fbbf24', borderWidth: 2, pointRadius: 0, tension: 0.3, order: 3 },
                    { label: 'Combined', data: [], borderColor: '#c084fc', borderWidth: 3, pointRadius: 0, tension: 0.3, order: 1 },
                    { label: 'Target', data: [], borderColor: 'rgba(255, 255, 255, 0.5)', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, order: 4 },
                    { label: 'Target High', data: [], borderColor: 'transparent', borderWidth: 0, pointRadius: 0, fill: false, order: 5 },
                    { label: 'Target Band', data: [], borderColor: 'transparent', borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: '-1', order: 6 },
                    { label: '0dB', data: [], borderColor: 'rgba(255, 255, 255, 0.15)', borderWidth: 1, pointRadius: 0, order: 10 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { type: 'linear', min: 20, max: 150, ticks: { stepSize: 20, color: '#64748b' }, grid: { color: '#1e293b' } },
                    y: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' } } 
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
        
        const getSpeakerResponse = (speakerPos) => {
            if (!speakerPos) return Array(this.settings.maxFreq + 1).fill(-60);
            let data = this.simulatePoint(modes, speakerPos, s.listener, s.room.width, s.room.length, s.room.height, this.settings.maxFreq);
            if (this.settings.couchMode) {
                const offset = 0.5;
                const lPos = { ...s.listener, x: Math.max(0.1, s.listener.x - offset) };
                const rPos = { ...s.listener, x: Math.min(s.room.width - 0.1, s.listener.x + offset) };
                const dataL = this.simulatePoint(modes, speakerPos, lPos, s.room.width, s.room.length, s.room.height, this.settings.maxFreq);
                const dataR = this.simulatePoint(modes, speakerPos, rPos, s.room.width, s.room.length, s.room.height, this.settings.maxFreq);
                const averaged = [];
                for(let i=0; i<data.length; i++) averaged.push((data[i] + dataL[i] + dataR[i]) / 3);
                data = averaged;
            }
            return data;
        };

        const rawSubData = getSpeakerResponse(s.speakers.sub);
        const leftData = getSpeakerResponse(s.speakers.left);
        const rightData = getSpeakerResponse(s.speakers.right);
        const rawMainsData = [];
        for (let i = 0; i < leftData.length; i++) rawMainsData.push((leftData[i] + rightData[i]) / 2);

        const targetData = this.getTargetCurveData(this.settings.maxFreq + 1, this.settings.targetCurve);

        const getGainMatchOffset = (rawData, targetData, minHz, maxHz) => {
            let sumDiff = 0; let count = 0;
            const startIdx = Math.max(0, minHz - 20); 
            const endIdx = Math.min(rawData.length - 1, maxHz - 20);
            for (let i = startIdx; i <= endIdx; i++) {
                if (i < rawData.length && isFinite(rawData[i])) {
                    const diff = rawData[i] - targetData[i].y;
                    sumDiff += diff; count++;
                }
            }
            return count > 0 ? sumDiff / count : 0;
        };

        const offsetSub = getGainMatchOffset(rawSubData, targetData, 20, this.settings.crossover);
        const offsetMains = getGainMatchOffset(rawMainsData, targetData, this.settings.crossover, this.settings.maxFreq);
        
        const finalSub = []; const finalMains = []; const finalCombined = [];
        const targetHigh = []; const targetLow = []; const zeroLine = [];

        let minVal = Infinity; let maxVal = -Infinity;
        const CULL_THRESHOLD = -35; const XO_MARGIN = 10; 
        const fc = this.settings.crossover;

        for(let i=0; i<rawSubData.length; i++) {
            const freq = 20 + i;
            if (freq > this.settings.maxFreq) break; 
            
            const ratio = freq / fc;
            const lpGainLin = 1 / (1 + Math.pow(ratio, 4));
            const lpAttenDB = 20 * Math.log10(lpGainLin);
            const hpGainLin = Math.pow(ratio, 4) / (1 + Math.pow(ratio, 4));
            const hpAttenDB = (freq === 0) ? -60 : 20 * Math.log10(hpGainLin);

            let valSub = rawSubData[i] - offsetSub + lpAttenDB;
            if (valSub < CULL_THRESHOLD) valSub = null;
            if (valSub !== null) finalSub.push({ x: freq, y: valSub });

            let valMains = rawMainsData[i] - offsetMains + hpAttenDB;
            if (valMains < CULL_THRESHOLD) valMains = null;
            if (valMains !== null) finalMains.push({ x: freq, y: valMains });

            let valComb = null;
            const subLin = (valSub !== null) ? Math.pow(10, valSub / 20) : 0;
            const mainLin = (valMains !== null) ? Math.pow(10, valMains / 20) : 0;
            
            if (subLin > 0 || mainLin > 0) valComb = 20 * Math.log10(subLin + mainLin);
            if (valComb !== null && valComb < CULL_THRESHOLD) valComb = null;
            if (valComb !== null) finalCombined.push({ x: freq, y: valComb });

            if (this.visibility.sub && valSub !== null) {
                if (freq <= (this.settings.crossover + XO_MARGIN)) {
                    if (valSub < minVal) minVal = valSub; if (valSub > maxVal) maxVal = valSub;
                }
            }
            if (this.visibility.mains && valMains !== null) {
                if (freq >= (this.settings.crossover - XO_MARGIN)) {
                    if (valMains < minVal) minVal = valMains; if (valMains > maxVal) maxVal = valMains;
                }
            }
            if (this.visibility.combined && valComb !== null) {
                 if (freq <= (this.settings.crossover + XO_MARGIN) || freq >= (this.settings.crossover - XO_MARGIN)) {
                    if (valComb < minVal) minVal = valComb; if (valComb > maxVal) maxVal = valComb;
                 }
            }

            const tVal = targetData[i].y;
            const tLow = tVal - 3; const tHigh = tVal + 3;
            if (minVal !== Infinity) {
                 if (tLow < minVal && tLow > (minVal - 10)) minVal = tLow;
                 if (tHigh > maxVal && tHigh < (maxVal + 10)) maxVal = tHigh;
            } else { minVal = -10; maxVal = 10; }

            targetHigh.push({ x: freq, y: tVal + 3 });
            targetLow.push({ x: freq, y: tVal - 3 });
            zeroLine.push({ x: freq, y: 0 });
        }

        if (minVal !== Infinity && maxVal !== -Infinity) {
            const lower = minVal - 2; const upper = maxVal + 2;
            this.chart.options.scales.y.min = Math.floor(lower);
            this.chart.options.scales.y.max = Math.ceil(upper);
        } else {
            this.chart.options.scales.y.min = -15; this.chart.options.scales.y.max = 15;
        }
        
        this.chart.options.scales.x.max = this.settings.maxFreq;
        const ds = this.chart.data.datasets;
        ds[0].hidden = !this.visibility.sub; ds[0].data = finalSub;
        ds[1].hidden = !this.visibility.mains; ds[1].data = finalMains;
        ds[2].hidden = !this.visibility.combined; ds[2].data = finalCombined;
        ds[3].hidden = !this.visibility.target; ds[3].data = targetData.slice(0, finalSub.length); 
        ds[4].hidden = !this.visibility.target; ds[4].data = targetHigh;
        ds[5].hidden = !this.visibility.target; ds[5].data = targetLow;
        ds[6].data = zeroLine;
        this.chart.update('none');
    }

    generateHeatmap(btn) {
        const s = this.state.get();
        const modes = this.calculateModes(s.room.width, s.room.length, s.room.height);
        const rows = this.heatmap.rows; const cols = this.heatmap.cols;
        const sx = s.room.width / cols; const sy = s.room.length / rows;
        this.heatmap.data = [];
        let minScore = Infinity; let maxScore = -Infinity;

        const getRawTarget = (len, boost) => {
             const d = [];
             for(let i=0; i<len; i++) {
                 const f = 20+i;
                 let val = 0;
                 if (boost > 0) {
                    if (f <= 45) val = boost;
                    else if (f < 150) {
                        const r = (f - 45) / (150 - 45); val = boost * (1 - (1 - Math.cos(r * Math.PI)) / 2);
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
                const cx = x*sx + sx/2; const cy = y*sy + sy/2;
                const tempSub = { x: cx, y: cy, z: s.speakers.sub.z };
                let resp = this.simulatePoint(modes, tempSub, s.listener, s.room.width, s.room.length, s.room.height);
                
                if (this.settings.couchMode) {
                    const offset = 0.5;
                    const lPos = { ...s.listener, x: Math.max(0.1, s.listener.x - offset) };
                    const rPos = { ...s.listener, x: Math.min(s.room.width - 0.1, s.listener.x + offset) };
                    const respL = this.simulatePoint(modes, tempSub, lPos, s.room.width, s.room.length, s.room.height);
                    const respR = this.simulatePoint(modes, tempSub, rPos, s.room.width, s.room.length, s.room.height);
                    for(let i=0; i<resp.length; i++) resp[i] = (resp[i] + respL[i] + respR[i]) / 3;
                }

                let sumHigh = 0; let countHigh = 0;
                for (let i = 90; i < 130; i++) { 
                    if(i < resp.length && isFinite(resp[i])) { sumHigh += resp[i]; countHigh++; }
                }
                const off = (countHigh > 0) ? sumHigh / countHigh : 0;
                let err = 0; let mv = Infinity;

                for(let i=0; i<=limit; i++) {
                    const v = resp[i] - off; const diff = v - targetData[i]; 
                    if (diff < 0) err += (diff * diff) * 2.0; else err += (diff * diff) * 0.5; 
                    if (v < mv) mv = v;
                }
                const weightedRMSE = Math.sqrt(err / (limit + 1));
                const deepNullPenalty = Math.max(0, -mv - 10) * 0.5;
                const score = 1000 / (weightedRMSE + deepNullPenalty + 0.1);
                if (score < minScore) minScore = score; if (score > maxScore) maxScore = score;
                this.heatmap.data.push({ x: cx, y: cy, w: sx, h: sy, raw: score });
            }
        }
        
        const range = maxScore - minScore;
        this.heatmap.data.forEach(d => {
            if (range === 0) d.val = 0; else d.val = (d.raw - minScore) / range;
        });
        
        this.heatmap.active = true;
        document.getElementById('rmLegend').classList.remove('hidden');
        btn.innerText = "REFRESH HEATMAP"; btn.disabled = false;
        this.renderer.resize(); 
    }
}


// ============================================================================
// 2. SPEAKER MODE (Updated Mirroring)
// ============================================================================
class SpeakerMode extends LabMode {
    constructor(s, r) {
        super(s, r);
        this.chart = null;
        this.heatmap = { active: false, data: [], cols: 30, rows: 30, generating: false };
        this.settings = { smoothing: false, minHz: 20, maxHz: 20000 };
        this.C = 343;
        this.physParams = { wooferSize: 6.5, tweeterSize: 1.0, crossover: 2500, baffleWidth: 30 };
        this.overlay = 'none'; 
    }

    onEnter() {
        this.active = true;
        this.renderer.mirrorOverride = null; // Bruk global state
        this.syncMirrorSettings();
    }

    // Helper to initialize checkboxes correctly
    syncMirrorSettings() {
        const check = document.getElementById('spCheckMirror');
        const mode = document.getElementById('spSelectMirrorMode');
        // Trenger ikke sette renderer manuelt her lenger, da renderer leser global state
    }

    getSidebarHTML() {
        const s = this.state.get();
        const adv = s.advanced || {};
        const z = s.speakers.left.z || 1.0;
        const mirrorEnabled = s.mirror.enabled;
        const mirrorMode = s.mirror.mode;

        return `
            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mb-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-3">Guides & Overlays</h3>
                <div class="flex items-center justify-between">
                    <label class="text-[10px] text-slate-400">Placement Guide</label>
                    <select id="spSelectOverlay" class="input-dark text-[10px] rounded p-1 w-36 bg-slate-900 border border-slate-700 text-white">
                        <option value="none" ${this.overlay === 'none' ? 'selected' : ''}>None</option>
                        <option value="cardas" ${this.overlay === 'cardas' ? 'selected' : ''}>Cardas Method</option>
                        <option value="thirds" ${this.overlay === 'thirds' ? 'selected' : ''}>Rule of Thirds</option>
                    </select>
                </div>
            </div>

            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mb-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-3">Stereo Geometry</h3>
                <div class="grid grid-cols-3 gap-2 text-center">
                    <div class="bg-slate-900 rounded p-2 border border-slate-800">
                        <div class="text-[10px] text-slate-500">Angle</div>
                        <div id="spStatAngle" class="text-sm font-bold text-blue-400">--°</div>
                    </div>
                    <div class="bg-slate-900 rounded p-2 border border-slate-800">
                        <div class="text-[10px] text-slate-500">Spread</div>
                        <div id="spStatSpread" class="text-sm font-bold text-slate-200">--m</div>
                    </div>
                    <div class="bg-slate-900 rounded p-2 border border-slate-800">
                        <div class="text-[10px] text-slate-500">Distance</div>
                        <div id="spStatDist" class="text-sm font-bold text-slate-200">--m</div>
                    </div>
                </div>
            </div>

            ${this._getOriginalSidebarContent(s, adv, z, mirrorEnabled, mirrorMode)}
        `;
    }
    _getOriginalSidebarContent(s, adv, z, mirrorEnabled, mirrorMode) {
        return `
            <div class="control-card p-4 rounded-xl bg-green-950/20 border border-green-900/30 mb-4">
                <h3 class="text-xs font-bold text-green-400 mb-3 uppercase">Position & Alignment</h3>
                <div class="mb-3">
                    <div class="flex justify-between mb-1">
                        <label class="text-[10px] text-slate-400">Toe-In Angle</label>
                        <span id="spDispToe" class="text-[10px] font-mono text-white">${adv.toeInAngle || 10}°</span>
                    </div>
                    <input type="range" id="spInputToe" min="0" max="45" value="${adv.toeInAngle || 10}" class="range-slider w-full">
                </div>
                 <div class="mb-3">
                    <label class="text-[10px] text-slate-400 block mb-1">Speaker Height (Z)</label>
                    <input type="number" id="spInputZ" value="${z}" step="0.05" class="input-dark w-full rounded p-1 text-xs bg-slate-900 border border-slate-700 text-white">
                </div>
                <div class="flex items-center justify-between mb-2 border-t border-green-900/30 pt-2">
                    <label class="text-xs text-slate-300">Link Speakers</label>
                    <input type="checkbox" id="spCheckMirror" class="accent-green-500" ${mirrorEnabled ? 'checked' : ''}>
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-[10px] text-slate-400">Mirror Around</label>
                    <select id="spSelectMirrorMode" class="input-dark text-[10px] rounded p-1 w-24 bg-slate-900 border border-slate-700 text-white">
                        <option value="room" ${mirrorMode === 'room' ? 'selected' : ''}>Room Center</option>
                        <option value="listener" ${mirrorMode === 'listener' ? 'selected' : ''}>Listener</option>
                    </select>
                </div>
            </div>

            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mb-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-3">Graph Settings</h3>
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="text-[10px] text-slate-300">Psychoacoustic Smooth</label>
                        <input type="checkbox" id="spCheckSmooth" ${this.settings.smoothing ? 'checked' : ''} class="accent-blue-500">
                    </div>
                    <div class="flex gap-2">
                        <div class="flex-1">
                            <label class="text-[9px] text-slate-500">Min Hz</label>
                            <input type="number" id="spInputMinHz" value="${this.settings.minHz}" class="input-dark w-full rounded p-1 text-xs">
                        </div>
                        <div class="flex-1">
                            <label class="text-[9px] text-slate-500">Max Hz</label>
                            <input type="number" id="spInputMaxHz" value="${this.settings.maxHz}" class="input-dark w-full rounded p-1 text-xs">
                        </div>
                    </div>
                </div>
            </div>

            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700">
                <button id="spBtnHeatmap" class="btn-action w-full py-2 rounded text-xs font-bold text-white shadow-lg shadow-green-500/20 transition-all hover:scale-[1.02]">
                    OPTIMIZE PLACEMENT
                </button>
                <div id="spLegend" class="${this.heatmap.active ? '' : 'hidden'} pt-2 transition-all mt-2">
                    <div class="flex justify-between text-[10px] text-slate-400 mb-1"><span>Poor</span><span>Optimal</span></div>
                    <div class="h-2 w-full bg-gradient-to-r from-red-600 via-yellow-500 to-green-500 rounded-full border border-slate-700"></div>
                </div>
            </div>
        `;
    }

    getBottomPanelHTML() {
        return `<div class="relative w-full h-full p-2"><canvas id="spSbirChart"></canvas></div>`;
    }

    bindEvents() {
        const updateAdv = (key, val) => {
            const curr = this.state.get().advanced || {};
            this.state.update({ advanced: { ...curr, [key]: val } });
        };

        const rngToe = document.getElementById('spInputToe');
        const dispToe = document.getElementById('spDispToe');
        if(rngToe) {
            rngToe.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                dispToe.innerText = val + "°";
                updateAdv('toeInAngle', val);
                this.renderer.resize(); 
                this.updateChart();     
            });
        }

        // Mirroring (Link) - GLOBAL STATE UPDATE
        const checkMirror = document.getElementById('spCheckMirror');
        const selMirror = document.getElementById('spSelectMirrorMode');
        
        const updateMirror = () => {
            this.state.update({ 
                mirror: { 
                    enabled: checkMirror.checked, 
                    mode: selMirror.value 
                } 
            });
        };
        if(checkMirror) checkMirror.addEventListener('change', updateMirror);
        if(selMirror) selMirror.addEventListener('change', updateMirror);

        // Height (Z)
        const inputZ = document.getElementById('spInputZ');
        if(inputZ) {
            inputZ.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                const s = this.state.get();
                this.state.update({ 
                    speakers: {
                        ...s.speakers,
                        left: { ...s.speakers.left, z: val },
                        right: { ...s.speakers.right, z: val }
                    }
                });
            });
        }

        const selOverlay = document.getElementById('spSelectOverlay');
        if(selOverlay) {
            selOverlay.addEventListener('change', (e) => {
                this.overlay = e.target.value;
                this.renderer.resize(); // Trigger redraw via renderer loop
            });
        }

        const checkSmooth = document.getElementById('spCheckSmooth');
        if(checkSmooth) {
            checkSmooth.addEventListener('change', (e) => {
                this.settings.smoothing = e.target.checked;
                this.updateChart();
            });
        }
        
        const updateRange = () => {
            const minInput = document.getElementById('spInputMinHz');
            const maxInput = document.getElementById('spInputMaxHz');
            this.settings.minHz = minInput ? (parseFloat(minInput.value) || 20) : 20;
            this.settings.maxHz = maxInput ? (parseFloat(maxInput.value) || 20000) : 20000;
            
            if(this.chart) {
                this.chart.options.scales.x.min = this.settings.minHz;
                this.chart.options.scales.x.max = this.settings.maxHz;
                this.updateChart();
            }
        };
        const inMin = document.getElementById('spInputMinHz');
        const inMax = document.getElementById('spInputMaxHz');
        if(inMin) inMin.addEventListener('change', updateRange);
        if(inMax) inMax.addEventListener('change', updateRange);

        const btnHeat = document.getElementById('spBtnHeatmap');
        if(btnHeat) {
            btnHeat.addEventListener('click', () => {
                btnHeat.innerText = "CALCULATING...";
                btnHeat.disabled = true;
                setTimeout(() => this.generateHeatmap(btnHeat), 50);
            });
        }

        window.addEventListener('app-state-updated', () => {
            this.updateStats();
            this.updateChart();
        });

        this.initChart();
        this.updateStats();
        this.updateChart();
    }

    draw(ctx) {
        const s = this.state.get();
        const adv = s.advanced || { toeInAngle: 10 };
        const W = s.room.width;
        const L = s.room.length;

        // --- 1. TEGN STATISKE HJELPELINJER (W/3 og W/4) ---
        // Dette hjelper brukeren med å se symmetri og proporsjoner umiddelbart
        const w3_left = W / 3;
        const w4_left = W / 4;
        const w3_right = W - (W / 3);
        const w4_right = W - (W / 4);

        const y0 = this.renderer.toPx(0, 'y');
        const y1 = this.renderer.toPx(L, 'y');
        
        ctx.save();
        
        // Tegn svake "soner" mellom W/3 og W/4
        const px_w4_l = this.renderer.toPx(w4_left, 'x');
        const px_w3_l = this.renderer.toPx(w3_left, 'x');
        ctx.fillStyle = 'rgba(59, 130, 246, 0.03)'; // Svært svak blå
        ctx.fillRect(px_w3_l, y0, px_w4_l - px_w3_l, y1 - y0);

        const px_w4_r = this.renderer.toPx(w4_right, 'x');
        const px_w3_r = this.renderer.toPx(w3_right, 'x');
        ctx.fillRect(px_w3_r, y0, px_w4_r - px_w3_r, y1 - y0);

        // Tegn stiplede linjer
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)'; 
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        
        [w3_left, w4_left, w3_right, w4_right].forEach(mx => {
            const px = this.renderer.toPx(mx, 'x');
            ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
        });

        // Tegn 38% linjen (kjent utgangspunkt for lytterposisjon)
        const ly38 = L * 0.38;
        const py38 = this.renderer.toPx(ly38, 'y');
        const x0 = this.renderer.toPx(0, 'x');
        const x1 = this.renderer.toPx(W, 'x');
        
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.15)'; // Svak gul
        ctx.beginPath(); ctx.moveTo(x0, py38); ctx.lineTo(x1, py38); ctx.stroke();

        // Tegn etiketter
        ctx.fillStyle = 'rgba(148,163,184,0.4)'; 
        ctx.font = '9px sans-serif'; 
        ctx.textAlign = 'center';
        ctx.fillText('W/3', px_w3_l, y0 + 12);
        ctx.fillText('W/4', px_w4_l, y0 + 12);
        
        ctx.textAlign = 'right';
        ctx.fillText('38%', x0 + 20, py38 - 4);
        ctx.restore();


        // --- 2. TEGN HEATMAP (hvis aktiv) ---
        if (this.heatmap.active && this.heatmap.data.length > 0) {
            this.heatmap.data.forEach(cell => {
                const px = this.renderer.toPx(cell.x - cell.w/2, 'x');
                const py = this.renderer.toPx(cell.y - cell.h/2, 'y');
                const pw = this.renderer.toPx(cell.w, 'x') - this.renderer.toPx(0, 'x');
                const ph = this.renderer.toPx(cell.h, 'y') - this.renderer.toPx(0, 'y');
                const hue = cell.norm * 120;
                ctx.fillStyle = `hsla(${hue}, 70%, 45%, 0.4)`; 
                ctx.fillRect(px, py, pw, ph);
            });
        }


        // --- 3. TEGN OVERLAYS (Cardas / Thirds) ---
        if (this.overlay && this.overlay !== 'none') {
            let gx, gy, ly_ghost;

            // Hjelpefunksjon for å tegne "spøkelses-høyttaler"
            const drawGhostSpk = (x, y, name) => {
                const px = this.renderer.toPx(x, 'x');
                const py = this.renderer.toPx(y, 'y');
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; 
                ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
                ctx.strokeRect(px - 10, py - 10, 20, 20);
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'; 
                ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(name, px, py - 14); 
                ctx.restore();
            };

            // Hjelpefunksjon for "spøkelses-lytter"
            const drawGhostLis = (y, name) => {
                const px = this.renderer.toPx(W / 2, 'x');
                const py = this.renderer.toPx(y, 'y');
                ctx.save();
                ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)'; 
                ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.stroke();
                
                ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'; 
                ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(name, px, py + 20); 
                ctx.restore();
            };

            if (this.overlay === 'cardas') {
                // Cardas: Golden Ratio
                // Woofer plassering fra sidevegg: Room Width * 0.276
                // Woofer plassering fra bakvegg: Room Width * 0.447
                gx = W * 0.276; 
                gy = W * 0.447;
                
                drawGhostSpk(gx, gy, 'Cardas');
                drawGhostSpk(W - gx, gy, 'Cardas');
                
                // Cardas Golden Cuboid lytterposisjon (Likesidet trekant)
                const spread = W - (2 * gx); 
                const height = spread * Math.sin(Math.PI / 3); 
                ly_ghost = gy + height; 
                drawGhostLis(ly_ghost, 'Ref Pos');

            } else if (this.overlay === 'thirds') {
                // Rule of Thirds
                gx = W / 3; 
                gy = L / 3; // 1/3 ut i rommet

                drawGhostSpk(gx, gy, '1/3');
                drawGhostSpk(W - gx, gy, '1/3');
                
                // Lytter på 2/3
                ly_ghost = L * (2/3); 
                drawGhostLis(ly_ghost, '2/3');
            }
        }


        // --- 4. TEGN HØYTTALER-KONER OG LYTTER (Standard) ---
        const drawCone = (spk, label) => {
            const px = this.renderer.toPx(spk.x, 'x');
            const py = this.renderer.toPx(spk.y, 'y');
            const toeRad = (adv.toeInAngle || 10) * (Math.PI/180);
            
            const scaleX = this.renderer.toPx(1, 'x') - this.renderer.toPx(0, 'x');
            const scaleY = this.renderer.toPx(1, 'y') - this.renderer.toPx(0, 'y');

            let physAngle = Math.PI / 2; // Base nedover
            if (label === 'left') physAngle -= toeRad; 
            else physAngle += toeRad;

            const dx = Math.cos(physAngle) * scaleX;
            const dy = Math.sin(physAngle) * scaleY;
            const visualAngle = Math.atan2(dy, dx);

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(visualAngle); 
            
            ctx.fillStyle = 'rgba(234, 179, 8, 0.15)'; 
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(400, -40); ctx.lineTo(400, 40); ctx.fill();
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)'; ctx.lineWidth = 1; ctx.setLineDash([5,5]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(400, 0); ctx.stroke();
            ctx.restore();
        };

        if(s.speakers.left) drawCone(s.speakers.left, 'left');
        if(s.speakers.right) drawCone(s.speakers.right, 'right');
    }

    // ... (rest of SpeakerMode physics unchanged) ...
    updateStats() {
        const s = this.state.get();
        const dx = s.speakers.left.x - s.speakers.right.x;
        const dy = s.speakers.left.y - s.speakers.right.y;
        const spread = Math.hypot(dx, dy);
        
        const distL = Math.hypot(s.speakers.left.x - s.listener.x, s.speakers.left.y - s.listener.y);
        const distR = Math.hypot(s.speakers.right.x - s.listener.x, s.speakers.right.y - s.listener.y);
        const avgDist = (distL + distR) / 2;
        const deg = (2 * Math.asin(spread / (2 * avgDist))) * (180 / Math.PI);

        const elAng = document.getElementById('spStatAngle');
        const elSpr = document.getElementById('spStatSpread');
        const elDst = document.getElementById('spStatDist');
        
        if(elAng) {
            elAng.innerText = isNaN(deg) ? '--' : deg.toFixed(1) + '°';
            elAng.className = (deg > 50 && deg < 70) ? "text-sm font-bold text-green-400" : "text-sm font-bold text-orange-400";
        }
        if(elSpr) elSpr.innerText = spread.toFixed(2) + 'm';
        if(elDst) elDst.innerText = avgDist.toFixed(2) + 'm';
    }

    calculateComplexResponse(spk, isLeftSpeaker) {
        const s = this.state.get();
        const adv = s.advanced || {};
        const params = this.physParams;
        const woofRad = (params.wooferSize * 0.0254) / 2;
        const tweetRad = (params.tweeterSize * 0.0254) / 2;
        const xover = params.crossover;
        const reflectionCoeff = 0.85;

        const lx = s.listener.x; const ly = s.listener.y; const lz = s.listener.z || 1.1;
        const sx = spk.x; const sy = spk.y; const sz = spk.z || 1.0;
        const W = s.room.width; const L = s.room.length; const H = s.room.height;

        const dHoriz = Math.hypot(sx - lx, sy - ly);
        const dDirect = Math.sqrt(dHoriz**2 + (sz - lz)**2);
        const dFloor = Math.sqrt(dHoriz**2 + (sz + lz)**2);
        const dCeil = Math.sqrt(dHoriz**2 + (2*H - sz - lz)**2);
        
        const ly_mirror = (2 * L) - ly; 
        const dBackHoriz = Math.hypot(lx - sx, ly_mirror - sy);
        const dBack = Math.sqrt(dBackHoriz**2 + (sz - lz)**2);

        const dLeftWallHoriz = Math.hypot(sx - (-lx), sy - ly);
        const dLeftWall = Math.sqrt(dLeftWallHoriz**2 + (sz - lz)**2);

        const dRightWallHoriz = Math.hypot(sx - (2*W - lx), sy - ly);
        const dRightWall = Math.sqrt(dRightWallHoriz**2 + (sz - lz)**2);

        let spkAimAngle = Math.PI/2; 
        const toeRad = (adv.toeInAngle || 10) * (Math.PI/180);
        if (isLeftSpeaker) spkAimAngle -= toeRad; else spkAimAngle += toeRad;
        
        const getOffAxisDeg = (targetX, targetY) => {
            const angleToTarget = Math.atan2(targetY - sy, targetX - sx);
            let diff = Math.abs(angleToTarget - spkAimAngle);
            if(diff > Math.PI) diff = Math.abs(diff - 2*Math.PI);
            return diff * (180/Math.PI);
        };
        const degOffAxis = getOffAxisDeg(lx, ly);
        const degLeftWall = getOffAxisDeg(-lx, ly);
        const degRightWall = getOffAxisDeg(2*W - lx, ly);

        const data = [];
        for (let f = 20; f <= 20000; f *= 1.008) { 
            const k = (2 * Math.PI * f) / this.C;
            let r = 0.0; let i = 0.0; 

            const getBeam = (freq, deg) => {
                const radius = (freq >= xover) ? tweetRad : woofRad;
                const ka = k * radius;
                if (ka < 0.5) return 1.0;
                const lossDB = (ka - 0.5) * (deg / 90) * 12; 
                return Math.pow(10, -Math.min(40, lossDB) / 20);
            };

            const addPath = (dist, coeff, degOff) => {
                const mag = coeff * getBeam(f, degOff);
                const phase = k * dist;
                r += mag * Math.cos(phase);
                i += mag * Math.sin(phase);
            };

            addPath(dDirect, 1.0, degOffAxis);
            addPath(dFloor, reflectionCoeff, 45); 
            addPath(dCeil, reflectionCoeff, 45);
            addPath(dLeftWall, reflectionCoeff, degLeftWall); 
            addPath(dRightWall, reflectionCoeff, degRightWall);
            addPath(dBack, reflectionCoeff, degOffAxis);   
            data.push({ f, r, i });
        }
        return data;
    }

    applySmoothing(data, active) {
        if (!active) return data;
        const smoothed = [];
        const windowSize = 8; 
        for (let i = 0; i < data.length; i++) {
            let sum = 0; let count = 0;
            for (let j = i - windowSize; j <= i + windowSize; j++) {
                if (j >= 0 && j < data.length) { sum += data[j].y; count++; }
            }
            smoothed.push({ x: data[i].x, y: sum / count });
        }
        return smoothed;
    }

    initChart() {
        const ctx = document.getElementById('spSbirChart').getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: { 
                datasets: [
                    { label:'Left', data:[], borderColor:'#3b82f6', borderWidth:1.5, pointRadius:0, tension: 0.1 }, 
                    { label:'Right', data:[], borderColor:'#ef4444', borderWidth:1.5, pointRadius:0, tension: 0.1 },
                    { label:'Combined (Avg)', data:[], borderColor:'#a855f7', borderWidth:2.5, pointRadius:0, tension: 0.1 }
                ] 
            },
            options: { 
                responsive:true, maintainAspectRatio:false, animation: false,
                scales: { 
                    x: { 
                        type: 'logarithmic', min: this.settings.minHz, max: this.settings.maxHz,
                        ticks:{ color:'#64748b', callback: function(value) { if([20,50,100,200,500,1000,2000,5000,10000].includes(value)) return value; }}, 
                        grid:{color:'#1e293b'} 
                    }, 
                    y: { suggestedMin:-20, suggestedMax:10, grid:{color:'#1e293b'}, ticks:{color:'#64748b'} } 
                },
                plugins: { legend: { labels: { color: '#94a3b8' } }, tooltip: { mode: 'index', intersect: false } }
            }
        });
    }
    
    updateChart() {
        if(!this.chart) return;
        const s = this.state.get();
        
        const rawL = this.calculateComplexResponse(s.speakers.left, true);
        const rawR = this.calculateComplexResponse(s.speakers.right, false);

        const NORM = 14; 
        const toDB = (c) => 20 * Math.log10(Math.sqrt(c.r**2 + c.i**2) + 1e-9) - NORM;

        const dataL = rawL.map(p => ({ x: p.f, y: toDB(p) }));
        const dataR = rawR.map(p => ({ x: p.f, y: toDB(p) }));

        const dataComb = rawL.map((p, i) => {
            const pR = rawR[i];
            const sumR = p.r + pR.r;
            const sumI = p.i + pR.i;
            const magSum = Math.sqrt(sumR**2 + sumI**2);
            return { x: p.f, y: (20 * Math.log10((magSum / 2) + 1e-9)) - NORM };
        });

        this.chart.data.datasets[0].data = this.applySmoothing(dataL, this.settings.smoothing);
        this.chart.data.datasets[1].data = this.applySmoothing(dataR, this.settings.smoothing);
        this.chart.data.datasets[2].data = this.applySmoothing(dataComb, this.settings.smoothing);
        this.chart.update('none');
    }

    generateHeatmap(btn) {
        const s = this.state.get();
        const W = s.room.width; const L = s.room.length;
        const rows = this.heatmap.rows; const cols = this.heatmap.cols;
        const sx = W / cols; const sy = L / rows;
        this.heatmap.data = [];
        let min = Infinity; let max = -Infinity;
        const checkFreqs = [40, 60, 80, 100, 150]; 

        for(let y=0; y<rows; y++) {
            for(let x=0; x<cols; x++) {
                const cx = x*sx + sx/2; const cy = y*sy + sy/2;
                const spread = Math.abs((W - cx) - cx);
                const distToLis = Math.hypot(cx - s.listener.x, cy - s.listener.y);
                const angle = (2 * Math.asin(spread / (2 * distToLis))) * (180 / Math.PI);
                let geomScore = !isNaN(angle) ? Math.max(0, 1 - (Math.abs(60-angle)/30)) : 0;
                
                const dDir = Math.hypot(cx - s.listener.x, cy - s.listener.y);
                const dFront = Math.hypot(cx - s.listener.x, -cy - s.listener.y);
                let dSide;
                if (cx < W/2) dSide = Math.hypot(-cx - s.listener.x, cy - s.listener.y); 
                else dSide = Math.hypot((2*W - cx) - s.listener.x, cy - s.listener.y); 

                let err = 0;
                checkFreqs.forEach(f => {
                    const k = (2 * Math.PI * f) / 343;
                    let val = 1.0 + 0.7 * Math.cos(k*(dSide-dDir)) + 0.7 * Math.cos(k*(dFront-dDir));
                    err += Math.abs(20*Math.log10(Math.abs(val)+0.1));
                });
                
                const physScore = Math.max(0, 1 - (err / 60)); 
                const total = geomScore * 0.4 + physScore * 0.6;
                if (total < min) min = total; if (total > max) max = total;
                this.heatmap.data.push({ x: cx, y: cy, w: sx, h: sy, raw: total });
            }
        }
        const range = max - min;
        this.heatmap.data.forEach(d => d.norm = range === 0 ? 0 : (d.raw - min) / range);
        
        this.heatmap.active = true;
        document.getElementById('spLegend').classList.remove('hidden');
        btn.innerText = "REFRESH OPTIMIZATION"; btn.disabled = false;
        this.renderer.resize();
    }
}

// ============================================================================
// 3. REFLECTION MODE (Updated Mirroring)
// ============================================================================
class ReflectionMode extends LabMode {
    constructor(s, r) {
        super(s, r);
        this.walls = { side: true, front: false, back: false };
    }

    onEnter() {
        this.active = true;
        this.renderer.mirrorOverride = null; // Bruk global state
    }

    getSidebarHTML() {
        const s = this.state.get();
        const mirrorEnabled = s.mirror.enabled;
        const mirrorMode = s.mirror.mode;

        return `
            <div class="control-card p-4 rounded-xl bg-orange-950/20 border border-orange-900/30 space-y-3">
                <h3 class="text-xs font-bold text-orange-400 mb-2 uppercase">First Reflections</h3>
                
                <div class="flex justify-between items-center text-xs group relative">
                    <span class="text-slate-300">Side Walls</span>
                    <input type="checkbox" id="rfCheckSide" ${this.walls.side ? 'checked' : ''} class="accent-orange-500 cursor-pointer">
                </div>
                
                <div class="flex justify-between items-center text-xs group relative">
                    <span class="text-slate-300">Front Wall</span>
                    <input type="checkbox" id="rfCheckFront" ${this.walls.front ? 'checked' : ''} class="accent-orange-500 cursor-pointer">
                </div>
                
                <div class="flex justify-between items-center text-xs group relative">
                    <span class="text-slate-300">Back Wall</span>
                    <input type="checkbox" id="rfCheckBack" ${this.walls.back ? 'checked' : ''} class="accent-orange-500 cursor-pointer">
                </div>
            </div>

            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-3">Layout & Mirroring</h3>
                <div class="flex items-center justify-between mb-2">
                    <label class="text-xs text-slate-300">Link Speakers</label>
                    <input type="checkbox" id="rfCheckMirror" class="accent-blue-500" ${mirrorEnabled ? 'checked' : ''}>
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-[10px] text-slate-400">Mirror Around</label>
                    <select id="rfSelectMirrorMode" class="input-dark text-[10px] rounded p-1 w-28 bg-slate-900 border border-slate-700 text-white">
                        <option value="room" ${mirrorMode === 'room' ? 'selected' : ''}>Room Center</option>
                        <option value="listener" ${mirrorMode === 'listener' ? 'selected' : ''}>Listener</option>
                    </select>
                </div>
            </div>
            
            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
    <h3 class="text-xs font-bold text-slate-300 mb-2 uppercase">Acoustic Treatment</h3>
    <div class="text-[10px] text-slate-400 leading-relaxed space-y-2">
        <p>
            The orange dots mark the exact impact points on your walls. These are the optimal locations for placing acoustic absorption panels.
        </p>
        <ul class="space-y-1 mt-2">
            <li>
                <span class="text-orange-400 font-bold">Solid Line:</span> 
                <span class="text-slate-300">Primary Reflection.</span> 
                Treat these first to improve clarity and imaging.
            </li>
            <li>
                <span class="text-orange-300 font-bold">Dashed Line:</span> 
                <span class="text-slate-300">Cross-Reflection.</span> 
                Sound from the opposite speaker (Left speaker reflecting on Right wall).
            </li>
        </ul>
    </div>
</div>
        `;
    }

    getBottomPanelHTML() {
        return `
            <div class="w-full h-full overflow-auto p-4 custom-scrollbar">
                <table class="w-full text-left text-[10px] md:text-xs text-slate-400">
                    <thead class="text-slate-500 font-bold uppercase border-b border-slate-700">
                        <tr>
                            <th class="py-2 pl-2">Source</th>
                            <th class="py-2">Wall</th>
                            <th class="py-2">Distance</th>
                            <th class="py-2">Delay</th>
                            <th class="py-2 pr-2 text-right">Atten.</th>
                        </tr>
                    </thead>
                    <tbody id="rfTableBody" class="font-mono divide-y divide-slate-800/50"></tbody>
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
        
        // Mirroring (Link) - GLOBAL STATE UPDATE
        const checkMirror = document.getElementById('rfCheckMirror');
        const selMirror = document.getElementById('rfSelectMirrorMode');
        
        const updateMirror = () => {
            this.state.update({ 
                mirror: { 
                    enabled: checkMirror.checked, 
                    mode: selMirror.value 
                } 
            });
        };
        if(checkMirror) checkMirror.addEventListener('change', updateMirror);
        if(selMirror) selMirror.addEventListener('change', updateMirror);
        
        window.addEventListener('app-state-updated', () => this.updateTable());
        this.updateTable();
    }

    draw(ctx) {
        const s = this.state.get();
        const lx = s.listener.x; const ly = s.listener.y;
        const W = s.room.width; const L = s.room.length;

        const drawDimensionLine = (startX, startY, endX, endY, val, layer = 0, isVertical) => {
            const pxStart = this.renderer.toPx(startX, 'x');
            const pyStart = this.renderer.toPx(startY, 'y');
            const pxEnd = this.renderer.toPx(endX, 'x');
            const pyEnd = this.renderer.toPx(endY, 'y');
            
            let offX = 0; let offY = 0;
            const dist = 25 + (layer * 30); 

            if (isVertical) {
                const direction = startX < W/2 ? 1 : -1; offX = dist * direction;
            } else {
                const direction = startY < L/2 ? 1 : -1; offY = dist * direction;
            }

            const p1x = pxStart + offX; const p1y = pyStart + offY;
            const p2x = pxEnd + offX;   const p2y = pyEnd + offY;

            ctx.save();
            ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
            const tickSz = 4;
            if(isVertical) {
                 ctx.beginPath(); ctx.moveTo(p1x-tickSz, p1y); ctx.lineTo(p1x+tickSz, p1y); ctx.stroke();
                 ctx.beginPath(); ctx.moveTo(p2x-tickSz, p2y); ctx.lineTo(p2x+tickSz, p2y); ctx.stroke();
            } else {
                 ctx.beginPath(); ctx.moveTo(p1x, p1y-tickSz); ctx.lineTo(p1x, p1y+tickSz); ctx.stroke();
                 ctx.beginPath(); ctx.moveTo(p2x, p2y-tickSz); ctx.lineTo(p2x, p2y+tickSz); ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(71, 85, 105, 0.3)'; ctx.setLineDash([2, 2]);
            ctx.beginPath(); ctx.moveTo(pxEnd, pyEnd); ctx.lineTo(p2x, p2y); ctx.stroke();

            const txt = val.toFixed(2) + 'm'; const met = ctx.measureText(txt);
            const mx = (p1x + p2x) / 2; const my = (p1y + p2y) / 2;
            ctx.fillStyle = '#0f172a'; ctx.fillRect(mx - met.width/2 - 2, my - 6, met.width + 4, 12);
            ctx.fillStyle = layer > 0 ? '#fb923c' : '#fdba74'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(txt, mx, my);
            ctx.restore();
        };

        const processReflection = (spk, wall, isSecondary = false) => {
            let refX, refY, mirX, mirY; const sx = spk.x; const sy = spk.y;
            if (wall === 'left') {
                mirX = -sx; mirY = sy;
                const m = (ly - mirY) / (lx - mirX);
                refY = mirY + m * (0 - mirX); refX = 0;
            } else if (wall === 'right') {
                mirX = W + (W - sx); mirY = sy;
                const m = (ly - mirY) / (lx - mirX);
                refY = mirY + m * (W - mirX); refX = W;
            } else if (wall === 'front') {
                mirX = sx; mirY = -sy;
                const m = (ly - mirY) / (lx - mirX);
                refX = (0 - mirY)/m + mirX; refY = 0;
            } else if (wall === 'back') {
                mirX = sx; mirY = L + (L - sy);
                const m = (ly - mirY) / (lx - mirX);
                refX = (L - mirY)/m + mirX; refY = L;
            }

            if ((wall === 'left' || wall === 'right') && (refY < 0 || refY > L)) return;
            if ((wall === 'front' || wall === 'back') && (refX < 0 || refX > W)) return;

            const pxS = this.renderer.toPx(sx, 'x'); const pyS = this.renderer.toPx(sy, 'y');
            const pxR = this.renderer.toPx(refX, 'x'); const pyR = this.renderer.toPx(refY, 'y');
            const pxL = this.renderer.toPx(lx, 'x'); const pyL = this.renderer.toPx(ly, 'y');

            ctx.save();
            if (isSecondary) { ctx.strokeStyle = 'rgba(249, 115, 22, 0.4)'; ctx.setLineDash([4, 4]); } 
            else { ctx.strokeStyle = 'rgba(249, 115, 22, 0.7)'; ctx.setLineDash([]); }
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pxS, pyS); ctx.lineTo(pxR, pyR); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(pxR, pyR); ctx.lineTo(pxL, pyL); ctx.stroke();
            ctx.fillStyle = isSecondary ? '#fb923c' : '#f97316';
            ctx.beginPath(); ctx.arc(pxR, pyR, isSecondary ? 3 : 4, 0, Math.PI*2); ctx.fill();

            const layer = isSecondary ? 1 : 0;
            if (wall === 'left' || wall === 'right') {
                const distFront = refY; const distBack = L - refY;
                if (distFront < distBack) drawDimensionLine(refX, 0, refX, refY, refY, layer, true);
                else drawDimensionLine(refX, L, refX, refY, L-refY, layer, true);
            } else {
                const distLeft = refX; const distRight = W - refX;
                if (distLeft < distRight) drawDimensionLine(0, refY, refX, refY, refX, layer, false);
                else drawDimensionLine(W, refY, refX, refY, W-refX, layer, false);
            }
            ctx.restore();
        };

        if (this.walls.side) {
            if (s.speakers.left) processReflection(s.speakers.left, 'left', false);
            if (s.speakers.right) processReflection(s.speakers.right, 'right', false);
            if (s.speakers.left) processReflection(s.speakers.left, 'right', true);
            if (s.speakers.right) processReflection(s.speakers.right, 'left', true);
        }
        if (this.walls.front) {
            if (s.speakers.left) processReflection(s.speakers.left, 'front', false);
            if (s.speakers.right) processReflection(s.speakers.right, 'front', false);
        }
        if (this.walls.back) {
            if (s.speakers.left) processReflection(s.speakers.left, 'back', false);
            if (s.speakers.right) processReflection(s.speakers.right, 'back', false);
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
            let delayColor = 'text-slate-200';
            if(delay < 5) delayColor = 'text-red-400 font-bold'; 
            else if(delay < 15) delayColor = 'text-yellow-400';

            rows += `
                <tr class="hover:bg-slate-800/50 transition-colors border-b border-slate-800/50">
                    <td class="py-2 pl-2 text-white text-[10px]">${name}</td>
                    <td class="py-2 text-orange-400 text-[10px]">${wall.charAt(0).toUpperCase() + wall.slice(1)}</td>
                    <td class="py-2 text-slate-400">${dReflect.toFixed(2)}m</td>
                    <td class="py-2 ${delayColor}">+${delay.toFixed(1)}ms</td>
                    <td class="py-2 pr-2 text-right text-slate-500">${atten.toFixed(1)} dB</td>
                </tr>
            `;
        };

        if(this.walls.side) { calcPath(s.speakers.left, 'left', 'Left Spk'); calcPath(s.speakers.right, 'right', 'Right Spk'); }
        if(this.walls.front) { calcPath(s.speakers.left, 'front', 'Left Spk'); calcPath(s.speakers.right, 'front', 'Right Spk'); }
        if(this.walls.back) { calcPath(s.speakers.left, 'back', 'Left Spk'); calcPath(s.speakers.right, 'back', 'Right Spk'); }
        if(rows === '') rows = '<tr><td colspan="5" class="py-8 text-center text-slate-600 italic">Select walls in the sidebar to visualize reflections</td></tr>';
        tbody.innerHTML = rows;
    }
}

// ============================================================================
// 4. TIME ALIGN MODE (New Implementation)
// ============================================================================
class TimeAlignMode extends LabMode {
    constructor(s, r) {
        super(s, r);
        this.settings = { crossover: 80, speedOfSound: 343 };
    }

    onEnter() {
        this.active = true;
        // FORCE MIRRORING OFF IN THIS MODE
        this.renderer.mirrorOverride = false;
    }

    getSidebarHTML() {
        return `
            <div class="control-card p-4 rounded-xl bg-purple-950/20 border border-purple-900/30 space-y-4">
                <h3 class="text-xs font-bold text-purple-400 uppercase">Time Alignment</h3>
                <p class="text-[10px] text-slate-400">
                    Calculates precise delay settings to ensure sound from all speakers arrives at the listener's ears simultaneously.
                </p>

                <div>
                    <label class="text-[10px] text-slate-400 block mb-1">Crossover Frequency (Hz)</label>
                    <input type="number" id="taInputXover" value="${this.settings.crossover}" class="input-dark w-full rounded p-1.5 text-xs bg-slate-900 border border-slate-700 text-white">
                </div>
                
                <div>
                    <label class="text-[10px] text-slate-400 block mb-1">Speed of Sound (m/s)</label>
                    <input type="number" id="taInputSpeed" value="${this.settings.speedOfSound}" class="input-dark w-full rounded p-1.5 text-xs bg-slate-900 border border-slate-700 text-white">
                </div>
            </div>

            <div class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-2">Instructions</h3>
                <ul class="list-disc list-inside text-[10px] text-slate-400 space-y-1">
                    <li>Input physical distances are calculated automatically from the 3D layout.</li>
                    <li>Enter the required delay values into your DSP / Receiver.</li>
                    <li>Check "Phase Recommendation" for Subwoofer polarity.</li>
                </ul>
            </div>
        `;
    }

    getBottomPanelHTML() {
        return `
            <div class="w-full h-full overflow-auto p-4 custom-scrollbar">
                <div class="flex flex-col md:flex-row gap-6">
                    <div class="flex-1">
                        <table class="w-full text-left text-[10px] md:text-xs text-slate-400">
                            <thead class="text-slate-500 font-bold uppercase border-b border-slate-700">
                                <tr>
                                    <th class="py-2 pl-2">Channel</th>
                                    <th class="py-2">Distance</th>
                                    <th class="py-2">Time of Flight</th>
                                    <th class="py-2 text-right pr-2 text-purple-400">Set Delay</th>
                                </tr>
                            </thead>
                            <tbody id="taTableBody" class="font-mono divide-y divide-slate-800/50">
                                </tbody>
                        </table>
                    </div>

                    <div class="w-full md:w-1/3 bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                        <h4 class="text-xs font-bold text-slate-300 uppercase mb-3">Subwoofer Integration</h4>
                        
                        <div class="flex justify-between items-center mb-2 border-b border-slate-700 pb-2">
                            <span class="text-[10px] text-slate-400">Phase Shift @ <span id="taDispXover">80</span>Hz</span>
                            <span id="taResDiff" class="font-mono text-white font-bold">--°</span>
                        </div>
                        
                        <div class="flex flex-col gap-1">
                            <span class="text-[10px] text-slate-400">Recommended Polarity:</span>
                            <div id="taResRec" class="text-xs font-bold text-slate-500 uppercase bg-slate-900/50 px-2 py-1.5 rounded text-center border border-slate-700">
                                --
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const inpXover = document.getElementById('taInputXover');
        const inpSpeed = document.getElementById('taInputSpeed');

        const updateParams = () => {
            this.settings.crossover = parseFloat(inpXover.value) || 80;
            this.settings.speedOfSound = parseFloat(inpSpeed.value) || 343;
            document.getElementById('taDispXover').innerText = this.settings.crossover;
            this.updateData();
            this.renderer.resize(); 
        };

        if(inpXover) inpXover.addEventListener('input', updateParams);
        if(inpSpeed) inpSpeed.addEventListener('input', updateParams);

        // NOTE: Mirroring is handled via renderer.mirrorOverride = false in onEnter()
        
        window.addEventListener('app-state-updated', () => {
            this.updateData();
            this.renderer.resize(); 
        });
        
        this.updateData();
    }

    draw(ctx) {
        const s = this.state.get();
        const lx = s.listener.x; const ly = s.listener.y; const lz = s.listener.z || 1.1;

        const drawTimeLine = (spk, color) => {
            if (!spk) return;
            const sx = spk.x; const sy = spk.y; const sz = spk.z || 0;
            const pxS = this.renderer.toPx(sx, 'x'); const pyS = this.renderer.toPx(sy, 'y');
            const pxL = this.renderer.toPx(lx, 'x'); const pyL = this.renderer.toPx(ly, 'y');

            ctx.save();
            ctx.beginPath(); ctx.moveTo(pxS, pyS); ctx.lineTo(pxL, pyL);
            ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke();

            const dist = Math.hypot(sx - lx, sy - ly, sz - lz);
            const ms = (dist / this.settings.speedOfSound) * 1000;
            const midX = (pxS + pxL) / 2; const midY = (pyS + pyL) / 2;
            const txt = ms.toFixed(1) + ' ms'; const met = ctx.measureText(txt);
            
            ctx.fillStyle = '#0f172a'; ctx.fillRect(midX - met.width/2 - 4, midY - 7, met.width + 8, 14);
            ctx.fillStyle = color; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(txt, midX, midY);
            ctx.restore();
        };

        if (s.speakers.left) drawTimeLine(s.speakers.left, '#60a5fa');
        if (s.speakers.right) drawTimeLine(s.speakers.right, '#ef4444');
        if (s.speakers.sub) drawTimeLine(s.speakers.sub, '#a855f7');
    }

    updateData() {
        const tbody = document.getElementById('taTableBody');
        const dispDiff = document.getElementById('taResDiff');
        const dispRec = document.getElementById('taResRec');
        if(!tbody) return;

        const s = this.state.get();
        const c = this.settings.speedOfSound;
        const l = s.listener;
        const getD = (p) => Math.hypot(p.x - l.x, p.y - l.y, (p.z||0) - (l.z||1.1));

        const dL = getD(s.speakers.left);
        const dR = getD(s.speakers.right);
        const dSub = getD(s.speakers.sub);

        const tL = (dL / c) * 1000;
        const tR = (dR / c) * 1000;
        const tSub = (dSub / c) * 1000;
        const maxT = Math.max(tL, tR, tSub);
        const delL = maxT - tL;
        const delR = maxT - tR;
        const delSub = maxT - tSub;

        const row = (label, dist, time, delay, colorClass) => `
            <tr class="hover:bg-slate-800/50 transition-colors border-b border-slate-800/50">
                <td class="py-2 pl-2 text-white font-medium">${label}</td>
                <td class="py-2 text-slate-400">${dist.toFixed(2)}m</td>
                <td class="py-2 text-slate-400">${time.toFixed(2)}ms</td>
                <td class="py-2 pr-2 text-right font-bold font-mono ${colorClass} text-sm">
                    ${delay < 0.01 ? '<span class="text-slate-600">0.00ms</span>' : delay.toFixed(2) + 'ms'}
                </td>
            </tr>
        `;

        tbody.innerHTML = 
            row('Left Speaker', dL, tL, delL, 'text-blue-400') +
            row('Right Speaker', dR, tR, delR, 'text-red-400') +
            row('Subwoofer', dSub, tSub, delSub, 'text-purple-400');

        const avgMainDist = (dL + dR) / 2;
        const diffMeters = Math.abs(dSub - avgMainDist);
        const lambda = c / this.settings.crossover;
        
        const cycles = diffMeters / lambda;
        const phaseShift = (cycles % 1) * 360;

        if (dispDiff) dispDiff.innerText = phaseShift.toFixed(0) + "°";

        if (dispRec) {
            if (phaseShift > 90 && phaseShift < 270) {
                dispRec.innerText = "INVERT POLARITY (180°)";
                dispRec.className = "text-xs font-bold text-orange-400 uppercase bg-orange-900/30 px-2 py-1.5 rounded text-center border border-orange-800/50 shadow-[0_0_10px_rgba(251,146,60,0.2)]";
            } else {
                dispRec.innerText = "NORMAL POLARITY (0°)";
                dispRec.className = "text-xs font-bold text-green-400 uppercase bg-green-900/30 px-2 py-1.5 rounded text-center border border-green-800/50 shadow-[0_0_10px_rgba(74,222,128,0.2)]";
            }
        }
    }
}

// ============================================================================
// 5. PEQ GENERATOR MODE (Standalone & Live)
// ============================================================================
class PeqMode extends LabMode {
    constructor(s, r) {
        super(s, r);
        this.chart = null;
        this.C = 343;
        
        // Settings state
        this.peq = {
            filters: [],
            threshold: 1.5,
            targetLevel: 'auto',
            targetCurve: 0,
            targetOffset: 0,
            crossover: 80,
            viewMaxF: 200,
            maxFilters: 5,
            minF: 20,
            maxF: 200,
            
            // NYE GRENSER
            maxCut: 12,    // Maks demping (dB)
            maxBoost: 0,   // Maks heving (dB)
            
            couchMode: false
        };

        this.pendingUpdate = false;
    }

    onEnter() {
        this.active = true;
        this.renderer.mirrorOverride = null;
        this.runAutoEQ(); 
    }

    getSidebarHTML() {
        return `
            <div class="control-card p-4 rounded-xl bg-pink-950/20 border border-pink-900/30 space-y-4">
                <h3 class="text-xs font-bold text-pink-400 uppercase">Auto EQ Generator</h3>
                <p class="text-[10px] text-slate-400">
                    Move the subwoofer to see filters update live. The algorithm targets peaks (and dips if boost is allowed) up to the crossover frequency.
                </p>

                <div class="space-y-3">
                    <div>
                        <label class="text-[10px] text-slate-400 block mb-1">Calculation Mode</label>
                        <div class="flex items-center justify-between bg-slate-900 p-2 rounded border border-slate-700">
                            <span class="text-xs text-slate-300">Couch Average (3-point)</span>
                            <input type="checkbox" id="peqCheckCouch" ${this.peq.couchMode ? 'checked' : ''} class="accent-pink-500">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="text-[10px] text-slate-400">Crossover (LPF)</label>
                            <input type="number" id="peqInputXover" value="${this.peq.crossover}" step="5" class="input-dark w-full rounded p-1 text-xs">
                        </div>
                        <div>
                            <label class="text-[10px] text-slate-400">Graph View Max</label>
                            <input type="number" id="peqInputViewMax" value="${this.peq.viewMaxF}" step="10" min="50" max="500" class="input-dark w-full rounded p-1 text-xs">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/50">
                        <div>
                            <label class="text-[10px] text-slate-400">Max Cut (dB)</label>
                            <input type="number" id="peqInputMaxCut" value="${this.peq.maxCut}" step="1" min="0" max="40" class="input-dark w-full rounded p-1 text-xs text-red-300">
                        </div>
                        <div>
                            <label class="text-[10px] text-slate-400">Max Boost (dB)</label>
                            <input type="number" id="peqInputMaxBoost" value="${this.peq.maxBoost}" step="1" min="0" max="10" class="input-dark w-full rounded p-1 text-xs text-green-300">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="text-[10px] text-slate-400">Threshold (dB)</label>
                            <input type="number" id="peqInputThresh" value="${this.peq.threshold}" step="0.5" class="input-dark w-full rounded p-1 text-xs">
                        </div>
                        <div>
                            <label class="text-[10px] text-slate-400">Max Filters</label>
                            <input type="number" id="peqInputCount" value="${this.peq.maxFilters}" step="1" class="input-dark w-full rounded p-1 text-xs">
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between mb-1">
                            <label class="text-[10px] text-slate-400">Target Boost (Harman)</label>
                            <span id="peqDispBoost" class="text-[10px] text-white">${this.peq.targetCurve}dB</span>
                        </div>
                        <input type="range" id="peqInputBoost" min="0" max="20" step="1" value="${this.peq.targetCurve}" class="range-slider w-full">
                    </div>
                    
                    <div>
                        <div class="flex justify-between mb-1">
                            <label class="text-[10px] text-slate-400">Target Level Offset</label>
                            <span id="peqDispOffset" class="text-[10px] text-white">${this.peq.targetOffset > 0 ? '+' : ''}${this.peq.targetOffset}dB</span>
                        </div>
                        <input type="range" id="peqInputOffset" min="-20" max="20" step="0.5" value="${this.peq.targetOffset}" class="range-slider w-full">
                    </div>
                </div>
            </div>

            <div id="peqResultContainer" class="control-card p-4 rounded-xl bg-slate-800/50 border border-slate-700 mt-4">
                <h3 class="text-xs font-bold text-slate-300 uppercase mb-2">Live Filters</h3>
                
                <div class="max-h-56 overflow-y-auto custom-scrollbar border border-slate-700 rounded bg-slate-900/50 mb-3">
                    <table class="w-full text-[10px] text-left">
                        <thead class="bg-slate-800 text-slate-400 sticky top-0">
                            <tr>
                                <th class="p-2 pl-3">Hz</th>
                                <th class="p-2">Gain</th>
                                <th class="p-2">Q</th>
                            </tr>
                        </thead>
                        <tbody id="peqTableBody" class="font-mono text-slate-300 divide-y divide-slate-800">
                            ${this.renderTableRows()}
                        </tbody>
                    </table>
                </div>
                
                <button id="peqBtnCopy" class="w-full py-2 rounded border border-slate-600 text-xs text-slate-300 hover:bg-slate-700 transition-colors flex items-center justify-center gap-2">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                    Copy to Clipboard
                </button>
            </div>
        `;
    }

    renderTableRows() {
        if (this.peq.filters.length === 0) {
            return `<tr><td colspan="3" class="p-4 text-center text-slate-500 italic">No peaks (or dips) found</td></tr>`;
        }
        return this.peq.filters.map(f => {
            // Fargekode Gain (Rød = cut, Grønn = boost)
            const colorClass = f.gain < 0 ? 'text-red-400' : 'text-green-400';
            const sign = f.gain > 0 ? '+' : '';
            return `
            <tr class="hover:bg-slate-800/50 transition-colors">
                <td class="p-1 pl-3 text-blue-300">${f.f}</td>
                <td class="p-1 ${colorClass} font-bold">${sign}${f.gain}</td>
                <td class="p-1 text-slate-400">${f.q}</td>
            </tr>
        `}).join('');
    }

    getBottomPanelHTML() {
        return `<div class="relative w-full h-full p-2"><canvas id="peqChart"></canvas></div>`;
    }

    bindEvents() {
        const bindInp = (id, key, type = 'float') => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('input', (e) => {
                const val = type === 'int' ? parseInt(e.target.value) : parseFloat(e.target.value);
                this.peq[key] = val;
                
                if(id === 'peqInputBoost') document.getElementById('peqDispBoost').innerText = val + 'dB';
                if(id === 'peqInputOffset') document.getElementById('peqDispOffset').innerText = (val > 0 ? '+' : '') + val + 'dB';
                
                this.triggerLiveUpdate();
            });
        };

        bindInp('peqInputThresh', 'threshold');
        bindInp('peqInputCount', 'maxFilters', 'int');
        bindInp('peqInputBoost', 'targetCurve');
        bindInp('peqInputOffset', 'targetOffset');
        bindInp('peqInputXover', 'crossover', 'int');
        bindInp('peqInputViewMax', 'viewMaxF', 'int');
        
        // NYE LISTENERS
        bindInp('peqInputMaxCut', 'maxCut');
        bindInp('peqInputMaxBoost', 'maxBoost');

        const chkCouch = document.getElementById('peqCheckCouch');
        if(chkCouch) chkCouch.addEventListener('change', (e) => {
            this.peq.couchMode = e.target.checked;
            this.triggerLiveUpdate();
        });

        const btnCopy = document.getElementById('peqBtnCopy');
        if(btnCopy) {
            btnCopy.addEventListener('click', () => {
                const txt = this.peq.filters.map(f => 
                    `Filter  ON  PK       Fc ${f.f} Hz  Gain ${f.gain} dB  Q ${f.q}`
                ).join('\n');
                navigator.clipboard.writeText(txt).then(() => {
                    const orig = btnCopy.innerHTML;
                    btnCopy.innerHTML = "Copied!";
                    setTimeout(() => btnCopy.innerHTML = orig, 1500);
                });
            });
        }

        window.addEventListener('app-state-updated', () => {
            if (this.active) this.triggerLiveUpdate();
        });

        this.initChart();
    }

    triggerLiveUpdate() {
        if (!this.pendingUpdate) {
            this.pendingUpdate = true;
            requestAnimationFrame(() => {
                this.runAutoEQ();
                this.pendingUpdate = false;
            });
        }
    }

    draw(ctx) {
        const s = this.state.get();
        const drawEnt = (pos, color) => {
            const px = this.renderer.toPx(pos.x, 'x');
            const py = this.renderer.toPx(pos.y, 'y');
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI*2); ctx.fill();
        };
        if(s.speakers.sub) drawEnt(s.speakers.sub, '#a855f7');
        drawEnt(s.listener, '#22c55e');
    }

    // --- PHYSICS & MATH ---

    calculateModes(L, W, H) {
        const modes = [];
        const maxOrder = 10; const maxF = 300; 
        
        for (let n = 1; n <= maxOrder; n++) {
            modes.push({ f: (this.C / 2) * (n / L), nx: n, ny: 0, nz: 0 });
            modes.push({ f: (this.C / 2) * (n / W), nx: 0, ny: n, nz: 0 });
            modes.push({ f: (this.C / 2) * (n / H), nx: 0, ny: 0, nz: n });
        }
        for (let x = 1; x <= 4; x++) for (let y = 1; y <= 4; y++) {
            const f = (this.C / 2) * Math.sqrt((x / L) ** 2 + (y / W) ** 2);
            if (f < maxF) modes.push({ f, nx: x, ny: y, nz: 0 });
        }
        for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) {
            const f = (this.C / 2) * Math.sqrt((x / L) ** 2 + (z / H) ** 2);
            if (f < maxF) modes.push({ f, nx: x, ny: 0, nz: z });
        }
        for (let y = 1; y <= 3; y++) for (let z = 1; z <= 3; z++) {
            const f = (this.C / 2) * Math.sqrt((y / W) ** 2 + (z / H) ** 2);
            if (f < maxF) modes.push({ f, nx: 0, ny: y, nz: z });
        }
        return modes.sort((a, b) => a.f - b.f);
    }

    simulatePoint(modes, srcPos, recPos, L, W, H) {
        const data = [];
        const dist = Math.hypot(srcPos.x - recPos.x, srcPos.y - recPos.y, (srcPos.z||0) - (recPos.z||0)) || 0.1;
        const dirScale = 100 / dist; 
        const damping = 10;

        for (let f = this.peq.minF; f <= 500; f++) {
            let r = 0; let i = 0;
            const k = (2 * Math.PI * f) / this.C;
            r += dirScale * Math.cos(-k * dist);
            i += dirScale * Math.sin(-k * dist);

            modes.forEach(m => {
                if (m.f > 400) return;
                const src = Math.cos(m.nx * Math.PI * srcPos.x / L) * Math.cos(m.ny * Math.PI * srcPos.y / W) * Math.cos(m.nz * Math.PI * (srcPos.z||0) / H);
                const rec = Math.cos(m.nx * Math.PI * recPos.x / L) * Math.cos(m.ny * Math.PI * recPos.y / W) * Math.cos(m.nz * Math.PI * (recPos.z||0) / H);
                const num = src * rec;
                const dr = (m.f ** 2) - (f ** 2);
                const di = (f * m.f) / damping; 
                const mag = dr ** 2 + di ** 2;
                const scl = 50000; 
                r += (num * dr * scl) / mag;
                i += (num * (-di) * scl) / mag;
            });
            data.push(20 * Math.log10(Math.sqrt(r ** 2 + i ** 2) + 1e-6));
        }
        return data;
    }

    calculateFilterGain(f, fc, gain, q) {
        if (gain === 0) return 0;
        const w = 2 * Math.PI * f / 48000; 
        const w0 = 2 * Math.PI * fc / 48000;
        const alpha = Math.sin(w0) / (2 * q);
        const A = Math.pow(10, gain / 40);
        const b0 = 1 + alpha * A; const b1 = -2 * Math.cos(w0); const b2 = 1 - alpha * A;
        const a0 = 1 + alpha / A; const a1 = -2 * Math.cos(w0); const a2 = 1 - alpha / A;
        const num = b0*b0 + b1*b1 + b2*b2 + 2*(b0*b1 + b1*b2)*Math.cos(w) + 2*b0*b2*Math.cos(2*w);
        const den = a0*a0 + a1*a1 + a2*a2 + 2*(a0*a1 + a1*a2)*Math.cos(w) + 2*a0*a2*Math.cos(2*w);
        return 10 * Math.log10(num / den);
    }

    getTargetCurveData(length, offset = 0) {
        const data = [];
        for (let i = 0; i < length; i++) {
            const f = this.peq.minF + i;
            let val = 0;
            if (this.peq.targetCurve > 0) {
                const lowCorner = 45; const highCorner = 150; 
                if (f <= lowCorner) val = this.peq.targetCurve;
                else if (f < highCorner) {
                    const ratio = (f - lowCorner) / (highCorner - lowCorner);
                    val = this.peq.targetCurve * (1 - (1 - Math.cos(ratio * Math.PI)) / 2);
                }
            }
            data.push(val + offset);
        }
        return data;
    }

    getGainMatchOffset(rawData, targetDataArr, minHz, maxHz) {
        let sumDiff = 0; let count = 0;
        const startIdx = Math.max(0, minHz - this.peq.minF);
        
        for (let i = 0; i < rawData.length; i++) {
            const p = rawData[i];
            if (p.f >= minHz && p.f <= maxHz) {
                const tVal = targetDataArr[i]; 
                const diff = p.db - tVal;
                sumDiff += diff;
                count++;
            }
        }
        return count > 0 ? sumDiff / count : 0;
    }

    // --- MAIN LOGIC (Med BOOST og Limits) ---

    runAutoEQ() {
        const s = this.state.get();
        const L = s.room.width; const W = s.room.length; const H = s.room.height;
        const modes = this.calculateModes(L, W, H);
        
        let rawResponse = this.simulatePoint(modes, s.speakers.sub, s.listener, L, W, H);
        
        if (this.peq.couchMode) {
            const offset = 0.5;
            const lPos = { ...s.listener, x: Math.max(0.1, s.listener.x - offset) };
            const rPos = { ...s.listener, x: Math.min(L - 0.1, s.listener.x + offset) };
            const respL = this.simulatePoint(modes, s.speakers.sub, lPos, L, W, H);
            const respR = this.simulatePoint(modes, s.speakers.sub, rPos, L, W, H);
            rawResponse = rawResponse.map((v, i) => (v + respL[i] + respR[i]) / 3);
        }

        this.currentRawData = rawResponse.map((v, i) => ({ f: this.peq.minF + i, db: v }));

        const baseTargetArr = this.getTargetCurveData(this.currentRawData.length, 0);
        const autoOffset = this.getGainMatchOffset(this.currentRawData, baseTargetArr, 20, this.peq.crossover);
        
        const workingData = this.currentRawData.map(p => ({ f: p.f, db: p.db - autoOffset }));
        const eqTargetData = this.getTargetCurveData(workingData.length, this.peq.targetOffset);

        this.peq.filters = [];
        const MIN_SEPARATION = 5; // Hz - Minimum avstand mellom filtre
        
        for (let iter = 0; iter < this.peq.maxFilters; iter++) {
            let maxDeviation = 0;
            let peakIdx = -1;
            let type = 'none';

            for (let i = 1; i < workingData.length - 1; i++) {
                const freq = workingData[i].f;
                
                // STOPP hvis over XO
                if (freq > this.peq.crossover) continue;

                // NYTT: Sjekk om vi er for nær et eksisterende filter
                const isTooClose = this.peq.filters.some(f => Math.abs(f.f - freq) < MIN_SEPARATION);
                if (isTooClose) continue;

                const diff = workingData[i].db - eqTargetData[i];
                
                // Sjekk Peak
                if (diff > this.peq.threshold) {
                    if (diff > maxDeviation) {
                        if (workingData[i].db > workingData[i-1].db && workingData[i].db > workingData[i+1].db) {
                            maxDeviation = diff;
                            peakIdx = i;
                            type = 'peak';
                        }
                    }
                }
                // Sjekk Dip
                else if (this.peq.maxBoost > 0 && diff < -this.peq.threshold) {
                    const absDiff = Math.abs(diff);
                    if (absDiff > maxDeviation) {
                        if (workingData[i].db < workingData[i-1].db && workingData[i].db < workingData[i+1].db) {
                            maxDeviation = absDiff;
                            peakIdx = i;
                            type = 'dip';
                        }
                    }
                }
            }

            if (peakIdx === -1) break;

            const peakF = workingData[peakIdx].f;
            const peakVal = workingData[peakIdx].db;
            let gain = 0;

            if (type === 'peak') {
                gain = -(maxDeviation - 1.0); 
                if (gain < -this.peq.maxCut) gain = -this.peq.maxCut;
            } else {
                gain = (maxDeviation - 1.0);
                if (gain > this.peq.maxBoost) gain = this.peq.maxBoost;
            }

            // Enkel Q-beregning
            let limitVal = peakVal - (type === 'peak' ? 3 : -3);
            let fLow = peakF; let fHigh = peakF;
            
            for(let j=peakIdx; j>=0; j--) {
                const val = workingData[j].db;
                if ((type === 'peak' && val <= limitVal) || (type === 'dip' && val >= limitVal)) { fLow = workingData[j].f; break; }
            }
            for(let j=peakIdx; j<workingData.length; j++) {
                const val = workingData[j].db;
                if ((type === 'peak' && val <= limitVal) || (type === 'dip' && val >= limitVal)) { fHigh = workingData[j].f; break; }
            }
            
            let bw = fHigh - fLow;
            if(bw < 2) bw = 2;
            let q = peakF / bw;
            if(q < 1.0) q = 1.0; if(q > 15) q = 15;

            const filter = { f: peakF, gain: parseFloat(gain.toFixed(1)), q: parseFloat(q.toFixed(2)) };
            this.peq.filters.push(filter);

            for(let i=0; i<workingData.length; i++) {
                workingData[i].db += this.calculateFilterGain(workingData[i].f, filter.f, filter.gain, filter.q);
            }
        }

        this.peq.filters.sort((a,b) => a.f - b.f);
        
        const tbody = document.getElementById('peqTableBody');
        if(tbody) {
            tbody.innerHTML = this.renderTableRows();
        }

        this.updateChart();
    }

    initChart() {
        const ctx = document.getElementById('peqChart').getContext('2d');
        const crossoverLinePlugin = {
            id: 'crossoverLine',
            afterDraw: (chart) => {
                if(!this.peq.crossover) return;
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;
                const xVal = xAxis.getPixelForValue(this.peq.crossover);
                
                if (xVal >= xAxis.left && xVal <= xAxis.right) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(xVal, yAxis.top);
                    ctx.lineTo(xVal, yAxis.bottom);
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = 'rgba(236, 72, 153, 0.4)'; 
                    ctx.setLineDash([5, 5]); ctx.stroke(); ctx.restore();
                }
            }
        };

        this.chart = new Chart(ctx, {
            type: 'line',
            data: { datasets: [] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: { 
                    x: { type: 'linear', min: 20, max: 200, ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
                    y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } } 
                },
                plugins: { legend: { labels: { color: '#94a3b8' } } }
            },
            plugins: [crossoverLinePlugin]
        });
    }

    updateChart() {
        if(!this.chart || !this.currentRawData) return;
        
        const baseTargetArr = this.getTargetCurveData(this.currentRawData.length, 0);
        const autoOffset = this.getGainMatchOffset(this.currentRawData, baseTargetArr, 20, this.peq.crossover);
        
        const applyLP = (f, db) => {
            const ratio = f / this.peq.crossover;
            const lpGain = 1 / (1 + Math.pow(ratio, 4));
            return db + 20 * Math.log10(lpGain);
        };

        const beforeData = this.currentRawData.map(p => ({ x: p.f, y: applyLP(p.f, p.db - autoOffset) }));
        const targetArr = this.getTargetCurveData(beforeData.length, this.peq.targetOffset);
        const targetData = targetArr.map((v, i) => ({ x: this.peq.minF + i, y: v }));

        const bandUpper = targetData.map(p => ({ x: p.x, y: p.y + this.peq.threshold }));
        const bandLower = targetData.map(p => ({ x: p.x, y: p.y - this.peq.threshold }));

        const afterData = beforeData.map(p => {
            let correction = 0;
            this.peq.filters.forEach(f => {
                correction += this.calculateFilterGain(p.x, f.f, f.gain, f.q);
            });
            return { x: p.x, y: p.y + correction };
        });

        const maxX = Math.max(100, this.peq.viewMaxF);
        this.chart.options.scales.x.max = maxX;

        const visiblePoints = [...beforeData, ...afterData].filter(p => p.x <= maxX && p.y > -20);
        if (visiblePoints.length > 0) {
            const yVals = visiblePoints.map(p => p.y);
            const minY = Math.min(...yVals);
            const maxY = Math.max(...yVals);
            this.chart.options.scales.y.min = Math.floor(minY - 3);
            this.chart.options.scales.y.max = Math.ceil(maxY + 3);
        }

        const filterDatasets = this.peq.filters.map((f, i) => {
            const fData = [];
            for(let freq = this.peq.minF; freq <= 500; freq++) {
                fData.push({ x: freq, y: this.calculateFilterGain(freq, f.f, f.gain, f.q) });
            }
            return {
                label: `F${i+1}: ${f.f}Hz`,
                data: fData,
                borderColor: 'rgba(56, 189, 248, 0.4)',
                borderWidth: 1,
                borderDash: [2, 2],
                pointRadius: 0,
                tension: 0.3,
                order: 10,
                fill: false
            };
        });

        this.chart.data.datasets = [
            { label: 'Limit', data: bandUpper, borderColor: 'transparent', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 0, pointRadius: 0, fill: 1, order: 4 },
            { label: 'Limit', data: bandLower, borderColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderDash: [2, 2], pointRadius: 0, fill: false, order: 4 },
            { label: 'Before EQ', data: beforeData, borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.3, order: 2 },
            { label: 'After EQ', data: afterData, borderColor: '#4ade80', borderWidth: 2, pointRadius: 0, tension: 0.3, order: 1 },
            { label: 'Target', data: targetData, borderColor: 'rgba(255, 255, 255, 0.3)', borderDash: [5, 5], borderWidth: 1, pointRadius: 0, order: 3 },
            ...filterDatasets
        ];
        
        this.chart.update('none');
    }
}