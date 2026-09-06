"use strict";

const { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage, shell } = require("electron");
const path = require("node:path");
const { ApiClient } = require("./api");
const { Store } = require("./store");
const { registerIpc } = require("./ipc");

let mainWindow = null;
let tray = null;
let store = null;
let api = null;
let authenticated = false;

const isSelfTest = process.argv.includes("--selftest");

function createWindow() {
    const bounds = store.get("windowBounds") || { width: 1200, height: 820 };

    mainWindow = new BrowserWindow({
        ...bounds,
        minWidth: 720,
        minHeight: 480,
        show: false,
        title: "GreyNote",
        backgroundColor: "#111315",
        webPreferences: {
            preload: path.join(__dirname, "..", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

    mainWindow.once("ready-to-show", () => {
        if (!store.get("startMinimised") || isSelfTest) mainWindow.show();
    });

    mainWindow.on("close", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            store.set("windowBounds", mainWindow.getBounds());
        }
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    // Anything the page tries to open in a new window goes to the real browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });

    return mainWindow;
}

function showWindow() {
    if (!mainWindow) createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

/** Tells the renderer to run a command — the menu, tray and hotkey all use this. */
function send(channel, payload) {
    showWindow();
    mainWindow.webContents.send(channel, payload);
}

function buildMenu() {
    const template = [
        {
            label: "File",
            submenu: [
                { label: "New note", accelerator: "CmdOrCtrl+N", click: () => send("command", "new-note") },
                { label: "Today's journal", accelerator: "CmdOrCtrl+D", click: () => send("command", "today") },
                { type: "separator" },
                { label: "Save note", accelerator: "CmdOrCtrl+S", click: () => send("command", "save") },
                { label: "Save note as…", click: () => send("command", "save-as") },
                { label: "Export all notes…", click: () => send("command", "export") },
                { type: "separator" },
                { role: "quit" },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" }, { role: "redo" }, { type: "separator" },
                { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
            ],
        },
        {
            label: "View",
            submenu: [
                { label: "Notes", accelerator: "CmdOrCtrl+1", click: () => send("command", "view-notes") },
                { label: "Journal", accelerator: "CmdOrCtrl+2", click: () => send("command", "view-daily") },
                { label: "Templates", accelerator: "CmdOrCtrl+3", click: () => send("command", "view-templates") },
                { label: "Tags & folders", accelerator: "CmdOrCtrl+4", click: () => send("command", "view-tags") },
                { label: "Trash", accelerator: "CmdOrCtrl+5", click: () => send("command", "view-trash") },
                { label: "Statistics", accelerator: "CmdOrCtrl+6", click: () => send("command", "view-stats") },
                { type: "separator" },
                { label: "Search", accelerator: "CmdOrCtrl+F", click: () => send("command", "focus-search") },
                { label: "Toggle preview", accelerator: "CmdOrCtrl+E", click: () => send("command", "toggle-preview") },
                { type: "separator" },
                { role: "reload" }, { role: "toggleDevTools" }, { role: "resetZoom" },
                { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" },
            ],
        },
        {
            label: "Help",
            submenu: [
                { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => send("command", "view-settings") },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray() {
    // A 1-bit dot rather than a bundled asset: the tray only needs to be findable.
    const icon = nativeImage.createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAQUlEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFAJ0kAAGxJ1nJAAAAAElFTkSuQmCC"
    );

    tray = new Tray(icon);
    tray.setToolTip("GreyNote");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open GreyNote", click: () => showWindow() },
        { label: "Quick capture", click: () => send("command", "quick-capture") },
        { label: "Today's journal", click: () => send("command", "today") },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
    ]));
    tray.on("click", () => showWindow());
}

function registerQuickCapture() {
    globalShortcut.unregisterAll();
    const accelerator = store.get("quickCaptureShortcut");
    if (!accelerator) return true;

    try {
        return globalShortcut.register(accelerator, () => send("command", "quick-capture"));
    } catch {
        return false;
    }
}

app.whenReady().then(() => {
    store = new Store(app.getPath("userData"));
    api = new ApiClient(store.get("serverUrl"), cookie => store.set("cookie", cookie));
    api.setCookie(store.get("cookie"));

    registerIpc({
        api,
        store,
        getWindow: () => mainWindow,
        onAuthChange: value => { authenticated = value; },
    });

    createWindow();
    buildMenu();
    if (!isSelfTest) {
        buildTray();
        registerQuickCapture();
    } else {
        // Drives the real window against a real backend; see test/selftest.js.
        mainWindow.webContents.on("console-message", (_event, level, message, line, source) => {
            console.log(`[renderer:${level}] ${message} (${source}:${line})`);
        });
        mainWindow.webContents.once("did-finish-load", () => {
            require("../test/selftest")
                .run({ app, window: mainWindow, store, api })
                .catch(err => {
                    console.error("self-test crashed:", err);
                    app.exit(1);
                });
        });
    }

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    // The tray keeps the app alive on Linux and Windows the way a notes app
    // with a global capture hotkey should behave; macOS does this by default.
    if (process.platform !== "darwin" && (isSelfTest || !tray)) app.quit();
});

app.on("will-quit", () => globalShortcut.unregisterAll());

module.exports = { registerQuickCapture, isAuthenticated: () => authenticated };
