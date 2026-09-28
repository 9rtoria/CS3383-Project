"use strict";

export function createChartsView() {
    const section = document.getElementById("charts-section");

    return {
        render
    };

    function render(isActive) {
        if (!section) {
            return;
        }
        section.hidden = !isActive;
    }
}
