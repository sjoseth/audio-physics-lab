window.app = {
    navigate: function(viewId) {
        // Hide all views
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        
        // Show target view
        document.getElementById('view-' + viewId).classList.add('active');
        
        // Trigger events to ensure canvas/charts redraw correctly when becoming visible
        if (viewId === 'simulator') {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        } else if (viewId === 'speaker-placement') {
            setTimeout(() => window.dispatchEvent(new Event('resize-sp')), 50);
        } else if (viewId === 'reflection-sim') {
            setTimeout(() => window.dispatchEvent(new Event('resize-rf')), 50);
        }
    }
};