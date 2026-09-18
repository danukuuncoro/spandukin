# Spandukin Backend API V2

## Public endpoints

- `GET /healthz` — health service/provider.
- `GET /api/status` — backward-compatible status untuk frontend Spandukin.
- `GET /api/settings` — konfigurasi aman tanpa secret.
- `GET /api/providers` — status provider OpenAI/Gemini.
- `POST /api/ai` — membuat konsep spanduk dari `{ "prompt": "..." }`.

## Admin endpoints

Semua endpoint admin memerlukan salah satu header:

- `Authorization: Bearer <API_ADMIN_TOKEN>`
- `X-API-Admin-Token: <API_ADMIN_TOKEN>`

Endpoint:

- `GET /api/admin/overview`
- `GET /api/admin/settings`
- `PATCH /api/admin/settings`
- `POST /api/admin/test`
- `GET /api/admin/logs?limit=50`
- `GET /api/admin/stats`

`PATCH /api/admin/settings` hanya mengubah konfigurasi runtime. Nilai permanen tetap dikelola sebagai Railway environment variables agar API key dan secret tidak pernah disimpan di frontend atau repository.

## Secret variables

Gunakan Railway Variables: `OPENAI_API_KEY`, `GEMINI_API_KEY` (opsional), dan `API_ADMIN_TOKEN`.
