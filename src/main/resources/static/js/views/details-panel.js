"use strict";

import {ApiError} from "../api.js";

const DEFAULT_PROGRESS = "Not started";
const DEFAULT_PRIORITY = "Medium";

export function createTaskDetailsView(options) {
    const {
        state,
        planApi,
        getPlanDetail,
        updatePlanDetail,
        onMutationStart = () => {
        },
        onMutationEnd = () => {
        },
        onTaskChange = () => {
        },
        onNotice = () => {
        }
    } = options;

    const elements = {
        drawer: document.getElementById("task-drawer"),
        drawerBackdrop: document.getElementById("task-drawer-backdrop"),
        drawerCloseButton: document.getElementById("task-drawer-close-button"),
        status: document.getElementById("task-details-status"),
        error: document.getElementById("task-details-error"),
        empty: document.getElementById("task-details-empty"),
        form: document.getElementById("task-details-form"),
        formError: document.getElementById("task-form-error"),
        saveButton: document.getElementById("task-save-button"),
        cancelButton: document.getElementById("task-cancel-button"),
        deleteButton: document.getElementById("task-delete-button"),
        addChecklistItemButton: document.getElementById("task-add-checklist-item-button"),
        checklistItems: document.getElementById("task-checklist-items"),
        title: document.getElementById("task-title-input"),
        bucketId: document.getElementById("task-bucket-select"),
        progress: document.getElementById("task-progress-select"),
        priority: document.getElementById("task-priority-select"),
        startDate: document.getElementById("task-start-date-input"),
        dueDate: document.getElementById("task-due-date-input"),
        notes: document.getElementById("task-notes-input")
    };

    let draft = null;
    let draftFromTaskId = null;

    wireEvents();

    return {
        render,
        openTask,
        openCreate,
        closeDrawer,
        clearMessages
    };

    function wireEvents() {
        elements.drawerCloseButton.addEventListener("click", () => {
            closeDrawer();
        });

        elements.drawerBackdrop.addEventListener("click", () => {
            closeDrawer();
        });

        elements.form.addEventListener("submit", async (event) => {
            event.preventDefault();
            await saveTask();
        });

        elements.cancelButton.addEventListener("click", () => {
            closeDrawer();
        });

        elements.deleteButton.addEventListener("click", async () => {
            await deleteTask();
        });

        elements.addChecklistItemButton.addEventListener("click", () => {
            if (!draft || state.isSavingTask) {
                return;
            }
            draft.checklist.push({id: null, text: "", completed: false});
            render();
        });

        elements.title.addEventListener("input", () => {
            if (draft) {
                draft.title = elements.title.value;
            }
        });
        elements.bucketId.addEventListener("change", () => {
            if (draft) {
                draft.bucketId = elements.bucketId.value;
            }
        });
        elements.progress.addEventListener("change", () => {
            if (draft) {
                draft.progress = elements.progress.value;
            }
        });
        elements.priority.addEventListener("change", () => {
            if (draft) {
                draft.priority = elements.priority.value;
            }
        });
        elements.startDate.addEventListener("change", () => {
            if (draft) {
                draft.startDate = elements.startDate.value;
            }
        });
        elements.dueDate.addEventListener("change", () => {
            if (draft) {
                draft.dueDate = elements.dueDate.value;
            }
        });
        elements.notes.addEventListener("input", () => {
            if (draft) {
                draft.notes = elements.notes.value;
            }
        });

        elements.checklistItems.addEventListener("input", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }

            const index = Number.parseInt(target.dataset.index || "", 10);
            if (!Number.isInteger(index) || !draft || !draft.checklist[index]) {
                return;
            }

            if (target.dataset.role === "checklist-text") {
                draft.checklist[index].text = target.value;
            }
        });

        elements.checklistItems.addEventListener("change", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }

            const index = Number.parseInt(target.dataset.index || "", 10);
            if (!Number.isInteger(index) || !draft || !draft.checklist[index]) {
                return;
            }

            if (target.dataset.role === "checklist-completed") {
                draft.checklist[index].completed = target.checked;
                elements.status.textContent = "";
            }
        });

        elements.checklistItems.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const button = target.closest("button[data-role='remove-checklist-item']");
            if (!(button instanceof HTMLButtonElement)) {
                return;
            }

            if (!draft || state.isSavingTask) {
                return;
            }

            const index = Number.parseInt(button.dataset.index || "", 10);
            if (!Number.isInteger(index) || !draft.checklist[index]) {
                return;
            }

            const item = draft.checklist[index];
            const label = item.text && item.text.trim().length > 0 ? item.text.trim() : "this item";
            const confirmed = window.confirm(`Delete checklist item \"${label}\"?`);
            if (!confirmed) {
                return;
            }

            draft.checklist.splice(index, 1);
            render();
        });
    }

    function render() {
        if (!elements.drawer) {
            return;
        }

        const planDetail = getPlanDetail();
        const isOpen = state.taskDrawerOpen && Boolean(planDetail);
        elements.drawer.hidden = !isOpen;
        if (!isOpen) {
            return;
        }

        if (state.taskDetailsMode === "edit" && state.selectedTaskId) {
            const selected = findTask(planDetail, state.selectedTaskId);
            if (!selected) {
                state.selectedTaskId = null;
                state.taskDrawerOpen = false;
                draft = null;
                draftFromTaskId = null;
                elements.drawer.hidden = true;
                return;
            }
            if (!draft || draftFromTaskId !== state.selectedTaskId) {
                draft = toDraft(selected);
                draftFromTaskId = state.selectedTaskId;
            }
        }

        if (!draft) {
            draft = createBlankDraft(planDetail);
            draftFromTaskId = null;
        }

        elements.empty.hidden = true;
        elements.form.hidden = false;

        syncBucketOptions(planDetail.buckets || []);
        syncFormFieldsFromDraft();
        renderChecklistItems();

        const isCreateMode = state.taskDetailsMode === "create";
        elements.deleteButton.hidden = isCreateMode;
        elements.deleteButton.disabled = isCreateMode || state.isSavingTask;
        elements.saveButton.disabled = state.isSavingTask;
        elements.cancelButton.disabled = state.isSavingTask;
        elements.addChecklistItemButton.disabled = state.isSavingTask;

        elements.status.textContent = state.taskDetailsStatus;
        elements.error.textContent = state.taskDetailsError;
    }

    function openTask(taskId) {
        const planDetail = getPlanDetail();
        if (!planDetail) {
            return;
        }

        const task = findTask(planDetail, taskId);
        if (!task) {
            state.taskDetailsError = "Task no longer exists.";
            state.taskDetailsStatus = "";
            render();
            return;
        }

        state.selectedTaskId = task.id;
        state.taskDetailsMode = "edit";
        state.taskDetailsStatus = "";
        state.taskDetailsError = "";
        elements.formError.textContent = "";
        draft = toDraft(task);
        draftFromTaskId = task.id;
        state.taskDrawerOpen = true;
        render();
    }

    function openCreate(prefill) {
        const planDetail = getPlanDetail();
        if (!planDetail) {
            return;
        }

        const config = prefill || {};
        const blank = createBlankDraft(planDetail);
        if (config.bucketId) {
            blank.bucketId = config.bucketId;
        }
        if (config.progress) {
            blank.progress = config.progress;
        }

        state.selectedTaskId = null;
        state.taskDetailsMode = "create";
        state.taskDetailsStatus = "";
        state.taskDetailsError = "";
        elements.formError.textContent = "";
        draft = blank;
        draftFromTaskId = null;
        state.taskDrawerOpen = true;
        render();
    }

    function closeDrawer() {
        state.taskDrawerOpen = false;
        state.taskDetailsError = "";
        state.taskDetailsStatus = "";
        elements.formError.textContent = "";
        if (state.taskDetailsMode === "create") {
            state.selectedTaskId = null;
        }
        draft = null;
        draftFromTaskId = null;
        render();
    }

    function syncBucketOptions(buckets) {
        elements.bucketId.innerHTML = "";

        buckets.forEach((bucket) => {
            const option = document.createElement("option");
            option.value = bucket.id;
            option.textContent = bucket.name;
            elements.bucketId.appendChild(option);
        });

        const bucketIds = buckets.map((bucket) => bucket.id);
        if (!bucketIds.includes(draft.bucketId)) {
            draft.bucketId = bucketIds[0] || "";
        }
        elements.bucketId.value = draft.bucketId;
    }

    function syncFormFieldsFromDraft() {
        elements.title.value = draft.title;
        elements.bucketId.value = draft.bucketId;
        elements.progress.value = draft.progress;
        elements.priority.value = draft.priority;
        elements.startDate.value = draft.startDate;
        elements.dueDate.value = draft.dueDate;
        elements.notes.value = draft.notes;
    }

    function renderChecklistItems() {
        elements.checklistItems.innerHTML = "";

        if (!draft.checklist.length) {
            const empty = document.createElement("p");
            empty.className = "checklist-empty";
            empty.textContent = "No checklist items yet.";
            elements.checklistItems.appendChild(empty);
            return;
        }

        draft.checklist.forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "checklist-row";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = item.completed;
            checkbox.disabled = state.isSavingTask;
            checkbox.dataset.role = "checklist-completed";
            checkbox.dataset.index = String(index);

            const textInput = document.createElement("input");
            textInput.type = "text";
            textInput.value = item.text;
            textInput.maxLength = 120;
            textInput.autocomplete = "off";
            textInput.placeholder = "Checklist item text";
            textInput.disabled = state.isSavingTask;
            textInput.dataset.role = "checklist-text";
            textInput.dataset.index = String(index);

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "danger checklist-remove-button";
            removeButton.textContent = "Delete";
            removeButton.disabled = state.isSavingTask;
            removeButton.dataset.role = "remove-checklist-item";
            removeButton.dataset.index = String(index);

            row.appendChild(checkbox);
            row.appendChild(textInput);
            row.appendChild(removeButton);
            elements.checklistItems.appendChild(row);
        });
    }

    async function saveTask() {
        if (!state.selectedPlanId || !draft || state.isSavingTask) {
            return;
        }

        elements.formError.textContent = "";
        state.taskDetailsError = "";
        state.taskDetailsStatus = "";
        state.isSavingTask = true;
        onMutationStart();
        render();

        const payload = toTaskPayload(draft);
        const isCreate = state.taskDetailsMode === "create";

        try {
            const savedTask = isCreate
                    ? await planApi.createTask(state.selectedPlanId, payload)
                    : await planApi.updateTask(state.selectedPlanId, state.selectedTaskId, payload);

            const planDetail = getPlanDetail();
            if (!planDetail) {
                throw new Error("Plan detail unavailable after saving task.");
            }

            const updatedTasks = isCreate
                    ? [...planDetail.tasks, savedTask]
                    : planDetail.tasks.map((task) => task.id === savedTask.id ? savedTask : task);

            updatePlanDetail({
                ...planDetail,
                tasks: updatedTasks
            });

            state.selectedTaskId = savedTask.id;
            state.taskDetailsMode = "edit";
            draft = toDraft(savedTask);
            draftFromTaskId = savedTask.id;
            onTaskChange();
            onNotice("Saved");
            closeDrawer();
        } catch (error) {
            const message = toFormMessage(error);
            state.taskDetailsError = message;
            state.taskDetailsStatus = "";
            elements.formError.textContent = message;
        } finally {
            state.isSavingTask = false;
            onMutationEnd();
            render();
        }
    }

    async function deleteTask() {
        if (!state.selectedPlanId || !state.selectedTaskId || state.isSavingTask) {
            return;
        }

        const planDetail = getPlanDetail();
        if (!planDetail) {
            return;
        }

        const task = findTask(planDetail, state.selectedTaskId);
        if (!task) {
            return;
        }

        const confirmed = window.confirm(`Delete task \"${task.title}\"? This cannot be undone.`);
        if (!confirmed) {
            return;
        }

        elements.formError.textContent = "";
        state.taskDetailsError = "";
        state.taskDetailsStatus = "";
        state.isSavingTask = true;
        onMutationStart();
        render();

        try {
            await planApi.deleteTask(state.selectedPlanId, state.selectedTaskId);

            const updatedTasks = planDetail.tasks.filter((item) => item.id !== state.selectedTaskId);
            updatePlanDetail({
                ...planDetail,
                tasks: updatedTasks
            });

            state.selectedTaskId = null;
            state.taskDetailsMode = "view";
            draft = null;
            draftFromTaskId = null;
            onTaskChange();
            onNotice("Saved");
            closeDrawer();
        } catch (error) {
            state.taskDetailsError = toFormMessage(error);
            state.taskDetailsStatus = "";
            elements.formError.textContent = state.taskDetailsError;
        } finally {
            state.isSavingTask = false;
            onMutationEnd();
            render();
        }
    }

    function createBlankDraft(planDetail) {
        const firstBucket = planDetail.buckets.length ? planDetail.buckets[0].id : "";
        return {
            title: "",
            bucketId: firstBucket,
            progress: DEFAULT_PROGRESS,
            priority: DEFAULT_PRIORITY,
            startDate: "",
            dueDate: "",
            notes: "",
            checklist: []
        };
    }

    function toDraft(task) {
        return {
            title: task.title || "",
            bucketId: task.bucketId || "",
            progress: task.progress || DEFAULT_PROGRESS,
            priority: task.priority || DEFAULT_PRIORITY,
            startDate: task.startDate || "",
            dueDate: task.dueDate || "",
            notes: task.notes || "",
            checklist: (task.checklist || []).map((item) => ({
                id: item.id || null,
                text: item.text || "",
                completed: Boolean(item.completed)
            }))
        };
    }

    function toTaskPayload(source) {
        return {
            title: source.title,
            bucketId: source.bucketId,
            progress: source.progress,
            priority: source.priority,
            startDate: normalizeOptionalDate(source.startDate),
            dueDate: normalizeOptionalDate(source.dueDate),
            notes: normalizeOptionalText(source.notes),
            checklist: source.checklist.map((item) => ({
                id: normalizeChecklistId(item.id),
                text: item.text,
                completed: Boolean(item.completed)
            }))
        };
    }

    function normalizeChecklistId(value) {
        if (typeof value !== "string") {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    }

    function normalizeOptionalText(value) {
        if (typeof value !== "string") {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    }

    function normalizeOptionalDate(value) {
        if (typeof value !== "string") {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    }

    function findTask(planDetail, taskId) {
        return planDetail.tasks.find((task) => task.id === taskId) || null;
    }

    function toFormMessage(error) {
        if (error instanceof ApiError) {
            if (error.details.length > 0) {
                const first = error.details[0];
                if (first.field && first.reason) {
                    return `${first.field}: ${first.reason}`;
                }
                if (first.reason) {
                    return first.reason;
                }
            }
            return error.message;
        }
        return "Unexpected task save error. Please retry.";
    }

    function clearMessages() {
        state.taskDetailsStatus = "";
        state.taskDetailsError = "";
        elements.formError.textContent = "";
        elements.status.textContent = "";
        elements.error.textContent = "";
    }
}
