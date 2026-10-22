# API reference

Base path `/api`. JSON in, JSON out. An optional `x-session-id` header groups a
visitor's simulation events; the front end generates one per tab.

Errors are `{ "error": "message" }` with a meaningful status: 400 for a bad
graph or parameter, 404 for an unknown company, design or route.

## Metadata

### `GET /api/meta`

Everything the front end needs to render its pickers and palette: companies,
the 32 service types with their defaults, the timeline bounds and era years, the
failure scenarios and the attack types.

### `GET /api/companies`
### `GET /api/companies/:id/scale/:year`

The workload for a company in a year. This object is the `usage` every
simulation endpoint takes.

```json
{
  "companyId": "shopcart", "year": 2014,
  "requestsPerDay": 380000000, "monthlyRequests": 11400000000,
  "averageRps": 4398, "peakRps": 21990,
  "storageGb": 90000, "monthlyEgressGb": 2052000,
  "beforeFounding": false
}
```

## Architectures

### `GET /api/architectures/:companyId/:year`

The architecture for that company and year, with nodes, edges, the era
narrative, what changed since the previous era, and the security, availability
and cost scores.

### `GET /api/architectures/:companyId/timeline`

All seven era snapshots with headline scores. Drives the timeline strip.

### `GET /api/architectures/:companyId/:year/compare`

That year against the 2025 reference **at the same workload**, so the difference
measured is architecture rather than growth.

## Simulations

Every endpoint under `/api/simulate` accepts either form:

```jsonc
{ "companyId": "shopcart", "year": 2014 }              // load a stock architecture
{ "graph": { "nodes": [...], "edges": [...] },         // or supply your own
  "usage": { "peakRps": 20000, "averageRps": 4000,
             "monthlyRequests": 1e10, "monthlyEgressGb": 50000, "storageGb": 1000 } }
```

### `POST /api/simulate/traffic`

`rps` (default 1000), `rampSeconds` (20), `durationSeconds` (120).

Returns served and dropped rates, error rate, p99 latency, the bottleneck tier,
a per-tier breakdown with utilisation, a time series for charting, and advice.

```bash
curl -X POST localhost:8080/api/simulate/traffic \
  -H 'content-type: application/json' \
  -d '{"companyId":"shopcart","year":2005,"rps":50000}'
```

### `POST /api/simulate/failure`

`scenario`: `database-primary`, `availability-zone`, `compute-node`,
`cache-flush`, `load-balancer`.

Returns downtime, data loss, whether recovery is automatic, an incident
timeline, and the lessons that would change the outcome.

### `POST /api/simulate/ddos`

`attack`: `volumetric`, `http-flood`, `slow-loris`. Plus `attackRps`,
`legitimateRps`, `durationHours`.

Returns each defence layer with what it absorbed, what reached the origin, the
share of real users still served, and the bandwidth cost.

### `POST /api/simulate/storage`

`months` (36), `monthlyGrowthPercent` (8), `startGb`.

Returns the monthly series priced three ways, the recommended tier split, and
lifetime totals.

### `POST /api/simulate/cost`
### `POST /api/simulate/cost/optimise`

The first returns the estimate with per-item line items and category totals. The
second adds recommendations ranked by monthly saving, each with its
Well-Architected pillar and effort level.

### `POST /api/simulate/scores`

Security and availability scores plus the cost estimate, in one call.

### `POST /api/simulate/compare`

`{ left, right, usage }` — two graphs under one workload, with deltas and a
plain-language narrative.

### `POST /api/simulate/full-report`

Every simulation in one response. Heavy; this is the endpoint that hands a
message to SQS when a queue is configured.

## Builder

### `GET /api/builder/starter`

A minimal four-node graph to start from.

### `POST /api/builder/review`

`{ graph, companyId, year }`. Returns an overall score and grade, structural
findings by severity, a best-practice checklist, the four sub-scores, the full
security and availability reports, the cost estimate, a peak-load simulation,
and prioritised next steps.

### `POST /api/builder/benchmark`

The same, plus a side-by-side comparison against the 2025 reference for that
company.

### `POST /api/builder/designs`
### `GET /api/builder/designs`
### `GET /api/builder/designs/:id`

Save, list and read architectures. With AWS configured, metadata goes to
DynamoDB and the graph to S3; without it, to an in-process Map.

## Operational

### `GET /healthz`

The load balancer's health check. Cheap, no dependencies.

### `GET /readyz`

Region, environment, version, and which AWS integrations are live.

### `GET /events`

The recent simulation events for your session id.

## Limits

At most 60 nodes per graph (`MAX_NODES`) and 5,000,000 simulated rps
(`MAX_SIMULATED_RPS`). Request bodies are capped at 1 MB.
