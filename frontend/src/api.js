export class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
    }
}

// apiFetchWithMeta is apiFetch plus the response headers, for the few calls
// that need them (the note list reports its total in X-Total-Count).
export async function apiFetchWithMeta(path, options = {}) {
    const res = await rawFetch(path, options);
    return { data: await parseResponse(res), headers: res.headers };
}

export async function apiFetch(path, options = {}) {
    const res = await rawFetch(path, options);
    return parseResponse(res);
}

async function rawFetch(path, { method = "GET", body, headers } = {}) {
    const res = await fetch(path, {
        method,
        headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(headers || {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include", // IMPORTANT: cookie sessions
    });
    return res;
}

async function parseResponse(res) {
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
