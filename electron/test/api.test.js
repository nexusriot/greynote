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
