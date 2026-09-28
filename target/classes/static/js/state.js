"use strict";

export function createAppState() {
    return {
        plans: [],
        selectedPlanId: null,
        selectedPlanDetail: null,
        isLoadingPlans: false,
        isLoadingDetail: false,
        plansStatus: "",
        mainError: "",
        boardGrouping: "bucket",
        boardStatus: "",
        boardError: "",
        isPatchingTask: false
    };
}

export function findSelectedPlanSummary(state) {
    if (!state.selectedPlanId) {
        return null;
    }

    return state.plans.find((plan) => plan.id === state.selectedPlanId) || null;
}

export function choosePlanAfterDelete(remainingPlans, deletedPlanId) {
    if (!Array.isArray(remainingPlans) || remainingPlans.length === 0) {
        return null;
    }

    const deletedIndex = remainingPlans.findIndex((plan) => plan.id === deletedPlanId);
    if (deletedIndex < 0) {
        return remainingPlans[0].id;
    }

    const fallbackIndex = deletedIndex >= remainingPlans.length ? remainingPlans.length - 1 : deletedIndex;
    return remainingPlans[fallbackIndex].id;
}
