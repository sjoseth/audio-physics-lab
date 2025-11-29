(function() {
    const global = window.appState.get();

    const state = {
        room: { width: global.room.width, length: global.room.length },
        speakers: { 
            left: { x: global.speakers.left.x, y: global.speakers.left.y }, 
            right: { x: global.speakers.right.x, y: global.speakers.right.y } 
        },
        listener: { x: global.listener.x, y: global.listener.y },
        options: { showSide: true, showFront: false, showBack: false },
        mirror: true,
        mirrorMode: 'room',
        hovered: null
    };
    let isDragging = null;

    const getEl = (id) => document.getElementById(id);
    const els = {
        canvas: getEl('rfCanvas'),
        container: getEl('rfCanvasContainer'),
        inputs: { W: getEl('rfInputW'), L: getEl('rfInputL'), Mirror: getEl('rfInputMirror'), MirrorMode: getEl('rfMirrorMode') },
        toggles: { Side: getEl('rfShowSide'), Front: getEl('rfShowFront'), Back: getEl('rfShowBack') }
    };

    if (!els.canvas) return;
    const ctx = els.canvas.getContext('2d');

    // --- SYNC LOGIC ---
    if(els.inputs.W) els.inputs.W.value = state.room.width;
    if(els.inputs.L) els.inputs.L.value = state.room.length;

    window.addEventListener('app-state-updated', (e) => {
        const s = e.detail;
        state.room.width = s.room.width;
        state.room.length = s.room.length;
        state.speakers.left.x = s.speakers.left.x;
        state.speakers.left.y = s.speakers.left.y;
        state.speakers.right.x = s.speakers.right.x;
        state.speakers.right.y = s.speakers.right.y;
        state.listener.x = s.listener.x;
        state.listener.y = s.listener.y;
        
        if(document.activeElement !== els.inputs.W) els.inputs.W.value = state.room.width;
        if(document.activeElement !== els.inputs.L) els.inputs.L.value = state.room.length;
        draw();
    });
    // ------------------

    function toPx(m, axis) {
        const pad = 40, dim = axis === 'x' ? els.canvas.width : els.canvas.height, roomDim = axis === 'x' ? state.room.width : state.room.length;
        return pad + (m / roomDim) * (dim - 2 * pad);
    }
    function toMeters(px, axis) {
        const pad = 40, dim = axis === 'x' ? els.canvas.width : els.canvas.height, roomDim = axis === 'x' ? state.room.width : state.room.length;
        return Math.max(0, Math.min(roomDim, ((px - pad) / (dim - 2 * pad)) * roomDim));
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
        const x1 = toPx(state.room.width, 'x');
        const y0 = toPx(0, 'y');
        const y1 = toPx(state.room.length, 'y');
        
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

        if (x < state.room.width / 2) drawLbl(px - 15, py, x0, py, x);
        else drawLbl(px + 15, py, x1, py, state.room.width - x);

        if (y < state.room.length / 2) drawLbl(px, py - 15, px, y0, y);
        else drawLbl(px, py + 15, px, y1, state.room.length - y);
        
        ctx.restore();
    }

    function drawReflMeasurement(refX, refY, wall, isSecondary, layer = 0) {
        const px = toPx(refX, 'x');
        const py = toPx(refY, 'y');
        const x0 = toPx(0, 'x'); 
        const y0 = toPx(0, 'y'); 
        
        ctx.save();
        const col = isSecondary ? '#fdba74' : '#f97316'; 
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1;
        ctx.font = isSecondary ? '9px sans-serif' : '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let val, txt, mx, my;
        const direction = (wall === 'left' || wall === 'front') ? 1 : -1;
        let dist = 20 + (layer * 25); 
        if(isSecondary) dist += 45;
        const offset = dist * direction;

        if (wall === 'left' || wall === 'right') {
            val = refY;
            const lineX = px + offset;
            drawArrowLine(lineX, y0, lineX, py);
            mx = lineX; my = (y0 + py) / 2;
            txt = val.toFixed(2) + 'm';
            const met = ctx.measureText(txt);
            ctx.save(); ctx.fillStyle = '#0f172a'; ctx.fillRect(mx - met.width/2 - 2, my - 6, met.width + 4, 12); ctx.restore();
            ctx.fillText(txt, mx, my);
            ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(lineX, py); ctx.lineTo(px, py); ctx.stroke();
        } else { 
            val = refX;
            const lineY = py + offset;
            drawArrowLine(x0, lineY, px, lineY);
            mx = (x0 + px) / 2; my = lineY;
            txt = val.toFixed(2) + 'm';
            const met = ctx.measureText(txt);
            ctx.save(); ctx.fillStyle = '#0f172a'; ctx.fillRect(mx - met.width/2 - 2, my - 6, met.width + 4, 12); ctx.restore();
            ctx.fillText(txt, mx, my);
            ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(px, lineY); ctx.lineTo(px, py); ctx.stroke();
        }
        ctx.restore();
    }

    function drawReflection(spkPos, wall, isSecondary = false, layer = 0) {
        const lx = state.listener.x, ly = state.listener.y;
        const sx = spkPos.x, sy = spkPos.y;
        const W = state.room.width, L = state.room.length;

        let refX, refY, mirX, mirY; 

        if (wall === 'left') {
            mirX = -sx; mirY = sy;
            const m = (ly - mirY) / (lx - mirX);
            refY = mirY + m * (0 - mirX);
            refX = 0;
        } else if (wall === 'right') {
            mirX = W + (W - sx); mirY = sy;
            const m = (ly - mirY) / (lx - mirX);
            refY = mirY + m * (W - mirX);
            refX = W;
        } else if (wall === 'front') {
            mirX = sx; mirY = -sy;
            const m = (ly - mirY) / (lx - mirX);
            refX = (0 - mirY)/m + mirX;
            refY = 0;
        } else if (wall === 'back') {
            mirX = sx; mirY = L + (L - sy);
            const m = (ly - mirY) / (lx - mirX);
            refX = (L - mirY)/m + mirX;
            refY = L;
        }

        if ((wall === 'left' || wall === 'right') && (refY < 0 || refY > L)) return;
        if ((wall === 'front' || wall === 'back') && (refX < 0 || refX > W)) return;

        drawReflMeasurement(refX, refY, wall, isSecondary, layer);

        const pxS = toPx(sx, 'x'), pyS = toPx(sy, 'y');
        const pxL = toPx(lx, 'x'), pyL = toPx(ly, 'y');
        const pxR = toPx(refX, 'x'), pyR = toPx(refY, 'y');

        ctx.save();
        ctx.lineWidth = 1;
        if(isSecondary) {
            ctx.strokeStyle = 'rgba(249, 115, 22, 0.3)';
            ctx.setLineDash([4, 4]);
        } else {
            ctx.strokeStyle = 'rgba(249, 115, 22, 0.6)';
            ctx.setLineDash([]);
        }
        
        ctx.beginPath(); ctx.moveTo(pxS, pyS); ctx.lineTo(pxR, pyR); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pxR, pyR); ctx.lineTo(pxL, pyL); ctx.stroke();
        
        ctx.fillStyle = isSecondary ? '#fdba74' : '#f97316'; 
        ctx.beginPath(); ctx.arc(pxR, pyR, 4, 0, Math.PI*2); ctx.fill();
        ctx.restore();
    }

    function draw() {
        if (!els.container || !els.canvas) return;
        const w = els.canvas.width;
        const h = els.canvas.height;
        ctx.clearRect(0, 0, w, h);
        
        ctx.fillStyle = '#0b101e'; ctx.fillRect(0, 0, w, h);
        const x0 = toPx(0, 'x'), y0 = toPx(0, 'y');
        const x1 = toPx(state.room.width, 'x'), y1 = toPx(state.room.length, 'y');
        
        ctx.fillStyle = '#111827'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath();
        for (let i = 1; i < state.room.length; i++) { const px = toPx(i, 'y'); ctx.moveTo(x0, px); ctx.lineTo(x1, px); } 
        for (let i = 1; i < state.room.width; i++) { const px = toPx(i, 'x'); ctx.moveTo(px, y0); ctx.lineTo(px, y1); } 
        ctx.stroke();
        
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

        if (state.options.showSide) {
            drawReflection(state.speakers.left, 'left', false, 0);
            drawReflection(state.speakers.right, 'left', true, 0);
            drawReflection(state.speakers.right, 'right', false, 0);
            drawReflection(state.speakers.left, 'right', true, 0);
        }
        if (state.options.showFront) {
            drawReflection(state.speakers.left, 'front', false, 0);
            drawReflection(state.speakers.right, 'front', false, 1);
        }
        if (state.options.showBack) {
            drawReflection(state.speakers.left, 'back', false, 0);
            drawReflection(state.speakers.right, 'back', false, 1);
        }

        const drawEnt = (pos, type, label) => {
            const px = toPx(pos.x, 'x'), py = toPx(pos.y, 'y');
            const c = type === 'spk' ? '#3b82f6' : '#22c55e';
            const isAct = (state.hovered === label || isDragging === label);
            if (isAct) drawMeasurements(pos.x, pos.y, '#3b82f6');

            ctx.save();
            if (isAct) { ctx.shadowColor = c; ctx.shadowBlur = 15; }
            ctx.fillStyle = c;
            if (type === 'spk') ctx.fillRect(px - 10, py - 10, 20, 20);
            else { ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI*2); ctx.fill(); }
            ctx.restore();
        };

        drawEnt(state.speakers.left, 'spk', 'left');
        drawEnt(state.speakers.right, 'spk', 'right');
        drawEnt(state.listener, 'lis', 'listener');
    }

    function update() {
        state.room.width = parseFloat(els.inputs.W.value) || 5.0;
        state.room.length = parseFloat(els.inputs.L.value) || 6.0;
        state.options.showSide = els.toggles.Side.checked;
        state.options.showFront = els.toggles.Front.checked;
        state.options.showBack = els.toggles.Back.checked;
        state.mirror = els.inputs.Mirror.checked;
        state.mirrorMode = els.inputs.MirrorMode.value;

        // --- UPDATE GLOBAL ---
        window.appState.update({
            room: { width: state.room.width, length: state.room.length },
            speakers: {
                left: { x: state.speakers.left.x, y: state.speakers.left.y },
                right: { x: state.speakers.right.x, y: state.speakers.right.y }
            },
            listener: { x: state.listener.x, y: state.listener.y }
        });
        // ---------------------

        const pd = 0.1;
        const clamp = (val, max) => Math.max(pd, Math.min(val, max - pd));
        state.speakers.left.x = clamp(state.speakers.left.x, state.room.width);
        state.speakers.left.y = clamp(state.speakers.left.y, state.room.length);
        state.speakers.right.x = clamp(state.speakers.right.x, state.room.width);
        state.speakers.right.y = clamp(state.speakers.right.y, state.room.length);
        state.listener.x = clamp(state.listener.x, state.room.width);
        state.listener.y = clamp(state.listener.y, state.room.length);
        draw();
    }

    function resizeRF() {
        if (els.container && els.canvas) {
            if (els.container.clientWidth === 0) return;
            els.canvas.width = els.container.clientWidth;
            els.canvas.height = els.container.clientHeight;
            requestAnimationFrame(() => draw());
        }
    }

    const getPos = (e) => { 
        const r = els.canvas.getBoundingClientRect(); 
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: cx - r.left, y: cy - r.top }; 
    };
    
    const handleStart = (e) => {
        const p = getPos(e), mx = toMeters(p.x, 'x'), my = toMeters(p.y, 'y');
        isDragging = null;
        if (Math.hypot(mx - state.speakers.left.x, my - state.speakers.left.y) < 0.5) isDragging = 'left';
        else if (Math.hypot(mx - state.speakers.right.x, my - state.speakers.right.y) < 0.5) isDragging = 'right';
        else if (Math.hypot(mx - state.listener.x, my - state.listener.y) < 0.5) isDragging = 'lis';
        draw(); 
    };

    const handleMove = (e) => {
        const p = getPos(e), mx = toMeters(p.x, 'x'), my = toMeters(p.y, 'y');
        const hL = Math.hypot(mx - state.speakers.left.x, my - state.speakers.left.y) < 0.5;
        const hR = Math.hypot(mx - state.speakers.right.x, my - state.speakers.right.y) < 0.5;
        const hLis = Math.hypot(mx - state.listener.x, my - state.listener.y) < 0.5;
        let h = null; 
        if(hL) h='left'; else if(hR) h='right'; else if(hLis) h='listener';
        if(state.hovered !== h) { state.hovered = h; draw(); }
        if (!isDragging) return;
        if(e.cancelable) e.preventDefault(); 
        if (isDragging === 'lis') {
            state.listener.x = mx; state.listener.y = my;
        } else {
            const active = state.speakers[isDragging];
            const other = isDragging === 'left' ? state.speakers.right : state.speakers.left;
            active.x = mx; active.y = my;
            if (state.mirror) {
                other.y = my;
                if (state.mirrorMode === 'room') other.x = state.room.width - mx; 
                else { const dist = state.listener.x - mx; other.x = state.listener.x + dist; }
                const pd = 0.1;
                other.x = Math.max(pd, Math.min(other.x, state.room.width - pd));
                other.y = Math.max(pd, Math.min(other.y, state.room.length - pd));
            }
        }
        
        // Sync during drag
        update();
    };
    
    const handleEnd = () => isDragging = null;

    els.canvas.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    els.canvas.addEventListener('touchstart', handleStart, {passive: false});
    window.addEventListener('touchmove', handleMove, {passive: false});
    window.addEventListener('touchend', handleEnd);
    
    Object.values(els.inputs).forEach(e => e.addEventListener('input', update));
    Object.values(els.toggles).forEach(e => e.addEventListener('change', update));
    
    window.addEventListener('resize-rf', resizeRF);
    window.addEventListener('resize', () => { if(document.getElementById('view-reflection-sim').classList.contains('active')) resizeRF(); });
    setTimeout(resizeRF, 100);

    update();
})();