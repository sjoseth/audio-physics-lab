/**
 * js/lab-controller.js
 * Hovedkontrolleren for Audio Physics Lab 2.0.
 */

// Funksjonen defineres, men kjøres ikke enda
function initMobileMenu() {
    const btn = document.getElementById('btnMobileMenu');
    const sidebar = document.getElementById('labSidebar');
    const overlay = document.getElementById('mobileMenuOverlay');

    if (btn && sidebar) {
        console.log("Mobile menu initialized");

        const toggleMenu = (e) => {
            if(e && e.cancelable) { e.preventDefault(); e.stopPropagation(); }
            const isClosed = sidebar.classList.contains('-translate-x-full');
            if (isClosed) {
                sidebar.classList.remove('-translate-x-full');
                if(overlay) overlay.classList.remove('hidden');
            } else {
                sidebar.classList.add('-translate-x-full');
                if(overlay) overlay.classList.add('hidden');
            }
        };
        
        // Clone node trick to ensure no duplicate listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', toggleMenu);
        newBtn.addEventListener('touchstart', toggleMenu, {passive: false});
        
        if (overlay) {
            overlay.addEventListener('click', toggleMenu);
            // overlay.addEventListener('touchstart', toggleMenu, {passive: false}); // Valgfritt
        }

        // --- VIKTIG FIKS: ISOLER SIDEBAR FRA GLOBALE TOUCH EVENTS ---
        // Dette hindrer at touch i menyen "lekker" ut til canvas/window og blir ignorert eller avbrutt.
        const stopProp = (e) => e.stopPropagation();
        
        // Vi stopper propagation, men vi kjører IKKE preventDefault() her,
        // for da ville scrolling av menyen sluttet å virke.
        sidebar.addEventListener('touchstart', stopProp, {passive: true});
        sidebar.addEventListener('touchmove', stopProp, {passive: true});
        sidebar.addEventListener('touchend', stopProp, {passive: true});
        sidebar.addEventListener('click', stopProp); // For sikkerhets skyld
        // -------------------------------------------------------------

    } else {
        console.error("Mobile menu elements not found!");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Audio Lab 2.0: Booting up...');
    
    // --- 1. INIT MOBILE MENU (Her er endringen: Vi kaller den INNI her) ---
    initMobileMenu();

    // --- 2. INIT SYSTEM ---
    const stateManager = window.appState;
    if (!stateManager) return console.error('State Manager missing');

    let renderer = null;
    try {
        renderer = new LabRenderer('labCanvas', stateManager);
    } catch (e) {
        console.error('Canvas init failed:', e);
        return;
    }

    if (typeof RoomMode === 'undefined') return console.error('Modes missing');

    const modes = {
        room: new RoomMode(stateManager, renderer),
        speaker: new SpeakerMode(stateManager, renderer),
        reflection: new ReflectionMode(stateManager, renderer),
        timealign: new TimeAlignMode(stateManager, renderer)
    };

    let currentMode = null;

    // --- 3. GLOBAL ROOM SETTINGS ---
    const inputs = {
        L: document.getElementById('globalInputL'),
        W: document.getElementById('globalInputW'),
        H: document.getElementById('globalInputH')
    };

    const updateStateFromDOM = () => {
        const l = parseFloat(inputs.L.value);
        const w = parseFloat(inputs.W.value);
        const h = parseFloat(inputs.H.value);

        if (!isNaN(l) && !isNaN(w) && !isNaN(h)) {
            const current = stateManager.get();
            const clamp = (val, max) => Math.max(0.1, Math.min(val, max - 0.1));
            
            stateManager.update({
                room: { width: l, length: w, height: h },
                speakers: {
                    left: { ...current.speakers.left, x: clamp(current.speakers.left.x, l), y: clamp(current.speakers.left.y, w) },
                    right: { ...current.speakers.right, x: clamp(current.speakers.right.x, l), y: clamp(current.speakers.right.y, w) },
                    sub: { ...current.speakers.sub, x: clamp(current.speakers.sub.x, l), y: clamp(current.speakers.sub.y, w) }
                },
                listener: { ...current.listener, x: clamp(current.listener.x, l), y: clamp(current.listener.y, w) }
            });
        }
    };

    const syncDOMFromState = (s) => {
        const updateIfChanged = (el, newVal) => {
            if (document.activeElement === el) {
                if (Math.abs(parseFloat(el.value) - newVal) < 0.01) return;
            }
            el.value = newVal;
        };

        updateIfChanged(inputs.L, s.room.width);
        updateIfChanged(inputs.W, s.room.length);
        updateIfChanged(inputs.H, s.room.height);
    };

    if(inputs.L) inputs.L.addEventListener('input', updateStateFromDOM);
    if(inputs.W) inputs.W.addEventListener('input', updateStateFromDOM);
    if(inputs.H) inputs.H.addEventListener('input', updateStateFromDOM);

    window.addEventListener('app-state-updated', (e) => syncDOMFromState(e.detail));
    syncDOMFromState(stateManager.get());

    // --- 4. MODUS-BYTTE ---
    const setMode = (modeName) => {
        if (!modes[modeName]) return;
        if (currentMode && typeof currentMode.onExit === 'function') currentMode.onExit();
        
        currentMode = modes[modeName];
        renderer.activeMode = currentMode;

        const sidebarContainer = document.getElementById('labModeControls');
        const bottomContainer = document.getElementById('labBottomContent');
        
        if (sidebarContainer && typeof currentMode.getSidebarHTML === 'function') {
            sidebarContainer.innerHTML = currentMode.getSidebarHTML();
        }
        if (bottomContainer && typeof currentMode.getBottomPanelHTML === 'function') {
            bottomContainer.innerHTML = currentMode.getBottomPanelHTML();
        }

        if (typeof currentMode.onEnter === 'function') currentMode.onEnter();
        if (typeof currentMode.bindEvents === 'function') currentMode.bindEvents();

        document.querySelectorAll('.tab-btn').forEach(t => {
            if (t.dataset.mode === modeName) {
                t.classList.add('active', 'text-slate-300', 'border-blue-500');
                t.classList.remove('text-slate-400', 'border-transparent');
            } else {
                t.classList.remove('active', 'text-slate-300', 'border-blue-500');
                t.classList.add('text-slate-400', 'border-transparent');
            }
        });
        renderer.resize();
        
        // Auto-close menu on selection
        const sidebar = document.getElementById('labSidebar');
        const overlay = document.getElementById('mobileMenuOverlay');
        if (window.innerWidth < 768 && sidebar) {
            sidebar.classList.add('-translate-x-full');
            if(overlay) overlay.classList.add('hidden');
        }
    };

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('touchstart', (e) => {
            setMode(btn.dataset.mode);
        }, {passive: true});
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    setMode('room');

    // --- 5. PANEL TOGGLE ---
    const toggleBtn = document.getElementById('toggleBottomPanel');
    const bottomPanel = document.getElementById('labBottomPanel');
    const icon = document.getElementById('bottomPanelIcon');
    let panelOpen = true;

    if(toggleBtn && bottomPanel) {
        const togglePanel = (e) => {
            // Hindre at både touch og click fyrer samtidig (double firing)
            if (e.type === 'touchstart') e.preventDefault();
            
            panelOpen = !panelOpen;
            if(panelOpen) {
                bottomPanel.style.height = '16rem';
                if(icon) icon.style.transform = 'rotate(0deg)';
            } else {
                bottomPanel.style.height = '2rem';
                if(icon) icon.style.transform = 'rotate(180deg)';
            }
            setTimeout(() => { if(renderer) renderer.resize(); }, 350);
        };

        // Lytt på både klikk og touch
        toggleBtn.addEventListener('click', togglePanel);
        toggleBtn.addEventListener('touchstart', togglePanel, {passive: false});
    }
});