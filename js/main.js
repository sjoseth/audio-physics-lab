window.app = {
    navigate: function(viewId) {
        // Hide all views
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        
        // Show target view
        document.getElementById('view-' + viewId).classList.add('active');
        
        // Trigger events to ensure canvas/charts redraw correctly when becoming visible
        if (viewId === 'simulator') {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
        } else if (viewId === 'speaker-placement') {
            setTimeout(() => window.dispatchEvent(new Event('resize-sp')), 150);
        } else if (viewId === 'reflection-sim') {
            setTimeout(() => window.dispatchEvent(new Event('resize-rf')), 150);
        }
    }
}

// js/main.js - Add this at the bottom

document.addEventListener('DOMContentLoaded', () => {

    // --- HJELPEFUNKSJON: Den "gamle" metoden (Fallback) ---
    const fallbackCopyTextToClipboard = (text, btn) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        
        // Sørg for at elementet ikke synes, men er en del av DOM-en
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showSuccessFeedback(btn);
            } else {
                throw new Error('Fallback copy failed');
            }
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
            alert('Could not copy link automatically (Security restriction).\nURL:\n' + text);
        }

        document.body.removeChild(textArea);
    };

    // --- VISUELL FEEDBACK ---
    const showSuccessFeedback = (btn) => {
        const originalContent = btn.innerHTML;
        const isMobile = btn.id === 'btnShareMobile';
        
        if (isMobile) {
            btn.classList.add('text-green-400');
        } else {
            btn.innerHTML = `
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                Copied!
            `;
            btn.classList.add('text-green-400');
        }

        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.classList.remove('text-green-400');
        }, 2000);
    };

    // --- HOVEDFUNKSJON ---
    const handleShare = (btn) => {
        const url = window.appState.getShareableUrl();
        
        // Prøv den moderne metoden først (Krever HTTPS)
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                showSuccessFeedback(btn);
            }).catch(err => {
                console.warn('Clipboard API failed (likely HTTP connection), trying fallback...', err);
                fallbackCopyTextToClipboard(url, btn);
            });
        } else {
            // Hvis nettleseren ikke støtter API-et i det hele tatt
            fallbackCopyTextToClipboard(url, btn);
        }
    };

    const bindShareButton = (id) => {
        const btn = document.getElementById(id);
        if (btn) {
            const trigger = (e) => {
                if (e.type === 'touchstart') e.preventDefault();
                handleShare(btn);
            };
            btn.addEventListener('click', trigger);
            btn.addEventListener('touchstart', trigger, {passive: false});
        }
    };

    bindShareButton('btnShareDesktop');
    bindShareButton('btnShareMobile');
});