(function() {
    const els = {
        btnCalc: document.getElementById('btnCalcPEQ'),
        btnCopy: document.getElementById('btnCopyPEQ'),
        table: document.getElementById('peqTableBody'),
        chartCanvas: document.getElementById('peqChart'),
        inputs: {
            targetCurve: document.getElementById('peqTargetCurve'),
            targetOffset: document.getElementById('peqTargetOffset'),
            offsetDisp: document.getElementById('peqOffsetVal'),
            threshold: document.getElementById('peqThreshold'),
            couchMode: document.getElementById('peqCouchMode'),
            maxCut: document.getElementById('peqMaxCut'),
            minF: document.getElementById('peqMinFreq'),
            maxF: document.getElementById('peqMaxFreq')
        }
    };

    if (!els.btnCalc) return;

    let peqChart = null;
    const C = 343;

    // --- PHYSICS ENGINE ---
    function getModes(L, W, H) {
        const modes = [];
        for (let n = 1; n <= 4; n++) {
            modes.push({ f: (C / 2) * (n / L), nx: n, ny: 0, nz: 0 });
            modes.push({ f: (C / 2) * (n / W), nx: 0, ny: n, nz: 0 });
            modes.push({ f: (C / 2) * (n / H), nx: 0, ny: 0, nz: n });
        }
        for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) {
            modes.push({ f: (C / 2) * Math.sqrt((x / L) ** 2 + (y / W) ** 2), nx: x, ny: y, nz: 0 });
        }
        for (let x = 1; x <= 2; x++) for (let z = 1; z <= 2; z++) {
            modes.push({ f: (C / 2) * Math.sqrt((x / L) ** 2 + (z / H) ** 2), nx: x, ny: 0, nz: z });
        }
        for (let y = 1; y <= 2; y++) for (let z = 1; z <= 2; z++) {
            modes.push({ f: (C / 2) * Math.sqrt((y / W) ** 2 + (z / H) ** 2), nx: 0, ny: y, nz: z });
        }
        return modes.sort((a,b) => a.f - b.f);
    }

    function simulatePoint(modes, sx, sy, sz, lx, ly, lz, minF, maxF, L, W, H) {
        const dampingQ = 10;
        const data = [];
        const dist = Math.hypot(sx - lx, sy - ly, sz - lz) || 0.1;
        const dirScale = 200 / (dist ** 2);

        for (let f = minF; f <= maxF; f++) {
            let r = 0; let i = 0;
            const k = (2 * Math.PI * f) / C;
            r += dirScale * Math.cos(-k * dist);
            i += dirScale * Math.sin(-k * dist);

            modes.forEach(m => {
                if (m.f > 300) return;
                const src = Math.cos(m.nx * Math.PI * sx / L) * Math.cos(m.ny * Math.PI * sy / W) * Math.cos(m.nz * Math.PI * sz / H);
                const rec = Math.cos(m.nx * Math.PI * lx / L) * Math.cos(m.ny * Math.PI * ly / W) * Math.cos(m.nz * Math.PI * lz / H);
                const num = src * rec;
                const dr = (m.f ** 2) - (f ** 2);
                const di = (f * m.f) / dampingQ;
                const mag = dr ** 2 + di ** 2;
                const scl = 50000;
                r += (num * dr * scl) / mag;
                i += (num * -di * scl) / mag;
            });
            data.push(20 * Math.log10(Math.sqrt(r ** 2 + i ** 2) + 1e-6));
        }
        return data;
    }

    function calculateRoomResponse(minF, maxF) {
        const s = window.appState.get();
        const simL = s.room.width || 5.0; 
        const simW = s.room.length || 4.0;
        const simH = s.room.height || 2.4;
        const modes = getModes(simL, simW, simH);
        
        const sx = s.speakers.sub.x; const sy = s.speakers.sub.y; const sz = s.speakers.sub.z;
        const lx = s.listener.x; const ly = s.listener.y; const lz = s.listener.z;

        const resMain = simulatePoint(modes, sx, sy, sz, lx, ly, lz, minF, maxF, simL, simW, simH);

        if (els.inputs.couchMode.checked) {
            const offset = 0.5; 
            const lxL = Math.max(0.1, lx - offset);
            const lxR = Math.min(simL - 0.1, lx + offset);
            const resL = simulatePoint(modes, sx, sy, sz, lxL, ly, lz, minF, maxF, simL, simW, simH);
            const resR = simulatePoint(modes, sx, sy, sz, lxR, ly, lz, minF, maxF, simL, simW, simH);
            return resMain.map((val, i) => ({ f: minF + i, db: (val + resL[i] + resR[i]) / 3 }));
        }
        return resMain.map((val, i) => ({ f: minF + i, db: val }));
    }

    function getTargetCurve(minF, maxF, boostdB) {
        const curve = [];
        const lowCorner = 45; 
        const highCorner = 150; 
        for (let f = minF; f <= maxF; f++) {
            let val = 0;
            if (boostdB > 0) {
                if (f <= lowCorner) val = boostdB;
                else if (f < highCorner) {
                    const ratio = (f - lowCorner) / (highCorner - lowCorner);
                    val = boostdB * (1 - (1 - Math.cos(ratio * Math.PI)) / 2);
                }
            }
            curve.push(val);
        }
        return curve;
    }

    function getFilterDb(f, fc, gain, q) {
        if (gain === 0) return 0;
        const Fs = 48000;
        const w0 = 2 * Math.PI * fc / Fs;
        const alpha = Math.sin(w0) / (2 * q);
        const A = Math.pow(10, gain / 40);
        const b0 = 1 + alpha * A; const b1 = -2 * Math.cos(w0); const b2 = 1 - alpha * A;
        const a0 = 1 + alpha / A; const a1 = -2 * Math.cos(w0); const a2 = 1 - alpha / A;
        const phi = 2 * Math.PI * f / Fs;
        const numR = b0 + b1*Math.cos(phi) + b2*Math.cos(2*phi); const numI = b1*Math.sin(phi) + b2*Math.sin(2*phi);
        const denR = a0 + a1*Math.cos(phi) + a2*Math.cos(2*phi); const denI = a1*Math.sin(phi) + a2*Math.sin(2*phi);
        return 10 * Math.log10((numR**2 + numI**2) / (denR**2 + denI**2));
    }

    // --- SMART ITERATIVE GENERATOR ---
    function generatePEQ() {
        const minF = parseInt(els.inputs.minF.value) || 20;
        const maxF = parseInt(els.inputs.maxF.value) || 200;
        const targetBoost = parseInt(els.inputs.targetCurve.value) || 0;
        const targetOffset = parseFloat(els.inputs.targetOffset.value) || 0;
        const threshold = parseFloat(els.inputs.threshold.value) || 1.5;
        let rawCutInput = parseFloat(els.inputs.maxCut.value) || 20;
        const limitCut = -Math.abs(rawCutInput); 

        els.inputs.offsetDisp.innerText = (targetOffset > 0 ? "+" : "") + targetOffset + " dB";

        const rawData = calculateRoomResponse(minF, maxF);
        if (rawData.length === 0) return;

        let sum = 0; rawData.forEach(p => sum += p.db);
        const avgOffset = sum / rawData.length;
        
        let currentData = rawData.map(p => ({ f: p.f, db: p.db - avgOffset }));
        const originalData = rawData.map(p => ({ f: p.f, db: p.db - avgOffset }));

        const baseTarget = getTargetCurve(minF, maxF, targetBoost);
        const effectiveTarget = baseTarget.map(v => v + targetOffset);

        const filters = [];
        const MAX_FILTERS = 10;

        for (let iter = 0; iter < MAX_FILTERS; iter++) {
            
            // 1. Finn HØYESTE avvik (Peak)
            let maxDiff = -Infinity;
            let peakIdx = -1;

            for (let i = 1; i < currentData.length - 1; i++) {
                const val = currentData[i].db;
                const tgt = effectiveTarget[i];
                const diff = val - tgt;

                // Er det en lokal topp?
                if (val > currentData[i-1].db && val > currentData[i+1].db) {
                    if (diff > maxDiff) {
                        maxDiff = diff;
                        peakIdx = i;
                    }
                }
            }

            if (peakIdx === -1 || maxDiff < threshold) break;

            // 2. Lag filter
            const curr = currentData[peakIdx];
            
            // Gain beregning
            let desiredHeadroom = threshold * 0.5;
            let gain = -(maxDiff - desiredHeadroom);
            if (gain < limitCut) gain = limitCut;

            // 3. SMARTERE Q-BEREGNING (Dal-deteksjon)
            const minus3 = curr.db - 3;
            let fLow = curr.f; let fHigh = curr.f;

            // Søk nedover: Stopp ved -3dB ELLER hvis kurven går opp igjen (en dal)
            for (let j = peakIdx; j >= 0; j--) {
                if (currentData[j].db < minus3) { fLow = currentData[j].f; break; }
                // Dal-sjekk: Hvis neste punkt til venstre er lavere enn nåværende, er vi på vei ned.
                // Men hvis punktet til venstre er HØYERE, har vi passert en dal og er på vei opp mot en ny topp.
                if (j < peakIdx && currentData[j].db > currentData[j+1].db) { fLow = currentData[j].f; break; }
            }
            
            // Søk oppover: Samme logikk
            for (let j = peakIdx; j < currentData.length; j++) {
                if (currentData[j].db < minus3) { fHigh = currentData[j].f; break; }
                if (j > peakIdx && currentData[j].db > currentData[j-1].db) { fHigh = currentData[j].f; break; }
            }
            
            const bw = fHigh - fLow;
            let Q = (bw > 0) ? (curr.f / bw) : 5;
            
            // VIKTIG: Tving Q til å være minst 2.0 for rom-moder.
            // Dette hindrer "badekar"-filteret du så på skjermbildet.
            Q = Math.min(Math.max(Q, 2.0), 15);

            const newFilter = { f: curr.f, gain: gain, q: Q };
            filters.push(newFilter);

            // 4. Oppdater data
            for (let i = 0; i < currentData.length; i++) {
                const correction = getFilterDb(currentData[i].f, newFilter.f, newFilter.gain, newFilter.q);
                currentData[i].db += correction;
            }
        }

        filters.sort((a, b) => a.f - b.f);

        renderTable(filters);
        renderChart(originalData, currentData, effectiveTarget);
    }

    function renderTable(filters) {
        els.table.innerHTML = '';
        if (filters.length === 0) {
            els.table.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-slate-600">Response is within tolerance.</td></tr>`;
            els.btnCopy.classList.add('hidden');
            return;
        }
        filters.forEach((fil, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-slate-800 hover:bg-slate-800/50 transition-colors';
            tr.innerHTML = `
                <td class="px-4 py-3 font-mono text-slate-500 text-xs">${idx + 1}</td>
                <td class="px-4 py-3 font-mono text-white">${fil.f} Hz</td>
                <td class="px-4 py-3 font-mono text-pink-400 font-bold">${fil.gain.toFixed(1)} dB</td>
                <td class="px-4 py-3 font-mono text-slate-300">${fil.q.toFixed(2)}</td>
            `;
            els.table.appendChild(tr);
        });
        els.btnCopy.classList.remove('hidden');
        els.btnCopy.onclick = () => {
            const txt = filters.map(f => `Filter ${f.f}Hz \tGain ${f.gain.toFixed(1)}dB \tQ ${f.q.toFixed(2)}`).join('\n');
            navigator.clipboard.writeText(txt);
        };
    }

    function renderChart(before, after, targetData) {
        const ctx = els.chartCanvas.getContext('2d');
        const labels = before.map(p => p.f);
        
        if (peqChart) {
            peqChart.data.labels = labels;
            peqChart.data.datasets[0].data = before.map(p => p.db);
            peqChart.data.datasets[1].data = after.map(p => p.db);
            peqChart.data.datasets[2].data = targetData;
            peqChart.update('none');
        } else {
            peqChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Before EQ', data: before.map(p => p.db), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.3 },
                        { label: 'After EQ', data: after.map(p => p.db), borderColor: '#4ade80', borderWidth: 2, pointRadius: 0, tension: 0.3 },
                        { label: 'Target', data: targetData, borderColor: 'rgba(255, 255, 255, 0.3)', borderDash: [5, 5], borderWidth: 1, pointRadius: 0 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, 
                    devicePixelRatio: window.devicePixelRatio,
                    interaction: { mode: 'index', intersect: false },
                    animation: false,
                    plugins: { legend: { labels: { color: '#94a3b8' } }, tooltip: { backgroundColor: '#1e293b' } },
                    scales: { x: { ticks: { color: '#64748b', maxTicksLimit: 10 }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } } }
                }
            });
        }
    }

    els.btnCalc.addEventListener('click', generatePEQ);
    els.inputs.targetOffset.addEventListener('input', generatePEQ);
    els.inputs.targetCurve.addEventListener('change', generatePEQ);
    els.inputs.threshold.addEventListener('input', generatePEQ);

})();