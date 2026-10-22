/**
 * Company scale profiles.
 *
 * `points` are anchor measurements (requests/day and stored GB) for a given
 * year; anything in between is interpolated geometrically, which is how traffic
 * actually grows. Figures are illustrative orders of magnitude chosen to make
 * the simulators interesting, not published metrics.
 */

export const COMPANIES = [
  {
    id: 'streamflix',
    name: 'Streamflix',
    industry: 'Video streaming',
    foundedYear: 1998,
    blurb: 'DVD-by-post catalogue that became a global streaming service.',
    accent: '#e50914',
    story: {
      2005: 'A rented cage, one Oracle box, and a queue of DVD orders.',
      2011: 'Streaming overtakes discs; the single database becomes the bottleneck.',
      2017: 'Everything is a microservice behind a CDN; chaos testing is routine.',
      2025: 'Edge-first delivery with per-title encoding pipelines.',
    },
    points: [
      { year: 2005, requestsPerDay: 1_200_000, storageGb: 900 },
      { year: 2008, requestsPerDay: 9_000_000, storageGb: 6_000 },
      { year: 2011, requestsPerDay: 70_000_000, storageGb: 60_000 },
      { year: 2014, requestsPerDay: 420_000_000, storageGb: 400_000 },
      { year: 2017, requestsPerDay: 1_600_000_000, storageGb: 1_800_000 },
      { year: 2020, requestsPerDay: 4_200_000_000, storageGb: 5_000_000 },
      { year: 2025, requestsPerDay: 9_000_000_000, storageGb: 12_000_000 },
    ],
    peakMultiplier: 2.6,
  },
  {
    id: 'shopcart',
    name: 'ShopCart',
    industry: 'E-commerce',
    foundedYear: 2001,
    blurb: 'Marketplace whose year is decided by four days in November.',
    accent: '#ff9900',
    story: {
      2005: 'LAMP stack on two servers; the sale day is survived by luck.',
      2011: 'Load balancer plus read replicas; carts still live in session files.',
      2017: 'Queues absorb checkout spikes and inventory is event-driven.',
      2025: 'Auto scaling across three AZs with per-service budgets.',
    },
    points: [
      { year: 2005, requestsPerDay: 2_000_000, storageGb: 400 },
      { year: 2008, requestsPerDay: 14_000_000, storageGb: 2_500 },
      { year: 2011, requestsPerDay: 90_000_000, storageGb: 18_000 },
      { year: 2014, requestsPerDay: 380_000_000, storageGb: 90_000 },
      { year: 2017, requestsPerDay: 1_100_000_000, storageGb: 320_000 },
      { year: 2020, requestsPerDay: 2_600_000_000, storageGb: 900_000 },
      { year: 2025, requestsPerDay: 6_000_000_000, storageGb: 2_400_000 },
    ],
    peakMultiplier: 5, // Black Friday against a yearly average
  },
  {
    id: 'ridehail',
    name: 'RideHail',
    industry: 'Mobility',
    foundedYear: 2009,
    blurb: 'Real-time dispatch where a 2-second delay loses the ride.',
    accent: '#19c37d',
    story: {
      2011: 'One region, one Postgres, drivers polling every five seconds.',
      2014: 'Geo-sharded dispatch; websockets replace polling.',
      2020: 'Streaming location pipeline with DynamoDB and Step Functions.',
      2025: 'Multi-AZ everything with surge pricing computed at the edge.',
    },
    points: [
      { year: 2011, requestsPerDay: 3_000_000, storageGb: 200 },
      { year: 2014, requestsPerDay: 90_000_000, storageGb: 9_000 },
      { year: 2017, requestsPerDay: 700_000_000, storageGb: 120_000 },
      { year: 2020, requestsPerDay: 1_800_000_000, storageGb: 500_000 },
      { year: 2025, requestsPerDay: 5_200_000_000, storageGb: 1_900_000 },
    ],
    peakMultiplier: 4,
  },
  {
    id: 'socialgram',
    name: 'Socialgram',
    industry: 'Social media',
    foundedYear: 2006,
    blurb: 'Photo feed that doubled its users every quarter for three years.',
    accent: '#8b5cf6',
    story: {
      2008: 'A single rack, hot-linked images, and a growth curve nobody planned for.',
      2014: 'Images move to S3 behind a CDN; the feed is denormalised.',
      2020: 'Fan-out on write through queues; media archived to Glacier.',
      2025: 'Serverless ingest with per-user encryption keys.',
    },
    points: [
      { year: 2006, requestsPerDay: 300_000, storageGb: 50 },
      { year: 2008, requestsPerDay: 6_000_000, storageGb: 1_200 },
      { year: 2011, requestsPerDay: 120_000_000, storageGb: 40_000 },
      { year: 2014, requestsPerDay: 900_000_000, storageGb: 450_000 },
      { year: 2017, requestsPerDay: 3_400_000_000, storageGb: 2_200_000 },
      { year: 2020, requestsPerDay: 7_000_000_000, storageGb: 6_500_000 },
      { year: 2025, requestsPerDay: 14_000_000_000, storageGb: 18_000_000 },
    ],
    peakMultiplier: 3.2,
  },
  {
    id: 'fintrust',
    name: 'FinTrust Bank',
    industry: 'Banking',
    foundedYear: 1974,
    blurb: 'Regulated core banking that cannot lose a single transaction.',
    accent: '#2563eb',
    story: {
      2005: 'Mainframe of record, nightly batch, a web front end bolted on.',
      2014: 'Mobile banking in a VPC; the core stays on premises.',
      2020: 'Encryption keys under KMS, every API call audited.',
      2025: 'Multi-AZ RDS for the ledger mirror, Step Functions for settlement.',
    },
    points: [
      { year: 2005, requestsPerDay: 800_000, storageGb: 2_000 },
      { year: 2011, requestsPerDay: 8_000_000, storageGb: 20_000 },
      { year: 2014, requestsPerDay: 40_000_000, storageGb: 70_000 },
      { year: 2020, requestsPerDay: 300_000_000, storageGb: 400_000 },
      { year: 2025, requestsPerDay: 900_000_000, storageGb: 1_200_000 },
    ],
    peakMultiplier: 3,
    compliance: ['PCI-DSS', 'SOX', 'GDPR'],
  },
  {
    id: 'edulearn',
    name: 'EduLearn',
    industry: 'Online education',
    foundedYear: 2012,
    blurb: 'Course platform whose load is a sawtooth around exam weeks.',
    accent: '#0ea5e9',
    story: {
      2014: 'A Django monolith on two instances behind a classic ELB.',
      2017: 'Video to S3 and CloudFront; quizzes still hammer the database.',
      2020: 'The pandemic multiplies traffic by twelve in a fortnight.',
      2025: 'Auto scaling with scheduled capacity for exam windows.',
    },
    points: [
      { year: 2012, requestsPerDay: 150_000, storageGb: 80 },
      { year: 2014, requestsPerDay: 2_000_000, storageGb: 1_500 },
      { year: 2017, requestsPerDay: 24_000_000, storageGb: 25_000 },
      { year: 2020, requestsPerDay: 300_000_000, storageGb: 280_000 },
      { year: 2025, requestsPerDay: 700_000_000, storageGb: 900_000 },
    ],
    peakMultiplier: 4,
  },
];

export const TIMELINE_START = 2005;
export const TIMELINE_END = 2025;

export function getCompany(id) {
  const company = COMPANIES.find((c) => c.id === id);
  if (!company) {
    const err = new Error(`Unknown company: ${id}`);
    err.status = 404;
    throw err;
  }
  return company;
}

function interpolate(points, year, key) {
  const sorted = [...points].sort((a, b) => a.year - b.year);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (year <= first.year) {
    // Extrapolate backwards along the early growth rate, floored so the
    // simulators always have a non-zero workload to push around.
    const next = sorted[1] ?? first;
    const years = Math.max(1, next.year - first.year);
    const rate = (next[key] / first[key]) ** (1 / years);
    return Math.max(1, first[key] / rate ** (first.year - year));
  }
  if (year >= last.year) return last[key];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (year >= a.year && year <= b.year) {
      const span = b.year - a.year;
      const t = (year - a.year) / span;
      return a[key] * (b[key] / a[key]) ** t; // geometric, not linear
    }
  }
  return last[key];
}

/**
 * Workload for a company in a given year: the single input every engine takes.
 */
export function scaleFor(companyId, year) {
  const company = getCompany(companyId);
  const requestsPerDay = Math.round(interpolate(company.points, year, 'requestsPerDay'));
  const storageGb = Math.round(interpolate(company.points, year, 'storageGb'));
  const averageRps = requestsPerDay / 86400;
  const peakRps = averageRps * (company.peakMultiplier ?? 3);
  const monthlyRequests = requestsPerDay * 30;
  // ~180 KB average response, a reasonable mixed HTML/JSON/image page weight.
  const monthlyEgressGb = (monthlyRequests * 180) / 1e6;
  return {
    companyId,
    year,
    requestsPerDay,
    monthlyRequests,
    averageRps: Math.round(averageRps),
    peakRps: Math.round(peakRps),
    storageGb,
    monthlyEgressGb: Math.round(monthlyEgressGb),
    beforeFounding: year < company.foundedYear,
  };
}

export function companiesForClient() {
  return COMPANIES.map((c) => ({
    id: c.id,
    name: c.name,
    industry: c.industry,
    foundedYear: c.foundedYear,
    blurb: c.blurb,
    accent: c.accent,
    compliance: c.compliance ?? [],
    peakMultiplier: c.peakMultiplier,
  }));
}
