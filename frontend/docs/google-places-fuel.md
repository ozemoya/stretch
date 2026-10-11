# Google Places station prices

Stretch's `/api/live/local-fuel` endpoint uses Places API (New) Nearby Search from the server. It requests gas stations inside the selected radius and the `fuelOptions.fuelPrices` field. A station can still have no reported price for the selected fuel grade; Stretch leaves that price unknown. Reported prices include Google's update time, and Stretch treats reports older than 48 hours as stale.

To enable the connection:

1. In a Google Cloud project with billing set up, enable **Places API (New)**. Check current Places pricing and set a practical API quota before using the endpoint. The `fuelOptions` field is in Google's higher-cost Places field tier.
2. Create a separate server API key restricted to **Places API (New)**. If the server has a fixed outbound IP, restrict the key to that IP too. Do not use a browser-restricted Maps JavaScript key.
3. Put the key in `frontend/.env.local` as `GOOGLE_MAPS_API_KEY=...` and set `GOOGLE_PLACES_ENABLED=true`. Never use a `NEXT_PUBLIC_` prefix or commit the key.
4. Restart the Next.js server. Test `http://localhost:3000/api/live/local-fuel?area=downtown&radius=3&type=REGULAR_UNLEADED`. A successful response includes `source: "Google Maps"` and a `stations` array. A station may have `dollarsPerGallon: null`; that is not a verified pump price.

This connection provides Google-reported station prices where available, not real-time prices from every pump. It does not provide grocery product prices. If credentials are absent, keep `GOOGLE_PLACES_ENABLED=false` and leave the user-entered fuel estimate available.

## Nearby stores and the map

Stretch uses Places API (New) for nearby grocery and gas locations and Google Maps JavaScript API to display them on the trip map. Create a **separate browser key** restricted to Maps JavaScript API and the exact domains that host Stretch. Set `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=...` in each deployment environment and restart the app. The browser key is visible in page requests, so its application and API restrictions are essential. Keep the Places key server-only.

Nearby Search returns at most 20 grocery locations and 20 gas locations per request; the result is a nearby selection, not every business in the radius. Grocery listings on the map do not confirm branch-specific prices. The dedicated gas picker displays Google-reported prices only when present and recent. Google Maps attribution remains visible on the map and source links are provided for reported prices.

## Gas comparison workspace

`/gas` combines nearby gas stations, the Google map, selected-station details, and a road-distance detour calculator. ZIP/address lookup uses server-side Places Text Search (`/api/gas/location`). Station details (`/api/gas/details`) are requested only after a user selects a station. The browser never receives the server key. Browser geolocation is optional; denying permission leaves ZIP/address search available.

Nearby Search requests minimal discovery fields. The separate fuel-price provider requests `fuelOptions` for the selected grade. Station price records are joined to map results by exact Google Place ID and coordinates; names alone are never used. No independent fuel-price vendor is configured, so a missing or stale Google report displays **Gas price unavailable**. The calculator needs two recent reports, entered gallons and MPG, and a road route. Mix & Match compares its road route with and without a chosen gas station when a recent report, fill-up amount, and entered baseline price are present; it skips a detour that raises the estimated combined cost. Smart Cart shows the fill-up amount and detour benefit separately from groceries and driving cost.

Google Places content is requested on demand with no server cache. Preferred Place IDs are kept in browser local storage. A selected station's name, address, and coordinates are also saved in the trip draft and, if the user finalizes a plan, in that device's saved plan. The server applies a process-local request cap; configure Google Cloud quotas and billing alerts separately before launch. Public deployment needs a final review of Google's attribution and data-retention terms for those saved trip details.

Before a public deployment, add its domain to the browser key's allowed referrers and verify the Google Cloud project's billing and quota. See [Google's Maps JavaScript setup](https://developers.google.com/maps/documentation/javascript/get-api-key), [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies), and [Maps Platform terms](https://cloud.google.com/maps-platform/terms/maps-service-terms).
