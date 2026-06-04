# collect-ingest-observe

[![CI](https://github.com/ianaya89/collect-ingest-observe/actions/workflows/ci.yml/badge.svg)](https://github.com/ianaya89/collect-ingest-observe/actions/workflows/ci.yml)

A hands-on OpenTelemetry observability demo: instrument microservices, ship signals through a collector, store in ClickHouse, visualize in Grafana.

The pipeline follows three stages:

- **Collect** — Node.js microservices emit traces, logs, and metrics via OpenTelemetry auto-instrumentation.
- **Ingest** — An OpenTelemetry Collector receives OTLP signals and exports them to ClickHouse.
- **Observe** — Grafana queries ClickHouse to visualize the telemetry.

A companion talk is included as [`slides.pdf`](./slides.pdf).

---

## Architecture

```
  Load (Makefile/curl)
          │
          ▼
    ┌─────────────┐        ┌─────────────┐
    │   gateway   │───────▶│    users    │──┐
    │  :9999      │        │    :9998    │  │
    │             │───┐    └─────────────┘  │
    └─────────────┘   │    ┌─────────────┐  ├──▶ Postgres :5432
                      └───▶│   orders   │  │
                            │    :9997    │──┘
                            └─────────────┘
          │                       │                  │
          └───────────────────────┴──────────────────┘
                                  │
                             OTLP (traces/logs/metrics)
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │   OTel Collector    │
                       │  :4317 (gRPC OTLP)  │
                       │  :4318 (HTTP OTLP)  │
                       └──────────┬──────────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │  ClickHouse  │
                          │  :9000/:8123 │
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │   Grafana    │
                          │    :3000     │
                          └──────────────┘
```

### Components

| Component  | Image / Runtime                              | Port(s)          | Role                         |
|------------|----------------------------------------------|------------------|------------------------------|
| gateway    | Node.js                                      | 9999             | Public API entrypoint        |
| users      | Node.js                                      | 9998             | User data service            |
| orders     | Node.js                                      | 9997             | Order data service           |
| postgres   | postgres                                     | 5432             | Application data store       |
| otelcol    | otel/opentelemetry-collector-contrib:0.74.0  | 4317, 4318, 8888 | Receives and exports signals |
| clickhouse | clickhouse/clickhouse-server:24.8            | 9000, 8123       | Telemetry storage            |
| grafana    | grafana/grafana:9.4.3                        | 3000             | Dashboards                   |

---

## Prerequisites

- **Node.js** (v18+)
- **Docker** and **Docker Compose**
- **make** (for load generation)

---

## Quick Start (everything in containers)

One command builds the service images and starts the whole pipeline — Postgres, the seeder (runs once), the three microservices, the OTel Collector, ClickHouse, and Grafana — wired together with health-gated startup ordering:

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

Then generate load and open Grafana:

```bash
make run          # random traffic against the gateway (make stop to halt)
open http://localhost:3000   # Grafana, admin / admin
```

Tear down with `docker compose -f infra/docker-compose.yml down` (add `-v` to drop the ClickHouse/Postgres volumes).

---

## Local Development (services on the host)

Run the infrastructure in containers but the Node services on your machine — faster iteration and live logs.

### 1. Install dependencies

```bash
npm install
```

All service dependencies resolve from the root `node_modules`.

### 2. Set up environment files

```bash
cp .env.example .env
cp src/gateway/.env.example src/gateway/.env
cp src/users/.env.example src/users/.env
cp src/orders/.env.example src/orders/.env
```

`.env` files are git-ignored — only the `.env.example` templates are committed.

### 3. Start infrastructure only

```bash
docker compose -f infra/docker-compose.yml up -d clickhouse otelcol grafana postgres
```

### 4. Seed the database

```bash
npm run seed
```

Creates `users` and `orders` tables in Postgres and populates them with 10 users and 20 orders.

### 5. Start the services

Start all three in the background with a single command (logs land in `.logs/<service>.log`):

```bash
make services
```

Stop them with `make services-stop`.

<details>
<summary>Prefer separate terminals?</summary>

```bash
cd src/gateway && npm start   # terminal 1
cd src/users && npm start     # terminal 2
cd src/orders && npm start    # terminal 3
```
</details>

### 6. Generate load

```bash
make run
```

Fires random requests against gateway endpoints every 0.1 seconds in the background. To adjust the interval:

```bash
make run INTERVAL=0.5
```

Stop load generation:

```bash
make stop
```

### 7. Open Grafana

Navigate to [http://localhost:3000](http://localhost:3000).

Default credentials: `admin` / `admin`.

Two dashboards are pre-provisioned:

- **Traces** — span counts, p99 latency, error rates, a trace list, and a span/trace detail view, plus correlated logs.
- **OTel Metrics — Gateway** — the custom `gateway_request_count` counter (cumulative timeseries + total).

---

## Smoke Test

With the full containerized stack running, verify the pipeline end to end — routes respond and traces + the gateway metric reach ClickHouse:

```bash
./scripts/smoke-test.sh
```

This is the same check the CI `integration` job runs against a freshly built stack.

---

## Gateway Endpoints

| Method | Path                    | Description                                           |
|--------|-------------------------|-------------------------------------------------------|
| GET    | `/`                     | Returns `service vX.Y.Z`                              |
| GET    | `/users`                | Proxies to users service, returns all users           |
| GET    | `/orders`               | Proxies to orders service, returns all orders         |
| GET    | `/users/:userId/orders` | Returns orders for a specific user                    |
| GET    | `/error`                | Logs an error and returns HTTP 500 (useful for demos) |

---

## How Instrumentation Works

Each service starts with a `--require` flag that preloads the OTel SDK before any application code runs:

```bash
node --require ../../lib/otel.js app.js
```

This ensures the SDK patches Node.js modules (Express, pg, axios) before they are imported — the critical detail that makes zero-code auto-instrumentation work. `lib/otel.js` bootstraps `@opentelemetry/sdk-node` with `getNodeAutoInstrumentations()` and configures OTLP HTTP exporters for traces, logs, and metrics pointing at the collector.

The gateway adds two custom observability signals on top of auto-instrumentation:

- **Custom metric** — a counter named `gateway_request_count` incremented on each request.
- **Custom span attribute** — `user=root` set on the active span.

Winston logs are correlated into OTel traces automatically via Winston instrumentation, so log records carry the active `trace_id` and `span_id`.

---

## Project Layout

```
collect-ingest-observe/
├── src/
│   ├── gateway/             # Express gateway service (port 9999)
│   ├── users/               # Express users service (port 9998)
│   └── orders/              # Express orders service (port 9997)
├── lib/
│   ├── otel.js              # OTel SDK bootstrap (--require preload)
│   ├── db.js                # Postgres pool
│   └── logger.js            # Winston logger factory
├── infra/
│   ├── docker-compose.yml      # Full stack: services + infra
│   ├── clickhouse-users.xml    # Opens the default CH user to the container network
│   ├── otel/
│   │   └── otelcol-config.yml  # Collector: receivers, processors, exporters
│   └── grafana/                # Provisioned datasource + dashboards (traces, metrics)
├── seed/
│   └── index.js             # DB seeder (faker-generated users + orders)
├── scripts/
│   └── smoke-test.sh        # End-to-end pipeline assertion (used by CI)
├── Dockerfile               # Shared image for the three services + seeder
├── Makefile                 # Load generation + host service runner
├── slides.pdf               # Accompanying talk slides
└── .env.example             # Environment template (copy to .env)
```

---

## Configuration

| Variable             | Default                     | Description                         |
|----------------------|-----------------------------|-------------------------------------|
| `OTEL_COLLECTOR_URL` | `http://localhost:4318/v1`  | OTLP HTTP exporter base URL         |
| `OTEL_SERVICE_NAME`  | Set per service at start    | Service name reported in telemetry  |
| `POSTGRES_HOST`      | `localhost`                 | Postgres host (`postgres` in containers) |
| `POSTGRES_USER`      | `postgres`                  | Postgres username                   |
| `POSTGRES_PASSWORD`  | `postgres`                  | Postgres password                   |
| `POSTGRES_DB`        | `postgres`                  | Postgres database name              |
| `POSTGRES_PORT`      | `5432`                      | Postgres port                       |
| `PORT`               | Set per service `.env`      | HTTP port for each microservice     |
| `USERS_URL`          | `http://localhost:9998/`    | Gateway → users service URL         |
| `ORDERS_URL`         | `http://localhost:9997/`    | Gateway → orders service URL        |

Root `.env` holds Postgres credentials shared by all services and the seed script. Each service directory also contains its own `.env` for `PORT` (and, for the gateway, the downstream service URLs). All `.env` files are git-ignored; commit only the `.env.example` templates.

---

## Slides

`slides.pdf` contains the accompanying talk that walks through the Collect → Ingest → Observe pipeline in detail.
