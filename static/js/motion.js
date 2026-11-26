// Restrained, interruptible interaction feedback shared by every page.
(function () {
    'use strict';

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pressSelector = [
        'button',
        '[role="button"]',
        'summary',
        '.nav-item',
        '.fab-item',
        '.quick-btn',
        '.theme-toggle'
    ].join(',');
    let pressedElement = null;
    let pressedPointer = null;

    function clearPressed() {
        if (pressedElement) pressedElement.classList.remove('is-pressing');
        pressedElement = null;
        pressedPointer = null;
    }

    function setPressed(event) {
        if (reducedMotion.matches || event.button > 0) return;
        const element = event.target.closest(pressSelector);
        if (!element || element.matches(':disabled, [aria-disabled="true"]')) return;
        clearPressed();
        pressedElement = element;
        pressedPointer = event.pointerId;
        element.classList.add('is-pressing');
    }

    function releasePressed(event) {
        if (pressedPointer !== null && event.pointerId !== pressedPointer) return;
        clearPressed();
    }

    function animate(element, keyframes, options) {
        if (!element || typeof element.animate !== 'function') return null;
        return element.animate(keyframes, options);
    }

    function settle(animation) {
        if (!animation) return Promise.resolve();
        return animation.finished.catch(() => {});
    }

    function pageEnter(element, direction) {
        if (!element) return Promise.resolve();
        if (reducedMotion.matches) {
            return Promise.resolve();
        }
        const enterX = direction === 'backward' ? -6 : 6;
        return settle(animate(element, [
            { opacity: 0.82, transform: `translate3d(${enterX}px, 0, 0)` },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' }
        ], {
            duration: 190,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }));
    }

    function pageLeave(element, direction) {
        if (!element) return Promise.resolve();
        if (reducedMotion.matches) {
            return Promise.resolve();
        }
        const exitX = direction === 'backward' ? 4 : -4;
        return settle(animate(element, [
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            { opacity: 0.86, transform: `translate3d(${exitX}px, 0, 0)` }
        ], {
            duration: 90,
            easing: 'cubic-bezier(0.4, 0, 1, 1)'
        }));
    }

    function animateDetails(event) {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement) || !details.matches('.admin-details') || !details.open) return;
        const panel = details.querySelector('.admin-details-panel-inner');
        if (!panel) return;
        if (reducedMotion.matches) {
            animate(panel, [
                { opacity: 0 },
                { opacity: 1 }
            ], {
                duration: 120,
                easing: 'ease-out'
            });
            return;
        }
        animate(panel, [
            { opacity: 0.35, transform: 'translate3d(0, -5px, 0)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' }
        ], {
            duration: 260,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        });
    }

    document.addEventListener('pointerdown', setPressed, { passive: true });
    document.addEventListener('pointerup', releasePressed, { passive: true });
    document.addEventListener('pointercancel', releasePressed, { passive: true });
    window.addEventListener('blur', clearPressed);
    document.addEventListener('toggle', animateDetails, true);
    document.documentElement.classList.add('motion-ready');

    window.MotionFX = {
        pageEnter,
        pageLeave,
        reducedMotion
    };
})();
