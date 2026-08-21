/**
 * Country view over admissions cases.
 *
 * Groups the existing student-case queue by target country and by the five
 * delivery steps the owner named: documents, submission, awaiting an offer,
 * visa and enrolment. It reads no new relation and needs no migration; the
 * queue RPC already returns country, stage, curator and the overdue counters.
 *
 * The grouping is pure so it can be asserted without a database.
 */

/**
 * The builder takes the minimum a case must expose rather than one concrete
 * row type, so the Platform queue and the legacy fixture path can both feed it
 * without either becoming the other's shape.
 */
export type AdmissionsCaseInput = Readonly<{
  studentCaseId: string;
  studentDisplayName: string;
  targetCountry: string;
  operationalStage: string;
  state: "pending" | "active" | "closed";
  currentCuratorDisplayName: string | null;
  intake: string | null;
  overdueTaskCount: number;
  overdueObligationCount: number;
  rejectedDocumentCount: number;
}>;

export const ADMISSIONS_STEPS = [
  "documents",
  "applications",
  "decisions",
  "visa",
  "enrolled",
] as const;
export type AdmissionsStep = (typeof ADMISSIONS_STEPS)[number];

/**
 * Stage keys live in a versioned workflow contract rather than a database
 * enum, so a case may carry a stage this view does not know. Such a case is
 * counted separately instead of being forced into the nearest step, because a
 * wrong step reads as confident and wrong.
 */
const STEP_BY_STAGE: Readonly<Record<string, AdmissionsStep>> = {
  documents: "documents",
  applications: "applications",
  decisions: "decisions",
  visa: "visa",
  visa_predeparture: "visa",
  enrolled: "enrolled",
  completed: "enrolled",
  arrival_adaptation: "enrolled",
  // Legacy stage vocabulary carries the same five delivery steps under
  // different keys, so the country view reads identically in both paths.
  applying: "applications",
  offer: "decisions",
};

/** Stages that precede delivery. A case here has not reached the funnel yet. */
const PRE_DELIVERY_STAGES = new Set([
  "intake",
  "profile_route",
  "route",
  // Legacy vocabulary: everything before the signed contract precedes delivery.
  "lead",
  "consultation",
  "contract",
]);

export type AdmissionsCaseSummary = Readonly<{
  studentCaseId: string;
  studentDisplayName: string;
  curatorDisplayName: string | null;
  intake: string | null;
  overdueTaskCount: number;
  overdueObligationCount: number;
  rejectedDocumentCount: number;
  hasAttention: boolean;
}>;

export type AdmissionsStepGroup = Readonly<{
  step: AdmissionsStep;
  cases: readonly AdmissionsCaseSummary[];
  attentionCount: number;
}>;

export type AdmissionsCountryGroup = Readonly<{
  country: string;
  totalCases: number;
  attentionCount: number;
  steps: readonly AdmissionsStepGroup[];
  /** Cases before the delivery funnel, for example freshly handed over. */
  beforeDeliveryCount: number;
  /** Cases whose stage this view does not recognise. Never silently merged. */
  unknownStageCount: number;
  /** Closed cases are excluded from the funnel but reported so totals reconcile. */
  closedCount: number;
}>;

export type AdmissionsOverview = Readonly<{
  countries: readonly AdmissionsCountryGroup[];
  totalCases: number;
  totalAttention: number;
  unknownStageCount: number;
}>;

export function resolveAdmissionsStep(stage: string): AdmissionsStep | null {
  return STEP_BY_STAGE[stage.trim().toLowerCase()] ?? null;
}

export function isPreDeliveryStage(stage: string): boolean {
  return PRE_DELIVERY_STAGES.has(stage.trim().toLowerCase());
}

function toSummary(row: AdmissionsCaseInput): AdmissionsCaseSummary {
  const attention =
    row.overdueTaskCount > 0 ||
    row.overdueObligationCount > 0 ||
    row.rejectedDocumentCount > 0;
  return {
    studentCaseId: row.studentCaseId,
    studentDisplayName: row.studentDisplayName,
    curatorDisplayName: row.currentCuratorDisplayName,
    intake: row.intake,
    overdueTaskCount: row.overdueTaskCount,
    overdueObligationCount: row.overdueObligationCount,
    rejectedDocumentCount: row.rejectedDocumentCount,
    hasAttention: attention,
  };
}

export function buildAdmissionsOverview(
  rows: readonly AdmissionsCaseInput[],
): AdmissionsOverview {
  const byCountry = new Map<
    string,
    {
      steps: Map<AdmissionsStep, AdmissionsCaseSummary[]>;
      before: number;
      unknown: number;
      closed: number;
      total: number;
    }
  >();

  for (const row of rows) {
    const country = row.targetCountry.trim();
    let bucket = byCountry.get(country);
    if (!bucket) {
      bucket = {
        steps: new Map(ADMISSIONS_STEPS.map((step) => [step, []])),
        before: 0,
        unknown: 0,
        closed: 0,
        total: 0,
      };
      byCountry.set(country, bucket);
    }
    bucket.total += 1;

    // A closed case is not a funnel position. Counting it as one would inflate
    // whichever step it happened to stop at.
    if (row.state === "closed") {
      bucket.closed += 1;
      continue;
    }

    const step = resolveAdmissionsStep(row.operationalStage);
    if (step) {
      bucket.steps.get(step)!.push(toSummary(row));
    } else if (isPreDeliveryStage(row.operationalStage)) {
      bucket.before += 1;
    } else {
      bucket.unknown += 1;
    }
  }

  const countries = [...byCountry.entries()]
    .map(([country, bucket]) => {
      const steps = ADMISSIONS_STEPS.map((step) => {
        const cases = bucket.steps
          .get(step)!
          .slice()
          .sort((left, right) =>
            left.studentDisplayName.localeCompare(right.studentDisplayName, "ru"),
          );
        return {
          step,
          cases,
          attentionCount: cases.filter((item) => item.hasAttention).length,
        };
      });
      return {
        country,
        totalCases: bucket.total,
        attentionCount: steps.reduce((sum, group) => sum + group.attentionCount, 0),
        steps,
        beforeDeliveryCount: bucket.before,
        unknownStageCount: bucket.unknown,
        closedCount: bucket.closed,
      };
    })
    .sort((left, right) => {
      // Countries with something needing attention come first; ties by size,
      // then by name so the order is stable rather than incidental.
      if (left.attentionCount !== right.attentionCount) {
        return right.attentionCount - left.attentionCount;
      }
      if (left.totalCases !== right.totalCases) {
        return right.totalCases - left.totalCases;
      }
      return left.country.localeCompare(right.country, "ru");
    });

  return {
    countries,
    totalCases: rows.length,
    totalAttention: countries.reduce((sum, item) => sum + item.attentionCount, 0),
    unknownStageCount: countries.reduce(
      (sum, item) => sum + item.unknownStageCount,
      0,
    ),
  };
}
