"use strict";

import {planApi} from "./api.js";
import {createAppState} from "./state.js";
import {createPlansView} from "./views/plans.js";
import {createBoardView} from "./views/board.js";

document.addEventListener("DOMContentLoaded", () => {
    const state = createAppState();

    let plansView;
    let boardView;

    function renderEverything() {
        plansView.render();
        boardView.render();
    }

    plansView = createPlansView({
        state,
        planApi,
        onStateChange: () => {
            boardView.clearMessages();
            boardView.render();
        }
    });

    boardView = createBoardView({
        state,
        planApi,
        getPlanDetail: () => state.selectedPlanDetail,
        updatePlanDetail: (detail) => {
            state.selectedPlanDetail = detail;
            renderEverything();
        },
        onPatchStart: () => {
            plansView.render();
        },
        onPatchEnd: () => {
            plansView.render();
        }
    });

    renderEverything();
    plansView.refreshPlans();
});
