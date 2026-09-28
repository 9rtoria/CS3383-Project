"use strict";

import {ApiError} from "../api.js";
import {choosePlanAfterDelete, findSelectedPlanSummary} from "../state.js";

export function createPlansView(options) {
    const {
        state,
        planApi,
        onStateChange
    } = options;

    const elements = {
        planList: document.getElementById("plan-list"),
        plansStatus: document.getElementById("plans-status"),
        reloadButton: document.getElementById("reload-plans-button"),
        createForm: document.getElementById("create-plan-form"),
        createInput: document.getElementById("create-plan-name"),
        createError: document.getElementById("create-plan-error"),
        selectedPlanHeading: document.getElementById("selected-plan-heading"),
        selectedPlanMeta: document.getElementById("selected-plan-meta"),
        mainError: document.getElementById("main-error"),
        noPlanState: document.getElementById("no-plan-state"),
        planDetail: document.getElementById("plan-detail"),
        renameForm: document.getElementById("rename-plan-form"),
        renameInput: document.getElementById("rename-plan-name"),
        renameError: document.getElementById("rename-plan-error"),
        deleteButton: document.getElementById("delete-plan-button"),
        bucketList: document.getElementById("bucket-list"),
        taskPreviewList: document.getElementById("task-preview-list"),
        createSubmit: document.getElementById("create-plan-submit"),
        renameSubmit: document.getElementById("rename-plan-submit")
    };

    wireEvents();

    return {
        refreshPlans,
        render
    };

    function wireEvents() {
        elements.reloadButton.addEventListener("click", () => {
            refreshPlans();
        });

        elements.createForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFormErrors();

            const proposedName = elements.createInput.value;
            disableDuringMutation(true);
            try {
                const createdPlan = await planApi.createPlan(proposedName);
                await refreshPlans({
                    preferredPlanId: createdPlan.id,
                    successMessage: `Created plan: ${createdPlan.name}`
                });
                elements.createForm.reset();
            } catch (error) {
                handleFormError(error, elements.createError, "name");
            } finally {
                disableDuringMutation(false);
            }
        });

        elements.renameForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFormErrors();
            if (!state.selectedPlanId) {
                return;
            }

            disableDuringMutation(true);
            try {
                const updatedPlan = await planApi.renamePlan(state.selectedPlanId, elements.renameInput.value);
                await refreshPlans({
                    preferredPlanId: updatedPlan.id,
                    successMessage: `Saved plan name: ${updatedPlan.name}`,
                    skipDetailFetch: true,
                    detail: updatedPlan
                });
            } catch (error) {
                handleFormError(error, elements.renameError, "name");
            } finally {
                disableDuringMutation(false);
            }
        });

        elements.deleteButton.addEventListener("click", async () => {
            clearFormErrors();
            if (!state.selectedPlanId) {
                return;
            }

            const summary = findSelectedPlanSummary(state);
            const targetName = summary ? summary.name : "this plan";
            const deleteConfirmed = window.confirm(`Delete plan \"${targetName}\"? This cannot be undone.`);
            if (!deleteConfirmed) {
                return;
            }

            disableDuringMutation(true);
            try {
                const removedPlanId = state.selectedPlanId;
                await planApi.deletePlan(removedPlanId);
                await refreshPlans({
                    preferredPlanId: null,
                    deletedPlanId: removedPlanId,
                    successMessage: `Deleted plan: ${targetName}`
                });
            } catch (error) {
                handleMainError(error);
            } finally {
                disableDuringMutation(false);
            }
        });
    }

    async function refreshPlans(options) {
        const config = options || {};
        state.isLoadingPlans = true;
        if (!config.successMessage) {
            state.plansStatus = "Loading plans...";
        }
        state.mainError = "";
        render();

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

            state.plansStatus = config.successMessage || `Loaded ${plans.length} plan${plans.length === 1 ? "" : "s"}.`;
        } catch (error) {
            state.mainError = toMessage(error);
            state.plansStatus = "Unable to load plans.";
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
        state.plansStatus = "Loading selected plan...";
        render();

        await loadSelectedPlanDetail();
        state.plansStatus = "";
        render();
        onStateChange(state);
    }

    async function loadSelectedPlanDetail() {
        if (!state.selectedPlanId) {
            state.selectedPlanDetail = null;
            return;
        }

        state.isLoadingDetail = true;
        render();

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
        renderPlanList();
        renderMainArea();
        elements.plansStatus.textContent = state.plansStatus;
        elements.mainError.textContent = state.mainError;
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
            elements.renameInput.value = "";
            return;
        }

        elements.selectedPlanHeading.textContent = summary.name;

        if (state.isLoadingDetail) {
            elements.selectedPlanMeta.textContent = "Loading selected plan...";
        } else if (detail) {
            const bucketCount = detail.buckets.length;
            const taskCount = detail.tasks.length;
            elements.selectedPlanMeta.textContent = `${bucketCount} bucket${bucketCount === 1 ? "" : "s"} | ${taskCount} task${taskCount === 1 ? "" : "s"}`;
        } else {
            elements.selectedPlanMeta.textContent = "Plan data unavailable.";
        }

        elements.noPlanState.hidden = true;
        elements.planDetail.hidden = false;
        elements.renameInput.value = summary.name;

        renderBuckets(detail);
        renderTasks(detail);
    }

    function renderBuckets(detail) {
        elements.bucketList.innerHTML = "";
        if (!detail || detail.buckets.length === 0) {
            elements.bucketList.appendChild(simpleItem("No buckets in this plan."));
            return;
        }

        detail.buckets.forEach((bucket) => {
            elements.bucketList.appendChild(simpleItem(bucket.name));
        });
    }

    function renderTasks(detail) {
        elements.taskPreviewList.innerHTML = "";
        if (!detail || detail.tasks.length === 0) {
            elements.taskPreviewList.appendChild(simpleItem("No tasks in this plan."));
            return;
        }

        const maxPreview = 6;
        detail.tasks.slice(0, maxPreview).forEach((task) => {
            elements.taskPreviewList.appendChild(simpleItem(task.title));
        });

        if (detail.tasks.length > maxPreview) {
            elements.taskPreviewList.appendChild(simpleItem(`+ ${detail.tasks.length - maxPreview} more tasks`));
        }
    }

    function simpleItem(text) {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
    }

    function clearFormErrors() {
        elements.createError.textContent = "";
        elements.renameError.textContent = "";
        state.mainError = "";
        elements.mainError.textContent = "";
    }

    function disableDuringMutation(isDisabled) {
        elements.reloadButton.disabled = isDisabled;
        elements.createSubmit.disabled = isDisabled;
        elements.renameSubmit.disabled = isDisabled;
        elements.deleteButton.disabled = isDisabled;
    }

    function handleFormError(error, targetElement, fieldName) {
        const message = error instanceof ApiError
                ? (error.reasonForField(fieldName) || error.message)
                : toMessage(error);
        targetElement.textContent = message;
    }

    function handleMainError(error) {
        state.mainError = toMessage(error);
        elements.mainError.textContent = state.mainError;
    }

    function toMessage(error) {
        if (error instanceof ApiError) {
            return error.message;
        }
        return "Unexpected error. Please retry.";
    }
}
