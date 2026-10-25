# California evacuation status

Active California evacuation zones, road closures and wildfire incidents in one dataset with one record shape. It reads public, no-login sources and can notify a webhook the moment a zone goes to warning or order.

## What you get

Each dataset item has the same fields.

| Field | Meaning |
| --- | --- |
| `source`, `sourceUrl` | Where the record came from |
| `kind` | `evacuation_zone`, `road_closure` or `incident` |
| `id`, `name`, `county` | Source id, readable name, county |
| `status` | `order`, `warning`, `advisory`, `lifted`, `closed`, `open` or `unknown` |
| `updatedAt` | When the source last edited the record (ISO 8601) |
| `stale` | Zones only. `true` when `updatedAt` is older than `staleAfterHours` |
| `geometry` | GeoJSON in WGS84: polygon for zones, line or point for closures, point for incidents |
| `properties` | Source details such as raw status, acres burned or lanes closed |

Example zone:

```json
{
  "source": "cal-oes",
  "kind": "evacuation_zone",
  "id": "US-CA-XTU-PVL-E044",
  "name": "US-CA-XTU-PVL-E044",
  "county": "Tulare",
  "status": "order",
  "updatedAt": "2023-09-20T22:33:08.000Z",
  "stale": true,
  "geometry": { "type": "Polygon", "coordinates": [[[-119.3, 36.2], "..."]] }
}
```

## Sources

| Input name | Source | Records |
| --- | --- | --- |
| `calOesZones` | Cal OES statewide active evacuation zones (ArcGIS feature service, aggregates county layers) | Orders and warnings |
| `calFireZones` | CAL FIRE statewide evacuation status (ArcGIS feature service, Genasys Protect schema) | Orders, warnings, advisories |
| `calFireIncidents` | CAL FIRE active incidents (`incidents.fire.ca.gov`) | Point per incident |
| `calFireWebIncidents` | The same CAL FIRE incident list from `www.fire.ca.gov`, read through Bright Data Web Unlocker | Point per incident, merged with `calFireIncidents` by `UniqueId` (kind `incident`, source `cal-fire-incidents-web`) |
| `caltransClosures` | Caltrans lane closure feeds (`cwwp2.dot.ca.gov`, districts 1 to 12) | Closures in effect now |

Zones that appear in both statewide layers are returned once. If one source is down, the run logs the error, skips it and returns the rest. The run fails only when every requested source fails.

County layers are only as fresh as the county that edits them. Counties sometimes leave old orders in the statewide layer, so check `stale` and `updatedAt` before you act on a zone. This data is for reference. Follow your county's official alerts for decisions.

## Input

- `sources`: which sources to read (default all)
- `counties`: for example `["Los Angeles"]` (default whole state)
- `boundingBox`: `{ west, south, east, north }` in degrees
- `closureDetail`: `full` for fully closed roads and ramps only, `all` to add lane closures (reported as `open`)
- `staleAfterHours`: default 72
- `brightDataApiKey` (secret), `brightDataZone`: optional, or env `BRIGHTDATA_API_KEY` and `BRIGHTDATA_ZONE`; see below
- `webhookUrl`, `closureWebhookUrl`, `webhookSecret`: see below
- `drill`, `drillPolygon`, `drillZoneName`: add one labelled practice zone

## Bright Data

`www.fire.ca.gov` answers plain requests to its incident list with `403 Access Denied` from Akamai bot protection (checked 2026-10-25 with curl). The `calFireWebIncidents` source reads that page through Bright Data Web Unlocker: a `POST https://api.brightdata.com/request` with `{ "zone", "url", "format": "raw" }` and `Authorization: Bearer <key>`. It only reads public pages, never anything behind a login.

- Set `brightDataApiKey` and `brightDataZone` (or the env vars). Without them the source is not run and the run summary says `skipped: needs Bright Data`. Nothing else changes.
- Only sources marked `unblock` use Bright Data. The other sources always go direct.
- The run summary reports `fetchedVia: { direct, brightData }` and `blockedBySource`, the count of direct requests refused with 403 or 429 or answered with a challenge page, per source. That shows exactly what Bright Data unlocked.

## Webhook

When `webhookUrl` is set, the Actor POSTs zones whose status is `warning` or `order` and that are new or changed since the last run. Stale zones are never sent. The Actor remembers what it sent in the named key-value store `california-evacuation-status-state`, so schedule it (for example every 5 minutes) and each zone is sent once per status change.

```http
POST <webhookUrl>
Authorization: Bearer <webhookSecret>
Content-Type: application/json

{ "zones": [ { "source", "sourceUrl", "kind": "evacuation_zone", "id", "name", "county",
               "status": "warning" | "order", "updatedAt", "geometry", "drill"? } ] }
```

A zone is marked as sent only after your endpoint answers 2xx. A failed post is retried on the next run. Posts are sent in batches of 25 zones.

## Road closure webhook

When `closureWebhookUrl` is set, the Actor POSTs full road closures to it: each one once when it starts, and once more when the source stops reporting it. Lane closures are never sent. It uses the same `webhookSecret` and batches of 25, and it remembers what it sent in the same key-value store, under its own key.

```http
POST <closureWebhookUrl>
Authorization: Bearer <webhookSecret>
Content-Type: application/json

{ "closures": [ { "source", "sourceUrl", "kind": "road_closure", "id", "name", "county",
                  "status": "closed", "updatedAt", "geometry" },
                { "source", "kind": "road_closure", "id", "status": "lifted" } ] }
```

A closure counts as lifted only when the feed it came from was read on this run. If a Caltrans district's feed fails, its closures stay closed until a later run reads that district again.

## Drill mode

Set `drill: true` and give `drillPolygon` (a ring of `[longitude, latitude]` pairs) to add one synthetic zone in `warning` status. It has `source: "drill"` and `drill: true` and is posted to the webhook like any zone, so receivers can tell it from real data. Real records are never changed. Leave it off outside exercises.

## Use with Rider Check

Rider Check is a voice agent that phones every paratransit rider inside a warning area. Its Convex backend exposes `POST /apify/zone-status` and checks the bearer token against `APIFY_WEBHOOK_SECRET`. When a posted zone covers loaded riders, it records the zone and starts the calls. Posting the same zone and status again does nothing. Its `POST /apify/road-closures` takes the closure webhook. It writes a closure only where it runs along a street on the agency's road graph, so dispatch routes around it, and it reopens the road when the closure is lifted.
