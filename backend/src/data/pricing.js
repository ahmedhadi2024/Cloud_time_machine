/**
 * Approximate us-east-1 on-demand prices, August 2025 public list prices.
 * These are estimates for teaching/comparison purposes, not billing accuracy.
 * Keep every number used by the cost engine here so it is auditable in one place.
 */
export const HOURS_PER_MONTH = 730;

export const EC2_HOURLY = {
  't3.micro': 0.0104,
  't3.small': 0.0208,
  't3.medium': 0.0416,
  't3.large': 0.0832,
  'm5.large': 0.096,
  'm5.xlarge': 0.192,
  'm5.2xlarge': 0.384,
  'c5.large': 0.085,
  'c5.xlarge': 0.17,
  'legacy.datacenter': 0.25, // stand-in for a pre-cloud colocated box
};

export const RDS_HOURLY = {
  'db.t3.micro': 0.017,
  'db.t3.small': 0.034,
  'db.t3.medium': 0.068,
  'db.m5.large': 0.171,
  'db.m5.xlarge': 0.342,
  'db.m5.2xlarge': 0.684,
};

export const ELASTICACHE_HOURLY = {
  'cache.t3.micro': 0.017,
  'cache.t3.small': 0.034,
  'cache.m5.large': 0.156,
};

export const STORAGE_GB_MONTH = {
  s3Standard: 0.023,
  s3InfrequentAccess: 0.0125,
  s3GlacierInstant: 0.004,
  s3GlacierDeep: 0.00099,
  ebsGp3: 0.08,
  ebsGp2: 0.1,
  rdsGp3: 0.115,
};

export const TRANSFER_GB = {
  internetEgress: 0.09,
  cloudFrontEgress: 0.085,
  crossAz: 0.01,
};

export const REQUEST_PRICES = {
  albLcuHour: 0.008,
  albHour: 0.0225,
  nlbHour: 0.0225,
  natGatewayHour: 0.045,
  natGatewayGb: 0.045,
  cloudFrontPer10kRequests: 0.01,
  dynamoWriteRequestUnitMillion: 1.25,
  dynamoReadRequestUnitMillion: 0.25,
  dynamoStorageGbMonth: 0.25,
  sqsPerMillion: 0.4,
  snsPerMillion: 0.5,
  stepFunctionsPer1kTransitions: 0.025,
  cloudWatchMetricMonth: 0.3,
  cloudWatchLogsGbIngest: 0.5,
  kmsKeyMonth: 1.0,
  kmsPer10kRequests: 0.03,
  secretsManagerSecretMonth: 0.4,
  wafWebAclMonth: 5.0,
  wafRuleMonth: 1.0,
  wafPerMillionRequests: 0.6,
  shieldAdvancedMonth: 3000.0,
  route53HostedZoneMonth: 0.5,
  glacierRetrievalGb: 0.01,
};

/** Discount multipliers applied by the optimizer. */
export const COMMITMENT_DISCOUNTS = {
  onDemand: 1.0,
  computeSavingsPlan1yr: 0.72,
  computeSavingsPlan3yr: 0.54,
  reservedInstance1yrNoUpfront: 0.75,
  reservedInstance3yrAllUpfront: 0.44,
  graviton: 0.8,
  spot: 0.3,
};
