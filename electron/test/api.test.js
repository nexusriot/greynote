import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { ApiClient, ApiError } from "../main/api.js";

/**
 * The API client is the whole desktop app's connection to the outside world, so
 * it is tested against a real HTTP server rather than a mocked fetch.
 */
describe("ApiClient", () => {
    let server;
    let baseUrl;
    let requests;
    let respond;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const chunks = [];
            req.on("data", chunk => chunks.push(chunk));
            req.on("end", () => {
                requests.push({
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    body: Buffer.concat(chunks).toString("utf8"),
                    // Decoding to text mangles binary; uploads are checked here.
                    raw: Buffer.concat(chunks),
                });
                respond(req, res);
            });
        });

        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(() => new Promise(resolve => server.close(resolve)));

    beforeEach(() => {
        requests = [];
        respond = (req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
        };
    });

    function json(body, { status = 200, headers = {} } = {}) {
        return (req, res) => {
            res.writeHead(status, { "Content-Type": "application/json", ...headers });
            res.end(JSON.stringify(body));
        };
    }

    it("keeps the session cookie and replays it", async () => {
        const saved = [];
        const api = new ApiClient(baseUrl, cookie => saved.push(cookie));

        respond = (req, res) => {
            res.writeHead(204, { "Set-Cookie": "notes_session=abc123; Path=/; HttpOnly" });
            res.end();
        };
        await api.login("user@example.com", "secret");

        respond = json({ email: "user@example.com" });
        await api.me();

        expect(saved).toEqual(["notes_session=abc123"]);
        expect(requests[1].headers.cookie).toBe("notes_session=abc123");
        expect(JSON.parse(requests[0].body)).toEqual({ email: "user@example.com", password: "secret" });
    });

    it("forgets the cookie when the server clears it", async () => {
        const saved = [];
        const api = new ApiClient(baseUrl, cookie => saved.push(cookie));
        api.setCookie("notes_session=abc123");

        respond = (req, res) => {
            res.writeHead(204, { "Set-Cookie": "notes_session=; Path=/; Max-Age=0" });
            res.end();
        };
        await api.logout();

        expect(api.cookie).toBe(null);
        expect(saved.at(-1)).toBe(null);
    });

    it("sends the version the editor loaded as If-Match", async () => {
        const api = new ApiClient(baseUrl);
        respond = json({ updatedAt: "v2" });

        const result = await api.updateNote(7, { title: "t", content: "c" }, "v1");

        expect(result).toEqual({ updatedAt: "v2" });
        expect(requests[0].headers["if-match"]).toBe("v1");
    });

    it("omits If-Match when the caller forces a save", async () => {
        const api = new ApiClient(baseUrl);
        respond = json({ updatedAt: "v3" });

        await api.updateNote(7, { title: "t" }, null);

        expect(requests[0].headers["if-match"]).toBeUndefined();
    });

    it("surfaces a conflict with the server's copy attached", async () => {
        const api = new ApiClient(baseUrl);
        respond = json({ error: "changed elsewhere", current: { id: 7, content: "theirs" } }, { status: 409 });

        const error = await api.updateNote(7, { title: "t" }, "v1").catch(err => err);

        expect(error).toBeInstanceOf(ApiError);
        expect(error.status).toBe(409);
        expect(error.data.current.content).toBe("theirs");
    });

    it("reads the total count and builds list filters", async () => {
        const api = new ApiClient(baseUrl);
        respond = json([{ id: 1 }], { headers: { "X-Total-Count": "42" } });

        const result = await api.listNotes({ limit: 50, offset: 50, tag: "work", folder: "Work/Projects", recursive: true });

        expect(result.total).toBe(42);
        expect(result.notes).toHaveLength(1);
        const url = new URL(requests[0].url, baseUrl);
        expect(url.searchParams.get("limit")).toBe("50");
        expect(url.searchParams.get("offset")).toBe("50");
        expect(url.searchParams.get("tag")).toBe("work");
        expect(url.searchParams.get("folder")).toBe("Work/Projects");
        expect(url.searchParams.get("recursive")).toBe("1");
    });

    it("treats an unfiled filter differently from no filter", async () => {
        const api = new ApiClient(baseUrl);
        respond = json([]);

        await api.listNotes({ folder: "" });
        expect(new URL(requests[0].url, baseUrl).searchParams.has("folder")).toBe(true);

        await api.listNotes({});
        expect(new URL(requests[1].url, baseUrl).searchParams.has("folder")).toBe(false);
    });

    it("percent-encodes a tag name containing a slash", async () => {
        const api = new ApiClient(baseUrl);
        respond = json({ notesUpdated: 1 });

        await api.deleteTag("work/projects");

        expect(requests[0].url).toBe("/api/tags/work%2Fprojects");
    });

    it("explains a refused connection in plain language", async () => {
        const api = new ApiClient("http://127.0.0.1:1");

        const error = await api.me().catch(err => err);

        expect(error).toBeInstanceOf(ApiError);
        expect(error.message).toMatch(/refused/i);
        expect(error.status).toBe(0);
    });

    it("refuses to call anything without a server address", async () => {
        const api = new ApiClient("");
        await expect(api.me()).rejects.toThrow(/server address/i);
    });

    it("posts an upload as multipart/form-data with the bytes intact", async () => {
        const api = new ApiClient(baseUrl);
        respond = json({ url: "/api/images/abc.png" });

        const result = await api.uploadImage("shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png");

        expect(result.url).toBe("/api/images/abc.png");
        expect(requests[0].method).toBe("POST");
        expect(requests[0].url).toBe("/api/images");

        const boundary = requests[0].headers["content-type"].match(/boundary=(.+)$/)[1];
        expect(boundary).toBeTruthy();
        expect(requests[0].body).toContain(`--${boundary}`);
        expect(requests[0].body).toContain('name="file"; filename="shot.png"');
        expect(requests[0].body).toContain("image/png");
        // The PNG magic bytes must survive the envelope untouched.
        expect(requests[0].raw.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
        expect(requests[0].raw.subarray(-(boundary.length + 6)).toString())
            .toBe(`--${boundary}--\r\n`);
        expect(Number(requests[0].headers["content-length"])).toBe(requests[0].raw.length);
    });

    it("sends an import archive to the import endpoint", async () => {
        const api = new ApiClient(baseUrl);
        respond = json({ imported: 3, skipped: [] });

        const result = await api.importNotes("export.zip", Buffer.from("PKzip"));

        expect(result.imported).toBe(3);
        expect(requests[0].url).toBe("/api/notes/import");
        expect(requests[0].headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    });

    it("carries the share password in a header and nothing else", async () => {
        const api = new ApiClient(baseUrl);
        api.setCookie("notes_session=abc123");
        respond = json({ id: 4, title: "Shared" });

        await api.sharedNote("tok en", "letmein");

        expect(requests[0].url).toBe("/api/share/tok%20en");
        expect(requests[0].headers["x-share-password"]).toBe("letmein");
    });

    it("omits the share password header when there is none", async () => {
        const api = new ApiClient(baseUrl);
        respond = json({ id: 4 });

        await api.sharedNote("token");

        expect(requests[0].headers["x-share-password"]).toBeUndefined();
    });

    it("asks for one day's journal entry", async () => {
        const api = new ApiClient(baseUrl);
        respond = json({ id: 9, dailyDate: "2026-03-05" });

        await api.dailyNote("2026-03-05");
        expect(requests[0].url).toBe("/api/notes/daily?date=2026-03-05");

        await api.dailyNote();
        expect(requests[1].url).toBe("/api/notes/daily");
    });

    it("clears a share expiry by sending an empty string", async () => {
        const api = new ApiClient(baseUrl);
        respond = (req, res) => res.writeHead(204).end();

        await api.setShareExpiry(7, "");

        expect(requests[0].method).toBe("PUT");
        expect(requests[0].url).toBe("/api/notes/7/share/expiry");
        expect(JSON.parse(requests[0].body)).toEqual({ expiresAt: "" });
    });

    it("covers the account, session and admin routes", async () => {
        const api = new ApiClient(baseUrl);
        respond = (req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("[]");
        };

        await api.changePassword("old-one", "new-one");
        await api.deleteAccount("old-one");
        await api.sessions();
        await api.revokeSession(12);
        await api.users();
        await api.createUser({ email: "new@example.com", password: "password123", isAdmin: true });
        await api.setUserAdmin(3, false);
        await api.deleteUser(3);
        await api.serverVersion();

        expect(requests.map(request => `${request.method} ${request.url}`)).toEqual([
            "PUT /api/account/password",
            "DELETE /api/account",
            "GET /api/sessions",
            "DELETE /api/sessions/12",
            "GET /api/admin/users",
            "POST /api/admin/users",
            "PUT /api/admin/users/3/admin",
            "DELETE /api/admin/users/3",
            "GET /api/version",
        ]);
        expect(JSON.parse(requests[0].body)).toEqual({ currentPassword: "old-one", newPassword: "new-one" });
        expect(JSON.parse(requests[1].body)).toEqual({ password: "old-one" });
        expect(JSON.parse(requests[5].body)).toEqual({
            email: "new@example.com", password: "password123", isAdmin: true,
        });
        expect(JSON.parse(requests[6].body)).toEqual({ isAdmin: false });
    });

    it("returns raw bytes for the export download", async () => {
        const api = new ApiClient(baseUrl);
        respond = (req, res) => {
            res.writeHead(200, { "Content-Type": "application/zip" });
            res.end(Buffer.from("PKzip"));
        };

        const { buffer } = await api.exportZip();

        expect(buffer.subarray(0, 2).toString()).toBe("PK");
    });
});
