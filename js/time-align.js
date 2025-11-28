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

    if (!els.dL) return; // Exit if elements don't exist

    function calculate() {
        const distL = parseFloat(els.dL.value) || 0;
        const distR = parseFloat(els.dR.value) || 0;
        const distSub = parseFloat(els.dSub.value) || 0;
        const c = parseFloat(els.speed.value) || 343;
        const f = parseFloat(els.xover.value) || 80;

        // 1. Calculate Time of Flight (ms)
        const tL = (distL / c) * 1000;
        const tR = (distR / c) * 1000;
        const tSub = (distSub / c) * 1000;

        // 2. Find furthest speaker (reference)
        const maxT = Math.max(tL, tR, tSub);

        // 3. Calculate Delay needed (Reference - Current)
        const delL = maxT - tL;
        const delR = maxT - tR;
        const delSub = maxT - tSub;

        els.resL.innerText = delL.toFixed(2);
        els.resR.innerText = delR.toFixed(2);
        els.resSub.innerText = delSub.toFixed(2);

        // 4. Phase Calculation
        // Wavelength
        const lambda = c / f;
        // Distance difference between Mains (Avg) and Sub
        const avgMainDist = (distL + distR) / 2;
        const diffMeters = Math.abs(distSub - avgMainDist);
        
        // How many wavelengths is this?
        const cycles = diffMeters / lambda;
        // Phase shift (removing full cycles)
        const phaseShift = (cycles % 1) * 360; 
        
        els.resXover.innerText = f;
        els.resDiff.innerText = phaseShift.toFixed(0) + "°";

        // Simple Recommendation
        // If shift is close to 180 (e.g. 135-225), flipping polarity usually helps
        if (phaseShift > 120 && phaseShift < 240) {
            els.resRec.innerText = "INVERT (180°)";
            els.resRec.className = "text-sm font-bold text-orange-400 uppercase bg-orange-900/30 px-2 py-1 rounded inline-block";
        } else {
            els.resRec.innerText = "NORMAL (0°)";
            els.resRec.className = "text-sm font-bold text-green-400 uppercase bg-green-900/30 px-2 py-1 rounded inline-block";
        }
    }

    // Listeners
    [els.dL, els.dR, els.dSub, els.xover, els.speed].forEach(el => el.addEventListener('input', calculate));
    
    // Init
    calculate();
})();