(function() {
    // Physics Constants
    const C = 343; 

    // Init State from Global Manager
    const global = window.appState.get();

    // Mapping Note: 
    // In this specific file, 'length' is used for X-axis (DimX) and 'width' for Y-axis (DimY).
    // Global state uses standard: width=X, length=Y. We map accordingly.
    const state = {
        room: { 
            length: global.room.width,  // Map Global Width (X) -> Local Length (X)
            width: global.room.length,  // Map Global Length (Y) -> Local Width (Y)
            height: global.room.height 
        },
        sub: { ...global.speakers.sub },
        listener: { ...global.listener },
        dampingQ: 10,
        crossover: 80,
        targetBoost: 0,
        couchMode: false, // <-- NY: State for Sofa Mode
        heatmap: { active: false, visible: false, data: [] },
        hovered: null
    };

    let isDragging = null;
    let myChart = null;

    const getEl = (id) => document.getElementById(id);
    
    const els = {
        canvas: getEl('roomCanvas'),
        container: getEl('canvasContainer'),
        inputs: {
            DimX: getEl('inputDimX'), DimY: getEl('inputDimY'), H: getEl('inputHeight'),
            SubZ: getEl('inputSubZ'), ListZ: getEl('inputListZ'), Q: getEl('inputQ'),
            Crossover: getEl('inputCrossover'), Target: getEl('inputTargetCurve'),
            Couch: getEl('checkCouchMode') // <-- NY: Checkbox input
        },
        displays: {
            Q: getEl('qValueDisplay'), Crossover: getEl('crossoverVal'),
            Sub: getEl('coordsSub'), List: getEl('coordsList'), Modes: getEl('modeList')
        },
        btnHeatmap: getEl('btnHeatmap'), legend: getEl('heatmapLegend'),
        toggleHeatmap: getEl('toggleHeatmapSim')
    };

    if (!els.canvas) return;

    const ctx = els.canvas.getContext('2d');
    const ctxChart = getEl('freqChart').getContext('2d');

    // --- SYNC LOGIC START ---
    
    // Set initial input values from state
    if(els.inputs.DimX) els.inputs.DimX.value = state.room.length;
    if(els.inputs.DimY) els.inputs.DimY.value = state.room.width;
    if(els.inputs.H) els.inputs.H.value = state.room.height;
    if(els.inputs.SubZ) els.inputs.SubZ.value = state.sub.z;
    if(els.inputs.ListZ) els.inputs.ListZ.value = state.listener.z;
    // Merk: Vi setter ikke checkbox state her, den er default false.

    // Listen for global updates
    window.addEventListener('app-state-updated', (e) => {
        const s = e.detail;
        
        // Update local state
        state.room.length = s.room.width;
        state.room.width = s.room.length;
        state.room.height = s.room.height;
        state.sub.x = s.speakers.sub.x;
        state.sub.y = s.speakers.sub.y;
        state.sub.z = s.speakers.sub.z;
        state.listener.x = s.listener.x;
        state.listener.y = s.listener.y;
        state.listener.z = s.listener.z;

        // Update DOM inputs to match new reality (only if not currently focused to avoid typing conflict)
        if(document.activeElement !== els.inputs.DimX) els.inputs.DimX.value = state.room.length;
        if(document.activeElement !== els.inputs.DimY) els.inputs.DimY.value = state.room.width;
        if(document.activeElement !== els.inputs.H) els.inputs.H.value = state.room.height;
        if(document.activeElement !== els.inputs.SubZ) els.inputs.SubZ.value = state.sub.z;
        if(document.activeElement !== els.inputs.ListZ) els.inputs.ListZ.value = state.listener.z;

        // Force redraw
        upd();
    });

    // --- SYNC LOGIC END ---

    function getTargetCurveData() {
        const data = [];
        const lowCorner = 45; const highCorner = 150;
        // CHANGED: 200 -> 150
        for (let f = 20; f <= 150; f++) {
            let val = 0;
            if (state.targetBoost !== 0) {
                if (f <= lowCorner) val = state.targetBoost;
                else if (f < highCorner) {
                    const ratio = (f - lowCorner) / (highCorner - lowCorner);
                    val = state.targetBoost * (1 - (1 - Math.cos(ratio * Math.PI)) / 2);
                }
            }
            data.push(val);
        }
        return data;
    }

    function getModes() {
        const modes = [];
        const L = state.room.length || 5.0;
        const W = state.room.width || 4.0;
        const H = state.room.height || 2.4;
        
        for (let n = 1; n <= 4; n++) {
            modes.push({ f: (C / 2) * (n / L), axis: 'L', nx: n, ny: 0, nz: 0 });
            modes.push({ f: (C / 2) * (n / W), axis: 'W', nx: 0, ny: n, nz: 0 });
            modes.push({ f: (C / 2) * (n / H), axis: 'H', nx: 0, ny: 0, nz: n });
        }
        for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) {
            modes.push({ f: (C / 2) * Math.sqrt((x / L) ** 2 + (y / W) ** 2), axis: 'XY', nx: x, ny: y, nz: 0 });
        }
        // Tangential XZ/YZ
        for (let x = 1; x <= 2; x++) for (let z = 1; z <= 2; z++) {
            modes.push({ f: (C / 2) * Math.sqrt((x / L) ** 2 + (z / H) ** 2), axis: 'XZ', nx: x, ny: 0, nz: z });
        }
        for (let y = 1; y <= 2; y++) for (let z = 1; z <= 2; z++) {
            modes.push({ f: (C / 2) * Math.sqrt((y / W) ** 2 + (z / H) ** 2), axis: 'YZ', nx: 0, ny: y, nz: z });
        }
        return modes.sort((a, b) => a.f - b.f);
    }

    // --- REFACTORED SIMULATE: Supports custom listener pos ---
    function simulate(sx_in, sy_in, lx_in, ly_in) {
        const modes = getModes();
        const L = state.room.length || 5.0;
        const W = state.room.width || 4.0;
        const H = state.room.height || 2.4;
        
        // Show modes only if running main simulation (no args)
        // CHANGED: 200 -> 150
        if (sx_in == null && els.displays.Modes) {
            els.displays.Modes.innerHTML = modes.filter(m => m.f < 150).map(m => 
                `<div class="flex justify-between border-b border-slate-800"><span class="text-blue-400 font-bold">${m.f.toFixed(0)}Hz</span><span class="text-slate-500">${m.axis}</span></div>`
            ).join('');
        }

        const d = [];
        const sx = sx_in ?? state.sub.x;
        const sy = sy_in ?? state.sub.y;
        const sz = state.sub.z;
        
        // Use custom listener if provided (for Couch Mode), otherwise state
        const lx = lx_in ?? state.listener.x;
        const ly = ly_in ?? state.listener.y;
        const lz = state.listener.z;

        const dist = Math.hypot(sx - lx, sy - ly, sz - lz) || 0.1;
        const dirScale = 200 / (dist ** 2);

        // CHANGED: 200 -> 150
        for (let f = 20; f <= 150; f++) {
            let r = 0; let i = 0;
            const k = (2 * Math.PI * f) / C;

            r += dirScale * Math.cos(-k * dist);
            i += dirScale * Math.sin(-k * dist);

            modes.forEach(m => {
                if (m.f > 250) return;
                const sc = Math.cos(m.nx * Math.PI * sx / L) * Math.cos(m.ny * Math.PI * sy / W) * Math.cos(m.nz * Math.PI * sz / H);
                const rc = Math.cos(m.nx * Math.PI * lx / L) * Math.cos(m.ny * Math.PI * ly / W) * Math.cos(m.nz * Math.PI * lz / H);
                const num = sc * rc;
                const dr = (m.f ** 2) - (f ** 2);
                const di = (f * m.f) / state.dampingQ;
                const mag = dr ** 2 + di ** 2;
                const scl = 50000;
                r += (num * dr * scl) / mag;
                i += (num * -di * scl) / mag;
            });
            d.push(20 * Math.log10(Math.sqrt(r ** 2 + i ** 2) + 1e-6));
        }
        return d;
    }

    // --- NEW: COUCH RESPONSE HELPER ---
    function getCouchResponse(subX, subY) {
        // 1. Calculate Center (Main)
        const resC = simulate(subX, subY, state.listener.x, state.listener.y);
        
        if (!state.couchMode) return resC;

        // 2. Calculate Left/Right Seats (+/- 50cm along X-axis)
        const offset = 0.5; // 50 cm
        
        // Clamp so we don't listen outside walls
        const lxL = Math.max(0.1, state.listener.x - offset);
        const lxR = Math.min(state.room.length - 0.1, state.listener.x + offset);

        const resL = simulate(subX, subY, lxL, state.listener.y);
        const resR = simulate(subX, subY, lxR, state.listener.y);

        // 3. Average the Magnitude Response
        return resC.map((val, i) => (val + resL[i] + resR[i]) / 3);
    }

    function toPx(m, axis) {
        const pad = 30;
        const dim = axis === 'x' ? els.canvas.width : els.canvas.height;
        const roomDim = axis === 'x' ? state.room.length : state.room.width;
        return pad + (m / roomDim) * (dim - 2 * pad);
    }
    
    function toMeters(px, axis) {
        const pad = 30;
        const dim = axis === 'x' ? els.canvas.width : els.canvas.height;
        const roomDim = axis === 'x' ? state.room.length : state.room.width;
        return Math.max(0, Math.min(roomDim, ((px - pad) / (dim - 2 * pad)) * roomDim));
    }

    function drawMeasurements(x, y, color) {
        const px = toPx(x, 'x');
        const py = toPx(y, 'y');
        const x0 = toPx(0, 'x');
        const x1 = toPx(state.room.length, 'x');
        const y0 = toPx(0, 'y');
        const y1 = toPx(state.room.width, 'y');

        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.fillStyle = '#ef4444';
        ctx.lineWidth = 1;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const drawArrow = (xStart, yStart, xEnd, yEnd) => {
            ctx.beginPath(); ctx.moveTo(xStart, yStart); ctx.lineTo(xEnd, yEnd); ctx.stroke();
            const ang = Math.atan2(yEnd - yStart, xEnd - xStart); const h = 6;
            ctx.beginPath(); ctx.moveTo(xEnd, yEnd); ctx.lineTo(xEnd - h * Math.cos(ang - Math.PI / 6), yEnd - h * Math.sin(ang - Math.PI / 6)); ctx.lineTo(xEnd - h * Math.cos(ang + Math.PI / 6), yEnd - h * Math.sin(ang + Math.PI / 6)); ctx.fill();
            ctx.beginPath(); ctx.moveTo(xStart, yStart); ctx.lineTo(xStart + h * Math.cos(ang - Math.PI / 6), yStart + h * Math.sin(ang - Math.PI / 6)); ctx.lineTo(xStart + h * Math.cos(ang + Math.PI / 6), yStart + h * Math.sin(ang + Math.PI / 6)); ctx.fill();
        };

        const drawLbl = (xStart, yStart, xEnd, yEnd, val) => {
            drawArrow(xStart, yStart, xEnd, yEnd);
            const mx = (xStart + xEnd) / 2; const my = (yStart + yEnd) / 2;
            const txt = val.toFixed(2) + "m"; const met = ctx.measureText(txt);
            ctx.save(); ctx.fillStyle = '#0f172a'; ctx.fillRect(mx - met.width / 2 - 2, my - 6, met.width + 4, 12); ctx.restore();
            ctx.fillText(txt, mx, my);
        };

        if (x < state.room.length / 2) drawLbl(px - 15, py, x0, py, x);
        else drawLbl(px + 15, py, x1, py, state.room.length - x);

        if (y < state.room.width / 2) drawLbl(px, py - 15, px, y0, y);
        else drawLbl(px, py + 15, px, y1, state.room.width - y);
        ctx.restore();
    }

    function draw() {
        if (!els.container || !els.canvas) return;
        const w = els.canvas.width;
        const h = els.canvas.height;
        const L = state.room.length;
        const W = state.room.width;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0b101e'; ctx.fillRect(0, 0, w, h);

        const x0 = toPx(0, 'x'); const y0 = toPx(0, 'y');
        const x1 = toPx(L, 'x'); const y1 = toPx(W, 'y');

        ctx.fillStyle = '#111827'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

        // --- DRAW HEATMAP IF ACTIVE AND VISIBLE ---
        if (state.heatmap.active && state.heatmap.visible) {
            state.heatmap.data.forEach(c => {
                ctx.fillStyle = `hsla(${c.norm * 120}, 70%, 45%, 0.5)`;
                ctx.fillRect(Math.floor(toPx(c.x - c.w / 2, 'x')), Math.floor(toPx(c.y - c.h / 2, 'y')), Math.ceil(toPx(c.w, 'x') - toPx(0, 'x')) + 1, Math.ceil(toPx(c.h, 'y') - toPx(0, 'y')) + 1);
            });
        }

        ctx.strokeStyle = '#374151'; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 1; i < L; i++) { const x = toPx(i, 'x'); ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
        for (let i = 1; i < W; i++) { const y = toPx(i, 'y'); ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
        ctx.stroke();

        ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

        // --- NYTT: VISUALISERING AV SOFA-PUNKTER (GHOST SEATS) ---
        if (state.couchMode) {
            const offset = 0.5; // 50cm
            // Beregn posisjoner (samme logikk som i getCouchResponse)
            const lxL = Math.max(0.1, state.listener.x - offset);
            const lxR = Math.min(state.room.length - 0.1, state.listener.x + offset);
            const ly = state.listener.y;

            const drawGhost = (mx, my) => {
                const px = toPx(mx, 'x'); 
                const py = toPx(my, 'y');
                ctx.save();
                // Tegn stiplet linje til hovedposisjon
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(toPx(state.listener.x, 'x'), toPx(state.listener.y, 'y'));
                ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.stroke();
                
                // Tegn selve punktet (gjennomsiktig grønn)
                ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
                ctx.beginPath(); ctx.arc(px, py, 6, 0, 2 * Math.PI); ctx.fill();
                ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
                ctx.setLineDash([]);
                ctx.stroke();
                ctx.restore();
            };

            drawGhost(lxL, ly);
            drawGhost(lxR, ly);
        }
        // ---------------------------------------------------------

        const drawIt = (t, x, y) => {
            const px = toPx(x, 'x'); const py = toPx(y, 'y');
            const c = t === 'sub' ? '#3b82f6' : '#22c55e';
            const isHover = state.hovered === t; const isDrag = isDragging === t;
            
            if (isHover || isDrag) drawMeasurements(x, y, c);

            ctx.save();
            if (isHover || isDrag) { ctx.shadowColor = c; ctx.shadowBlur = 15; }

            ctx.fillStyle = c;
            if (t === 'sub') {
                ctx.fillRect(px - 15, py - 15, 30, 30);
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(px - 15, py - 15, 30, 30);
            } else {
                ctx.beginPath(); ctx.arc(px, py, 10, 0, 2 * Math.PI); ctx.fill();
                ctx.fillStyle = '#064e3b'; ctx.beginPath(); ctx.moveTo(px - 4, py - 10); ctx.lineTo(px + 4, py - 10); ctx.lineTo(px, py - 16); ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            }
            ctx.restore();
        };

        if (isDragging === 'lis' || state.hovered === 'lis') { drawIt('sub', state.sub.x, state.sub.y); drawIt('lis', state.listener.x, state.listener.y); } 
        else { drawIt('lis', state.listener.x, state.listener.y); drawIt('sub', state.sub.x, state.sub.y); }

        if (els.displays.Sub) els.displays.Sub.innerText = `${state.sub.x.toFixed(2)}, ${state.sub.y.toFixed(2)}`;
        if (els.displays.List) els.displays.List.innerText = `${state.listener.x.toFixed(2)}, ${state.listener.y.toFixed(2)}`;
    }

    function resizeRoomSim() {
        if (els.container && els.canvas) {
            if (els.container.clientWidth === 0) return;
            els.canvas.width = els.container.clientWidth;
            els.canvas.height = els.container.clientHeight;
            requestAnimationFrame(() => { draw(); updateChart(); });
        }
    }

    // --- REFACTORED UPDATECHART: Uses getCouchResponse & Improved Scaling ---
    function updateChart() {
        // 1. Simulering og beregninger (COUCH AWARE)
        const res = getCouchResponse();
        const target = getTargetCurveData();

        // Beregn offset (normalisering)
        let sumHigh = 0; let countHigh = 0;
        // CHANGED: 130-180 -> 90-130 (110-150Hz range)
        for (let i = 90; i < 130; i++) {
            if (i < res.length && !isNaN(res[i])) {
                sumHigh += res[i]; countHigh++;
            }
        }
        const off = (countHigh > 0) ? sumHigh / countHigh : 0;

        // --- SMART ROLL-OFF LOGIC ---
        const responseData = res.map((v, i) => {
            const freq = 20 + i;
            let val = v - off;
            
            // Apply 24dB/oct roll-off above Crossover
            if (freq > state.crossover) {
                const octaves = Math.log2(freq / state.crossover);
                const attenuation = 24 * octaves;
                val -= attenuation;
                
                // Clip values below -25dB to keep chart clean
                if (val < -10) return null; 
            }
            return val;
        });

        // 2. Opprett Chart hvis den ikke finnes
        if (!myChart) {
            myChart = new Chart(ctxChart, {
                type: 'line',
                data: {
                    // CHANGED: 181 -> 131
                    labels: Array.from({ length: 131 }, (_, i) => i + 20),
                    datasets: [
                        {
                            label: 'Upper Limit',
                            data: [],
                            borderColor: 'transparent',
                            borderWidth: 0,
                            pointRadius: 0,
                            fill: 1,
                            backgroundColor: 'rgba(59, 130, 246, 0.15)',
                            order: 3
                        },
                        {
                            label: 'Lower Limit',
                            data: [],
                            borderColor: 'transparent',
                            borderWidth: 0,
                            pointRadius: 0,
                            fill: false,
                            order: 3
                        },
                        { 
                            label: 'Response', 
                            data: [], 
                            borderColor: '#60a5fa', 
                            borderWidth: 2, 
                            pointRadius: 0,
                            spanGaps: false, // Don't connect lines over null values
                            order: 1 
                        },
                        { 
                            label: 'Target', 
                            data: [], 
                            borderColor: 'rgba(255,255,255,0.4)', 
                            borderDash: [5, 5], 
                            pointRadius: 0,
                            order: 2
                        },
                        { 
                            label: '0dB Ref', 
                            // CHANGED: 181 -> 131
                            data: new Array(131).fill(0), 
                            borderColor: '#334155', 
                            borderWidth: 1, 
                            pointRadius: 0,
                            order: 4 
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { 
                            display: true, 
                            labels: { 
                                color: '#94a3b8',
                                filter: function(item, chart) {
                                    return !item.text.includes('Limit');
                                }
                            } 
                        },
                        tooltip: { 
                            enabled: true, 
                            backgroundColor: '#1e293b', 
                            titleColor: '#fff', 
                            bodyColor: '#fff', 
                            borderColor: '#334155', 
                            borderWidth: 1, 
                            callbacks: { 
                                label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(1) + ' dB' 
                            } 
                        }
                    },
                    scales: {
                        y: { 
                            // Dynamisk skala som viser dype dips, men holder seg stabil
                            suggestedMin: -5, 
                            suggestedMax: 5,
                            grid: { color: '#1e293b' }, 
                            ticks: { color: '#64748b' } 
                        },
                        x: { 
                            ticks: { maxTicksLimit: 12, color: '#64748b' }, 
                            grid: { color: '#1e293b' } 
                        }
                    }
                },
                // Plugin to draw Crossover Line correctly
                plugins: [{
                    id: 'crossoverLine',
                    afterDraw: (chart) => {
                        const ctx = chart.ctx;
                        const topY = chart.chartArea.top;
                        const bottomY = chart.chartArea.bottom;
                        
                        // Calc index based on freq (20Hz offset)
                        const dataIndex = state.crossover - 20;
                        const meta = chart.getDatasetMeta(0);
                        
                        if (meta.data[dataIndex]) {
                            const xVal = meta.data[dataIndex].x;

                            ctx.save();
                            ctx.beginPath();
                            ctx.moveTo(xVal, topY);
                            ctx.lineTo(xVal, bottomY);
                            ctx.lineWidth = 1;
                            ctx.strokeStyle = 'rgba(147, 197, 253, 0.5)';
                            ctx.setLineDash([4, 4]);
                            ctx.stroke();

                            ctx.fillStyle = 'rgba(147, 197, 253, 0.8)';
                            ctx.textAlign = 'right';
                            ctx.font = '10px Inter, sans-serif';
                            ctx.fillText(`XO ${state.crossover}Hz`, xVal - 4, topY + 10);
                            ctx.restore();
                        }
                    }
                }]
            });
        }

        // 3. Oppdater data
        const targetUpper = target.map(v => v + 3);
        const targetLower = target.map(v => v - 3);

        myChart.data.datasets[0].data = targetUpper;
        myChart.data.datasets[1].data = targetLower;
        myChart.data.datasets[2].data = responseData;
        myChart.data.datasets[3].data = target;
        
        myChart.update();
    }

    function upd() { resizeRoomSim(); }

    // --- REFACTORED GENERATE HEATMAP: Uses Couch Response & Weighted Score ---
    function generateHeatmap() {
        state.heatmap.active = true;
        state.heatmap.visible = true;
        state.heatmap.data = [];
        els.toggleHeatmap.checked = true;
        els.toggleHeatmap.disabled = false;
        
        const rows = 30; const cols = 30;
        const sx = state.room.length / cols; const sy = state.room.width / rows;
        const tgt = getTargetCurveData();
        let min = Infinity; let max = -Infinity;

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const cx = (x * sx) + sx / 2;
                const cy = (y * sy) + sy / 2;
                
                // USE COUCH RESPONSE HERE
                const res = getCouchResponse(cx, cy);
                
                // Calculate average offset (normalize level)
                let sh = 0; let c = 0;
                // CHANGED: 130-180 -> 90-130
                for (let i = 90; i < 130; i++) { if(!isNaN(res[i])){sh += res[i]; c++;} }
                const off = sh / c;

                let err = 0; 
                let mv = Infinity; // Minimum value tracker
                // CHANGED: 180 -> 130
                const limit = Math.min(130, state.crossover - 20);

                // Asymmetric scoring: Penalize dips more than peaks
                for (let i = 0; i <= limit; i++) {
                    const v = res[i] - off;
                    const diff = v - tgt[i];
                    
                    if (diff < 0) {
                        // Dip: Penalize heavily (2x)
                        err += (diff * diff) * 2.0;
                    } else {
                        // Peak: Penalize lightly (0.5x)
                        err += (diff * diff) * 0.5;
                    }

                    if (v < mv) mv = v;
                }
                
                // Final Score Calculation
                const weightedRMSE = Math.sqrt(err / (limit + 1));
                const deepNullPenalty = Math.max(0, -mv - 10) * 0.5; // Extra penalty for deep nulls
                
                const sc = 1000 / (weightedRMSE + deepNullPenalty + 0.1);

                if (sc < min) min = sc;
                if (sc > max) max = sc;
                state.heatmap.data.push({ x: cx, y: cy, w: sx, h: sy, val: sc });
            }
        }
        
        const diff = max - min;
        state.heatmap.data.forEach(d => d.norm = diff === 0 ? 0 : (d.val - min) / diff);
        els.legend.classList.remove('hidden');
        upd();
    }


    // --- REFACTORED UPDATE LOGIC ---
    function updateStateFromDOM(keepHeatmap = false) {
        state.room.length = parseFloat(els.inputs.DimX.value) || 5.0;
        state.room.width = parseFloat(els.inputs.DimY.value) || 4.0;
        state.room.height = parseFloat(els.inputs.H.value) || 2.4;
        state.sub.z = parseFloat(els.inputs.SubZ.value) || 0.3;
        state.listener.z = parseFloat(els.inputs.ListZ.value) || 1.1;
        state.dampingQ = parseFloat(els.inputs.Q.value) || 10;
        state.crossover = parseInt(els.inputs.Crossover.value) || 80;
        state.targetBoost = parseInt(els.inputs.Target.value) || 0;
        
        // Couch Mode update not needed here as it has its own listener, but sync state just in case
        if(els.inputs.Couch) state.couchMode = els.inputs.Couch.checked;

        els.displays.Q.innerText = state.dampingQ;
        els.displays.Crossover.innerText = state.crossover; // FIX: No "HzHz" bug

        // Boundaries
        const pd = 0.1;
        state.sub.x = Math.min(Math.max(pd, state.sub.x), state.room.length - pd);
        state.sub.y = Math.min(Math.max(pd, state.sub.y), state.room.width - pd);
        state.listener.x = Math.min(Math.max(pd, state.listener.x), state.room.length - pd);
        state.listener.y = Math.min(Math.max(pd, state.listener.y), state.room.width - pd);

        // Sync Global
        window.appState.update({
            room: { 
                width: state.room.length, // Mapping local X to global width
                length: state.room.width, // Mapping local Y to global length
                height: state.room.height 
            },
            speakers: { 
                sub: { x: state.sub.x, y: state.sub.y, z: state.sub.z } 
            },
            listener: { 
                x: state.listener.x, y: state.listener.y, z: state.listener.z 
            }
        });

        // Heatmap Logic
        if (!keepHeatmap) {
            state.heatmap.active = false;
            state.heatmap.visible = false;
            els.toggleHeatmap.checked = false;
            els.toggleHeatmap.disabled = true;
            els.legend.classList.add('hidden');
        }
        upd();
    }

    // Listeners for "Destructive" changes (Resets Heatmap)
    [els.inputs.DimX, els.inputs.DimY, els.inputs.H, els.inputs.ListZ, els.inputs.Q, els.inputs.Crossover, els.inputs.Target]
        .forEach(e => e.addEventListener('input', () => updateStateFromDOM(false)));

    // Listeners for "Non-Destructive" changes (Keeps Heatmap)
    els.inputs.SubZ.addEventListener('input', () => updateStateFromDOM(true));

    // NEW: Listener for Couch Mode
    if (els.inputs.Couch) {
        els.inputs.Couch.addEventListener('change', (e) => {
            state.couchMode = e.target.checked;
            updateChart(); // Live update of graph
            draw();
            // If heatmap is active, user needs to regenerate it manually to see effect
        });
    }

    // Drag Logic
    const getPos = (e) => {
        const r = els.canvas.getBoundingClientRect();
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: cx - r.left, y: cy - r.top };
    };

    const handleStart = (e) => {
        const p = getPos(e);
        const mx = toMeters(p.x, 'x');
        const my = toMeters(p.y, 'y');
        const hitS = Math.hypot(mx - state.sub.x, my - state.sub.y) < 0.5;
        const hitL = Math.hypot(mx - state.listener.x, my - state.listener.y) < 0.5;
        if (hitS) isDragging = 'sub'; else if (hitL) isDragging = 'lis';
        draw();
    };

    const handleMove = (e) => {
        const p = getPos(e);
        const mx = toMeters(p.x, 'x');
        const my = toMeters(p.y, 'y');
        
        const hitS = Math.hypot(mx - state.sub.x, my - state.sub.y) < 0.5;
        const hitL = Math.hypot(mx - state.listener.x, my - state.listener.y) < 0.5;
        const h = hitS ? 'sub' : (hitL ? 'lis' : null);
        if(state.hovered !== h) { state.hovered = h; draw(); }

        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();

        if (isDragging === 'sub') { 
            state.sub.x = mx; state.sub.y = my;
            updateStateFromDOM(true); // KEEP Heatmap
        } else { 
            state.listener.x = mx; state.listener.y = my; 
            updateStateFromDOM(false); // RESET Heatmap
        }
    };

    const handleEnd = () => { isDragging = null; draw(); };

    // Toggle Button Logic
    els.toggleHeatmap.addEventListener('change', (e) => {
        state.heatmap.visible = e.target.checked;
        if (state.heatmap.visible) els.legend.classList.remove('hidden');
        else els.legend.classList.add('hidden');
        draw();
    });

    els.btnHeatmap.addEventListener('click', () => {
        const oldTxt = els.btnHeatmap.innerText;
        els.btnHeatmap.innerText = 'CALCULATING...';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            generateHeatmap();
            els.btnHeatmap.innerText = oldTxt;
        }));
    });

    els.canvas.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    els.canvas.addEventListener('touchstart', handleStart, {passive: false});
    window.addEventListener('touchmove', handleMove, {passive: false});
    window.addEventListener('touchend', handleEnd);

    window.addEventListener('resize', resizeRoomSim);
    setTimeout(resizeRoomSim, 100);

})();