"use strict";

const PROGRESS_ORDER = ["Not started", "In progress", "Completed"];
const PRIORITY_ORDER = ["Urgent", "Important", "Medium", "Low"];

function hasValue(value) {
    return typeof value === "string" && value.length > 0;
}

function toLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function normalizeToday(today) {
    if (today instanceof Date && !Number.isNaN(today.getTime())) {
        return toLocalDateKey(today);
    }
    return toLocalDateKey(new Date());
}

export function isTaskOverdue(task, today) {
    if (!task || !hasValue(task.dueDate) || task.progress === "Completed") {
        return false;
    }
    return task.dueDate < normalizeToday(today);
}

export function computeProgressBreakdown(tasks) {
    const taskList = Array.isArray(tasks) ? tasks : [];
    const counts = {};
    PROGRESS_ORDER.forEach((label) => {
        counts[label] = 0;
    });
    taskList.forEach((task) => {
        const label = task && task.progress;
        if (Object.prototype.hasOwnProperty.call(counts, label)) {
            counts[label] += 1;
        }
    });
    return {
        total: taskList.length,
        values: PROGRESS_ORDER.map((label) => ({label, count: counts[label]}))
    };
}

export function computeTasksPerBucket(tasks, buckets) {
    const taskList = Array.isArray(tasks) ? tasks : [];
    const bucketList = Array.isArray(buckets) ? buckets : [];
    const countsByBucketId = {};
    taskList.forEach((task) => {
        if (!task || !hasValue(task.bucketId)) {
            return;
        }
        countsByBucketId[task.bucketId] = (countsByBucketId[task.bucketId] || 0) + 1;
    });
    return bucketList.map((bucket) => ({
        bucketId: bucket.id,
        name: bucket.name,
        count: countsByBucketId[bucket.id] || 0
    }));
}

export function computeTasksPerPriority(tasks) {
    const taskList = Array.isArray(tasks) ? tasks : [];
    const counts = {};
    PRIORITY_ORDER.forEach((label) => {
        counts[label] = 0;
    });
    taskList.forEach((task) => {
        const label = task && task.priority;
        if (Object.prototype.hasOwnProperty.call(counts, label)) {
            counts[label] += 1;
        }
    });
    return PRIORITY_ORDER.map((label) => ({label, count: counts[label]}));
}

export function computeOverdueCount(tasks, today) {
    const taskList = Array.isArray(tasks) ? tasks : [];
    return taskList.filter((task) => isTaskOverdue(task, today)).length;
}