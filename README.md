# GreyNote

Minimal notes app.

- **Backend:** Go + Gin + SQLite
- **Frontend:** React (Vite)
- **Auth:** cookie session
- **Sharing:** public link `/share/:token`
- **Admin:** user management

## Run (Docker Compose)

```bash
docker compose up -d --build
```

Open:
- Frontend: http://localhost:35173
- Backend:  http://localhost:38080 (health: `/health`)

Rebuild / restart

```bash
docker compose down -v
docker compose up -d --build
```

## Bootstrap first admin

Set these env vars for the backend (in compose):
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (min 8 chars)

Example:
```yaml
environment:
  ADMIN_EMAIL: "admin@example.com"
  ADMIN_PASSWORD: "supersecret123"
```

Then login via UI. Admin page:
- `/admin/users`


If you change the frontend port, also update backend:
- `FRONTEND_ORIGIN` (e.g. `http://localhost:5174`)

## Dev host allowlist (Vite)

If Vite blocks your hostname, allow it in `frontend/vite.config.js`:

```js
server: { allowedHosts: true } // dev only
```
