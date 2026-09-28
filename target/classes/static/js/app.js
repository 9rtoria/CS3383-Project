"use strict";

import {planApi} from "./api.js";
import {createAppState} from "./state.js";
import {createPlansView} from "./views/plans.js";
import {createBoardView} from "./views/board.js";
import {createGridView} from "./views/grid.js";

document.addEventListener("DOMContentLoaded", () => {
    const state = createAppState();

    let plansView;
    let boardView;
    let gridView;

    function renderEverything() {
        plansView.render();
        boardView.render();
        gridView.render();
    }

    plansView = createPlansView({
        state,
        planApi,
        onStateChange: () => {
            boardView.clearMessages();
            gridView.clearMessages();
            boardView.render();
            gridView.render();
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

    gridView = createGridView({
        state,
        getPlanDetail: () => state.selectedPlanDetail
    });

    renderEverything();
    plansView.refreshPlans();
});
