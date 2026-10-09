# Stretch

Next.js App Router + React + TypeScript + Supabase. Selected design: Draft C; original PNG logo preserved.

## Run

Node 20.9+ required. Run `npm ci`, copy `.env.example` to `.env.local`, then `npm run dev`. Open http://localhost:3000.

## Supabase setup

Run `supabase/setup.sql` once in the project's SQL Editor against an empty project. It creates tables, read-only public policies, and 30 products / 90 sample offers. Alternatively, apply `supabase/migrations/202610090001_catalog.sql` and then `supabase/seed.sql` through your migration workflow.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, then restart Next.js. The comparison panel should say **Catalog connected to Supabase**. No service-role key is needed. Credentials are ignored by Git.

Without a key the app explicitly uses its built-in demo catalog. A database failure displays a warning and falls back to demo data. Hosted setup is not complete until the SQL is applied and the key is configured.

## Features

- Whole-basket optimization across one and two stores, including round-trip fuel.
- Product search, quantities, area, budget, MPG, gas price, and maximum stops.
- Optional dietary/budget substitutions with package differences, savings, and undo.
- Per-store checklists, check-off controls, and downloadable text plan.
- Missing items excluded from cheapest ranking; timestamp and stale-price labels.
- Responsive Draft C landing page and interactive planner; no account required.

## Data and privacy

Prices and dietary tags are fictional sample data recorded October 9, 2026. Routes use illustrative area-based distances, not live navigation. Tax is excluded. Time assumes 25 mph plus 12 minutes per stop. Substitutions are not nutritional equivalents; confirm product labels.

Supabase serves public catalog data only. Grocery lists and preferences remain in browser memory; checklist downloads are created locally. Public users have SELECT access only; INSERT, UPDATE, and DELETE are revoked and protected by RLS.

## Checks

`npm test`, `npm run typecheck`, `npm run build`, `npm audit`.

Tests cover optimizer calculations, quantities, missing items, dietary conflicts, and split-store savings. PGlite applies the actual SQL setup and checks anonymous/authenticated reads and denied writes; this is a local SQL verification, not a hosted Supabase test.

## Deployment

Import the repository into Vercel with its Next.js preset and configure the two environment variables. No live routing provider is required for the sample demo. Old static files are kept in `archive/`.

[Selected Draft C](https://www.figma.com/board/TNSW97eqDpo50behte9Xn9/Untitled?node-id=59-39)
