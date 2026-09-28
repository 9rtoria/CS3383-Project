"use strict";

import {planApi} from "./api.js";
import {createAppState} from "./state.js";
import {createPlansView} from "./views/plans.js";
import {createBoardView} from "./views/board.js";
import {createGridView} from "./views/grid.js";
import {createChartsView} from "./views/charts.js";
import {createTaskDetailsView} from "./views/details-panel.js";

document.addEventListener("DOMContentLoaded", () => {
    const state = createAppState();

    let plansView;
    let boardView;
    let gridView;
    let chartsView;
    let taskDetailsView;

    const elements = {
        tabBoard: document.getElementById("tab-board"),
        tabGrid: document.getElementById("tab-grid"),
        tabCharts: document.getElementById("tab-charts"),
        openCreateTaskButton: document.getElementById("open-create-task-button"),
        noticeHost: document.getElementById("notice-host")
    };

    function showNotice(message) {
        if (!elements.noticeHost || !message) {
            return;
        }
        elements.noticeHost.textContent = message;
        elements.noticeHost.classList.add("visible");
        window.setTimeout(() => {
            elements.noticeHost.classList.remove("visible");
            elements.noticeHost.textContent = "";
        }, 1800);
    }

    function renderTabs() {
        const tabs = [
            {element: elements.tabBoard, view: "board"},
            {element: elements.tabGrid, view: "grid"},
            {element: elements.tabCharts, view: "charts"}
        ];

        tabs.forEach((tab) => {
            const active = state.activeView === tab.view;
            tab.element.classList.toggle("active", active);
            tab.element.setAttribute("aria-selected", String(active));
        });
    }

    function renderEverything() {
        renderTabs();
        plansView.render();
        boardView.render();
        gridView.render();
        chartsView.render(state.activeView === "charts");
        taskDetailsView.render();
    }

    function wireTabs() {
        const mapping = [
            [elements.tabBoard, "board"],
            [elements.tabGrid, "grid"],
            [elements.tabCharts, "charts"]
        ];

        mapping.forEach(([element, view]) => {
            element.addEventListener("click", () => {
                state.activeView = view;
                renderEverything();
            });
        });
    }

    plansView = createPlansView({
        state,
        planApi,
        onNotice: showNotice,
        onStateChange: () => {
            state.selectedTaskId = null;
            state.taskDetailsMode = "view";
            state.taskDetailsStatus = "";
            state.taskDetailsError = "";
            state.taskDrawerOpen = false;
            boardView.clearMessages();
            gridView.clearMessages();
            taskDetailsView.clearMessages();
            renderEverything();
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
        onTaskSelect: (taskId) => {
            taskDetailsView.openTask(taskId);
            renderEverything();
        },
        onCreateTaskFromBoard: (prefill) => {
            taskDetailsView.openCreate(prefill);
            renderEverything();
        },
        onPatchStart: () => {
            plansView.render();
        },
        onPatchEnd: () => {
            plansView.render();
        },
        onNotice: showNotice
    });

    gridView = createGridView({
        state,
        getPlanDetail: () => state.selectedPlanDetail,
        onTaskSelect: (taskId) => {
            taskDetailsView.openTask(taskId);
            renderEverything();
        }
    });

    chartsView = createChartsView();

    taskDetailsView = createTaskDetailsView({
        state,
        planApi,
        getPlanDetail: () => state.selectedPlanDetail,
        updatePlanDetail: (detail) => {
            state.selectedPlanDetail = detail;
            renderEverything();
        },
        onMutationStart: () => {
            plansView.render();
        },
        onMutationEnd: () => {
            plansView.render();
        },
        onTaskChange: () => {
            renderEverything();
        },
        onNotice: showNotice
    });

    elements.openCreateTaskButton.addEventListener("click", () => {
        taskDetailsView.openCreate();
        renderEverything();
    });

    wireTabs();

    renderEverything();
    plansView.refreshPlans();
});
