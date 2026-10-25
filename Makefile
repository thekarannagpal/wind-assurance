DATA_DIR := backend/data
VENV := .venv
PY := $(VENV)/bin/python

.PHONY: setup ingest backend frontend test docker-build compose-up compose-down lint

setup:
	python3 -m venv $(VENV) && $(VENV)/bin/pip install -q -r backend/requirements.txt pytest
	cd frontend && npm install

ingest:
	DATA_DIR=$(abspath $(DATA_DIR)) $(PY) -c "import sys;sys.path.insert(0,'backend');from app.ingest import run_ingestion;run_ingestion()"

backend:
	DATA_DIR=$(abspath $(DATA_DIR)) INGEST_ON_START=0 $(VENV)/bin/uvicorn app.main:app --port 8719

frontend:
	cd frontend && npm run dev

test:
	$(PY) -m pytest backend/tests -q

docker-build:
	docker build -t wind-assurance .

compose-up:
	docker compose up --build

compose-down:
	docker compose down

lint:
	$(VENV)/bin/pip install -q ruff && $(VENV)/bin/ruff check backend
	cd frontend && npx tsc -b --force
