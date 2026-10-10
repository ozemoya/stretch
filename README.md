# Stretch

Grocery comparison and trip planning with a Next.js frontend and FastAPI backend.

- `frontend/`: web app, provider integrations, tests, and Supabase migrations. See [frontend setup](frontend/README.md).
- `backend/`: catalog and product API. Configure `backend/.env` using `backend/.env.example`.
- `reports/`: collected Kroger catalog reports from the backend work.

## Product options API

The backend exposes product price options from the `product` table at
`GET /api/products`. All query parameters are optional:

```text
/api/products?category=bread
/api/products?locationID=123
/api/products?category=bread&locationID=123
/api/products?id=product-123
```

Dietary filters, pagination, and sorting are also supported:

```text
/api/products?gluten_free=true&vegan=false&nut_free=true
/api/products?limit=50&offset=50&order=price.asc
```

Supported sorting fields are `category`, `date`, `price`, `unit_price`,
`locationID`, and `ID`, each with `.asc` or `.desc`.

## Run the web app

From `frontend/`, run `npm ci`, configure `.env.local` from `.env.example`, and run `npm run dev`.
Set `BACKEND_API_URL` when running the backend. Missing prices are never replaced with another retailer's prices.

For a production server, build before starting:

```bash
cd frontend
npm ci
npm run build
npm start
```

Run `npm start` from `frontend/`, not the repository root. The build creates the `.next` directory required by the production server; use `npm run dev` for local development without a production build.

## Run the backend

From the repository root:

```bash
./backend/run.sh
```

The script starts the FastAPI development server at `http://127.0.0.1:8000`
with reload enabled. Set `HOST` or `PORT` to override the defaults, or pass
additional Uvicorn options to the script.

## Checks

From `frontend/`: `npm test` and `npm run build`.

Current capabilities and external access requirements are documented in [the MVP audit](frontend/docs/mvp-audit.md).
