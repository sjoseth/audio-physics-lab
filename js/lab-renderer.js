/**
 * js/lab-renderer.js
 * Grafikk-motoren for Audio Physics Lab 2.0.
 * Inkluderer nå: Hjelpestreker (Measurements) og Speiling (Mirroring).
 */

class LabRenderer {
    constructor(canvasId, stateManager) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) throw new Error(`Canvas with ID ${canvasId} not found`);
        
        this.ctx = this.canvas.getContext('2d');
        this.stateManager = stateManager;
        
        this.activeMode = null; 
        
        this.isDragging = null;
        this.hovered = null;
        this.padding = 40;

        // Settings for mirroring (Disse settes av Controller/Mode)
        this.mirrorSettings = { enabled: false, mode: 'room' }; // mode: 'room' | 'listener'

        this.bindEvents();
        this.resize();
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    // --- KOORDINATSYSTEMER ---
    toPx(meters, axis) {
        const s = this.stateManager.get();
        const canvasDim = axis === 'x' ? this.canvas.width / this.dpr : this.canvas.height / this.dpr;
        const roomDim = axis === 'x' ? s.room.width : s.room.length;
        if (roomDim <= 0) return 0;
        return this.padding + (meters / roomDim) * (canvasDim - 2 * this.padding);
    }

    toMeters(px, axis) {
        const s = this.stateManager.get();
        const canvasDim = axis === 'x' ? this.canvas.width / this.dpr : this.canvas.height / this.dpr;
        const roomDim = axis === 'x' ? s.room.width : s.room.length;
        const contentSize = canvasDim - 2 * this.padding;
        if (contentSize <= 0) return 0;
        const val = ((px - this.padding) / contentSize) * roomDim;
        // Clamp verdien slik at man ikke kan dra objekter utenfor veggene
        return Math.max(0, Math.min(roomDim, val));
    }

    // --- TEGNE-PRIMITIVER ---
    clear() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.fillStyle = '#0b101e';
        this.ctx.fillRect(0, 0, w, h);
    }

    drawRoom() {
        const s = this.stateManager.get();
        const x0 = this.toPx(0, 'x');
        const y0 = this.toPx(0, 'y');
        const x1 = this.toPx(s.room.width, 'x');
        const y1 = this.toPx(s.room.length, 'y');

        this.ctx.fillStyle = '#111827';
        this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

        this.ctx.strokeStyle = '#1e293b';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([]); 
        this.ctx.beginPath();
        
        for (let i = 1; i < s.room.width; i++) {
            const x = this.toPx(i, 'x');
            this.ctx.moveTo(x, y0); this.ctx.lineTo(x, y1);
        }
        for (let i = 1; i < s.room.length; i++) {
            const y = this.toPx(i, 'y');
            this.ctx.moveTo(x0, y); this.ctx.lineTo(x1, y);
        }
        this.ctx.stroke();

        this.ctx.strokeStyle = '#334155';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }

    // PUNKT 2: Hjelpestreker med piler
    drawMeasurements(obj, color) {
        const x = obj.x;
        const y = obj.y;
        const s = this.stateManager.get();
        
        const px = this.toPx(x, 'x');
        const py = this.toPx(y, 'y');
        const x0 = this.toPx(0, 'x');
        const x1 = this.toPx(s.room.width, 'x');
        const y0 = this.toPx(0, 'y');
        const y1 = this.toPx(s.room.length, 'y');

        this.ctx.save();
        this.ctx.strokeStyle = '#ef4444'; // Rød farge for mål
        this.ctx.fillStyle = '#ef4444';
        this.ctx.lineWidth = 1;
        this.ctx.font = '10px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Hjelpefunksjon for pil
        const drawArrowLine = (xStart, yStart, xEnd, yEnd, val) => {
            this.ctx.beginPath(); this.ctx.moveTo(xStart, yStart); this.ctx.lineTo(xEnd, yEnd); this.ctx.stroke();
            
            // Pilhode
            const ang = Math.atan2(yEnd - yStart, xEnd - xStart);
            const h = 6;
            this.ctx.beginPath();
            this.ctx.moveTo(xEnd, yEnd);
            this.ctx.lineTo(xEnd - h * Math.cos(ang - Math.PI / 6), yEnd - h * Math.sin(ang - Math.PI / 6));
            this.ctx.lineTo(xEnd - h * Math.cos(ang + Math.PI / 6), yEnd - h * Math.sin(ang + Math.PI / 6));
            this.ctx.fill();

            // Tekst med bakgrunn
            const mx = (xStart + xEnd) / 2;
            const my = (yStart + yEnd) / 2;
            const txt = val.toFixed(2) + 'm';
            const met = this.ctx.measureText(txt);
            
            this.ctx.save();
            this.ctx.fillStyle = '#0f172a';
            this.ctx.fillRect(mx - met.width / 2 - 2, my - 6, met.width + 4, 12);
            this.ctx.restore();
            this.ctx.fillText(txt, mx, my);
        };

        // Tegn linje til nærmeste vegger
        if (x < s.room.width / 2) drawArrowLine(px - 10, py, x0, py, x);
        else drawArrowLine(px + 10, py, x1, py, s.room.width - x);

        if (y < s.room.length / 2) drawArrowLine(px, py - 10, px, y0, y);
        else drawArrowLine(px, py + 10, px, y1, s.room.length - y);

        this.ctx.restore();
    }

    drawEntity(type, x, y, label) {
        const px = this.toPx(x, 'x');
        const py = this.toPx(y, 'y');
        
        const isHover = this.hovered === label;
        const isActive = this.isDragging === label;
        
        // Hvis aktiv eller hover, tegn hjelpestreker FØR vi translaterer
        if (isHover || isActive) {
            this.drawMeasurements({x, y}, '#ef4444');
        }

        this.ctx.save();
        this.ctx.translate(px, py);

        let color = '#94a3b8';
        if (type === 'speaker') color = '#3b82f6';
        if (type === 'sub') color = '#a855f7';
        if (type === 'listener') color = '#22c55e';

        if (isHover || isActive) {
            this.ctx.shadowColor = color;
            this.ctx.shadowBlur = 15;
        }

        this.ctx.fillStyle = color;

        if (type === 'speaker' || type === 'sub') {
            this.ctx.fillRect(-12, -12, 24, 24);
            if (type === 'speaker') {
                this.ctx.fillStyle = '#1e3a8a';
                this.ctx.beginPath(); this.ctx.moveTo(-6, -12); this.ctx.lineTo(6, -12); this.ctx.lineTo(0, 0); this.ctx.fill();
            }
        } else if (type === 'listener') {
            this.ctx.beginPath(); this.ctx.arc(0, 0, 10, 0, Math.PI * 2); this.ctx.fill();
            this.ctx.fillStyle = '#064e3b';
            this.ctx.beginPath(); this.ctx.moveTo(-4, -8); this.ctx.lineTo(4, -8); this.ctx.lineTo(0, -14); this.ctx.fill();
        }
        this.ctx.restore();
    }

    loop() {
        this.dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (this.canvas.width !== Math.floor(rect.width * this.dpr) || 
            this.canvas.height !== Math.floor(rect.height * this.dpr)) {
            this.resize();
        }
        
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(this.dpr, this.dpr);
        
        this.clear();
        this.drawRoom();

        if (this.activeMode && typeof this.activeMode.draw === 'function') {
            this.ctx.save();
            this.activeMode.draw(this.ctx);
            this.ctx.restore();
        }

        const s = this.stateManager.get();
        if (s.speakers.left) this.drawEntity('speaker', s.speakers.left.x, s.speakers.left.y, 'left');
        if (s.speakers.right) this.drawEntity('speaker', s.speakers.right.x, s.speakers.right.y, 'right');
        if (s.speakers.sub) this.drawEntity('sub', s.speakers.sub.x, s.speakers.sub.y, 'sub');
        if (s.listener) this.drawEntity('listener', s.listener.x, s.listener.y, 'listener');

        requestAnimationFrame(this.loop);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.floor(rect.width * this.dpr);
        this.canvas.height = Math.floor(rect.height * this.dpr);
    }

    bindEvents() {
        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return { rawX: clientX - rect.left, rawY: clientY - rect.top };
        };

        const handleDown = (e) => {
            if (e.cancelable && e.target === this.canvas) e.preventDefault();
            const p = getPos(e);
            const mx = this.toMeters(p.rawX * this.dpr, 'x');
            const my = this.toMeters(p.rawY * this.dpr, 'y');
            
            const s = this.stateManager.get();
            const hitDist = 0.6;
            const check = (obj) => obj && Math.hypot(mx - obj.x, my - obj.y) < hitDist;

            this.isDragging = null;
            if (check(s.listener)) this.isDragging = 'listener';
            else if (check(s.speakers.left)) this.isDragging = 'left';
            else if (check(s.speakers.right)) this.isDragging = 'right';
            else if (check(s.speakers.sub)) this.isDragging = 'sub';
            
            this.canvas.style.cursor = this.isDragging ? 'grabbing' : 'default';
        };

        const handleMove = (e) => {
            const p = getPos(e);
            const mx = this.toMeters(p.rawX * this.dpr, 'x');
            const my = this.toMeters(p.rawY * this.dpr, 'y');
            
            const debugX = document.getElementById('debugX');
            const debugY = document.getElementById('debugY');
            if(debugX) debugX.innerText = mx.toFixed(2);
            if(debugY) debugY.innerText = my.toFixed(2);

            if (!this.isDragging) {
                const s = this.stateManager.get();
                const hitDist = 0.6;
                const check = (obj) => obj && Math.hypot(mx - obj.x, my - obj.y) < hitDist;
                let h = null;
                if (check(s.listener)) h = 'listener';
                else if (check(s.speakers.left)) h = 'left';
                else if (check(s.speakers.right)) h = 'right';
                else if (check(s.speakers.sub)) h = 'sub';
                if (this.hovered !== h) {
                    this.hovered = h;
                    this.canvas.style.cursor = h ? 'grab' : 'default';
                }
                return;
            }

            if (e.cancelable) e.preventDefault();

            // PUNKT 3: Speiling-logikk
            const s = this.stateManager.get();
            const updates = { speakers: { ...s.speakers }, listener: { ...s.listener } };

            if (this.isDragging === 'listener') {
                updates.listener.x = mx;
                updates.listener.y = my;
            } else if (this.isDragging === 'sub') {
                updates.speakers.sub.x = mx;
                updates.speakers.sub.y = my;
            } else if (this.isDragging === 'left') {
                updates.speakers.left.x = mx;
                updates.speakers.left.y = my;
                
                if (this.mirrorSettings.enabled) {
                    updates.speakers.right.y = my; // Alltid samme dybde
                    if (this.mirrorSettings.mode === 'room') {
                        // Speil rundt rom-senter
                        updates.speakers.right.x = s.room.width - mx;
                    } else {
                        // Speil rundt lytter
                        // distanse fra venstre til lytter
                        const dist = s.listener.x - mx;
                        updates.speakers.right.x = s.listener.x + dist;
                    }
                    // Clamp
                    updates.speakers.right.x = Math.max(0.1, Math.min(updates.speakers.right.x, s.room.width - 0.1));
                }

            } else if (this.isDragging === 'right') {
                updates.speakers.right.x = mx;
                updates.speakers.right.y = my;
                
                if (this.mirrorSettings.enabled) {
                    updates.speakers.left.y = my;
                    if (this.mirrorSettings.mode === 'room') {
                        updates.speakers.left.x = s.room.width - mx;
                    } else {
                        const dist = mx - s.listener.x;
                        updates.speakers.left.x = s.listener.x - dist;
                    }
                    updates.speakers.left.x = Math.max(0.1, Math.min(updates.speakers.left.x, s.room.width - 0.1));
                }
            }

            this.stateManager.update(updates);
            
             if (this.activeMode && typeof this.activeMode.updateChart === 'function') {
                 this.activeMode.updateChart();
             }
        };

        const handleUp = () => {
            this.isDragging = null;
            this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
        };

        this.canvas.addEventListener('mousedown', handleDown);
        this.canvas.addEventListener('touchstart', handleDown, { passive: false });
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchend', handleUp);
    }
}