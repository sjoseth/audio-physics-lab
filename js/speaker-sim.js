(function() {
    const global = window.appState.get();

    const spState = {
        room: { width: global.room.width, length: global.room.length },
        speakers: { 
            left: { x: global.speakers.left.x, y: global.speakers.left.y }, 
            right: { x: global.speakers.right.x, y: global.speakers.right.y } 
        },
        listener: { x: global.listener.x, y: global.listener.y },
        mirror: true,
        mirrorMode: 'room',
        hovered: null,
        activeSpeaker: 'left',
        overlay: 'none', 
        heatmap: { active: false, visible: false, data: [] },
        sbirChart: null 
    };
    let isDragging = null;

    const getEl = (id) => document.getElementById(id);
    const els = {
        canvas: getEl('spCanvas'),
        container: getEl('spCanvasContainer'),
        sbirCanvas: getEl('sbirChart'), 
        inputs: { 
            W: getEl('spInputW'), 
            L: getEl('spInputL'), 
            Mirror: getEl('spInputMirror'), 
            MirrorMode: getEl('spMirrorMode'),
            Overlay: getEl('spOverlay')
        },
        stats: { 
            angle: getEl('spAngleVal'), 
            spread: getEl('spSpreadVal'), 
            dist: getEl('spDistVal'),
            lFront: getEl('sbirLFront'), lSide: getEl('sbirLSide'),
            lFrontBar: getEl('sbirLFrontBar'), lSideBar: getEl('sbirLSideBar'),
            rFront: getEl('sbirRFront'), rSide: getEl('sbirRSide'),
            rFrontBar: getEl('sbirRFrontBar'), rSideBar: getEl('sbirRSideBar')
        },
        btnHeatmap: getEl('btnSpHeatmap'), 
        legend: getEl('spHeatmapLegend'),
        toggleHeatmap: getEl('toggleHeatmapSp')
    };

    if (!els.canvas) return;
    const ctx = els.canvas.getContext('2d');

    // Sync init
    els.inputs.W.value = spState.room.width;
    els.inputs.L.value = spState.room.length;

    window.addEventListener('app-state-updated', (e) => {
        const s = e.detail;
        spState.room.width = s.room.width;
        spState.room.length = s.room.length;
        spState.speakers.left.x = s.speakers.left.x;
        spState.speakers.left.y = s.speakers.left.y;
        spState.speakers.right.x = s.speakers.right.x;
        spState.speakers.right.y = s.speakers.right.y;
        spState.listener.x = s.listener.x;
        spState.listener.y = s.listener.y;

        if(document.activeElement !== els.inputs.W) els.inputs.W.value = spState.room.width;
        if(document.activeElement !== els.inputs.L) els.inputs.L.value = spState.room.length;

        draw();
    });

    function toPx(m, axis) {
        const pad = 40;
        const dim = axis === 'x' ? els.canvas.width : els.canvas.height;
        const roomDim = axis === 'x' ? spState.room.width : spState.room.length;
        return pad + (m / roomDim) * (dim - 2 * pad);
    }
    function toMeters(px, axis) {
        const pad = 40;
        const dim = axis === 'x' ? els.canvas.width : els.canvas.height;
        const roomDim = axis === 'x' ? spState.room.width : spState.room.length;
        return Math.max(0, Math.min(roomDim, ((px - pad) / (dim - 2 * pad)) * roomDim));
    }

    // Helper: Distance between two points {x, y}
    function getDist(p1, p2) {
        return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    function drawArrowLine(x1, y1, x2, y2) {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const ang = Math.atan2(y2 - y1, x2 - x1); const h = 6;
        const tri = (a) => {
            ctx.beginPath(); ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - h * Math.cos(a - Math.PI / 6), y2 - h * Math.sin(a - Math.PI / 6));
            ctx.lineTo(x2 - h * Math.cos(a + Math.PI / 6), y2 - h * Math.sin(a + Math.PI / 6));
            ctx.fill();
        };
        tri(ang);
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + h * Math.cos(ang - Math.PI / 6), y1 + h * Math.sin(ang - Math.PI / 6));
        ctx.lineTo(x1 + h * Math.cos(ang + Math.PI / 6), y1 + h * Math.sin(ang + Math.PI / 6));
        ctx.fill();
    }

    function drawMeasurements(x, y, color) {
        const px = toPx(x, 'x');
        const py = toPx(y, 'y');
        const x0 = toPx(0, 'x');
        const x1 = toPx(spState.room.width, 'x');
        const y0 = toPx(0, 'y');
        const y1 = toPx(spState.room.length, 'y');
        
        ctx.save();
        ctx.strokeStyle = '#ef4444'; ctx.fillStyle = '#ef4444'; ctx.lineWidth = 1;
        ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

        const drawLbl = (xStart, yStart, xEnd, yEnd, val) => {
            drawArrowLine(xStart, yStart, xEnd, yEnd);
            const mx = (xStart + xEnd) / 2;
            const my = (yStart + yEnd) / 2;
            const txt = val.toFixed(2) + 'm';
            const met = ctx.measureText(txt);
            ctx.save(); ctx.fillStyle = '#0f172a'; ctx.fillRect(mx - met.width / 2 - 2, my - 6, met.width + 4, 12); ctx.restore();
            ctx.fillText(txt, mx, my);
        };

        if (x < spState.room.width / 2) drawLbl(px - 15, py, x0, py, x);
        else drawLbl(px + 15, py, x1, py, spState.room.width - x);

        if (y < spState.room.length / 2) drawLbl(px, py - 15, px, y0, y);
        else drawLbl(px, py + 15, px, y1, spState.room.length - y);
        
        ctx.restore();
    }

    function draw() {
        if (!els.container || !els.canvas) return;
        const w = els.canvas.width;
        const h = els.canvas.height;
        ctx.clearRect(0, 0, w, h);
        
        ctx.fillStyle = '#0b101e'; ctx.fillRect(0, 0, w, h);
        const x0 = toPx(0, 'x');
        const y0 = toPx(0, 'y');
        const x1 = toPx(spState.room.width, 'x');
        const y1 = toPx(spState.room.length, 'y');

        ctx.fillStyle = '#111827'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

        // --- DRAW HEATMAP IF VISIBLE ---
        if (spState.heatmap.active && spState.heatmap.visible) {
            spState.heatmap.data.forEach(c => {
                ctx.fillStyle = `hsla(${c.norm * 120}, 70%, 45%, 0.5)`;
                ctx.fillRect(
                    Math.floor(toPx(c.x - c.w / 2, 'x')),
                    Math.floor(toPx(c.y - c.h / 2, 'y')),
                    Math.ceil(toPx(c.w, 'x') - toPx(0, 'x')) + 1,
                    Math.ceil(toPx(c.h, 'y') - toPx(0, 'y')) + 1
                );
            });
        }

        const W = spState.room.width;
        const L = spState.room.length;
        
        // --- DRAW GHOST SPEAKERS & LISTENER (METHOD OVERLAY) ---
        if (spState.overlay !== 'none') {
            let gx, gy, ly_ghost;
            
            const drawGhostSpk = (x, y, name) => {
                const px = toPx(x, 'x'); const py = toPx(y, 'y');
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.strokeRect(px - 12, py - 12, 24, 24);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(name, px, py - 16);
                ctx.restore();
            };

            const drawGhostLis = (y, name) => {
                const px = toPx(W / 2, 'x');
                const py = toPx(y, 'y');
                ctx.save();
                ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)'; 
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.stroke();
                
                ctx.fillStyle = 'rgba(34, 197, 94, 0.6)';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(name, px, py + 20);
                ctx.restore();
            };

            if (spState.overlay === 'cardas') {
                gx = W * 0.276;
                gy = W * 0.447;
                drawGhostSpk(gx, gy, 'Cardas');
                drawGhostSpk(W - gx, gy, 'Cardas');

                const spread = W - (2 * gx);
                const height = spread * Math.sin(Math.PI / 3); 
                ly_ghost = gy + height;
                drawGhostLis(ly_ghost, 'Cardas Ref');

            } else if (spState.overlay === 'thirds') {
                gx = W / 3;
                gy = L / 3;
                drawGhostSpk(gx, gy, '1/3');
                drawGhostSpk(W - gx, gy, '1/3');
                ly_ghost = L * (2/3);
                drawGhostLis(ly_ghost, '2/3 Ref');
            }
        }
        
        const li = W / 4; const lo = W / 3; const ri = W - W / 4; const ro = W - W / 3;

        ctx.save();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
        ctx.fillRect(toPx(lo, 'x'), y0, toPx(li, 'x') - toPx(lo, 'x'), y1 - y0);
        ctx.fillRect(toPx(ri, 'x'), y0, toPx(ro, 'x') - toPx(ri, 'x'), y1 - y0);
        
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'; ctx.setLineDash([4, 4]);
        [li, lo, ri, ro].forEach(mx => { const p = toPx(mx, 'x'); ctx.beginPath(); ctx.moveTo(p, y0); ctx.lineTo(p, y1); ctx.stroke(); });
        
        const ly3 = L - (L / 3);
        const pLy3 = toPx(ly3, 'y');
        ctx.beginPath(); ctx.moveTo(x0, pLy3); ctx.lineTo(x1, pLy3); ctx.stroke();
        
        const p38 = toPx(L * 0.38, 'y');
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.2)';
        ctx.beginPath(); ctx.moveTo(x0, p38); ctx.lineTo(x1, p38); ctx.stroke();

        ctx.fillStyle = 'rgba(148,163,184,0.5)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('W/3', toPx(lo, 'x'), y0 - 5); ctx.fillText('W/4', toPx(li, 'x'), y0 - 5);
        ctx.textAlign = 'right'; ctx.fillText('L/3', x0 - 5, pLy3); ctx.fillText('38%', x0 - 5, p38);
        ctx.restore();

        ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

        const lx = toPx(spState.listener.x, 'x'); const ly = toPx(spState.listener.y, 'y');
        const lkx = toPx(spState.speakers.left.x, 'x'); const lky = toPx(spState.speakers.left.y, 'y');
        const rkx = toPx(spState.speakers.right.x, 'x'); const rky = toPx(spState.speakers.right.y, 'y');
        ctx.save(); ctx.strokeStyle = 'rgba(234, 179, 8, 0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lkx, lky); ctx.lineTo(rkx, rky); ctx.closePath(); ctx.stroke();
        ctx.restore();

        const drawEnt = (pos, type, label) => {
            const px = toPx(pos.x, 'x');
            const py = toPx(pos.y, 'y');
            const isAct = (spState.hovered === label || isDragging === label);
            if (isAct) drawMeasurements(pos.x, pos.y, '#3b82f6');

            ctx.save();
            ctx.translate(px, py);
            const angle = Math.atan2(ly - py, lx - px);
            ctx.rotate(angle - Math.PI / 2);

            if (type === 'spk') {
                ctx.fillStyle = isAct ? '#60a5fa' : '#3b82f6';
                if(isAct) { ctx.shadowColor = '#60a5fa'; ctx.shadowBlur = 15; }
                ctx.fillRect(-12, -12, 24, 24);
                ctx.fillStyle = '#1e3a8a'; ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(6, -12); ctx.lineTo(0, -18); ctx.fill();
            } else {
                ctx.fillStyle = isAct ? '#4ade80' : '#22c55e';
                if(isAct) { ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 15; }
                ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#064e3b'; ctx.beginPath(); ctx.moveTo(-4, -10); ctx.lineTo(4, -10); ctx.lineTo(0, -16); ctx.fill();
            }
            ctx.restore();
        };

        drawEnt(spState.speakers.left, 'spk', 'left');
        drawEnt(spState.speakers.right, 'spk', 'right');
        drawEnt(spState.listener, 'lis', 'listener');

        updateStats();
    }

    // --- SBIR Kalkulator (IMAGE SOURCE METHOD) ---
    function calculateSBIRResponse(dDirect, dFrontRefl, dSideRefl) {
        const data = [];
        const c = 343;
        const reflectionCoeff = 0.85;

        for (let f = 40; f <= 500; f += 2) {
            const k = (2 * Math.PI * f) / c;
            
            // Direkte lyd (Fase 0)
            let r = 1.0; 
            let i = 0.0;

            // Frontvegg Refleksjon
            const pathDiffFront = dFrontRefl - dDirect;
            const thetaFront = k * pathDiffFront; 
            r += reflectionCoeff * Math.cos(thetaFront);
            i += reflectionCoeff * Math.sin(thetaFront);

            // Sidevegg Refleksjon
            const pathDiffSide = dSideRefl - dDirect;
            const thetaSide = k * pathDiffSide;
            r += reflectionCoeff * Math.cos(thetaSide);
            i += reflectionCoeff * Math.sin(thetaSide);

            // Magnitude dB
            const mag = Math.sqrt(r * r + i * i);
            let db = 20 * Math.log10(mag);
            
            data.push(Math.max(-25, db)); 
        }
        return data;
    }

    // --- NY Hjelpefunksjon: Beregn kanselleringsfrekvens basert på path difference ---
    function getCancellationFreq(direct, reflected) {
        const diff = reflected - direct;
        if (diff <= 0) return 0;
        // Kansellering skjer når path diff = 1/2 bølgelengde (lambda/2)
        // lambda = 2 * diff
        // f = c / lambda = 343 / (2 * diff)
        return 343 / (2 * diff);
    }

    // --- Initialiser SBIR Chart med Average ---
    function initSBIRChart() {
        if (!els.sbirCanvas || spState.sbirChart) return;
        
        const ctx = els.sbirCanvas.getContext('2d');
        const labels = [];
        for(let f=40; f<=500; f+=2) labels.push(f);

        spState.sbirChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Left',
                        data: [],
                        borderColor: '#3b82f6', 
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3
                    },
                    {
                        label: 'Right',
                        data: [],
                        borderColor: '#ef4444', 
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        borderDash: [5, 5]
                    },
                    {
                        label: 'Average',
                        data: [],
                        borderColor: '#a855f7', 
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        borderDash: [2, 2],
                        order: 0 
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 }, 
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#94a3b8' } },
                    tooltip: { 
                        backgroundColor: '#1e293b',
                        callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)} dB` }
                    }
                },
                scales: {
                    x: { 
                        ticks: { color: '#64748b', maxTicksLimit: 10 }, 
                        grid: { color: '#1e293b' },
                        title: { display: true, text: 'Frequency (Hz)', color: '#475569' }
                    },
                    y: { 
                        suggestedMin: -20, 
                        suggestedMax: 6, 
                        grid: { color: '#1e293b' }, 
                        ticks: { color: '#64748b' } 
                    }
                }
            }
        });
    }

    function updateStats() {
        const sL = spState.speakers.left;
        const sR = spState.speakers.right;
        const lis = spState.listener;
        const W = spState.room.width; 

        const spread = getDist(sL, sR);
        const dL = getDist(sL, lis);
        const dR = getDist(sR, lis);
        const avgD = (dL + dR) / 2;
        const deg = (2 * Math.asin(spread / (2 * avgD))) * (180 / Math.PI);

        els.stats.spread.innerText = spread.toFixed(2) + 'm';
        els.stats.dist.innerText = avgD.toFixed(2) + 'm';
        els.stats.angle.innerText = isNaN(deg) ? '--' : deg.toFixed(1) + '°';
        els.stats.angle.style.color = (deg >= 55 && deg <= 65) ? '#4ade80' : (deg >= 50 && deg <= 70 ? '#facc15' : '#f87171');

        // --- OPPGRADERT: Tekstboksene bruker nå Image Source Method (Lytter-posisjon) ---
        const updateSpeakerSBIR_Text = (spk, label, directDist) => {
            
            // 1. Beregn Front SBIR (Speilpunkt: {x, -y})
            const ghostFront = { x: spk.x, y: -spk.y };
            const distReflFront = getDist(ghostFront, lis);
            const fFreq = getCancellationFreq(directDist, distReflFront);

            // 2. Beregn Side SBIR
            let ghostSide;
            if (label === 'left') {
                // Venstre vegg (x=0): Speilpunkt {-x, y}
                ghostSide = { x: -spk.x, y: spk.y };
            } else {
                // Høyre vegg (x=W): Speilpunkt {2W - x, y}
                ghostSide = { x: (2 * W) - spk.x, y: spk.y };
            }
            const distReflSide = getDist(ghostSide, lis);
            const sFreq = getCancellationFreq(directDist, distReflSide);
            
            // Formatering og farger
            const fmt = (f) => f > 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f);
            const sbirCol = (f) => (f >= 50 && f <= 150) ? 'bg-red-500' : 'bg-green-500';
            const sbirPct = (f) => Math.max(0, Math.min(100, ((f - 20) / 280) * 100));
            
            if(label === 'left') {
                els.stats.lFront.innerText = fmt(fFreq) + " Hz";
                els.stats.lSide.innerText = fmt(sFreq) + " Hz";
                els.stats.lFrontBar.className = `h-1 rounded ${sbirCol(fFreq)}`; els.stats.lFrontBar.style.width = sbirPct(fFreq)+'%';
                els.stats.lSideBar.className = `h-1 rounded ${sbirCol(sFreq)}`; els.stats.lSideBar.style.width = sbirPct(sFreq)+'%';
            } else {
                els.stats.rFront.innerText = fmt(fFreq) + " Hz";
                els.stats.rSide.innerText = fmt(sFreq) + " Hz";
                els.stats.rFrontBar.className = `h-1 rounded ${sbirCol(fFreq)}`; els.stats.rFrontBar.style.width = sbirPct(fFreq)+'%';
                els.stats.rSideBar.className = `h-1 rounded ${sbirCol(sFreq)}`; els.stats.rSideBar.style.width = sbirPct(sFreq)+'%';
            }

            return { distReflFront, distReflSide }; // Returner for bruk i graf
        };

        const sbirL = updateSpeakerSBIR_Text(spState.speakers.left, 'left', dL);
        const sbirR = updateSpeakerSBIR_Text(spState.speakers.right, 'right', dR);

        // --- Oppdater Graf med Image Source Method ---
        if (!spState.sbirChart) initSBIRChart();
        
        if (spState.sbirChart) {
            const dataL = calculateSBIRResponse(dL, sbirL.distReflFront, sbirL.distReflSide);
            const dataR = calculateSBIRResponse(dR, sbirR.distReflFront, sbirR.distReflSide);
            const dataAvg = dataL.map((val, i) => (val + dataR[i]) / 2);

            spState.sbirChart.data.datasets[0].data = dataL;
            spState.sbirChart.data.datasets[1].data = dataR;
            spState.sbirChart.data.datasets[2].data = dataAvg;
            
            spState.sbirChart.update('none');
        }
    }

    function generateHeatmap() {
        els.btnHeatmap.innerText = 'Calculating...';
        setTimeout(() => {
            spState.heatmap.active = true;
            spState.heatmap.visible = true;
            spState.heatmap.data = [];
            els.toggleHeatmap.checked = true;
            els.toggleHeatmap.disabled = false;

            const rows = 30;
            const cols = 30;
            const sx = spState.room.width / cols;
            const sy = spState.room.length / rows;
            let min = Infinity;
            let max = -Infinity;
            const lx = spState.listener.x;
            const ly = spState.listener.y;

            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const cx = (x * sx) + sx / 2;
                    const cy = (y * sy) + sy / 2;
                    
                    const dx = Math.abs(cx - lx);
                    const dy = Math.abs(cy - ly);
                    const dist = Math.hypot(cx - lx, cy - ly);
                    
                    const angleRatio = (dist > 0) ? dx / dist : 0;
                    const angleScore = 1 - Math.abs(angleRatio - 0.5);

                    const frontF = 343 / (4 * cy);
                    const sideDist = cx < spState.room.width / 2 ? cx : spState.room.width - cx;
                    const sideF = 343 / (4 * sideDist);
                    
                    const badZone = (f) => (f >= 50 && f <= 150) ? 1 : 0;
                    const sbirScore = 1 - ((badZone(frontF) + badZone(sideF)) * 0.4);

                    const total = (angleScore * 0.6) + (sbirScore * 0.4);
                    if (total < min) min = total;
                    if (total > max) max = total;
                    spState.heatmap.data.push({ x: cx, y: cy, w: sx, h: sy, val: total });
                }
            }
            spState.heatmap.data.forEach(d => d.norm = (d.val - min) / (max - min));
            
            els.legend.classList.remove('hidden');
            draw();
            els.btnHeatmap.innerText = 'REFRESH ZONES';
        }, 50);
    }

    // --- REFACTORED UPDATE LOGIC ---
    function updateStateFromDOM(keepHeatmap = false) {
        spState.room.width = parseFloat(els.inputs.W.value) || 5.0;
        spState.room.length = parseFloat(els.inputs.L.value) || 6.0;
        spState.mirror = els.inputs.Mirror.checked;
        spState.mirrorMode = els.inputs.MirrorMode.value;
        spState.overlay = els.inputs.Overlay.value;

        window.appState.update({
            room: { width: spState.room.width, length: spState.room.length },
            speakers: { 
                left: { x: spState.speakers.left.x, y: spState.speakers.left.y }, 
                right: { x: spState.speakers.right.x, y: spState.speakers.right.y } 
            },
            listener: { x: spState.listener.x, y: spState.listener.y }
        });

        if (!keepHeatmap) {
            spState.heatmap.active = false;
            spState.heatmap.visible = false;
            els.toggleHeatmap.checked = false;
            els.toggleHeatmap.disabled = true;
            els.legend.classList.add('hidden');
        }
        
        const clamp = (val, max) => Math.max(0.1, Math.min(val, max - 0.1));
        spState.speakers.left.x = clamp(spState.speakers.left.x, spState.room.width);
        spState.speakers.left.y = clamp(spState.speakers.left.y, spState.room.length);
        spState.speakers.right.x = clamp(spState.speakers.right.x, spState.room.width);
        spState.speakers.right.y = clamp(spState.speakers.right.y, spState.room.length);
        spState.listener.x = clamp(spState.listener.x, spState.room.width);
        spState.listener.y = clamp(spState.listener.y, spState.room.length);
        draw();
    }

    function resizeSP() {
        if (els.container && els.canvas) {
            if (els.container.clientWidth === 0) return;
            els.canvas.width = els.container.clientWidth;
            els.canvas.height = els.container.clientHeight;
            requestAnimationFrame(() => draw());
        }
    }

    // Toggle Button Logic
    els.toggleHeatmap.addEventListener('change', (e) => {
        spState.heatmap.visible = e.target.checked;
        if (spState.heatmap.visible) els.legend.classList.remove('hidden');
        else els.legend.classList.add('hidden');
        draw();
    });

    // Listeners
    [els.inputs.W, els.inputs.L].forEach(e => e.addEventListener('input', () => updateStateFromDOM(false)));
    [els.inputs.Mirror, els.inputs.MirrorMode, els.inputs.Overlay].forEach(e => e.addEventListener('change', () => updateStateFromDOM(true)));

    // Drag
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
        const hit = (obj) => Math.hypot(mx - obj.x, my - obj.y) < 0.5;
        
        isDragging = null;
        if (hit(spState.speakers.left)) { isDragging = 'left'; spState.activeSpeaker = 'left'; }
        else if (hit(spState.speakers.right)) { isDragging = 'right'; spState.activeSpeaker = 'right'; }
        else if (hit(spState.listener)) isDragging = 'listener';
        draw();
    };

    const handleMove = (e) => {
        const p = getPos(e);
        const mx = toMeters(p.x, 'x');
        const my = toMeters(p.y, 'y');
        
        const hit = (obj) => Math.hypot(mx - obj.x, my - obj.y) < 0.5;
        let h = null;
        if (hit(spState.speakers.left)) h = 'left';
        else if (hit(spState.speakers.right)) h = 'right';
        else if (hit(spState.listener)) h = 'listener';

        if (spState.hovered !== h) { spState.hovered = h; draw(); }

        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();

        const S = spState.speakers;
        const L = spState.listener;

        if (isDragging === 'listener') {
            L.x = mx; L.y = my;
            updateStateFromDOM(false); 
        } else {
            const active = spState.speakers[isDragging];
            const other = isDragging === 'left' ? S.right : S.left;
            active.x = mx; active.y = my;

            if (spState.mirror) {
                other.y = my;
                if (spState.mirrorMode === 'room') { 
                    other.x = spState.room.width - mx; 
                } else { 
                    const dist = L.x - mx; 
                    other.x = L.x + dist; 
                }
                const pd = 0.1;
                other.x = Math.max(pd, Math.min(other.x, spState.room.width - pd));
                other.y = Math.max(pd, Math.min(other.y, spState.room.length - pd));
            }
            updateStateFromDOM(true);
        }
    };

    const handleEnd = () => { isDragging = null; draw(); };

    els.canvas.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    
    els.canvas.addEventListener('touchstart', handleStart, {passive: false});
    window.addEventListener('touchmove', handleMove, {passive: false});
    window.addEventListener('touchend', handleEnd);
    
    els.btnHeatmap.addEventListener('click', generateHeatmap);

    window.addEventListener('resize-sp', resizeSP);
    window.addEventListener('resize', () => { if(document.getElementById('view-speaker-placement').classList.contains('active')) resizeSP(); });
    setTimeout(resizeSP, 100);
    updateStateFromDOM(false);

})();