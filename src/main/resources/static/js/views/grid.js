"use strict";

import {sortTasksForGrid} from "../utils/task-sort.js";

const COLUMNS = [
    {key: "title", label: "Title"},
    {key: "bucket", label: "Bucket"},
    {key: "progress", label: "Progress"},
    {key: "priority", label: "Priority"},
    {key: "startDate", label: "Start"},
    {key: "dueDate", label: "Due"}
];

export function createGridView(options) {
    const {
        state,
        getPlanDetail,
        onTaskSelect = () => {
        }
    } = options;

    const elements = {
        section: document.getElementById("grid-section"),
        status: document.getElementById("grid-status"),
        error: document.getElementById("grid-error"),
        empty: document.getElementById("grid-empty"),
        table: document.getElementById("grid-table"),
        body: document.getElementById("grid-body"),
        headings: document.getElementById("grid-headings")
    };

    wireEvents();

    return {
        render,
        clearMessages
    };

    function wireEvents() {
        if (!elements.headings) {
            return;
        }

        elements.headings.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const button = target.closest("button[data-sort-key]");
            if (!(button instanceof HTMLButtonElement)) {
                return;
            }

            const key = button.dataset.sortKey;
            if (!key) {
                return;
            }

            applySort(key);
            render();
        });
    }

    function applySort(key) {
        if (state.gridSortKey === key) {
            state.gridSortDirection = state.gridSortDirection === "asc" ? "desc" : "asc";
        } else {
            state.gridSortKey = key;
            state.gridSortDirection = "asc";
        }
        state.gridStatus = "";
        state.gridError = "";
    }

    function render() {
        if (!elements.section || !elements.table || !elements.body) {
            return;
        }

        elements.section.hidden = state.activeView !== "grid";
        if (elements.section.hidden) {
            return;
        }

        const planDetail = getPlanDetail();
        renderHeaders();

        if (!planDetail) {
            renderNoPlanState();
            return;
        }

        const tasks = Array.isArray(planDetail.tasks) ? planDetail.tasks : [];
        const bucketNameById = toBucketNameMap(planDetail.buckets || []);

        const sortedTasks = sortTasksForGrid(tasks, {
            sortKey: state.gridSortKey,
            direction: state.gridSortDirection,
            bucketNameById
        });

        renderRows(sortedTasks, bucketNameById);
        elements.status.textContent = state.gridStatus;
        elements.error.textContent = state.gridError;
    }

    function renderHeaders() {
        const headingButtons = elements.headings.querySelectorAll("button[data-sort-key]");
        headingButtons.forEach((button) => {
            const key = button.dataset.sortKey;
            const isActive = key === state.gridSortKey;
            const headingCell = button.closest("th");
            if (headingCell) {
                headingCell.setAttribute(
                        "aria-sort",
                        isActive
                                ? (state.gridSortDirection === "asc" ? "ascending" : "descending")
                                : "none");
            }

            const arrow = isActive
                    ? (state.gridSortDirection === "asc" ? "\u25B2" : "\u25BC")
                    : "\u2195";
            const indicator = button.querySelector(".grid-sort-indicator");
            if (indicator) {
                indicator.textContent = arrow;
            }
            button.classList.toggle("active", isActive);
        });
    }

    function renderNoPlanState() {
        elements.body.innerHTML = "";
        elements.table.hidden = true;
        elements.empty.hidden = false;
        elements.empty.textContent = "Select a plan to view tasks in the grid.";
        elements.status.textContent = "";
        elements.error.textContent = "";
    }

    function renderRows(tasks, bucketNameById) {
        elements.body.innerHTML = "";

        if (!tasks.length) {
            elements.table.hidden = true;
            elements.empty.hidden = false;
            elements.empty.textContent = "No tasks to display for this plan.";
            return;
        }

        tasks.forEach((task) => {
            const row = document.createElement("tr");
            row.className = "grid-row";
            row.tabIndex = 0;
            row.dataset.taskId = task.id;
            if (state.selectedTaskId === task.id) {
                row.classList.add("selected");
            }

            row.addEventListener("click", () => {
                onTaskSelect(task.id);
            });

            row.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onTaskSelect(task.id);
                }
            });

            row.appendChild(cell(task.title));
            row.appendChild(cell(bucketNameById[task.bucketId] || "-"));
            row.appendChild(cell(task.progress || "-"));
            row.appendChild(cell(task.priority || "-"));
            row.appendChild(cell(task.startDate || "-"));
            row.appendChild(cell(task.dueDate || "-"));

            elements.body.appendChild(row);
        });

        elements.table.hidden = false;
        elements.empty.hidden = true;
    }

    function cell(value) {
        const td = document.createElement("td");
        td.textContent = value;
        return td;
    }

    function toBucketNameMap(buckets) {
        const map = {};
        buckets.forEach((bucket) => {
            map[bucket.id] = bucket.name;
        });
        return map;
    }

    function clearMessages() {
        state.gridStatus = "";
        state.gridError = "";
    }
}
