# How it is put together

## One data structure

Everything in this project runs on one shape:

```js
{
  nodes: [{ id: 'app', type: 'autoScalingGroup', props: { instanceType: 'm5.large', max: 20 } }],
  edges: [{ from: 'lb', to: 'app' }],
}
```

A 2005 era architecture, the 2025 reference, and something a user dragged
together on a canvas are all this. That is the decision the rest of the design
follows from: there is no separate code path for "real" architectures and user
ones, so a user design is judged by identical rules, and a new simulator written
against the graph works on all of them at once.

## The catalog is the source of truth

`backend/src/data/catalog.js` declares 32 service types. Each one says:

| Field | Used by |
| --- | --- |
| `role` | Topology checks and request-path ordering |
| `capacityRps` / `capacityFor(props)` | Traffic simulator |
| `security` / `securityFor(props)` | Security scorer |
| `availability` / `availabilityFor(props)` | Availability scorer, failure simulator |
| `cost(props, usage)` | Cost estimator |
| `offloadRatio`, `absorbsDdosRatio`, `bufferingQueue`, `elastic`, `legacy` | Individual engines |

The `*For(props)` variants are what make configuration meaningful. `rds` with
`multiAz: true` reports two AZs, managed failover and a two-minute recovery;
with `multiAz: false` it reports one AZ and sixty minutes. The failure simulator
does not know what Multi-AZ is — it reads those numbers. So turning the checkbox
on in the builder changes the incident timeline, the availability score, the
annual downtime estimate and the cost, all from one declaration.

Adding a service means adding one catalog entry. Every engine, the palette, the
canvas and the scoring pick it up with no further changes.

## Eras are templates, not fixtures

Six companies × seven eras would be 42 hand-written architectures that drift out
of sync. Instead there are seven era templates, each a function of the company's
workload for the chosen year:

```
scaleFor(companyId, year) -> { requestsPerDay, averageRps, peakRps, storageGb, monthlyEgressGb }
eraForYear(year)          -> the latest era at or before that year
era.build(scale)          -> nodes, edges, and what changed since the last era
```

Company growth is interpolated **geometrically** between anchor points, because
traffic grows by multiples rather than by increments; linear interpolation
between 2 million and 6 billion requests a day produces numbers that are wrong
everywhere in between. The templates then size the fleet and the database class
from that workload, so ShopCart's 2014 architecture is the 2014 pattern at
ShopCart's 2014 scale.

## The engines

### Traffic (`engines/traffic.js`)

Walks the request path — dns, edge, loadBalancer, compute, cache, database,
storage — and at each tier:

1. Sums the capacity of the nodes in it.
2. If offered load exceeds capacity: a tier with a buffering queue converts the
   overflow into queue wait; anything else drops it.
3. Adds latency as `base / (1 - utilisation)`, which is why a tier at 90% is
   already slow and one at 99% is unusable. A linear model would make saturation
   look survivable.
4. Reduces what continues by that tier's offload ratio, so a CDN at an 85% cache
   hit ratio passes 15% to the origin.

The timeline series models elastic tiers starting at about a third of their
ceiling and warming up — three minutes for EC2, five seconds for Lambda. That
warm-up is why a traffic spike causes errors even when the ASG maximum is high
enough, and the chart shows it.

### Failure (`engines/failure.js`)

Five scenarios. Each reads the catalog's availability facts rather than
hard-coding an outcome, and returns downtime, data loss, whether recovery is
automatic, a second-by-second incident timeline, and what would have changed the
result. The AZ scenario works out which tiers exist in only one AZ, and a tier
with `azSpread < 2` and no redundant sibling is a single point of failure.

### DDoS (`engines/ddos.js`)

Attack volume passes through each defence in turn and the remainder competes with
real users for origin capacity, which is what produces the interesting result:
legitimate availability falls proportionally rather than cliff-edging. Each
defence's effectiveness depends on the attack — WAF stops 90% of an HTTP flood
and 30% of a volumetric one; CloudFront's contribution against an HTTP flood is
its cache hit ratio, because a cached response never reaches the origin.

### Storage (`engines/storage.js`)

Projects volume forward and prices three policies: all Standard, as currently
configured, and recommended tiering. The share of data older than a cutoff is
derived from elapsed time and the growth rate — in a fast-growing dataset, old
data is a small fraction of the total, which is exactly why tiering saves less
than people expect early on and a great deal later.

### Cost (`engines/cost.js`)

Per-node estimates summed from `data/pricing.js`, with CDN cache hits removed
from origin egress first. Every item carries its own line-item breakdown, and a
test asserts that line items sum to item totals and item totals sum to the
monthly figure, so the displayed arithmetic is checked rather than trusted.

The optimiser proposes only changes that apply to the given graph, each with the
saving it makes at this workload, and a test asserts no recommendation ever
claims a negative saving.

### Scoring (`engines/scoring.js`)

Security is eleven weighted controls (102 points) minus five penalties for
active misconfigurations, clamped to 0-100. It reports which controls are
missing and how to fix each one, because "67" alone teaches nothing.

Availability multiplies tier uptimes in series and treats nodes within a tier as
parallel, then subtracts for single points of failure and a slow recovery time.
Composite uptime alone would rate a single-AZ design at 99.4% and sound fine; the
penalties are what reflect that its bad day is four hours long.

## Front end

React with React Flow for the canvas. Nodes are laid out in columns by service
role rather than by a layout engine, so the diagram always reads left to right as
a request does, and two architectures from different eras are visually
comparable.

One custom node type renders every state — normal, legacy, saturated, failed,
newly added — driven by `data.state` that the panels set after a simulation. The
canvas refits only when the *set* of nodes changes, so running a simulation does
not jerk a viewport the user has panned.

`useAsync` discards results from superseded calls. Without that, dragging the
year slider quickly leaves whichever request finished last on screen rather than
the year now selected.

## Deployed shape

```
Route 53 → CloudFront (+ WAF, Shield Standard) ──→ S3 web bucket (private, OAC)
                                              └──→ ALB → Auto Scaling Group (EC2, 3 AZ)
                                                              ├── ElastiCache
                                                              ├── RDS (Multi-AZ)
                                                              ├── DynamoDB
                                                              ├── S3 assets → Glacier
                                                              └── SQS → Lambda → Step Functions → SNS
CloudWatch, KMS, IAM, Secrets Manager, Budgets span all of it.
```

Five CloudFormation stacks, deployed in order, each importing the previous one's
exports: `00-network`, `10-data`, `20-app`, `30-edge`, `40-ops`. They are split
along change frequency, not neatness — the network almost never changes, the
application changes on every deployment, and a single stack would make a routine
deployment touch the VPC.

The application is deliberately the same architecture it teaches: elastic
compute behind a CDN and load balancer, managed data stores, queue-decoupled
work, encryption everywhere, and a budget.

## Running without AWS

Every integration checks for its environment variable and falls back: DynamoDB
events to a bounded in-memory ring, the design store to a Map, SNS and SQS to log
lines, CloudWatch metrics to nothing. `/readyz` reports which are live. This is
not only convenience — the fallbacks mean the test suite exercises the real route
handlers without mocking the AWS SDK.

## What is deliberately approximate

Pricing is us-east-1 list price as of August 2025, with no enterprise discount.
Average response size is assumed at 180 KB. Capacity figures per instance type
are reasonable for an interpreted web application and would be wrong by a factor
for a compiled one. Company growth curves are plausible shapes, not published
metrics.

The trade-off shapes are robust: Multi-AZ really does turn hours into minutes, a
CDN really does remove most origin load, lifecycle tiering really is an order of
magnitude on cold data. The third significant figure is not the point.
