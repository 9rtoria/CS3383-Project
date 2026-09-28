"use strict";

function hasValue(value) {
    return typeof value === "string" && value.length > 0;
}

function normalizeText(value) {
    return hasValue(value) ? value.toLocaleLowerCase() : "";
}

function compareTextAscending(leftText, rightText) {
    return normalizeText(leftText).localeCompare(normalizeText(rightText));
}

function compareDateAscendingWithEmptyLast(leftDate, rightDate) {
    const leftHasDate = hasValue(leftDate);
    const rightHasDate = hasValue(rightDate);

    if (!leftHasDate && !rightHasDate) {
        return 0;
    }
    if (!leftHasDate) {
        return 1;
    }
    if (!rightHasDate) {
        return -1;
    }
    return leftDate.localeCompare(rightDate);
}

export function compareTasksByDefaultOrder(leftTask, rightTask) {
    const dueDateComparison = compareDateAscendingWithEmptyLast(leftTask.dueDate, rightTask.dueDate);
    if (dueDateComparison !== 0) {
        return dueDateComparison;
    }

    const titleComparison = compareTextAscending(leftTask.title, rightTask.title);
    if (titleComparison !== 0) {
        return titleComparison;
    }

    return (leftTask.id || "").localeCompare(rightTask.id || "");
}

function compareDateByDirectionWithEmptyLast(leftDate, rightDate, direction) {
    const ascending = compareDateAscendingWithEmptyLast(leftDate, rightDate);
    if (ascending === 0) {
        return 0;
    }

    const leftHasDate = hasValue(leftDate);
    const rightHasDate = hasValue(rightDate);
    if (!leftHasDate || !rightHasDate) {
        return ascending;
    }

    return direction === "desc" ? ascending * -1 : ascending;
}

function compareByDirection(ascendingResult, direction) {
    return direction === "desc" ? ascendingResult * -1 : ascendingResult;
}

function buildBucketName(task, bucketNameById) {
    if (!task || !hasValue(task.bucketId)) {
        return "";
    }

    return bucketNameById[task.bucketId] || "";
}

export function compareTasksForGrid(leftTask, rightTask, options) {
    const config = options || {};
    const sortKey = config.sortKey || "dueDate";
    const direction = config.direction === "desc" ? "desc" : "asc";
    const bucketNameById = config.bucketNameById || {};

    let comparison = 0;
    switch (sortKey) {
        case "title":
            comparison = compareByDirection(compareTextAscending(leftTask.title, rightTask.title), direction);
            break;
        case "bucket":
            comparison = compareByDirection(
                    compareTextAscending(buildBucketName(leftTask, bucketNameById), buildBucketName(rightTask, bucketNameById)),
                    direction);
            break;
        case "progress":
            comparison = compareByDirection(compareTextAscending(leftTask.progress, rightTask.progress), direction);
            break;
        case "priority":
            comparison = compareByDirection(compareTextAscending(leftTask.priority, rightTask.priority), direction);
            break;
        case "startDate":
            comparison = compareDateByDirectionWithEmptyLast(leftTask.startDate, rightTask.startDate, direction);
            break;
        case "dueDate":
            comparison = compareDateByDirectionWithEmptyLast(leftTask.dueDate, rightTask.dueDate, direction);
            break;
        default:
            comparison = 0;
            break;
    }

    if (comparison !== 0) {
        return comparison;
    }

    return compareTasksByDefaultOrder(leftTask, rightTask);
}

export function sortTasksForGrid(tasks, options) {
    return [...tasks].sort((leftTask, rightTask) => compareTasksForGrid(leftTask, rightTask, options));
}
