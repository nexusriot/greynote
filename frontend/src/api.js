export class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
    }
}

export async function apiFetch(path, { method = "GET", body, headers } = {}) {
    const res = await fetch(path, {
        method,
        headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(headers || {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include", // IMPORTANT: cookie sessions
    });

    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const payload = isJson ? await res.json().catch(() => null) : null;

    if (!res.ok) {
        const text = isJson ? "" : await res.text().catch(() => "");
        throw new ApiError(payload?.error || text || `HTTP ${res.status}`, res.status, payload);
    }

    return payload;
}

// uploadFile posts a single file as multipart/form-data (apiFetch is JSON-only).
export async function uploadFile(path, file) {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(path, { method: "POST", credentials: "include", body: form });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        throw new ApiError(payload?.error || `HTTP ${res.status}`, res.status, payload);
    }
    return payload;
}
