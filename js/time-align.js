(function() {
    const els = {
        dL: document.getElementById('taDistL'),
        dR: document.getElementById('taDistR'),
        dSub: document.getElementById('taDistSub'),
        xover: document.getElementById('taCrossover'),
        speed: document.getElementById('taSpeed'),
        
        resL: document.getElementById('resDelayL'),
        resR: document.getElementById('resDelayR'),
        resSub: document.getElementById('resDelaySub'),
        
        resDiff: document.getElementById('resPhaseDiff'),
        resRec: document.getElementById('resPhaseRec'),
        resXover: document.getElementById('resXoverDisp')
    };

    if (!els.dL) return;

    // --- NEW: FETCH DISTANCES FROM STATE ---
    function fetchDistancesFromState() {
        const s = window.appState.get();
        const mgr = window.appState;

        const distL = mgr.getDistance(s.listener, s.speakers.left);
        const distR = mgr.getDistance(s.listener, s.speakers.right);
        const distSub = mgr.getDistance(s.listener, s.speakers.sub);

        els.dL.value = distL.toFixed(2);
        els.dR.value = distR.toFixed(2);
        els.dSub.value = distSub.toFixed(2);
        
        calculate();
    }

    // Update whenever user modifies layout in other tools
    window.addEventListener('app-state-updated', fetchDistancesFromState);
    
    // Initial fetch
    fetchDistancesFromState();
    // ---------------------------------------

    function calculate() {
        const distL = parseFloat(els.dL.value) || 0;
        const distR = parseFloat(els.dR.value) || 0;
        const distSub = parseFloat(els.dSub.value) || 0;
        const c = parseFloat(els.speed.value) || 343;
        const f = parseFloat(els.xover.value) || 80;

        const tL = (distL / c) * 1000;
        const tR = (distR / c) * 1000;
        const tSub = (distSub / c) * 1000;

        const maxT = Math.max(tL, tR, tSub);

        const delL = maxT - tL;
        const delR = maxT - tR;
        const delSub = maxT - tSub;

        els.resL.innerText = delL.toFixed(2);
        els.resR.innerText = delR.toFixed(2);
        els.resSub.innerText = delSub.toFixed(2);

        const lambda = c / f;
        const avgMainDist = (distL + distR) / 2;
        const diffMeters = Math.abs(distSub - avgMainDist);
        
        const cycles = diffMeters / lambda;
        const phaseShift = (cycles % 1) * 360; 
        
        els.resXover.innerText = f;
        els.resDiff.innerText = phaseShift.toFixed(0) + "°";

        if (phaseShift > 120 && phaseShift < 240) {
            els.resRec.innerText = "INVERT (180°)";
            els.resRec.className = "text-sm font-bold text-orange-400 uppercase bg-orange-900/30 px-2 py-1 rounded inline-block";
        } else {
            els.resRec.innerText = "NORMAL (0°)";
            els.resRec.className = "text-sm font-bold text-green-400 uppercase bg-green-900/30 px-2 py-1 rounded inline-block";
        }
    }

    [els.dL, els.dR, els.dSub, els.xover, els.speed].forEach(el => el.addEventListener('input', calculate));
    
    calculate();
})();