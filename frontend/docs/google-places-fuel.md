# Google Places station prices

Stretch's `/api/live/local-fuel` endpoint uses Places API (New) Nearby Search from the server. It requests gas stations inside the selected radius and the `fuelOptions.fuelPrices` field. A station can still have no reported price for the selected fuel grade; Stretch leaves that price unknown. Reported prices include Google's update time, and Stretch treats reports older than 48 hours as stale.

To enable the connection:

1. In a Google Cloud project with billing set up, enable **Places API (New)**. Check current Places pricing and set a practical API quota before using the endpoint. The `fuelOptions` field is in Google's higher-cost Places field tier.
2. Create a separate server API key restricted to **Places API (New)**. If the server has a fixed outbound IP, restrict the key to that IP too. Do not use a browser-restricted Maps JavaScript key.
3. Put the key in `frontend/.env.local` as `GOOGLE_MAPS_API_KEY=...` and set `GOOGLE_PLACES_ENABLED=true`. Never use a `NEXT_PUBLIC_` prefix or commit the key.
4. Restart the Next.js server. Test `http://localhost:3000/api/live/local-fuel?area=downtown&radius=3&type=REGULAR_UNLEADED`. A successful response includes `source: "Google Maps"` and a `stations` array. A station may have `dollarsPerGallon: null`; that is not a verified pump price.

This connection provides Google-reported station prices where available, not real-time prices from every pump. It does not provide grocery product prices. If credentials are absent, keep `GOOGLE_PLACES_ENABLED=false` and leave the user-entered fuel estimate available.
