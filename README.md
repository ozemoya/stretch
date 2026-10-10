# Stretch

The cheapest groceries aren't always the cheapest grocery trip.

Stretch compares the cost of a whole grocery basket plus the fuel to get everything home.

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
