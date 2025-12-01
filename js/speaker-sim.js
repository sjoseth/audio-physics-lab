(function() {
    const global = window.appState.get();

    const spState = {
        room: { width: global.room.width, length: global.room.length, height: global.room.height },
        speakers: { 
            left: { x: global.speakers.left.x, y: global.speakers.left.y, z: global.speakers.left.z }, 
            right: { x: global.speakers.right.x, y: global.speakers.right.y, z: global.speakers.right.z } 
        },
        listener: { x: global.listener.x, y: global.listener.y, z: global.listener.z },
        adv: { ...global.advanced },
        
        mirror: true,
        mirrorMode: 'room',
        hovered: null,
        activeSpeaker: 'left',
        overlay: 'none', 
        heatmap: { active: false, visible: false, data: [], generating: false },
        sbirChart: null,
        graph: { smoothing: true, minHz: 20, maxHz: 20000 },
        // Cache for performance
        lastChartUpdate: 0
    };
    
    let isDragging = null;
    
    // Graph points (Full Range)
    const chartPoints = [];
    for (let f = 20; f <= 20000; f *= 1.05) chartPoints.push(f);

    // Heatmap points (Bass Focus 30-350Hz)
    const heatPoints = [];
    for (let f = 30; f <= 350; f *= 1.1) heatPoints.push(f);

    const getEl = (id) => document.getElementById(id);
    const els = {
        canvas: getEl('spCanvas'),
        container: getEl('spCanvasContainer'),
        sbirCanvas: getEl('sbirChart'), 
        inputs: { 
            W: getEl('spInputW'), L: getEl('spInputL'), H: getEl('spInputH'), 
            Mirror: getEl('spInputMirror'), MirrorMode: getEl('spMirrorMode'),
            Overlay: getEl('spOverlay'),
            ToeInMode: getEl('spInputToeInMode'), ToeInAngle: getEl('spInputToeInAngle'),
            DispToeIn: getEl('spDispToeIn'), ManualToeGroup: getEl('spManualToeInControl'),
            Woofer: getEl('spInputWoofer'), Tweeter: getEl('spInputTweeter'),
            TweeterType: getEl('spInputTweeterType'),
            Crossover: getEl('spInputCrossover'), Baffle: getEl('spInputBaffle'),
            SpkZ: getEl('spInputSpkZ'), ListZ: getEl('spInputListZ'), 
            // GRAPH
            Smoothing: getEl('spCheckSmoothing'),
            MinHz: getEl('spInputMinHz'), MaxHz: getEl('spInputMaxHz'),
            UpdateGraph: getEl('btnSpUpdateGraph')
        },
        stats: { 
            angle: getEl('spAngleVal'), spread: getEl('spSpreadVal'), dist: getEl('spDistVal'),
            lFront: getEl('sbirLFront'), lSide: getEl('sbirLSide'),
            rFront: getEl('sbirRFront'), rSide: getEl('sbirRSide')
        },
        btnHeatmap: getEl('btnSpHeatmap'), 
        legend: getEl('spHeatmapLegend'),
        toggleHeatmap: getEl('toggleHeatmapSp')
    };

    if (!els.canvas) return;
    const ctx = els.canvas.getContext('2d');

    const syncInputs = () => {
        if(els.inputs.W) els.inputs.W.value = spState.room.width;
        if(els.inputs.L) els.inputs.L.value = spState.room.length;
        if(els.inputs.H) els.inputs.H.value = spState.room.height || 2.4;
        if(els.inputs.SpkZ) els.inputs.SpkZ.value = spState.speakers.left.z || 1.0; 
        if(els.inputs.ListZ) els.inputs.ListZ.value = spState.listener.z || 1.1;
        
        if(els.inputs.ToeInMode) els.inputs.ToeInMode.value = spState.adv.toeInMode || 'auto';
        if(els.inputs.ToeInAngle) els.inputs.ToeInAngle.value = spState.adv.toeInAngle || 10;
        if(els.inputs.DispToeIn) els.inputs.DispToeIn.innerText = (spState.adv.toeInAngle || 10) + "°";
        if(els.inputs.Woofer) els.inputs.Woofer.value = spState.adv.wooferSize || 6.5;
        if(els.inputs.Tweeter) els.inputs.Tweeter.value = spState.adv.tweeterSize || 1.0;
        if(els.inputs.TweeterType) els.inputs.TweeterType.value = spState.adv.tweeterType || 'dome';
        if(els.inputs.Crossover) els.inputs.Crossover.value = spState.adv.crossover || 2500;
        if(els.inputs.Baffle) els.inputs.Baffle.value = spState.adv.baffleWidth || 20;
        if(els.inputs.Overlay) els.inputs.Overlay.value = spState.overlay;
        
        if(els.inputs.ManualToeGroup) {
            if(spState.adv.toeInMode === 'manual') els.inputs.ManualToeGroup.classList.remove('hidden');
            else els.inputs.ManualToeGroup.classList.add('hidden');
        }
    };
    syncInputs();

    window.addEventListener('app-state-updated', (e) => {
        if (isDragging) return;
        const s = e.detail;
        spState.room.width = s.room.width;
        spState.room.length = s.room.length;
        spState.room.height = s.room.height;
        spState.speakers.left.x = s.speakers.left.x;
        spState.speakers.left.y = s.speakers.left.y;
        spState.speakers.left.z = s.speakers.left.z;
        spState.speakers.right.x = s.speakers.right.x;
        spState.speakers.right.y = s.speakers.right.y;
        spState.speakers.right.z = s.speakers.right.z;
        spState.listener.x = s.listener.x;
        spState.listener.y = s.listener.y;
        spState.listener.z = s.listener.z;
        
        if(s.advanced) spState.adv = { ...s.advanced };
        if(document.activeElement !== els.inputs.W) syncInputs();
        forceUpdate();
    });

    // --- COORDINATE SYSTEM ---
    function toPx(m, axis) {
        const pad = 40; 
        const rect = els.container.getBoundingClientRect();
        const dim = axis === 'x' ? rect.width : rect.height;
        const roomDim = axis === 'x' ? spState.room.width : spState.room.length;
        if (roomDim <= 0 || dim === 0) return 0;
        return pad + (m / roomDim) * (dim - 2 * pad);
    }

    function toMeters(px, axis) {
        const pad = 40; 
        const rect = els.container.getBoundingClientRect();
        const dim = axis === 'x' ? rect.width : rect.height;
        const roomDim = axis === 'x' ? spState.room.width : spState.room.length;
        if (dim - 2 * pad <= 0) return 0;
        return Math.max(0, Math.min(roomDim, ((px - pad) / (dim - 2 * pad)) * roomDim));
    }

    function getDist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }

    function forceUpdate() {
        draw();
        updateStats();
    }

    function requestStatsUpdate() {
        const now = performance.now();
        if (now - spState.lastChartUpdate > 50) { 
            updateStats();
            spState.lastChartUpdate = now;
        }
    }

    function draw() {
        if (!els.container || !els.canvas) return;
        
        const rect = els.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            requestAnimationFrame(draw);
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.floor(rect.width * dpr);
        const targetH = Math.floor(rect.height * dpr);

        if (els.canvas.width !== targetW || els.canvas.height !== targetH) {
            els.canvas.width = targetW;
            els.canvas.height = targetH;
            els.canvas.style.width = rect.width + 'px';
            els.canvas.style.height = rect.height + 'px';
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0); 
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;

        ctx.clearRect(0, 0, w, h);
        
        ctx.fillStyle = '#0b101e'; ctx.fillRect(0, 0, w, h);
        const x0 = toPx(0, 'x'); const y0 = toPx(0, 'y');
        const x1 = toPx(spState.room.width, 'x'); const y1 = toPx(spState.room.length, 'y');

        ctx.fillStyle = '#111827'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

        // Heatmap
        if (spState.heatmap.visible && spState.heatmap.data.length > 0) {
            spState.heatmap.data.forEach(c => {
                ctx.fillStyle = `hsla(${c.norm * 120}, 70%, 45%, 0.4)`;
                ctx.fillRect(Math.floor(toPx(c.x - c.w / 2, 'x')), Math.floor(toPx(c.y - c.h / 2, 'y')), Math.ceil(toPx(c.w, 'x') - toPx(0, 'x')) + 1, Math.ceil(toPx(c.h, 'y') - toPx(0, 'y')) + 1);
            });
        }

        // Grid
        const li = spState.room.width / 4; const lo = spState.room.width / 3; 
        const ri = spState.room.width - spState.room.width / 4; const ro = spState.room.width - spState.room.width / 3;

        ctx.save();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
        ctx.fillRect(toPx(lo, 'x'), y0, toPx(li, 'x') - toPx(lo, 'x'), y1 - y0);
        ctx.fillRect(toPx(ri, 'x'), y0, toPx(ro, 'x') - toPx(ri, 'x'), y1 - y0);
        
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'; ctx.setLineDash([4, 4]);
        [li, lo, ri, ro].forEach(mx => { const p = toPx(mx, 'x'); ctx.beginPath(); ctx.moveTo(p, y0); ctx.lineTo(p, y1); ctx.stroke(); });
        
        const ly3 = spState.room.length - (spState.room.length / 3);
        const pLy3 = toPx(ly3, 'y');
        ctx.beginPath(); ctx.moveTo(x0, pLy3); ctx.lineTo(x1, pLy3); ctx.stroke();
        
        const p38 = toPx(spState.room.length * 0.38, 'y');
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.2)';
        ctx.beginPath(); ctx.moveTo(x0, p38); ctx.lineTo(x1, p38); ctx.stroke();

        ctx.fillStyle = 'rgba(148,163,184,0.5)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('W/3', toPx(lo, 'x'), y0 - 5); ctx.fillText('W/4', toPx(li, 'x'), y0 - 5);
        ctx.textAlign = 'right'; ctx.fillText('L/3', x0 - 5, pLy3); ctx.fillText('38%', x0 - 5, p38);
        ctx.restore();

        // Overlay
        if (spState.overlay !== 'none') {
            const W = spState.room.width; const L = spState.room.length;
            let gx, gy, ly_ghost;
            
            const drawGhostSpk = (x, y, name) => {
                const px = toPx(x, 'x'); const py = toPx(y, 'y');
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
                ctx.strokeRect(px - 12, py - 12, 24, 24);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(name, px, py - 16); ctx.restore();
            };
            const drawGhostLis = (y, name) => {
                const px = toPx(W / 2, 'x'); const py = toPx(y, 'y');
                ctx.save();
                ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(name, px, py + 20); ctx.restore();
            };

            if (spState.overlay === 'cardas') {
                gx = W * 0.276; gy = W * 0.447;
                drawGhostSpk(gx, gy, 'Cardas'); drawGhostSpk(W - gx, gy, 'Cardas');
                const spread = W - (2 * gx); const height = spread * Math.sin(Math.PI / 3); 
                ly_ghost = gy + height; drawGhostLis(ly_ghost, 'Cardas Ref');
            } else if (spState.overlay === 'thirds') {
                gx = W / 3; gy = L / 3;
                drawGhostSpk(gx, gy, '1/3'); drawGhostSpk(W - gx, gy, '1/3');
                ly_ghost = L * (2/3); drawGhostLis(ly_ghost, '2/3 Ref');
            }
        }

        ctx.save();
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        
        const lx = toPx(spState.listener.x, 'x'); const ly = toPx(spState.listener.y, 'y');
        const lkx = toPx(spState.speakers.left.x, 'x'); const lky = toPx(spState.speakers.left.y, 'y');
        const rkx = toPx(spState.speakers.right.x, 'x'); const rky = toPx(spState.speakers.right.y, 'y');
        
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.2)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lkx, lky); ctx.lineTo(rkx, rky); ctx.closePath(); ctx.stroke();

        const drawEnt = (pos, type, label) => {
            const px = toPx(pos.x, 'x'); const py = toPx(pos.y, 'y');
            const isAct = (spState.hovered === label || isDragging === label);

            ctx.save();
            ctx.translate(px, py);
            
            if (type === 'spk') {
                let angle = 0;
                if (spState.adv.toeInMode === 'auto') {
                    const dx = spState.listener.x - pos.x; const dy = spState.listener.y - pos.y;
                    angle = Math.atan2(dy, dx);
                } else {
                    const baseAngle = Math.PI / 2; 
                    const toeRad = (spState.adv.toeInAngle || 10) * (Math.PI / 180);
                    if (label === 'left') angle = baseAngle - toeRad;
                    else angle = baseAngle + toeRad;
                }
                
                ctx.rotate(angle - Math.PI / 2);
                
                ctx.fillStyle = isAct ? '#60a5fa' : '#3b82f6';
                if(isAct) { ctx.shadowColor = '#60a5fa'; ctx.shadowBlur = 15; }
                ctx.fillRect(-12, -12, 24, 24);
                
                ctx.fillStyle = '#1e3a8a'; 
                ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(0, 14); ctx.fill();

                const isHorn = spState.adv.tweeterType === 'horn';
                ctx.fillStyle = isHorn ? 'rgba(234, 179, 8, 0.15)' : 'rgba(59, 130, 246, 0.1)';
                const coneW = isHorn ? 25 : 50; 
                const coneL = Math.max(200, rect.height * 0.4);
                ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(-coneW, coneL); ctx.lineTo(coneW, coneL); ctx.fill();

            } else {
                ctx.fillStyle = isAct ? '#4ade80' : '#22c55e';
                if(isAct) { ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 15; }
                ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        };

        drawEnt(spState.speakers.left, 'spk', 'left');
        drawEnt(spState.speakers.right, 'spk', 'right');
        drawEnt(spState.listener, 'lis', 'listener');
        ctx.restore();
    }

    // --- PHYSICS ENGINE ---
    
    function getOffAxisAngle(spkPos, listenerPos, wallType) {
        const sx = spkPos.x; const sy = spkPos.y;
        const lx = listenerPos.x; const ly = listenerPos.y;
        let aimAngle = 0; 
        if (spState.adv.toeInMode === 'auto') {
            aimAngle = Math.atan2(ly - sy, lx - sx);
        } else {
            const toeRad = (spState.adv.toeInAngle || 10) * (Math.PI / 180);
            if (sx < spState.room.width / 2) aimAngle = (Math.PI / 2) - toeRad; // Left
            else aimAngle = (Math.PI / 2) + toeRad; // Right
        }
        let mirrorLx = lx; 
        if (wallType === 'left') mirrorLx = -lx;
        else if (wallType === 'right') mirrorLx = spState.room.width + (spState.room.width - lx);
        const reflAngle = Math.atan2(ly - sy, mirrorLx - sx);
        let diff = Math.abs(aimAngle - reflAngle);
        while(diff > Math.PI) diff -= 2*Math.PI;
        return Math.abs(diff) * (180 / Math.PI);
    }

    function calculateSBIRWithPhysics(spk, dDirect, dFrontRefl, dSideRefl, wallSide, customPoints = null) {
        const data = [];
        const c = 343;
        const reflectionCoeff = 0.85; 

        const baffleWidthM = (spState.adv.baffleWidth || 20) / 100;
        const woofRad = ((spState.adv.wooferSize || 6.5) * 0.0254) / 2;
        const tweetRad = ((spState.adv.tweeterSize || 1.0) * 0.0254) / 2;
        const xover = spState.adv.crossover || 2500;
        const isHorn = spState.adv.tweeterType === 'horn';
        
        const sideOffAxisDeg = getOffAxisAngle(spk, spState.listener, wallSide);

        // Vertical Params
        const H = spState.room.height || 2.4;
        const zs = spk.z || 1.0;
        const zl = spState.listener.z || 1.1;
        
        const dHoriz = getDist(spk, spState.listener); 
        const dFloorRefl = Math.sqrt(dHoriz*dHoriz + (zs + zl)*(zs + zl));
        const dCeilRefl = Math.sqrt(dHoriz*dHoriz + (2*H - zs - zl)*(2*H - zs - zl));
        const dDir3D = Math.sqrt(dHoriz*dHoriz + (zs - zl)*(zs - zl)); 

        const angleFloor = Math.atan((zs + zl) / dHoriz) * (180 / Math.PI);
        const angleCeil = Math.atan((2*H - zs - zl) / dHoriz) * (180 / Math.PI);

        const points = customPoints || chartPoints;

        for (const f of points) {
            const k = (2 * Math.PI * f) / c;
            let r = 1.0; let i = 0.0;

            // --- FRONT WALL ---
            const fStep = 115 / baffleWidthM;
            let frontMag = reflectionCoeff;
            if (f > fStep) {
                const octaves = Math.log2(f / fStep);
                const att = Math.min(10, octaves * 6); 
                frontMag *= Math.pow(10, -att / 20);
            }
            const thetaFront = k * (dFrontRefl - dDirect); 
            r += frontMag * Math.cos(thetaFront);
            i += frontMag * Math.sin(thetaFront);

            // --- SIDE WALL ---
            let sideMag = reflectionCoeff;
            const radius = (f >= xover) ? tweetRad : woofRad;
            const ka = k * radius;

            if (ka > 1) {
                let beamFactor = (ka - 1) * (sideOffAxisDeg / 90);
                if (isHorn && f >= xover) beamFactor *= 2.5; 
                else if (f >= xover) beamFactor *= 1.2; 
                sideMag *= Math.pow(10, -Math.min(30, beamFactor * 12) / 20);
            }
            const thetaSide = k * (dSideRefl - dDirect);
            r += sideMag * Math.cos(thetaSide);
            i += sideMag * Math.sin(thetaSide);

            // --- FLOOR ---
            let floorMag = reflectionCoeff; 
            if (ka > 1) {
                let beamFactor = (ka - 1) * (angleFloor / 90);
                if (isHorn && f >= xover) beamFactor *= 4.0; 
                else if (f >= xover) beamFactor *= 1.2; 
                floorMag *= Math.pow(10, -Math.min(30, beamFactor * 12) / 20);
            }
            const thetaFloor = k * (dFloorRefl - dDir3D);
            r += floorMag * Math.cos(thetaFloor);
            i += floorMag * Math.sin(thetaFloor);

            // --- CEILING ---
            let ceilMag = reflectionCoeff;
            if (ka > 1) {
                let beamFactor = (ka - 1) * (angleCeil / 90);
                if (isHorn && f >= xover) beamFactor *= 4.0; 
                else if (f >= xover) beamFactor *= 1.2; 
                ceilMag *= Math.pow(10, -Math.min(30, beamFactor * 12) / 20);
            }
            const thetaCeil = k * (dCeilRefl - dDir3D);
            r += ceilMag * Math.cos(thetaCeil);
            i += ceilMag * Math.sin(thetaCeil);

            const mag = Math.sqrt(r * r + i * i);
            let db = 20 * Math.log10(mag);
            data.push({ x: f, y: Math.max(-30, db) }); 
        }
        return data;
    }

    function applySmoothing(data, smoothing) {
        if (!smoothing) return data;
        const smoothed = [];
        const windowSize = 3; 
        for (let i = 0; i < data.length; i++) {
            let sum = 0; let count = 0;
            for (let j = i - windowSize; j <= i + windowSize; j++) {
                if (j >= 0 && j < data.length) { sum += data[j].y; count++; }
            }
            smoothed.push({ x: data[i].x, y: sum / count });
        }
        return smoothed;
    }

    function initSBIRChart() {
        if (!els.sbirCanvas || spState.sbirChart) return;
        const ctx = els.sbirCanvas.getContext('2d');
        
        spState.sbirChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    { label: 'Left', data: [], borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.3, borderDash: [5, 5], hidden: true },
                    { label: 'Right', data: [], borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.3, borderDash: [5, 5], hidden: true },
                    { label: 'Average', data: [], borderColor: '#a855f7', borderWidth: 3, pointRadius: 0, tension: 0.3 },
                    { label: 'Ref', data: [{x: 20, y: 0}, {x: 20000, y: 0}], borderColor: '#475569', borderWidth: 1, pointRadius: 0, borderDash: [2, 2], order: 10 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#94a3b8' } }, tooltip: { backgroundColor: '#1e293b' } },
                scales: {
                    x: { type: 'logarithmic', min: 20, max: 20000, ticks: { color: '#64748b', callback: function(value) { return [20,50,100,200,500,1000,2000,5000,10000,20000].includes(value) ? value : ''; } }, grid: { color: '#1e293b' }, title: { display: true, text: 'Frequency (Hz)', color: '#475569' } },
                    y: { suggestedMin: -2, suggestedMax: 2, grid: { color: '#1e293b' }, ticks: { color: '#64748b' } }
                }
            }
        });
    }

    function updateStats() {
        const sL = spState.speakers.left; const sR = spState.speakers.right;
        const lis = spState.listener; const W = spState.room.width; 

        const spread = getDist(sL, sR);
        const avgD = (getDist(sL, lis) + getDist(sR, lis)) / 2;
        const deg = (2 * Math.asin(spread / (2 * avgD))) * (180 / Math.PI);

        if(els.stats.spread) els.stats.spread.innerText = spread.toFixed(2) + 'm';
        if(els.stats.dist) els.stats.dist.innerText = avgD.toFixed(2) + 'm';
        if(els.stats.angle) els.stats.angle.innerText = isNaN(deg) ? '--' : deg.toFixed(1) + '°';

        const getCancelFreq = (dDirect, dRefl) => {
            const diff = dRefl - dDirect; return diff <= 0 ? 0 : 343 / (2 * diff);
        };
        const calcRefl = (spk, wall) => {
             let ghostX = (wall === 'left') ? -spk.x : (2 * W) - spk.x;
             return Math.hypot(ghostX - lis.x, spk.y - lis.y);
        };
        const calcFront = (spk) => Math.hypot(spk.x - lis.x, (-spk.y) - lis.y);

        const runCalc = (spk, wall) => {
            const dDir = getDist(spk, lis);
            const dFront = calcFront(spk); const dSide = calcRefl(spk, wall);
            return { dDir, dFront, dSide, fFreq: getCancelFreq(dDir, dFront), sFreq: getCancelFreq(dDir, dSide) };
        };

        const resL = runCalc(sL, 'left'); const resR = runCalc(sR, 'right');
        const fmt = (f) => f > 1000 ? (f/1000).toFixed(1)+'k' : Math.round(f);
        if(els.stats.lFront) els.stats.lFront.innerText = fmt(resL.fFreq) + " Hz"; 
        if(els.stats.lSide) els.stats.lSide.innerText = fmt(resL.sFreq) + " Hz";
        if(els.stats.rFront) els.stats.rFront.innerText = fmt(resR.fFreq) + " Hz"; 
        if(els.stats.rSide) els.stats.rSide.innerText = fmt(resR.sFreq) + " Hz";

        if (!spState.sbirChart) initSBIRChart();
        if (spState.sbirChart) {
            const rawL = calculateSBIRWithPhysics(sL, resL.dDir, resL.dFront, resL.dSide, 'left', chartPoints);
            const rawR = calculateSBIRWithPhysics(sR, resR.dDir, resR.dFront, resR.dSide, 'right', chartPoints);
            const rawAvg = rawL.map((v, i) => ({ x: v.x, y: (v.y + rawR[i].y) / 2 }));

            const shouldSmooth = els.inputs.Smoothing.checked;
            const dataL = applySmoothing(rawL, shouldSmooth);
            const dataR = applySmoothing(rawR, shouldSmooth);
            const dataAvg = applySmoothing(rawAvg, shouldSmooth);

            const minHz = parseFloat(els.inputs.MinHz.value) || 20;
            const maxHz = parseFloat(els.inputs.MaxHz.value) || 20000;
            spState.sbirChart.options.scales.x.min = minHz;
            spState.sbirChart.options.scales.x.max = maxHz;
            
            spState.sbirChart.data.datasets[0].data = dataL;
            spState.sbirChart.data.datasets[1].data = dataR;
            spState.sbirChart.data.datasets[2].data = dataAvg;
            spState.sbirChart.update('none');
        }
    }

    // --- UPDATE DOM STATE ---
    function updateStateFromDOM(keepHeatmap = false) {
        spState.room.width = parseFloat(els.inputs.W.value) || 5.0;
        spState.room.length = parseFloat(els.inputs.L.value) || 6.0;
        spState.room.height = parseFloat(els.inputs.H.value) || 2.4; 
        
        spState.overlay = els.inputs.Overlay.value;
        spState.adv.toeInMode = els.inputs.ToeInMode.value;
        spState.adv.toeInAngle = parseFloat(els.inputs.ToeInAngle.value);
        spState.adv.wooferSize = parseFloat(els.inputs.Woofer.value);
        spState.adv.tweeterSize = parseFloat(els.inputs.Tweeter.value);
        spState.adv.tweeterType = els.inputs.TweeterType.value;
        spState.adv.crossover = parseFloat(els.inputs.Crossover.value);
        spState.adv.baffleWidth = parseFloat(els.inputs.Baffle.value);
        
        if(els.inputs.SpkZ) spState.speakers.left.z = parseFloat(els.inputs.SpkZ.value) || 1.0;
        if(els.inputs.SpkZ) spState.speakers.right.z = parseFloat(els.inputs.SpkZ.value) || 1.0;
        if(els.inputs.ListZ) spState.listener.z = parseFloat(els.inputs.ListZ.value) || 1.1;

        if(spState.adv.toeInMode === 'manual') els.inputs.ManualToeGroup.classList.remove('hidden');
        else els.inputs.ManualToeGroup.classList.add('hidden');
        els.inputs.DispToeIn.innerText = spState.adv.toeInAngle + "°";

        window.appState.update({
            room: { width: spState.room.width, length: spState.room.length, height: spState.room.height },
            speakers: { 
                left: { x: spState.speakers.left.x, y: spState.speakers.left.y, z: spState.speakers.left.z }, 
                right: { x: spState.speakers.right.x, y: spState.speakers.right.y, z: spState.speakers.right.z } 
            },
            listener: { x: spState.listener.x, y: spState.listener.y, z: spState.listener.z },
            advanced: spState.adv
        });

        if (!keepHeatmap) {
            spState.heatmap.active = false;
            spState.heatmap.visible = false;
            els.toggleHeatmap.checked = false;
            els.toggleHeatmap.disabled = true;
            els.legend.classList.add('hidden');
        }
        forceUpdate();
    }

    [els.inputs.W, els.inputs.L, els.inputs.H, els.inputs.Woofer, els.inputs.Tweeter, els.inputs.Crossover, els.inputs.Baffle, els.inputs.SpkZ, els.inputs.ListZ].forEach(e => { if(e) e.addEventListener('input', () => updateStateFromDOM(false)); });
    [els.inputs.ToeInMode, els.inputs.ToeInAngle].forEach(e => { if(e) e.addEventListener('input', () => updateStateFromDOM(true)); });
    [els.inputs.Mirror, els.inputs.MirrorMode, els.inputs.Overlay, els.inputs.TweeterType].forEach(e => { if(e) e.addEventListener('change', () => updateStateFromDOM(true)); });
    
    [els.inputs.Smoothing, els.inputs.MinHz, els.inputs.MaxHz].forEach(e => { if(e) e.addEventListener('change', updateStats); });
    if(els.inputs.UpdateGraph) els.inputs.UpdateGraph.addEventListener('click', updateStats);

    els.toggleHeatmap.addEventListener('change', (e) => {
        spState.heatmap.visible = e.target.checked;
        if (spState.heatmap.visible) els.legend.classList.remove('hidden');
        else els.legend.classList.add('hidden');
        forceUpdate();
    });

    // --- TRUE PHYSICS HEATMAP GENERATION (OPTIMIZED) ---
    els.btnHeatmap.addEventListener('click', () => {
        els.btnHeatmap.innerText = 'CALCULATING...';
        els.btnHeatmap.disabled = true;
        
        spState.heatmap.active = true;
        spState.heatmap.visible = true;
        spState.heatmap.data = [];
        spState.heatmap.generating = true;
        els.toggleHeatmap.checked = true;
        els.toggleHeatmap.disabled = true;

        const rows = 30; const cols = 30;
        const sx = spState.room.width / cols; 
        const sy = spState.room.length / rows;
        const lx = spState.listener.x; const ly = spState.listener.y;
        const W = spState.room.width;
        
        // Cache static calcs
        const baffleWidthM = (spState.adv.baffleWidth || 20) / 100;
        const fStep = 115 / baffleWidthM;
        const xover = spState.adv.crossover || 2500;
        
        let y = 0;
        let min = Infinity; let max = -Infinity;

        function processRow() {
            if (!spState.heatmap.generating) return;

            for (let x = 0; x < cols; x++) {
                const cx = (x * sx) + sx / 2; const cy = (y * sy) + sy / 2;
                const tmpSpk = { x: cx, y: cy, z: spState.speakers.left.z }; 
                
                // 1. Stereo Geometry Score
                const dx = Math.abs(cx - lx); const dist = Math.hypot(cx - lx, cy - ly);
                const angleRatio = (dist > 0) ? dx / dist : 0;
                const geomScore = 1 - Math.abs(angleRatio - 0.5); 

                // 2. Physics Score (SBIR Flatness in BASS only)
                const dDir = getDist(tmpSpk, spState.listener);
                const dFront = Math.hypot(tmpSpk.x - lx, (-tmpSpk.y) - ly);
                
                // FIX: Sjekk hvilken sidevegg som er nærmest for å få riktig refleksjon
                let ghostX;
                if (cx <= W / 2) {
                     // Venstre side -> bruk venstre vegg (x=0) som speil -> ghostX = -cx
                     ghostX = -cx;
                } else {
                     // Høyre side -> bruk høyre vegg (x=W) som speil -> ghostX = 2W - cx
                     ghostX = (2 * W) - cx;
                }
                const dSide = Math.hypot(ghostX - lx, tmpSpk.y - ly);
                
                let variance = 0;
                let count = 0;
                const c = 343; const refC = 0.85;

                // Only check low freq for placement optimization
                heatPoints.forEach(f => {
                    const k = (2 * Math.PI * f) / c;
                    let mag = 1.0; 
                    mag += refC * Math.cos(k*(dFront-dDir));
                    mag += refC * Math.cos(k*(dSide-dDir));
                    const db = 20*Math.log10(Math.abs(mag) + 0.01);
                    variance += Math.abs(db); 
                    count++;
                });
                
                const avgError = variance / count;
                const physScore = Math.max(0, 10 - avgError) / 10; 
                
                const total = (geomScore * 0.3) + (physScore * 0.7);

                if (total < min) min = total; if (total > max) max = total;
                spState.heatmap.data.push({ x: cx, y: cy, w: sx, h: sy, val: total });
            }

            y++;
            if (y < rows) {
                requestAnimationFrame(processRow);
            } else {
                spState.heatmap.data.forEach(d => d.norm = (max === min) ? 0 : (d.val - min) / (max - min));
                spState.heatmap.generating = false;
                els.toggleHeatmap.disabled = false;
                els.legend.classList.remove('hidden');
                els.btnHeatmap.innerText = 'REFRESH ZONES';
                els.btnHeatmap.disabled = false;
                forceUpdate(); 
            }
        }
        processRow();
    });

    const getPos = (e) => {
        const r = els.canvas.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        return { 
            x: touch.clientX - r.left, 
            y: touch.clientY - r.top 
        };
    };
    const handleStart = (e) => {
        // Prevent text selection
        if (e.type === 'mousedown') e.preventDefault();
        
        const p = getPos(e);
        const mx = toMeters(p.x, 'x'); const my = toMeters(p.y, 'y');
        const hit = (obj) => Math.hypot(mx - obj.x, my - obj.y) < 0.6;
        
        isDragging = null;
        if (hit(spState.speakers.left)) { isDragging = 'left'; spState.activeSpeaker = 'left'; }
        else if (hit(spState.speakers.right)) { isDragging = 'right'; spState.activeSpeaker = 'right'; }
        else if (hit(spState.listener)) isDragging = 'listener';
        forceUpdate();
    };
    const handleMove = (e) => {
        const p = getPos(e);
        const mx = toMeters(p.x, 'x'); const my = toMeters(p.y, 'y');
        
        const hit = (obj) => Math.hypot(mx - obj.x, my - obj.y) < 0.6;
        let h = null;
        if (hit(spState.speakers.left)) h = 'left';
        else if (hit(spState.speakers.right)) h = 'right';
        else if (hit(spState.listener)) h = 'listener';
        
        if (spState.hovered !== h) { 
            spState.hovered = h; 
            els.canvas.style.cursor = h ? 'grab' : 'default'; 
            draw(); 
        }

        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        
        els.canvas.style.cursor = 'grabbing';

        const S = spState.speakers; const L = spState.listener;
        if (isDragging === 'listener') { 
            L.x = mx; L.y = my; 
        } else {
            const active = spState.speakers[isDragging];
            const other = isDragging === 'left' ? S.right : S.left;
            active.x = mx; active.y = my;
            if (els.inputs.Mirror.checked) {
                other.y = my;
                if (els.inputs.MirrorMode.value === 'room') other.x = spState.room.width - mx; 
                else other.x = L.x + (L.x - mx); 
                other.x = Math.max(0.1, Math.min(other.x, spState.room.width - 0.1));
            }
        }
        
        // 1. Draw VISUALS immediately (Fast)
        draw();
        
        // 2. Request PHYSICS update (Throttled)
        requestStatsUpdate();
    };
    const handleEnd = () => { 
        if (isDragging) {
            // Save state on mouse up -> Triggers physics update via event loop
            updateStateFromDOM(true);
        }
        isDragging = null; 
        els.canvas.style.cursor = spState.hovered ? 'grab' : 'default';
        forceUpdate(); 
    };

    els.canvas.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    els.canvas.addEventListener('touchstart', handleStart, {passive: false});
    window.addEventListener('touchmove', handleMove, {passive: false});
    window.addEventListener('touchend', handleEnd);

    // Initial Sync
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) forceUpdate();
    });
    resizeObserver.observe(els.container);
    window.addEventListener('resize', forceUpdate);
    window.addEventListener('resize-sp', forceUpdate);
    
    // Explicit initial call
    setTimeout(forceUpdate, 100);

})();