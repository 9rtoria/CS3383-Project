"use strict";

function compareDueDateAscending(leftDueDate, rightDueDate) {
    const leftHasDueDate = typeof leftDueDate === "string" && leftDueDate.length > 0;
    const rightHasDueDate = typeof rightDueDate === "string" && rightDueDate.length > 0;

    if (!leftHasDueDate && !rightHasDueDate) {
        return 0;
    }
    if (!leftHasDueDate) {
        return 1;
    }
    if (!rightHasDueDate) {
        return -1;
    }
    return leftDueDate.localeCompare(rightDueDate);
}

export function compareTasksByDefaultOrder(leftTask, rightTask) {
    const dueDateComparison = compareDueDateAscending(leftTask.dueDate, rightTask.dueDate);
    if (dueDateComparison !== 0) {
        return dueDateComparison;
    }

    const leftTitle = (leftTask.title || "").toLocaleLowerCase();
    const rightTitle = (rightTask.title || "").toLocaleLowerCase();
    if (leftTitle !== rightTitle) {
        return leftTitle.localeCompare(rightTitle);
    }

    return (leftTask.id || "").localeCompare(rightTask.id || "");
}
