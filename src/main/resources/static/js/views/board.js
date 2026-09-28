"use strict";

import {ApiError} from "../api.js";
import {compareTasksByDefaultOrder} from "../utils/task-sort.js";

const PROGRESS_COLUMNS = [
    {value: "Not started", label: "Not started"},
    {value: "In progress", label: "In progress"},
    {value: "Completed", label: "Completed"}
];

export function createBoardView(options) {
    const {
        state,
        planApi,
        getPlanDetail,
        updatePlanDetail,
        onTaskSelect = () => {
        },
        onCreateTaskFromBoard = () => {
        },
        onPatchStart = () => {
        },
        onPatchEnd = () => {
        },
        onNotice = () => {
        }
    } = options;

    const elements = {
        section: document.getElementById("board-section"),
        groupingSwitcher: document.getElementById("board-grouping-switcher"),
        addBucketButton: document.getElementById("board-add-bucket-button"),
        columns: document.getElementById("board-columns"),
        status: document.getElementById("board-status"),
        error: document.getElementById("board-error")
    };

    let activeDragTaskId = null;

    wireEvents();

    return {
        render,
        clearMessages
    };

    function wireEvents() {
        if (!elements.groupingSwitcher) {
            return;
        }

        elements.groupingSwitcher.addEventListener("change", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || target.name !== "board-grouping") {
                return;
            }

            if (target.value !== "bucket" && target.value !== "progress") {
                return;
            }

            state.boardGrouping = target.value;
            clearMessages();
            render();
        });

        if (elements.addBucketButton) {
            elements.addBucketButton.addEventListener("click", async () => {
                const proposed = window.prompt("Bucket name");
                if (proposed == null) {
                    return;
                }
                await createBucket(proposed);
            });
        }
    }

    function render() {
        if (!elements.section || !elements.columns) {
            return;
        }

        elements.section.hidden = state.activeView !== "board";
        if (elements.section.hidden) {
            return;
        }

        syncGroupingInputs();

        const planDetail = getPlanDetail();
        elements.columns.innerHTML = "";

        if (elements.addBucketButton) {
            elements.addBucketButton.hidden = state.boardGrouping !== "bucket";
            elements.addBucketButton.disabled = state.isPatchingTask || !planDetail;
        }

        if (!planDetail) {
            renderMessages();
            elements.columns.appendChild(renderPlaceholder("Select a plan to see board columns."));
            return;
        }

        renderMessages();

        const tasks = [...planDetail.tasks].sort(compareTasksByDefaultOrder);
        const columns = state.boardGrouping === "progress"
                ? buildProgressColumns(tasks)
                : buildBucketColumns(planDetail.buckets, tasks);

        columns.forEach((column) => {
            elements.columns.appendChild(renderColumn(column));
        });
    }

    function syncGroupingInputs() {
        const inputs = elements.groupingSwitcher.querySelectorAll("input[name='board-grouping']");
        inputs.forEach((input) => {
            if (input instanceof HTMLInputElement) {
                input.checked = input.value === state.boardGrouping;
                input.disabled = state.isPatchingTask;
            }
        });
    }

    function buildBucketColumns(buckets, tasks) {
        return buckets.map((bucket) => ({
            id: bucket.id,
            label: bucket.name,
            bucket: bucket,
            tasks: tasks.filter((task) => task.bucketId === bucket.id)
        }));
    }

    function buildProgressColumns(tasks) {
        return PROGRESS_COLUMNS.map((column) => ({
            id: column.value,
            label: column.label,
            tasks: tasks.filter((task) => task.progress === column.value)
        }));
    }

    function renderColumn(column) {
        const columnElement = document.createElement("article");
        columnElement.className = "board-column";

        const header = document.createElement("header");
        header.className = "board-column-header";

        const titleWrap = document.createElement("div");
        titleWrap.className = "board-column-title-wrap";

        const title = document.createElement("h4");
        title.textContent = column.label;
        titleWrap.appendChild(title);

        if (state.boardGrouping === "bucket") {
            titleWrap.appendChild(renderBucketMenuButton(column));
        }

        const count = document.createElement("p");
        count.textContent = `${column.tasks.length} task${column.tasks.length === 1 ? "" : "s"}`;
        header.appendChild(titleWrap);
        header.appendChild(count);

        const addTaskButton = document.createElement("button");
        addTaskButton.type = "button";
        addTaskButton.className = "ghost-main small";
        addTaskButton.textContent = "+";
        addTaskButton.setAttribute("aria-label", `Add task in ${column.label}`);
        addTaskButton.disabled = state.isPatchingTask;
        addTaskButton.addEventListener("click", () => {
            const initialDraft = state.boardGrouping === "bucket"
                    ? {bucketId: column.id}
                    : {progress: column.id};
            onCreateTaskFromBoard(initialDraft);
        });
        titleWrap.appendChild(addTaskButton);

        const dropZone = document.createElement("div");
        dropZone.className = "board-drop-zone";
        dropZone.dataset.columnId = column.id;

        dropZone.addEventListener("dragover", (event) => {
            if (!activeDragTaskId || state.isPatchingTask) {
                return;
            }
            event.preventDefault();
        });

        dropZone.addEventListener("dragenter", (event) => {
            if (!activeDragTaskId || state.isPatchingTask) {
                return;
            }
            event.preventDefault();
            dropZone.classList.add("drop-target");
        });

        dropZone.addEventListener("dragleave", (event) => {
            if (event.relatedTarget instanceof Node && dropZone.contains(event.relatedTarget)) {
                return;
            }
            dropZone.classList.remove("drop-target");
        });

        dropZone.addEventListener("drop", async (event) => {
            event.preventDefault();
            dropZone.classList.remove("drop-target");
            await handleDrop(column.id);
        });

        if (column.tasks.length === 0) {
            const empty = document.createElement("p");
            empty.className = "board-empty";
            empty.textContent = "No tasks.";
            dropZone.appendChild(empty);
        } else {
            column.tasks.forEach((task) => {
                dropZone.appendChild(renderTaskCard(task));
            });
        }

        columnElement.appendChild(header);
        columnElement.appendChild(dropZone);
        return columnElement;
    }

    function renderBucketMenuButton(column) {
        const wrap = document.createElement("div");
        wrap.className = "menu-wrap";

        const menuButton = document.createElement("button");
        menuButton.type = "button";
        menuButton.className = "icon-button";
        menuButton.textContent = "...";
        menuButton.setAttribute("aria-label", `${column.label} menu`);

        const menu = document.createElement("div");
        menu.className = "menu";
        menu.hidden = true;

        const renameButton = document.createElement("button");
        renameButton.type = "button";
        renameButton.className = "menu-item";
        renameButton.textContent = "Rename";
        renameButton.addEventListener("click", async () => {
            menu.hidden = true;
            const proposed = window.prompt("Rename bucket", column.label);
            if (proposed == null) {
                return;
            }
            await renameBucket(column.id, proposed);
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "menu-item danger-light";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", async () => {
            menu.hidden = true;
            const confirmed = window.confirm(`Delete bucket \"${column.label}\"?`);
            if (!confirmed) {
                return;
            }
            await deleteBucket(column.id);
        });

        menuButton.addEventListener("click", () => {
            menu.hidden = !menu.hidden;
        });

        menu.appendChild(renameButton);
        menu.appendChild(deleteButton);
        wrap.appendChild(menuButton);
        wrap.appendChild(menu);
        return wrap;
    }

    async function createBucket(name) {
        if (!state.selectedPlanId) {
            return;
        }
        try {
            const created = await planApi.createBucket(state.selectedPlanId, name);
            const planDetail = getPlanDetail();
            if (!planDetail) {
                return;
            }
            updatePlanDetail({
                ...planDetail,
                buckets: [...planDetail.buckets, created]
            });
            onNotice("Saved");
        } catch (error) {
            state.boardError = toMessage(error);
            renderMessages();
        }
    }

    async function renameBucket(bucketId, name) {
        if (!state.selectedPlanId) {
            return;
        }
        try {
            const renamed = await planApi.renameBucket(state.selectedPlanId, bucketId, name);
            const planDetail = getPlanDetail();
            if (!planDetail) {
                return;
            }
            updatePlanDetail({
                ...planDetail,
                buckets: planDetail.buckets.map((bucket) => bucket.id === renamed.id ? renamed : bucket)
            });
            onNotice("Saved");
        } catch (error) {
            state.boardError = toMessage(error);
            renderMessages();
        }
    }

    async function deleteBucket(bucketId) {
        if (!state.selectedPlanId) {
            return;
        }
        try {
            await planApi.deleteBucket(state.selectedPlanId, bucketId);
            const latest = await planApi.getPlan(state.selectedPlanId);
            updatePlanDetail(latest);
            onNotice("Saved");
        } catch (error) {
            state.boardError = toMessage(error);
            renderMessages();
        }
    }

    function renderTaskCard(task) {
        const card = document.createElement("article");
        card.className = "task-card";
        card.draggable = !state.isPatchingTask;
        card.dataset.taskId = task.id;
        if (state.selectedTaskId === task.id) {
            card.classList.add("selected");
        }

        card.addEventListener("dragstart", (event) => {
            if (state.isPatchingTask) {
                event.preventDefault();
                return;
            }

            activeDragTaskId = task.id;
            card.classList.add("dragging");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", task.id);
            }
            state.boardError = "";
            renderMessages();
        });

        card.addEventListener("dragend", () => {
            card.classList.remove("dragging");
            activeDragTaskId = null;
        });

        card.addEventListener("click", () => {
            if (state.isPatchingTask) {
                return;
            }
            onTaskSelect(task.id);
        });

        const title = document.createElement("strong");
        title.textContent = task.title;
        card.appendChild(title);

        const dueLabel = task.dueDate ? `Due ${task.dueDate}` : "No due date";
        const priorityLabel = task.priority || "-";
        const meta = document.createElement("p");
        meta.className = "task-meta";
        meta.textContent = `${priorityLabel} | ${dueLabel}`;
        card.appendChild(meta);

        return card;
    }

    function renderPlaceholder(text) {
        const placeholder = document.createElement("p");
        placeholder.className = "board-empty";
        placeholder.textContent = text;
        return placeholder;
    }

    async function handleDrop(targetColumnId) {
        if (!activeDragTaskId || state.isPatchingTask) {
            return;
        }

        const planDetail = getPlanDetail();
        if (!planDetail || !state.selectedPlanId) {
            return;
        }

        const draggedTask = planDetail.tasks.find((task) => task.id === activeDragTaskId);
        if (!draggedTask) {
            return;
        }

        const patchBody = state.boardGrouping === "bucket"
                ? {bucketId: targetColumnId}
                : {progress: targetColumnId};

        const noChange = state.boardGrouping === "bucket"
                ? draggedTask.bucketId === targetColumnId
                : draggedTask.progress === targetColumnId;
        if (noChange) {
            return;
        }

        const previousDetail = clonePlanDetail(planDetail);
        const optimisticDetail = applyOptimisticUpdate(previousDetail, draggedTask.id, targetColumnId, state.boardGrouping);
        updatePlanDetail(optimisticDetail);
        state.boardError = "";
        state.isPatchingTask = true;
        onPatchStart();
        render();

        try {
            const updatedTask = await planApi.patchTask(state.selectedPlanId, draggedTask.id, patchBody);
            const latestDetail = getPlanDetail();
            const merged = mergeUpdatedTask(latestDetail, updatedTask);
            updatePlanDetail(merged);
            onNotice("Saved");
        } catch (error) {
            updatePlanDetail(previousDetail);
            state.boardError = toMessage(error);
        } finally {
            state.isPatchingTask = false;
            activeDragTaskId = null;
            onPatchEnd();
            render();
        }
    }

    function renderMessages() {
        elements.status.textContent = state.boardStatus;
        elements.error.textContent = state.boardError;
    }

    function mergeUpdatedTask(planDetail, updatedTask) {
        if (!planDetail) {
            return planDetail;
        }

        const mergedTasks = planDetail.tasks.map((task) => task.id === updatedTask.id ? updatedTask : task);
        return {
            ...planDetail,
            tasks: mergedTasks
        };
    }

    function clonePlanDetail(planDetail) {
        return {
            ...planDetail,
            buckets: planDetail.buckets.map((bucket) => ({...bucket})),
            tasks: planDetail.tasks.map((task) => ({
                ...task,
                checklist: Array.isArray(task.checklist)
                        ? task.checklist.map((item) => ({...item}))
                        : []
            }))
        };
    }

    function applyOptimisticUpdate(planDetail, taskId, targetColumnId, grouping) {
        const tasks = planDetail.tasks.map((task) => {
            if (task.id !== taskId) {
                return task;
            }

            if (grouping === "bucket") {
                return {...task, bucketId: targetColumnId};
            }
            return {...task, progress: targetColumnId};
        });

        return {
            ...planDetail,
            tasks
        };
    }

    function toMessage(error) {
        if (error instanceof ApiError) {
            return error.message;
        }
        return "Unexpected error. Please retry.";
    }

    function clearMessages() {
        state.boardStatus = "";
        state.boardError = "";
    }
}
