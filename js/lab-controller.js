/**
 * js/lab-controller.js
 * Hovedkontrolleren for Audio Physics Lab 2.0.
 * Initierer systemet, håndterer faner, og bytter mellom Modus-klasser.
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('Audio Lab 2.0: Booting up...');

    // 1. Initier komponenter
    const stateManager = window.appState;
    if (!stateManager) {
        console.error('State Manager not found! script order correct?');
        return;
    }

    let renderer = null;
    try {
        renderer = new LabRenderer('labCanvas', stateManager);
        console.log('Renderer started.');
    } catch (e) {
        console.error('Canvas init failed:', e);
        return;
    }

    // 2. Instansier Modus-logikken (Disse kommer fra lab-modes.js)
    // Sjekk at klassene finnes før vi bruker dem
    if (typeof RoomMode === 'undefined' || typeof SpeakerMode === 'undefined') {
        console.error('Mode classes missing. Is lab-modes.js loaded?');
        return;
    }

    const modes = {
        room: new RoomMode(stateManager, renderer),
        speaker: new SpeakerMode(stateManager, renderer),
        reflection: new ReflectionMode(stateManager, renderer),
        // Time Align kan være en forenklet versjon eller gjenbruk av eksisterende logikk
        timealign: { 
            onEnter: () => console.log('Time Align active'), 
            onExit: () => {}, 
            getSidebarHTML: () => '<div class="p-4 text-slate-400">Time Align tool coming soon to V2 interface.</div>',
            getBottomPanelHTML: () => ''
        }
    };

    let currentMode = null;

    // 3. Koble Global Room Settings (Sidebar topp)
    const inputs = {
        L: document.getElementById('globalInputL'),
        W: document.getElementById('globalInputW'),
        H: document.getElementById('globalInputH')
    };

    const updateStateFromDOM = () => {
        const l = parseFloat(inputs.L.value); // X (Width i state)
        const w = parseFloat(inputs.W.value); // Y (Length i state)
        const h = parseFloat(inputs.H.value);

        if (!isNaN(l) && !isNaN(w) && !isNaN(h)) {
            // Hent nåværende state
            const current = stateManager.get();
            
            // Clamp funksjon: Sørg for at objekter holder seg innenfor nye grenser
            const clamp = (val, max) => Math.max(0.1, Math.min(val, max - 0.1));
            
            stateManager.update({
                room: { width: l, length: w, height: h },
                // PUNKT 1: Sjekk bounds ved resize
                speakers: {
                    left: { ...current.speakers.left, x: clamp(current.speakers.left.x, l), y: clamp(current.speakers.left.y, w) },
                    right: { ...current.speakers.right, x: clamp(current.speakers.right.x, l), y: clamp(current.speakers.right.y, w) },
                    sub: { ...current.speakers.sub, x: clamp(current.speakers.sub.x, l), y: clamp(current.speakers.sub.y, w) }
                },
                listener: {
                    ...current.listener,
                    x: clamp(current.listener.x, l),
                    y: clamp(current.listener.y, w)
                }
            });
        }
    };

    const syncDOMFromState = (s) => {
        if (document.activeElement !== inputs.L) inputs.L.value = s.room.width; 
        if (document.activeElement !== inputs.W) inputs.W.value = s.room.length; 
        if (document.activeElement !== inputs.H) inputs.H.value = s.room.height;
    };

    if(inputs.L) inputs.L.addEventListener('input', updateStateFromDOM);
    if(inputs.W) inputs.W.addEventListener('input', updateStateFromDOM);
    if(inputs.H) inputs.H.addEventListener('input', updateStateFromDOM);

    // Lytt til state endringer (f.eks fra dragging)
    window.addEventListener('app-state-updated', (e) => {
        syncDOMFromState(e.detail);
    });
    // Initielle verdier
    syncDOMFromState(stateManager.get());


    // 4. Modus-bytte Logikk (Tabs)
    const setMode = (modeName) => {
        if (!modes[modeName]) return;
        
        console.log(`Switching mode to: ${modeName}`);

        // A. Rydd opp gammel modus
        if (currentMode) {
            if (typeof currentMode.onExit === 'function') currentMode.onExit();
        }

        // B. Aktiver ny modus
        currentMode = modes[modeName];
        
        // C. Fortell renderer hvem som er sjefen nå
        renderer.activeMode = currentMode;

        // D. Injiser UI (HTML)
        const sidebarContainer = document.getElementById('labModeControls');
        const bottomContainer = document.getElementById('labBottomContent');
        
        if (sidebarContainer && typeof currentMode.getSidebarHTML === 'function') {
            sidebarContainer.innerHTML = currentMode.getSidebarHTML();
        }
        if (bottomContainer && typeof currentMode.getBottomPanelHTML === 'function') {
            bottomContainer.innerHTML = currentMode.getBottomPanelHTML();
        }

        // E. Aktiver logikk og bind events til den nye HTML-en
        if (typeof currentMode.onEnter === 'function') currentMode.onEnter();
        if (typeof currentMode.bindEvents === 'function') currentMode.bindEvents();

        // F. Oppdater Faner visuelt
        document.querySelectorAll('.tab-btn').forEach(t => {
            if (t.dataset.mode === modeName) {
                t.classList.add('active', 'text-slate-300', 'border-blue-500');
                t.classList.remove('text-slate-400', 'border-transparent');
            } else {
                t.classList.remove('active', 'text-slate-300', 'border-blue-500');
                t.classList.add('text-slate-400', 'border-transparent');
            }
        });
        
        // Tving en redraw
        renderer.resize(); 
    };

    // Bind klikk på faner
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    // Start i Room Mode
    setMode('room');


    // 5. UI Helpers (Mobilmeny & Panel Toggle)
    
    // Mobil Meny
    const btnMobileMenu = document.getElementById('btnMobileMenu');
    const sidebar = document.getElementById('labSidebar');
    const overlay = document.getElementById('mobileMenuOverlay');

    const toggleMenu = () => {
        const isClosed = sidebar.classList.contains('-translate-x-full');
        if (isClosed) {
            sidebar.classList.remove('-translate-x-full');
            if(overlay) overlay.classList.remove('hidden');
        } else {
            sidebar.classList.add('-translate-x-full');
            if(overlay) overlay.classList.add('hidden');
        }
    };
    if(btnMobileMenu) btnMobileMenu.addEventListener('click', toggleMenu);
    if(overlay) overlay.addEventListener('click', toggleMenu);

    // Bunnpanel Toggle
    const toggleBtn = document.getElementById('toggleBottomPanel');
    const bottomPanel = document.getElementById('labBottomPanel');
    const icon = document.getElementById('bottomPanelIcon');
    let panelOpen = true;

    if(toggleBtn && bottomPanel) {
        toggleBtn.addEventListener('click', () => {
            panelOpen = !panelOpen;
            if(panelOpen) {
                bottomPanel.style.height = '16rem'; // h-64
                if(icon) icon.style.transform = 'rotate(0deg)';
            } else {
                bottomPanel.style.height = '2rem'; // Kollapset
                if(icon) icon.style.transform = 'rotate(180deg)';
            }
            // Vent litt på CSS transition før vi ber canvas oppdatere størrelsen
            setTimeout(() => { if(renderer) renderer.resize(); }, 350);
        });
    }
});