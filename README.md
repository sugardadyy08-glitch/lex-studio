# Lex Studio

React and Tailwind frontend hosted on Cloudflare Pages, with a Pages Function
proxy for read-only Roblox catalog item lookups.

## Catalog lookup API

`POST https://lex-studio.pages.dev/api/catalog/details`

Request:

```json
{
  "itemIds": ["123456789", "987654321"]
}
```

The function validates positive numeric IDs, removes duplicates, limits each
request to 20 items, and forwards them to Roblox's public catalog details
endpoint. It does not require Roblox credentials and does not modify items.

## Asset previews

`POST https://lex-studio.pages.dev/api/assets/preview`

Request:

```json
{
  "assetIds": ["123456789"]
}
```

Example response:

```json
{
  "data": [{
    "id": 123456789,
    "name": "Example asset",
    "assetTypeId": 13,
    "assetType": "Decal",
    "status": "Not for sale",
    "isLimited": false,
    "thumbnailUrl": "https://tr.rbxcdn.com/...",
    "thumbnailState": "Completed"
  }]
}
```

The Cloudflare Pages Function in `functions/api/assets/[[path]].js` returns
public metadata from
`https://economy.roblox.com/v2/assets/{assetId}/details`, plus the thumbnail
state and image URL from
`https://thumbnails.roblox.com/v1/assets?assetIds={assetIds}&size=420x420&format=Png&isCircular=false`.
The endpoint accepts up to 10 positive asset IDs per request. It does not
download asset binaries, use Roblox account cookies, or bypass Roblox access
permissions. When Roblox responds with HTTP 429, the API forwards the status
and `Retry-After` header to the frontend; it does not automatically retry or
ignore Roblox's rate limit.
If public metadata is unavailable, the endpoint returns a generic asset name,
marks `metadataAvailable` as `false`, and continues to attempt the public
thumbnail lookup. It never treats missing metadata as permission to retrieve
the binary asset. Each metadata result also contains `metadataStatus`:
`METADATA FOUND` or `PRIVATE / NOT FOUND`; unavailable types are returned as
`Unknown` with a `null` type ID. **START SPOOF** checks IDs individually,
displays the public name when available, and otherwise places `Asset_{id}` in
the queue with the private/not-found status. It never downloads or changes an
asset.

## Saving lookup results locally

On the Spoof Asset page, choose a destination folder with **CHOOSE FOLDER**.
The browser prompts for write access through the File System Access API.
**START SPOOF** checks each ID against public metadata and saves the results as
a timestamped `lex-studio-asset-lookup-*.json` file in that folder. Private or
missing metadata is recorded with a generic `Asset_{id}` name and an explicit
status. Only metadata is saved; the feature does not download or modify Roblox
asset binaries. Use a secure context such as HTTPS or localhost in a browser
that supports `window.showDirectoryPicker`.

## Edit Music local conversion

The Edit Music page converts WAV, OGG, FLAC, and MP3 files to MP3, OGG, FLAC,
or WAV in the browser using `@ffmpeg/ffmpeg`, `@ffmpeg/core`, and
`@ffmpeg/util`. MP3 output is encoded at 192 kbps. Local uploads stay in
browser memory. URL inputs are temporarily fetched by the optional proxy
service, then passed to browser-side FFmpeg for conversion. The UI shows
loading/processing status, supports batch conversion, and provides a
format-specific download for each result. Speed presets remain visible but
currently do not change the conversion.

The page also accepts direct audio-file URLs and adds fetched files to the
same conversion queue through the optional `audio-proxy-service` microservice.
The proxy permits only the exact hostnames in `AUDIO_ALLOWED_HOSTS`, rejects
private-network DNS results and redirects outside the allowlist, and limits
audio to 25 MB and five minutes. Supported formats are MP3, OGG, FLAC, and
WAV. YouTube and SoundCloud page extraction is not supported.

To run the FastAPI microservice locally or deploy its Docker image to Railway or
Render, set `AUDIO_ALLOWED_HOSTS` to a comma-separated list of exact trusted
audio-file hostnames and `CORS_ORIGINS` to the exact Lex Studio origins that
should be allowed (include your Pages preview origin if needed). Build from
`audio-proxy-service/` and expose the platform-provided `PORT`. Set
`VITE_AUDIO_PROXY_URL` in the Vite build environment to the service's HTTPS base
URL, such as `https://audio-proxy.example.com`, then rebuild and deploy the
frontend. Do not use wildcards for the hostname allowlist. The included Docker
image installs `ffprobe`, which is used to enforce the five-minute duration
limit.

The FFmpeg core WASM is gzip-compressed during the Vite build and bundled as a
same-origin static asset to stay below Cloudflare Pages' per-file upload limit.
On first conversion, the browser downloads and decompresses this asset, then
runs it locally. Audio files are limited to 25 MB each to bound browser memory
use. No conversion API key is needed.

For local Vite UI development only, a failed `/api/auth/me` request falls back
to a mock `PreviewUser#0000` profile when the app is built in development mode
and served from `localhost`, `127.0.0.1`, or `::1`. Explicit `401` responses do
not use the mock. Pages Preview deployments remain protected by real Discord
authentication; the mock profile does not create a server-side session, so
authenticated API calls still require valid local session configuration.

Example browser integration:

```js
const response = await fetch("/api/assets/preview", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ assetIds: ["123456789"] }),
});
const { data, error } = await response.json();
if (!response.ok) throw new Error(error || "Asset preview lookup failed.");

for (const asset of data) {
  if (asset.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = asset.thumbnailUrl;
    image.alt = asset.name;
    document.body.append(image);
  }
}
```

## Local development and deploy

The frontend calls the relative `/api/catalog/details` path, so the API shares
the site origin and requires no separate public API URL or CORS configuration.
Run `npm run build`, then `npm run dev:pages` to test the built frontend and
Pages Function together at `http://localhost:8788`. Deploy both with
`npm run deploy`.

Run API validation and CSRF-handshake tests with `npm run test:api`.
The Worker allows the production Pages origin and the Vite localhost origin.

## Roblox OAuth login

The OAuth routes run as Cloudflare Pages Functions:

- `GET /api/auth/login` starts the Roblox authorization-code flow with PKCE,
  a single-use `state` cookie, and the `openid profile` scopes.
- `GET /api/auth/callback` validates state, exchanges the authorization code
  on the server, calls Roblox OpenID Connect `userinfo`, then renders an
  escaped profile summary. Access and refresh tokens are never returned to
  the browser or persisted.

Set these values as Cloudflare Pages environment variables/secrets for both
Preview and Production:

- `ROBLOX_CLIENT_ID`
- `ROBLOX_CLIENT_SECRET` (secret)
- `REDIRECT_URI=https://lex-studio.pages.dev/api/auth/callback`

For local development, copy `.dev.vars.example` to `.dev.vars`, replace the
placeholders with a **rotated** client secret, and register
`http://localhost:8788/api/auth/callback` as a development redirect URI.
`.dev.vars` and `.env` files are ignored by Git. Cloudflare Pages Functions
read values from `context.env`; Wrangler loads local bindings from `.dev.vars`.

Roblox's OpenID Connect discovery document is
`https://apis.roblox.com/oauth/.well-known/openid-configuration`. The flow
requests only `openid profile`. The `userinfo` endpoint returns profile claims,
not a list of the user's assets. This integration does not claim to fetch
asset records or expose tokens. If Roblox rejects the authorization code as
invalid or expired, or the access token is expired, the callback shows a
clear message asking the user to start login again.

Any client secret pasted into chat should be revoked/rotated in the Roblox
creator dashboard before deploying. Never put it in React, source control, or
a public `VITE_*` variable.

## Discord login button

The public landing page's Discord button navigates to
`GET /api/auth/discord/login`. This Cloudflare Pages Function reads
`DISCORD_CLIENT_ID` and `DISCORD_REDIRECT_URI` from server-side environment
variables, creates a random `state`, stores it in a five-minute HttpOnly cookie,
and redirects to Discord with the `identify` scope. Each transaction gets its
own `oauth_state_<state>` cookie so concurrent login tabs cannot overwrite one
another. The cookie uses `Path=/; HttpOnly; SameSite=Lax; Max-Age=300`, with
`Secure` enabled on HTTPS and omitted for local HTTP development.
If login starts on a Pages Preview hostname but the configured callback belongs
to Production, the login route first redirects to the configured callback
origin so the browser stores and returns the state cookie on the same host.

Register the exact callback URL in the Discord Developer Portal and configure
the matching server environment values:

- Local Pages development: `DISCORD_REDIRECT_URI=http://localhost:8788/api/auth/discord/callback`
- Production: `DISCORD_REDIRECT_URI=https://lex-studio.pages.dev/api/auth/discord/callback`

For local development, copy `.dev.vars.example` to `.dev.vars` and set
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_SESSION_SECRET` (at
least 32 characters), and the local redirect URI. Configure the same variables
in Cloudflare Pages for Preview and Production, using the production callback
URL for Production. Never put Discord credentials in `VITE_*` variables or
frontend code. The client ID is sent to Discord as part of the OAuth protocol;
the client secret and session signing secret must remain server-side.

`GET /api/auth/discord/callback` validates the returned UUID `state` against its
matching HttpOnly transaction cookie using a constant-time comparison, then
clears that cookie and exchanges the authorization code on the server. It
requests the Discord `/users/@me` profile and stores only the Discord user ID,
display name, username, avatar URL, and expiry in an HMAC-signed, HttpOnly
`lex_session` cookie; OAuth access and refresh tokens are not retained.
`GET /api/auth/me` verifies that signature and expiry before returning the
profile to the frontend, which fills the sidebar profile on page load. Avatar
URLs are restricted to Discord's CDN. The signed cookie is tamper-evident, not
encrypted, so it contains only non-sensitive identity claims. This is a
stateless browser session, not database-backed cross-device storage. The
callback redirects to `/#/spoof-asset`, which opens the Spoof Asset page after
successful login.

The frontend keeps the verified profile in an in-memory React context and
session-scoped browser cache so dashboard navigation does not wait for another
auth request. It checks `/api/auth/me` silently on app load and when the tab
returns to the foreground; a `401` clears the cached profile and returns the
user to the landing page. The cached profile is only a display optimization:
protected API routes must continue to validate the signed server-side session.

`POST /api/auth/logout` clears the `lex_session` session cookie, any legacy
`discord_session` cookie, and pending OAuth state cookies. The dashboard's
Logout button calls this endpoint and returns the browser to the landing page
after the cookies are cleared.

## Discord asset lookup notifications

Set `DISCORD_WEBHOOK_URL` as a Cloudflare Pages secret for both Preview and
Production. For local Pages development, add it to `.dev.vars` (copy
`.dev.vars.example` first). Do not put the webhook URL in frontend variables,
React code, or source control. If a webhook URL has been exposed, delete it and
create a replacement in Discord before configuring the new secret.

`POST /api/discord/send` accepts one JSON object containing `assetId`,
`assetName`, and `userName`, then sends a timestamped embed to the configured
webhook. It accepts requests only from the configured site/local development
origins, validates field types and lengths, disables Discord mentions, and
never returns or logs the webhook URL. The frontend sends a notification for
each successful public metadata lookup from **START SPOOF**. The current
dashboard profile name (`LEX`) is a demo value supplied by the browser, not a
verified Discord identity; do not treat it as authenticated user information.
Discord webhook rate limits and delivery errors are surfaced in the workspace
activity log.
