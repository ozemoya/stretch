# Stretch

Next.js App Router + React + TypeScript + Supabase. Selected design: Draft C; original PNG logo preserved.

## Run

Node 20.9+ required. Run `npm ci`, copy `.env.example` to `.env.local`, then `npm run dev`. Open http://localhost:3000.

## Supabase setup

The FastAPI bridge reads the existing `products`, `product`, and `store` tables. `product.id` joins to `products.id`, and `product.locationID` joins to `store.locationID`. Prices are converted from dollars to frontend cents; rows without a product or store mapping are skipped.

Run the FastAPI bridge from the repository root with `uvicorn backend.main:app --reload --port 8000` after copying `backend/.env.example` to `backend/.env` and setting its Supabase credentials. Set `BACKEND_API_URL=http://localhost:8000` in the frontend `.env.local`, then restart Expo/Next.js. The comparison panel should say **Catalog connected to Supabase**. Supabase credentials belong only to the backend; never expose a service-role key to the frontend.

Without a key the app explicitly uses its built-in demo catalog. A database failure displays a warning and falls back to demo data.

The Stretch project was connected and verified on October 9, 2026: 30 products, 3 stores, 90 sample offers, and 6 substitutions. Local `.env.local` contains the backend URL and is ignored by Git; each teammate or deployment must configure its own backend environment.

## Project status

Hacklanta prototype. The app is now an Expo / React Native application. It keeps the Draft C visual language while using native layout, touch interactions, accessibility props, and a responsive tablet/web layout.

## Selected design

**Draft C** is the selected direction. Preserve the original PNG logo and cream, olive, beige, and warm accent colors.

[Draft C in FigJam](https://www.figma.com/board/TNSW97eqDpo50behte9Xn9/Untitled?node-id=59-39)

![Draft C](draft-c-final.png)

## Run the React Native app

Install dependencies with `npm install`, then run `npm start`. Use the Expo terminal shortcuts to open the app on iOS, Android, or web.

## Planned MVP

- Grocery list with quantities and dietary preferences.
- Budget, starting area, MPG, gas price, and maximum stops.
- Whole-basket and round-trip fuel comparison.
- One-store and two-store optimization with an item checklist per stop.
- Optional budget substitutions with quantity and savings explanations.
- Supabase tables for stores, products, offers, and price timestamps.

## Data limitations

Prices and distances in this prototype are illustrative sample data, not live store prices or navigation. Fuel estimates exclude tax and travel time. Do not present incomplete baskets as complete trip estimates.

## Configuration

Keep credentials in local environment files. Never commit Supabase secret or service-role keys.
