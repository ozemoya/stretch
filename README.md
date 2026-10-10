# Stretch

Grocery comparison and trip planning with a Next.js frontend and FastAPI backend.

- `frontend/`: web app, provider integrations, tests, and Supabase migrations. See [frontend setup](frontend/README.md).
- `backend/`: catalog and product API. Configure `backend/.env` using `backend/.env.example`.
- `reports/`: collected Kroger catalog reports from the backend work.

## Run the web app

From `frontend/`, run `npm ci`, configure `.env.local` from `.env.example`, and run `npm run dev`.
Set `BACKEND_API_URL` when running the backend. Missing prices are never replaced with another retailer's prices.

## Checks

From `frontend/`: `npm test` and `npm run build`.

Current capabilities and external access requirements are documented in [the MVP audit](frontend/docs/mvp-audit.md).
