"use strict";

import {ApiError} from "../api.js";
import {compareTasksByDefaultOrder} from "../utils/task-sort.js";
import {isTaskOverdue} from "../utils/chart-data.js";

const PROGRESS_COLUMNS = [
    {value: "Not started", label: "Not started"},
    {value: "In progress", label: "In progress"},
    {value: "Completed", label: "Completed"}
];

const BUCKET_REORDER_ANIMATION_DURATION_MS = 320;
const BUCKET_REORDER_ANIMATION_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const PROGRESS_BUCKET_ACTIONS_HINT = "Bucket actions are available in Bucket view.";

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
    let activeDragBucketId = null;
    let activeDragProgressId = null;

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
            const isBucketGrouping = state.boardGrouping === "bucket";
            elements.addBucketButton.hidden = false;
            elements.addBucketButton.classList.toggle("board-toolbar-button-hidden", !isBucketGrouping);
            elements.addBucketButton.setAttribute("aria-hidden", String(!isBucketGrouping));
            elements.addBucketButton.tabIndex = isBucketGrouping ? 0 : -1;
            elements.addBucketButton.disabled = state.isPatchingTask || !planDetail || !isBucketGrouping;
        }

        if (!planDetail) {
            renderMessages();
            elements.columns.appendChild(renderPlaceholder("Select a plan to see board columns."));
            return;
        }

        renderMessages();

        const tasks = [...planDetail.tasks].sort(compareTasksByDefaultOrder);
        const columns = state.boardGrouping === "progress"
                ? buildProgressColumns(planDetail.progressOrder, tasks)
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

    function buildProgressColumns(progressOrder, tasks) {
        const order = normalizeProgressOrder(progressOrder);
        return order.map((progressLabel) => ({
            id: progressLabel,
            label: progressLabel,
            tasks: tasks.filter((task) => task.progress === progressLabel)
        }));
    }

    function normalizeProgressOrder(progressOrder) {
        const defaultOrder = PROGRESS_COLUMNS.map((column) => column.value);
        if (!Array.isArray(progressOrder) || progressOrder.length !== defaultOrder.length) {
            return defaultOrder;
        }

        const incoming = progressOrder.map((label) => typeof label === "string" ? label.trim() : "");
        const unique = new Set(incoming);
        if (unique.size !== defaultOrder.length) {
            return defaultOrder;
        }

        const expected = new Set(defaultOrder);
        for (const label of unique) {
            if (!expected.has(label)) {
                return defaultOrder;
            }
        }

        return incoming;
    }

    function renderColumn(column) {
        const columnElement = document.createElement("article");
        columnElement.className = "board-column";
        columnElement.dataset.columnId = column.id;

        const header = document.createElement("header");
        header.className = "board-column-header";

        const titleWrap = document.createElement("div");
        titleWrap.className = "board-column-title-wrap";

        const leadingSlot = document.createElement("span");
        leadingSlot.className = "board-column-leading-slot";
        if (state.boardGrouping === "bucket") {
            leadingSlot.appendChild(renderBucketDragHandle(column, columnElement));
        } else {
            leadingSlot.appendChild(renderProgressDragHandle(column, columnElement));
        }
        titleWrap.appendChild(leadingSlot);

        const title = document.createElement("h4");
        title.textContent = column.label;
        titleWrap.appendChild(title);

        const menuSlot = document.createElement("span");
        menuSlot.className = "board-column-menu-slot";

        if (state.boardGrouping === "bucket") {
            menuSlot.appendChild(renderBucketMenuButton(column));
            wireBucketColumnDrop(columnElement, column.id);
        } else {
            menuSlot.appendChild(renderProgressBucketMenuHint(column));
            wireProgressColumnDrop(columnElement, column.id);
        }
        titleWrap.appendChild(menuSlot);

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
            if (!activeDragTaskId || activeDragBucketId || activeDragProgressId || state.isPatchingTask) {
                return;
            }
            event.preventDefault();
        });

        dropZone.addEventListener("dragenter", (event) => {
            if (!activeDragTaskId || activeDragBucketId || activeDragProgressId || state.isPatchingTask) {
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
            if (activeDragBucketId || activeDragProgressId) {
                return;
            }
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

    function renderBucketDragHandle(column, columnElement) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "bucket-drag-handle";
        handle.textContent = "⋮⋮";
        handle.setAttribute("aria-label", `Drag ${column.label} bucket`);
        handle.draggable = !state.isPatchingTask;
        handle.disabled = state.isPatchingTask;

        handle.addEventListener("dragstart", (event) => {
            if (state.isPatchingTask || activeDragTaskId || activeDragProgressId) {
                event.preventDefault();
                return;
            }

            activeDragBucketId = column.id;
            columnElement.classList.add("dragging");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", `bucket:${column.id}`);
                event.dataTransfer.setDragImage(columnElement, 24, 24);
            }
            state.boardError = "";
            renderMessages();
        });

        handle.addEventListener("dragend", () => {
            columnElement.classList.remove("dragging");
            clearBucketDropTargets();
            activeDragBucketId = null;
        });

        return handle;
    }

    function renderProgressDragHandle(column, columnElement) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "bucket-drag-handle";
        handle.textContent = "⋮⋮";
        handle.setAttribute("aria-label", `Drag ${column.label} progress column`);
        handle.draggable = !state.isPatchingTask;
        handle.disabled = state.isPatchingTask;

        handle.addEventListener("dragstart", (event) => {
            if (state.isPatchingTask || activeDragTaskId || activeDragBucketId) {
                event.preventDefault();
                return;
            }

            activeDragProgressId = column.id;
            columnElement.classList.add("dragging");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", `progress:${column.id}`);
                event.dataTransfer.setDragImage(columnElement, 24, 24);
            }
            state.boardError = "";
            renderMessages();
        });

        handle.addEventListener("dragend", () => {
            columnElement.classList.remove("dragging");
            clearProgressDropTargets();
            activeDragProgressId = null;
        });

        return handle;
    }

    function wireBucketColumnDrop(columnElement, columnId) {
        columnElement.addEventListener("dragover", (event) => {
            if (!activeDragBucketId || state.isPatchingTask) {
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
        });

        columnElement.addEventListener("dragenter", (event) => {
            if (!activeDragBucketId || state.isPatchingTask) {
                return;
            }
            event.preventDefault();
            if (activeDragBucketId !== columnId) {
                columnElement.classList.add("bucket-drop-target");
            }
        });

        columnElement.addEventListener("dragleave", (event) => {
            if (event.relatedTarget instanceof Node && columnElement.contains(event.relatedTarget)) {
                return;
            }
            columnElement.classList.remove("bucket-drop-target");
        });

        columnElement.addEventListener("drop", async (event) => {
            if (!activeDragBucketId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            columnElement.classList.remove("bucket-drop-target");
            await handleBucketDrop(columnId);
        });
    }

    function clearBucketDropTargets() {
        if (!elements.columns) {
            return;
        }
        elements.columns.querySelectorAll(".board-column.bucket-drop-target").forEach((column) => {
            column.classList.remove("bucket-drop-target");
        });
        elements.columns.querySelectorAll(".board-column.dragging").forEach((column) => {
            column.classList.remove("dragging");
        });
    }

    function wireProgressColumnDrop(columnElement, columnId) {
        columnElement.addEventListener("dragover", (event) => {
            if (!activeDragProgressId || state.isPatchingTask) {
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
        });

        columnElement.addEventListener("dragenter", (event) => {
            if (!activeDragProgressId || state.isPatchingTask) {
                return;
            }
            event.preventDefault();
            if (activeDragProgressId !== columnId) {
                columnElement.classList.add("progress-drop-target");
            }
        });

        columnElement.addEventListener("dragleave", (event) => {
            if (event.relatedTarget instanceof Node && columnElement.contains(event.relatedTarget)) {
                return;
            }
            columnElement.classList.remove("progress-drop-target");
        });

        columnElement.addEventListener("drop", async (event) => {
            if (!activeDragProgressId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            columnElement.classList.remove("progress-drop-target");
            await handleProgressColumnDrop(columnId);
        });
    }

    function clearProgressDropTargets() {
        if (!elements.columns) {
            return;
        }
        elements.columns.querySelectorAll(".board-column.progress-drop-target").forEach((column) => {
            column.classList.remove("progress-drop-target");
        });
        elements.columns.querySelectorAll(".board-column.dragging").forEach((column) => {
            column.classList.remove("dragging");
        });
    }

    function captureColumnRects() {
        const rects = new Map();
        if (!elements.columns) {
            return rects;
        }

        elements.columns.querySelectorAll(".board-column").forEach((column) => {
            const columnId = column.dataset.columnId;
            if (columnId) {
                rects.set(columnId, column.getBoundingClientRect());
            }
        });
        return rects;
    }

    function shouldReduceMotion() {
        if (typeof window.matchMedia !== "function") {
            return false;
        }
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function animateColumnReorder(previousRects) {
        if (!elements.columns || shouldReduceMotion() || previousRects.size === 0) {
            return Promise.resolve();
        }

        let animatedCount = 0;
        let completedCount = 0;

        return new Promise((resolve) => {
            elements.columns.querySelectorAll(".board-column").forEach((column) => {
                const columnId = column.dataset.columnId;
                if (!columnId) {
                    return;
                }

                const previousRect = previousRects.get(columnId);
                if (!previousRect) {
                    return;
                }

                const currentRect = column.getBoundingClientRect();
                const deltaX = previousRect.left - currentRect.left;
                const deltaY = previousRect.top - currentRect.top;

                if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
                    return;
                }

                animatedCount += 1;
                column.classList.add("reorder-animating");
                column.style.transition = "none";
                column.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

                const finish = () => {
                    column.style.transition = "";
                    column.style.transform = "";
                    column.classList.remove("reorder-animating");
                    completedCount += 1;
                    if (completedCount >= animatedCount) {
                        resolve();
                    }
                };

                let timeoutHandle = null;
                const onTransitionEnd = (event) => {
                    if (event.target !== column || event.propertyName !== "transform") {
                        return;
                    }
                    column.removeEventListener("transitionend", onTransitionEnd);
                    if (timeoutHandle != null) {
                        window.clearTimeout(timeoutHandle);
                    }
                    finish();
                };

                column.addEventListener("transitionend", onTransitionEnd);
                timeoutHandle = window.setTimeout(() => {
                    column.removeEventListener("transitionend", onTransitionEnd);
                    finish();
                }, BUCKET_REORDER_ANIMATION_DURATION_MS + 90);

                window.requestAnimationFrame(() => {
                    column.style.transition = `transform ${BUCKET_REORDER_ANIMATION_DURATION_MS}ms ${BUCKET_REORDER_ANIMATION_EASING}`;
                    column.style.transform = "translate(0, 0)";
                });
            });

            if (animatedCount === 0) {
                resolve();
            }
        });
    }

    function alignBucketMenu(menu) {
        if (!elements.columns || !elements.section) {
            return;
        }

        menu.classList.remove("menu-align-start", "menu-align-end");
        menu.classList.add("menu-align-end");

        const safePadding = 8;
        const viewportRect = elements.columns.getBoundingClientRect();
        const endRect = menu.getBoundingClientRect();

        if (endRect.left < viewportRect.left + safePadding) {
            menu.classList.remove("menu-align-end");
            menu.classList.add("menu-align-start");

            const startRect = menu.getBoundingClientRect();
            if (startRect.right > viewportRect.right - safePadding) {
                menu.classList.remove("menu-align-start");
                menu.classList.add("menu-align-end");
            }
            return;
        }

        if (endRect.right > viewportRect.right - safePadding) {
            menu.classList.remove("menu-align-end");
            menu.classList.add("menu-align-start");

            const startRect = menu.getBoundingClientRect();
            if (startRect.left < viewportRect.left + safePadding) {
                menu.classList.remove("menu-align-start");
                menu.classList.add("menu-align-end");
            }
        }
    }

    function renderBucketMenuButton(column) {
        const wrap = document.createElement("div");
        wrap.className = "menu-wrap";

        const menuButton = document.createElement("button");
        menuButton.type = "button";
        menuButton.className = "icon-button board-column-menu-button";
        menuButton.textContent = "...";
        menuButton.setAttribute("aria-label", `${column.label} menu`);

        const menu = document.createElement("div");
        menu.className = "menu menu-align-end";
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
            const shouldOpen = menu.hidden;
            menu.hidden = !shouldOpen;
            if (shouldOpen) {
                alignBucketMenu(menu);
            }
        });

        menu.appendChild(renameButton);
        menu.appendChild(deleteButton);
        wrap.appendChild(menuButton);
        wrap.appendChild(menu);
        return wrap;
    }

    function renderProgressBucketMenuHint(column) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "icon-button board-column-menu-button is-disabled";
        button.textContent = "...";
        button.setAttribute("aria-label", `${column.label} bucket actions unavailable`);
        button.setAttribute("aria-disabled", "true");
        button.title = PROGRESS_BUCKET_ACTIONS_HINT;
        button.addEventListener("click", (event) => {
            event.preventDefault();
        });
        return button;
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
        if (isTaskOverdue(task, new Date())) {
            card.classList.add("task-card-overdue");
        }
        card.draggable = !state.isPatchingTask;
        card.dataset.taskId = task.id;
        if (state.selectedTaskId === task.id) {
            card.classList.add("selected");
        }

        card.addEventListener("dragstart", (event) => {
            if (state.isPatchingTask || activeDragBucketId) {
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
        const overdue = isTaskOverdue(task, new Date());
        const meta = document.createElement("p");
        meta.className = "task-meta";
        meta.textContent = `${priorityLabel} | ${dueLabel}`;
        card.appendChild(meta);

        if (overdue) {
            const overdueTag = document.createElement("span");
            overdueTag.className = "task-overdue-tag";
            overdueTag.textContent = "Overdue";
            card.appendChild(overdueTag);
        }

        return card;
    }

    function renderPlaceholder(text) {
        const placeholder = document.createElement("p");
        placeholder.className = "board-empty";
        placeholder.textContent = text;
        return placeholder;
    }

    async function handleBucketDrop(targetBucketId) {
        if (!activeDragBucketId || state.isPatchingTask) {
            return;
        }

        const planDetail = getPlanDetail();
        if (!planDetail || !state.selectedPlanId) {
            return;
        }

        const previousColumnRects = captureColumnRects();

        const fromIndex = planDetail.buckets.findIndex((bucket) => bucket.id === activeDragBucketId);
        const toIndex = planDetail.buckets.findIndex((bucket) => bucket.id === targetBucketId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
            return;
        }

        const previousDetail = clonePlanDetail(planDetail);
        const reorderedBuckets = [...planDetail.buckets];
        const [moved] = reorderedBuckets.splice(fromIndex, 1);
        reorderedBuckets.splice(toIndex, 0, moved);
        const bucketIds = reorderedBuckets.map((bucket) => bucket.id);

        updatePlanDetail({
            ...planDetail,
            buckets: reorderedBuckets
        });
        state.boardError = "";
        state.isPatchingTask = true;
        onPatchStart();
        activeDragBucketId = null;
        render();
        const reorderAnimation = animateColumnReorder(previousColumnRects);
        let reorderFailed = false;

        try {
            const savedBuckets = await planApi.reorderBuckets(state.selectedPlanId, bucketIds);
            const latestDetail = getPlanDetail();
            updatePlanDetail({
                ...latestDetail,
                buckets: savedBuckets
            });
            onNotice("Saved");
        } catch (error) {
            reorderFailed = true;
            updatePlanDetail(previousDetail);
            state.boardError = toMessage(error);
        } finally {
            state.isPatchingTask = false;
            onPatchEnd();
            if (!reorderFailed) {
                await reorderAnimation;
            }
            render();
        }
    }

    async function handleProgressColumnDrop(targetProgressId) {
        if (!activeDragProgressId || state.isPatchingTask) {
            return;
        }

        const planDetail = getPlanDetail();
        if (!planDetail || !state.selectedPlanId) {
            return;
        }

        const previousColumnRects = captureColumnRects();
        const currentOrder = normalizeProgressOrder(planDetail.progressOrder);
        const fromIndex = currentOrder.findIndex((value) => value === activeDragProgressId);
        const toIndex = currentOrder.findIndex((value) => value === targetProgressId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
            return;
        }

        const previousDetail = clonePlanDetail(planDetail);
        const reorderedProgressOrder = [...currentOrder];
        const [moved] = reorderedProgressOrder.splice(fromIndex, 1);
        reorderedProgressOrder.splice(toIndex, 0, moved);

        updatePlanDetail({
            ...planDetail,
            progressOrder: reorderedProgressOrder
        });
        state.boardError = "";
        state.isPatchingTask = true;
        onPatchStart();
        activeDragProgressId = null;
        render();
        const reorderAnimation = animateColumnReorder(previousColumnRects);
        let reorderFailed = false;

        try {
            const savedOrder = await planApi.reorderProgress(state.selectedPlanId, reorderedProgressOrder);
            const latestDetail = getPlanDetail();
            updatePlanDetail({
                ...latestDetail,
                progressOrder: normalizeProgressOrder(savedOrder)
            });
            onNotice("Saved");
        } catch (error) {
            reorderFailed = true;
            updatePlanDetail(previousDetail);
            state.boardError = toMessage(error);
        } finally {
            state.isPatchingTask = false;
            onPatchEnd();
            if (!reorderFailed) {
                await reorderAnimation;
            }
            render();
        }
    }

    async function handleDrop(targetColumnId) {
        if (!activeDragTaskId || activeDragBucketId || activeDragProgressId || state.isPatchingTask) {
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
            progressOrder: Array.isArray(planDetail.progressOrder) ? [...planDetail.progressOrder] : [],
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
