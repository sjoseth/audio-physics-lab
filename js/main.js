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
    const btnShare = document.getElementById('btnShareConfig');
    const txtShare = document.getElementById('shareBtnText');
    
    if (btnShare) {
        btnShare.addEventListener('click', () => {
            const url = window.appState.getShareableUrl();
            
            navigator.clipboard.writeText(url).then(() => {
                // Feedback animation
                const originalText = txtShare.innerText;
                txtShare.innerText = "Link Copied!";
                btnShare.classList.add('border-green-500', 'text-green-400');
                
                setTimeout(() => {
                    txtShare.innerText = originalText;
                    btnShare.classList.remove('border-green-500', 'text-green-400');
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                alert('Could not copy link automatically. Check console for URL.');
                console.log(url);
            });
        });
    }
});;