# Wind Assurance Portal

A web app for a GB electricity supplier's day-ahead trading team. It answers two questions
from **one approved data source** (Elexon BMRS, national wind power, January 2026):

1. **What did we know, when?** — browse the wind-generation forecasts that were actually
   available at the moment we had to buy in the day-ahead market (default: the last
   forecast runs published by **09:30 on D-1**, the GB day-ahead auction gate closure),
   including "what later revisions would have said".
2. **How much can we trust those forecasts?** — quantified accuracy: MAE / RMSE / bias /
   WAPE by forecast lead time, by half-hour of day, scatter against actuals, an empirical
   error distribution, a persistence benchmark, and P10/P90 error bands that can be drawn
   around any day-ahead forecast.

Stack: **React** (Vite + TypeScript + Tailwind + Recharts) for the front end,
**Python** (FastAPI + SQLite + HTTPX) for the back end, served as **one Docker image**
(spa + API) for Heroku/any container host. Criteria:

- No API key needed; the backend pulls from `https://data.elexon.co.uk/bmrs/api/v1`
  (BMRS Insights API), caches into SQLite, and serves analysis from that local store.
- All timestamps are UTC. GB stays on GMT in January, so UTC day == delivery/settlement day.
- Scope restriction is honoured: **only** `FUELHH` (actuals, fuelType = WIND) and
  `WINDFOR` (forecasts) — nothing else.

---

## Repository layout

```
├── backend/
│   ├── app/
│   │   ├── main.py        # FastAPI app: /api routers, CORS, static SPA serving, startup ingest
│   │   ├── config.py      # env-driven settings + data-window constants (Jan 2026 scope)
│   │   ├── routes.py      # HTTP API endpoints (health, data-status, summary, day, accuracy)
│   │   ├── service.py     # query/orchestration layer (day bundles, month summary, bands)
│   │   ├── analysis.py    # as-of forecast reconstruction, metrics, quantiles, procurement framing
│   │   ├── ingest.py      # SQLite schema + initial Elexon ingestion (idempotent)
│   │   └── elexon.py      # resilient BMRS client (chunked windows, retries/backoff)
│   ├── tests/
│   │   ├── test_analysis.py   # pure-logic tests (metrics, interpolation, procurement)
│   │   └── test_api.py        # end-to-end API tests over a deterministic fake Elexon source
│   ├── requirements.txt
│   └── data/          # ingested SQLite store lives here (git-ignored)
├── frontend/
│   ├── src/
│   │   ├── pages/Overview.tsx     # month KPIs, daily planned-vs-achieved, gap panels
│   │   ├── pages/DayView.tsx      # decision view: as-of slider, forecast vs actual, bands
│   │   ├── pages/Accuracy.tsx     # accuracy explorer: scatter, histogram, lead buckets
│   │   ├── components/            # Nav + shared UI atoms
│   │   └── lib/api.ts             # typed API client
│   ├── index.html / vite.config.ts / ... (Vite + React + TS build)
├── Dockerfile           # multi-stage: build SPA -> single python image serving both
├── docker-compose.yml   # one web service with a persistent volume for the SQLite store
├── heroku.yml           # Heroku container deployment (build from Dockerfile, run uvicorn on $PORT)
└── Makefile             # one-command dev/test/docker workflows
```

## Run the app

### Production-style (Docker, recommended)

```bash
docker compose up --build
# -> open http://localhost:8719
```

The image includes the built React bundle. On first start the backend notices an empty
store and ingests ~20k rows from Elexon BMRS (≈10 s, logged) into `/app-data`
(volume `app-data`), then serves everything.

Single image, no compose (mount a data dir for persistence):

```bash
docker build -t wind-assurance .
docker run --rm -p 8719:8000 -v $(pwd)/backend/data:/data wind-assurance
```

### Local development

```bash
make setup        # python venv + npm install

make ingest       # fetch actuals + forecasts into backend/data/bmrs.sqlite3 once
make backend      # FastAPI on http://localhost:8719 (or :8000 style uvicorn command)
make frontend     # Vite dev server on http://localhost:5173 (proxies /api -> :8719)

make test         # backend pytest suite (8 tests, runs against a fake Elexon API)
make lint         # ruff (python) + tsc (frontend)
```

Environment variables (all optional): `DATA_DIR`, `INGEST_ON_START`, `ELEXON_BASE_URL`,
`CORS_ORIGINS`.

## HTTP API (JSON)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | liveness probe |
| `GET /api/data-status` | row counts, publish window, ingestion timestamp |
| `GET /api/summary?lead_hours=14.5` | month KPIs, per-day planned vs achieved, lead-time curve |
| `GET /api/days` | per-day pointers for the day-picker |
| `GET /api/day/{YYYY-MM-DD}?lead_hours=14.5` | decision view for one delivery day (as-of reconstruction) |
| `GET /api/accuracy?lead_hours=14.5` | accuracy-explorer feed (scatter, bands, worst slots) |

`lead_hours` is the decision cut-off expressed as hours before delivery-day start
(14.5 h ≙ 09:30 on D-1). The UI exposes it as a slider; the API takes any value in [0, 96].

## Deployment

The app is deployed to **Heroku** (container stack via `heroku.yml`):

**Live app: <add your herokuapp.com URL here>** — see the How-to-deploy section below if
you are re-deploying.

```bash
heroku create <random-anonymous-name>
heroku stack:set container
git push heroku main            # heroku.yml builds the Docker image and runs it on $PORT
```

The SQLite store is ephemeral on Heroku; the app re-ingests on boot (it only depends on
the public BMRS API), which keeps the deployment stateless.

## Data & analysis notes

- **Actuals** — `/datasets/FUELHH/stream`, `fuelType=WIND`, half-hourly MW
  (`startTime`, `generation`), settlement days 2025-12-31…2026-01-31 (the extra December
  day powers the persistence benchmark for 1 Jan).
- **Forecasts** — `/datasets/WINDFOR/stream` filtered by `publishDateTime` ∈
  2025-12-30…2026-02-02: every published run (~8/day) with its `startTime → generation`
  curve and `publishTime`; ~19,900 rows ingested.
- **As-of reconstruction** — for a delivery day the "decision forecast" merges all runs
  published up to the cut-off (latest run wins per hour) and interpolates hourly forecast
  points linearly onto the 30-minute delivery slots (actuals are 30-min, WINDFOR hourly).
- **Metrics** — MAE, RMSE, bias (mean signed error), WAPE (Σ|e|/Σ|actual|), MAPE with a
  500 MW floor on the denominator, plus **skill vs persistence** (same half-hour actual
  from the previous day) and **empirical P10/P50/P90 of (forecast − actual)** bucketed by
  lead time (intraday <12 h / day-ahead 12–36 h / two-day 36–60 h / beyond).
- **Procurement framing** — planned wind energy (forecast × 0.5 h) vs achieved, the
  *shortfall* (Σ max(0, forecast − actual), i.e. extra unplanned purchases) and the
  *untracked surplus* (Σ max(0, actual − forecast)).
- On first non-cached load the store is empty and the backend triggers ingestion in a
  background thread; the SPA shows loading states until the data lands (~10 s).

### Headline the pilot found (January 2026, decision point = gate closure)

- 9,984 GWh of wind was planned day-ahead vs **8,616 GWh achieved**; the
  day-ahead forecast overpromised by ~3 % of the month's energy needs.
- Forecasts carried a persistent **optimistic bias of ≈ +1.8 GW** (27 of 31 days delivered
  less wind than forecast) with a WAPE ≈ 18 % at the day-ahead decision point.
- Forecasts still add ~**47 % error reduction vs naive persistence** — valuable, but the
  bias must be neutralised when sizing thermal/short-term hedges.
- Accuracy improves sharply by delivery morning: latest-run forecasts track actuals well,
  so the portal lets planners compare "what we knew at 09:30 D-1" with the final revision
  to see how much of the gap is decision-time knowledge vs later information.

## How-to-deploy (Heroku, from scratch)

```bash
git init && git add . && git commit -m "wind assurance portal"
heroku login
heroku create <anom-name> --stack container
heroku git:remote -a <anom-name>
git push heroku main
heroku open
```

## Development honesty: AI tools

This application was built with the assistance of AI coding tools (Claude/opencode):
scaffolding, backend implementation, front-end implementation, tests and this README.
All analysis logic, data handling decisions and product framing were validated against
raw Elexon API responses; the repo includes a deterministic fake source in the test suite
for reproducible CI.

---

*Contains BMRS data © Elexon Limited copyright and database right.*
