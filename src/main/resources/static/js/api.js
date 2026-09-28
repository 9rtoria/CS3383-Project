"use strict";

const API_BASE = "/api/plans";

export class ApiError extends Error {
    constructor(message, details) {
        super(message);
        this.name = "ApiError";
        this.details = Array.isArray(details) ? details : [];
    }

    reasonForField(fieldName) {
        const detail = this.details.find((item) => item.field === fieldName);
        return detail ? detail.reason : null;
    }
}

async function request(path, options) {
    const response = await fetch(path, options);
    if (response.status === 204) {
        return null;
    }

    const body = await readJsonSafely(response);
    if (!response.ok) {
        throw toApiError(response.status, body);
    }

    return body;
}

async function readJsonSafely(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return null;
    }

    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

function toApiError(statusCode, body) {
    if (body && typeof body.message === "string") {
        return new ApiError(body.message, body.details);
    }

    if (statusCode >= 500) {
        return new ApiError("Server error. Please retry.", []);
    }

    return new ApiError("Request failed. Check your input and retry.", []);
}

export const planApi = {
    listPlans() {
        return request(API_BASE, {
            method: "GET"
        });
    },

    getPlan(planId) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}`, {
            method: "GET"
        });
    },

    createPlan(name) {
        return request(API_BASE, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({name})
        });
    },

    renamePlan(planId, name) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({name})
        });
    },

    createBucket(planId, name) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}/buckets`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({name})
        });
    },

    renameBucket(planId, bucketId, name) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}/buckets/${encodeURIComponent(bucketId)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({name})
        });
    },

    deleteBucket(planId, bucketId) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}/buckets/${encodeURIComponent(bucketId)}`, {
            method: "DELETE"
        });
    },

    patchTask(planId, taskId, patchBody) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(patchBody)
        });
    },

    createTask(planId, taskBody) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}/tasks`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(taskBody)
        });
    },

    updateTask(planId, taskId, taskBody) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(taskBody)
        });
    },

    deleteTask(planId, taskId) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}`, {
            method: "DELETE"
        });
    },

    deletePlan(planId) {
        return request(`${API_BASE}/${encodeURIComponent(planId)}`, {
            method: "DELETE"
        });
    }
};
