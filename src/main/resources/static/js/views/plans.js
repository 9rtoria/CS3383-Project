"use strict";

import {ApiError} from "../api.js";
import {choosePlanAfterDelete, findSelectedPlanSummary} from "../state.js";

export function createPlansView(options) {
    const {
        state,
        planApi,
        onStateChange,
        onNotice = () => {
        }
    } = options;

    const elements = {
        appShell: document.getElementById("app-shell"),
        sidebarToggle: document.getElementById("sidebar-toggle-button"),
        planList: document.getElementById("plan-list"),
        plansStatus: document.getElementById("plans-status"),
        showCreatePlanButton: document.getElementById("show-create-plan-button"),
        cancelCreatePlanButton: document.getElementById("cancel-create-plan-button"),
        createForm: document.getElementById("create-plan-form"),
        createInput: document.getElementById("create-plan-name"),
        createError: document.getElementById("create-plan-error"),
        selectedPlanHeading: document.getElementById("selected-plan-heading"),
        selectedPlanHeadingInput: document.getElementById("selected-plan-heading-input"),
        selectedPlanMeta: document.getElementById("selected-plan-meta"),
        planMenuWrap: document.getElementById("plan-menu-wrap"),
        planMenuButton: document.getElementById("plan-menu-button"),
        planMenu: document.getElementById("plan-menu"),
        deletePlanButton: document.getElementById("delete-plan-button"),
        mainError: document.getElementById("main-error"),
        noPlanState: document.getElementById("no-plan-state"),
        planDetail: document.getElementById("plan-detail")
    };

    wireEvents();

    return {
        refreshPlans,
        render
    };

    function wireEvents() {
        elements.sidebarToggle.addEventListener("click", () => {
            state.isSidebarCollapsed = !state.isSidebarCollapsed;
            renderSidebarState();
        });

        elements.showCreatePlanButton.addEventListener("click", () => {
            state.isCreatePlanFormVisible = true;
            renderCreatePlanForm();
            elements.createInput.focus();
        });

        elements.cancelCreatePlanButton.addEventListener("click", () => {
            state.isCreatePlanFormVisible = false;
            elements.createForm.reset();
            elements.createError.textContent = "";
            renderCreatePlanForm();
        });

        elements.createForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            elements.createError.textContent = "";
            const proposedName = elements.createInput.value;
            disableMutations(true);
            try {
                const createdPlan = await planApi.createPlan(proposedName);
                state.isCreatePlanFormVisible = false;
                elements.createForm.reset();
                await refreshPlans({
                    preferredPlanId: createdPlan.id,
                    successMessage: "Saved"
                });
                onNotice("Saved");
            } catch (error) {
                const message = error instanceof ApiError
                        ? (error.reasonForField("name") || error.message)
                        : "Unexpected error. Please retry.";
                elements.createError.textContent = message;
            } finally {
                disableMutations(false);
                renderCreatePlanForm();
            }
        });

        elements.selectedPlanHeading.addEventListener("click", () => {
            if (!state.selectedPlanId) {
                return;
            }
            state.isPlanTitleEditing = true;
            renderPlanTitle();
            elements.selectedPlanHeadingInput.focus();
            elements.selectedPlanHeadingInput.select();
        });

        elements.selectedPlanHeading.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            event.preventDefault();
            if (!state.selectedPlanId) {
                return;
            }
            state.isPlanTitleEditing = true;
            renderPlanTitle();
            elements.selectedPlanHeadingInput.focus();
            elements.selectedPlanHeadingInput.select();
        });

        elements.selectedPlanHeadingInput.addEventListener("keydown", async (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                await savePlanTitle();
            } else if (event.key === "Escape") {
                event.preventDefault();
                state.isPlanTitleEditing = false;
                elements.selectedPlanHeadingInput.value = findSelectedPlanSummary(state)?.name || "";
                renderPlanTitle();
            }
        });

        elements.selectedPlanHeadingInput.addEventListener("blur", async () => {
            if (state.isPlanTitleEditing) {
                await savePlanTitle();
            }
        });

        elements.planMenuButton.addEventListener("click", () => {
            const shouldOpen = elements.planMenu.hidden;
            elements.planMenu.hidden = !shouldOpen;
        });

        document.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            if (!elements.planMenuWrap.contains(target)) {
                elements.planMenu.hidden = true;
            }
        });

        elements.deletePlanButton.addEventListener("click", async () => {
            elements.planMenu.hidden = true;
            if (!state.selectedPlanId) {
                return;
            }

            const summary = findSelectedPlanSummary(state);
            const targetName = summary ? summary.name : "this plan";
            const confirmed = window.confirm(`Delete plan \"${targetName}\"? This cannot be undone.`);
            if (!confirmed) {
                return;
            }

            disableMutations(true);
            try {
                const removedPlanId = state.selectedPlanId;
                await planApi.deletePlan(removedPlanId);
                await refreshPlans({
                    preferredPlanId: null,
                    deletedPlanId: removedPlanId,
                    successMessage: "Saved"
                });
                onNotice("Saved");
            } catch (error) {
                state.mainError = toMessage(error);
                renderMessages();
            } finally {
                disableMutations(false);
            }
        });
    }

    async function savePlanTitle() {
        if (!state.selectedPlanId) {
            return;
        }

        const newName = elements.selectedPlanHeadingInput.value;
        disableMutations(true);
        try {
            const updatedPlan = await planApi.renamePlan(state.selectedPlanId, newName);
            state.isPlanTitleEditing = false;
            await refreshPlans({
                preferredPlanId: updatedPlan.id,
                skipDetailFetch: true,
                detail: updatedPlan,
                successMessage: "Saved"
            });
            onNotice("Saved");
        } catch (error) {
            state.isPlanTitleEditing = false;
            state.mainError = toMessage(error);
            renderMessages();
            renderPlanTitle();
        } finally {
            disableMutations(false);
        }
    }

    async function refreshPlans(options) {
        const config = options || {};
        state.isLoadingPlans = true;
        state.mainError = "";
        renderMessages();

        try {
            const plans = await planApi.listPlans();
            state.plans = plans;
            if (plans.length === 0) {
                state.selectedPlanId = null;
                state.selectedPlanDetail = null;
            } else if (config.preferredPlanId) {
                state.selectedPlanId = config.preferredPlanId;
            } else if (config.deletedPlanId) {
                state.selectedPlanId = choosePlanAfterDelete(plans, config.deletedPlanId);
            } else if (!state.selectedPlanId || !plans.some((plan) => plan.id === state.selectedPlanId)) {
                state.selectedPlanId = plans[0].id;
            }

            if (config.detail && config.preferredPlanId === state.selectedPlanId) {
                state.selectedPlanDetail = config.detail;
            } else if (!config.skipDetailFetch) {
                await loadSelectedPlanDetail();
            }

            if (config.successMessage) {
                state.plansStatus = config.successMessage;
            } else {
                state.plansStatus = "";
            }
        } catch (error) {
            state.mainError = toMessage(error);
            state.plansStatus = "";
        } finally {
            state.isLoadingPlans = false;
            render();
            onStateChange(state);
        }
    }

    async function selectPlan(planId) {
        if (planId === state.selectedPlanId) {
            return;
        }

        state.selectedPlanId = planId;
        state.mainError = "";
        renderMessages();
        await loadSelectedPlanDetail();
        render();
        onStateChange(state);
    }

    async function loadSelectedPlanDetail() {
        if (!state.selectedPlanId) {
            state.selectedPlanDetail = null;
            return;
        }

        state.isLoadingDetail = true;
        try {
            state.selectedPlanDetail = await planApi.getPlan(state.selectedPlanId);
        } catch (error) {
            state.selectedPlanDetail = null;
            state.mainError = toMessage(error);
        } finally {
            state.isLoadingDetail = false;
        }
    }

    function render() {
        renderSidebarState();
        renderCreatePlanForm();
        renderPlanList();
        renderMainArea();
        renderMessages();
    }

    function renderSidebarState() {
        elements.appShell.classList.toggle("sidebar-collapsed", state.isSidebarCollapsed);
        elements.appShell.classList.toggle("sidebar-expanded", !state.isSidebarCollapsed);
        elements.sidebarToggle.setAttribute("aria-expanded", String(!state.isSidebarCollapsed));
        elements.sidebarToggle.setAttribute("aria-label", state.isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
        elements.sidebarToggle.setAttribute("title", state.isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
    }

    function renderCreatePlanForm() {
        elements.createForm.hidden = !state.isCreatePlanFormVisible;
        elements.showCreatePlanButton.hidden = state.isCreatePlanFormVisible;
    }

    function renderPlanList() {
        elements.planList.innerHTML = "";
        if (state.plans.length === 0) {
            const emptyItem = document.createElement("li");
            emptyItem.textContent = "No plans yet.";
            elements.planList.appendChild(emptyItem);
            return;
        }

        state.plans.forEach((plan) => {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "plan-button";
            button.textContent = plan.name;
            button.dataset.planId = plan.id;
            if (plan.id === state.selectedPlanId) {
                button.classList.add("selected");
            }

            button.addEventListener("click", () => {
                selectPlan(plan.id);
            });

            item.appendChild(button);
            elements.planList.appendChild(item);
        });
    }

    function renderMainArea() {
        const detail = state.selectedPlanDetail;
        const summary = findSelectedPlanSummary(state);

        if (!state.selectedPlanId || !summary) {
            elements.selectedPlanHeading.textContent = "No plan selected";
            elements.selectedPlanMeta.textContent = "Create a plan in the sidebar to begin.";
            elements.noPlanState.hidden = false;
            elements.planDetail.hidden = true;
            elements.planMenuWrap.hidden = true;
            state.isPlanTitleEditing = false;
            renderPlanTitle();
            return;
        }

        if (detail) {
            const bucketCount = detail.buckets.length;
            const taskCount = detail.tasks.length;
            elements.selectedPlanMeta.textContent = `${bucketCount} bucket${bucketCount === 1 ? "" : "s"} | ${taskCount} task${taskCount === 1 ? "" : "s"}`;
        } else if (state.isLoadingDetail) {
            elements.selectedPlanMeta.textContent = "";
        } else {
            elements.selectedPlanMeta.textContent = "";
        }

        elements.noPlanState.hidden = true;
        elements.planDetail.hidden = false;
        elements.planMenuWrap.hidden = false;
        if (!state.isPlanTitleEditing) {
            elements.selectedPlanHeading.textContent = summary.name;
            elements.selectedPlanHeadingInput.value = summary.name;
        }
        renderPlanTitle();
    }

    function renderPlanTitle() {
        elements.selectedPlanHeading.hidden = state.isPlanTitleEditing;
        elements.selectedPlanHeadingInput.hidden = !state.isPlanTitleEditing;
    }

    function disableMutations(isDisabled) {
        elements.sidebarToggle.disabled = isDisabled;
        elements.showCreatePlanButton.disabled = isDisabled;
        elements.cancelCreatePlanButton.disabled = isDisabled;
        elements.createInput.disabled = isDisabled;
        elements.selectedPlanHeadingInput.disabled = isDisabled;
        elements.planMenuButton.disabled = isDisabled;
        elements.deletePlanButton.disabled = isDisabled;
    }

    function renderMessages() {
        elements.plansStatus.textContent = state.plansStatus;
        elements.mainError.textContent = state.mainError;
    }

    function toMessage(error) {
        if (error instanceof ApiError) {
            return error.message;
        }
        return "Unexpected error. Please retry.";
    }
}
