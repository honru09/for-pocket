# Places and footprints

## Entry experience

- A small pin in the entry footer opens the location sheet. The first use is opt-in; enabling is saved per account and ledger on this device. Existing browser permission alone never enables the feature.
- Enabled entry pages acquire one position on opening or starting another amount. There is no `watchPosition`, periodic acquisition, live tracking or background trail. A one-minute in-memory coordinate cache avoids repeating GPS for nearby actions.
- Telegram Mini Apps use the official Bot API 8.0+ `LocationManager` when available. Other clients use browser geolocation. Permission refusal, timeout, unsupported APIs and reverse lookup errors leave ordinary entry available.
- GPS and nearby place results never block the optimistic save. Saving, removing a location, changing time or switching ledger invalidates pending draft results. Manual currency/category choices win; a country suggestion cannot truncate decimal input.
- A location is saved only with an entry. Ledger members can see saved locations. The sheet explains this before first use. Use “Remove from entry” or “Turn off” for private entries. Importing old files does not attach current location.

## Map provider

The default uses [Photon](https://github.com/komoot/photon), whose public service permits reasonable project use without an availability guarantee. Requests are cached in memory for two hours, equivalent concurrent lookups are combined, and each process limits requests to one per second. Coordinates are sent only to the selected provider, not logged by the application. Fine coordinates are not sent to the expense model; only a supplied place label/address/country is used as contextual data.

`GEO_REVERSE_PROVIDER=photon|nominatim`, `GEO_REVERSE_URL` and `GEO_USER_AGENT` allow a private/provider endpoint without changing application code. An empty URL disables reverse lookup while retaining explicitly attached coordinates and Telegram venues. Public Nominatim is disabled unless `GEO_NOMINATIM_PUBLIC_SINGLE_INSTANCE=true`: its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) requires at most one request per second **across the entire application**, a descriptive user agent, caching and attribution. Multiple Cloud Run instances require an external shared limiter or a suitable private provider. The UI attributes OpenStreetMap and Photon; adjust the provider credit if switching providers.

Reverse results identify nearby map objects, not proof of a visit. A merchant is only suggested for a commercial point within 25 m when GPS accuracy is at most 50 m. Otherwise only the neighborhood/address/country is attached. No merchant is invented from raw coordinates. Unknown countries retain the user's currency rather than being assigned USD.

## Telegram

Send a private `location` or `venue` message, then a numeric amount. The bot holds a user/chat/ledger-bound session for ten minutes. The amount waits for that same bounded lookup and is presented in the existing confirmation card, even if automatic confirmation is enabled. Location has a small pin label; modifying the amount preserves the original place and time. A consumed session cannot leak into later entries, other people or other ledgers. Live-location edits are not processed as tracking events.

## Ledger

Category filtering distinguishes expense and income categories and includes historical categories removed from settings. Filtering affects the displayed list, count and balance. Monthly footprints summarize expense counts for recorded areas in the selected currency/category; transfers, reimbursements, income and deleted entries do not inflate visits. No map or extra panel is added to the amount screen.

## Verification

`npm test` covers schema persistence, reverse lookup/cache/failure, permission fallback, stale request cancellation, API authorization/ledger races, parser context isolation and Telegram confirmation/replay/expiry. `node tests/location.browser.cjs` checks opt-in, saving, category filters, footprints, manual currency and delayed responses at 320/390/1280 px. `node tests/confirm-touch.browser.cjs` retains the amount confirmation edge-touch regression. Browser scripts require Playwright installed or available through `NODE_PATH`.
