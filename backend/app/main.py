"""FastAPI application entry point.

Serves the API under /api and the built React frontend (when present) for
single-container deployments (Docker/Heroku).
"""
from __future__ import annotations

import logging
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from .config import BASE_DIR, CORS_ORIGINS, INGEST_ON_START
from .ingest import connect, is_populated, run_ingestion
from .routes import router

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("app")

app = FastAPI(
    title="Wind Assurance Portal",
    description=(
        "Day-ahead wind generation forecast exploration and accuracy analytics "
        "for GB purchase decisions (January 2026, Elexon BMRS data)."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(router)


@app.on_event("startup")
def startup() -> None:
    if INGEST_ON_START and not _data_ready():
        log.info("no populated local store found; ingesting Elexon data on startup...")
        threading.Thread(target=_ingest_with_logs, daemon=True).start()


def _data_ready() -> bool:
    con = connect()
    try:
        return is_populated(con)
    except Exception:  # noqa: BLE001 - probe may fail if the DB is mid-migration
        return False
    finally:
        con.close()


def _ingest_with_logs() -> None:
    try:
        run_ingestion()
    except Exception:
        log.exception("ingestion failed — API will serve errors until data is available")
        # expose failure through /api/data-status rather than crashing the app


# ------------------------------- static frontend -------------------------------
_STATIC = BASE_DIR / "static"

if (_STATIC / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=_STATIC / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    candidate = _STATIC / full_path
    if full_path and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(_STATIC / "index.html")
