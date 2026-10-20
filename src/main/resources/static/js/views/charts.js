"use strict";

import {
    computeProgressBreakdown,
    computeTasksPerBucket,
    computeTasksPerPriority,
    computeOverdueCount
} from "../utils/chart-data.js";

const PROGRESS_COLOR_VARS = {
    "Not started": "var(--chart-progress-not-started)",
    "In progress": "var(--chart-progress-in-progress)",
    "Completed": "var(--chart-progress-completed)"
};

const PRIORITY_COLOR_VARS = {
    "Urgent": "var(--chart-priority-urgent)",
    "Important": "var(--chart-priority-important)",
    "Medium": "var(--chart-priority-medium)",
    "Low": "var(--chart-priority-low)"
};

export function createChartsView(options) {
    const {
        state,
        getPlanDetail
    } = options;

    const elements = {
        section: document.getElementById("charts-section"),
        progress: document.getElementById("chart-progress"),
        progressBody: document.getElementById("chart-progress-body"),
        overdueBody: document.getElementById("chart-overdue-body"),
        buckets: document.getElementById("chart-buckets"),
        bucketsBody: document.getElementById("chart-buckets-body"),
        priority: document.getElementById("chart-priority"),
        priorityBody: document.getElementById("chart-priority-body")
    };

    return {
        render,
        clearMessages
    };

    function render(isActive) {
        if (!elements.section) {
            return;
        }
        elements.section.hidden = !isActive;
        if (!isActive) {
            return;
        }

        const planDetail = getPlanDetail();
        if (!planDetail) {
            renderEmpty(elements.progressBody, "Select a plan to see charts.");
            renderEmpty(elements.overdueBody, "0");
            renderEmpty(elements.bucketsBody, "Select a plan to see charts.");
            renderEmpty(elements.priorityBody, "Select a plan to see charts.");
            return;
        }

        const tasks = Array.isArray(planDetail.tasks) ? planDetail.tasks : [];
        if (tasks.length === 0) {
            renderEmpty(elements.progressBody, "No tasks to chart yet.");
            renderEmpty(elements.overdueBody, "0");
            renderEmpty(elements.bucketsBody, "No tasks to chart yet.");
            renderEmpty(elements.priorityBody, "No tasks to chart yet.");
            return;
        }

        renderProgressDonut(computeProgressBreakdown(tasks));
        renderOverdueStat(computeOverdueCount(tasks));
        renderBucketBars(computeTasksPerBucket(tasks, planDetail.buckets));
        renderPriorityBars(computeTasksPerPriority(tasks));
    }

    function renderProgressDonut(breakdown) {
        if (!elements.progressBody) {
            return;
        }
        const total = breakdown.total;
        if (total <= 0) {
            renderEmpty(elements.progressBody, "No tasks to chart yet.");
            return;
        }

        elements.progressBody.innerHTML = "";

        const size = 180;
        const stroke = 22;
        const radius = (size - stroke) / 2;
        const center = size / 2;
        const circumference = 2 * Math.PI * radius;

        const svg = createSvg("svg", {
            viewBox: `0 0 ${size} ${size}`,
            class: "chart-donut",
            role: "img",
            "aria-label": `Progress donut. ${total} total tasks.`
        });

        let offset = 0;
        breakdown.values.forEach((entry) => {
            if (entry.count <= 0) {
                return;
            }
            const fraction = entry.count / total;
            const length = fraction * circumference;
            const arc = createSvg("circle", {
                cx: center,
                cy: center,
                r: radius,
                fill: "none",
                stroke: PROGRESS_COLOR_VARS[entry.label],
                "stroke-width": stroke,
                "stroke-dasharray": `${length} ${circumference - length}`,
                "stroke-dashoffset": -offset,
                "stroke-linecap": "butt",
                transform: `rotate(-90 ${center} ${center})`
            });
            svg.appendChild(arc);
            offset += length;
        });

        const centerText = createSvg("text", {
            x: center,
            y: center,
            "text-anchor": "middle",
            "dominant-baseline": "middle",
            class: "chart-donut-total"
        });
        centerText.textContent = String(total);
        svg.appendChild(centerText);

        elements.progressBody.appendChild(svg);
        elements.progressBody.appendChild(renderDonutLegend(breakdown));
    }

    function renderDonutLegend(breakdown) {
        const legend = document.createElement("div");
        legend.className = "chart-legend";
        breakdown.values.forEach((entry) => {
            const item = document.createElement("div");
            item.className = "chart-legend-item";

            const swatch = document.createElement("span");
            swatch.className = "chart-legend-swatch";
            swatch.style.backgroundColor = PROGRESS_COLOR_VARS[entry.label];

            const label = document.createElement("span");
            label.className = "chart-legend-label";
            label.textContent = entry.label;

            const value = document.createElement("span");
            value.className = "chart-legend-value";
            value.textContent = String(entry.count);

            item.appendChild(swatch);
            item.appendChild(label);
            item.appendChild(value);
            legend.appendChild(item);
        });
        return legend;
    }

    function renderOverdueStat(count) {
        if (!elements.overdueBody) {
            return;
        }
        elements.overdueBody.innerHTML = "";
        const value = document.createElement("div");
        value.className = "chart-overdue-value";
        value.textContent = String(count);
        const caption = document.createElement("p");
        caption.className = "chart-overdue-caption";
        caption.textContent = "overdue task" + (count === 1 ? "" : "s");
        elements.overdueBody.appendChild(value);
        elements.overdueBody.appendChild(caption);
    }

    function renderBucketBars(entries) {
        renderBarList(elements.bucketsBody, entries, (entry) => entry.name, () => "var(--chart-bar-bucket)");
    }

    function renderPriorityBars(entries) {
        renderBarList(elements.priorityBody, entries, (entry) => entry.label, (entry) => PRIORITY_COLOR_VARS[entry.label]);
    }

    function renderBarList(host, entries, labelResolver, colorResolver) {
        if (!host) {
            return;
        }
        host.innerHTML = "";

        const max = entries.reduce((highest, entry) => Math.max(highest, entry.count), 0);
        if (max <= 0) {
            renderEmpty(host, "No tasks to chart yet.");
            return;
        }

        entries.forEach((entry) => {
            const row = document.createElement("div");
            row.className = "chart-bar-row";

            const label = document.createElement("span");
            label.className = "chart-bar-label";
            label.textContent = labelResolver(entry);

            const track = document.createElement("div");
            track.className = "chart-bar-track";

            const fill = document.createElement("div");
            fill.className = "chart-bar-fill";
            const width = Math.round((entry.count / max) * 100);
            fill.style.width = `${width}%`;
            fill.style.backgroundColor = typeof colorResolver === "function" ? colorResolver(entry) : colorResolver;
            track.appendChild(fill);

            const value = document.createElement("span");
            value.className = "chart-bar-value";
            value.textContent = String(entry.count);

            row.appendChild(label);
            row.appendChild(track);
            row.appendChild(value);
            host.appendChild(row);
        });
    }

    function renderEmpty(host, message) {
        if (!host) {
            return;
        }
        host.innerHTML = "";
        const text = document.createElement("p");
        text.className = "chart-empty";
        text.textContent = message;
        host.appendChild(text);
    }

    function createSvg(tag, attributes) {
        const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.keys(attributes).forEach((key) => {
            node.setAttribute(key, attributes[key]);
        });
        return node;
    }

    function clearMessages() {
        // Charts render statically; no status/error text to clear.
    }
}