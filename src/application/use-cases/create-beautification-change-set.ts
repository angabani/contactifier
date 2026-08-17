import {
  analyzeContactQuality,
  createChangeSet,
  createConfidenceScore,
  type ChangeSet,
  type ContactQualityAnalysis,
  type ContactSnapshot,
  type ExactDuplicateAnalysis,
  type ProposedChange,
} from '@/domain';

import { createExactDuplicateChangeSet } from './create-exact-duplicate-change-set';

export interface CreateBeautificationChangeSetInput {
  readonly snapshot: ContactSnapshot;
  readonly duplicateAnalysis: ExactDuplicateAnalysis;
  readonly qualityAnalysis: ContactQualityAnalysis;
  readonly createdAt: string;
}

const reasonLabels = {
  'duplicate-email': 'Remove repeated email address',
  'duplicate-phone': 'Remove repeated phone number',
  'empty-contact': 'Contact has no useful information',
  'missing-name': 'Contact has no name',
  whitespace: 'Remove accidental whitespace',
} as const;

export function createBeautificationChangeSet({
  snapshot,
  duplicateAnalysis,
  qualityAnalysis,
  createdAt,
}: CreateBeautificationChangeSetInput): ChangeSet {
  const duplicateChanges = createExactDuplicateChangeSet({
    snapshot,
    analysis: duplicateAnalysis,
    createdAt,
  });
  const mergeContactIds = new Set(
    duplicateChanges.changes.flatMap((change) =>
      change.kind === 'merge' ? change.contactIds : [],
    ),
  );
  const mergeChanges = duplicateChanges.changes.map((change): ProposedChange => {
    if (change.kind !== 'merge') return change;
    const mergedQuality = analyzeContactQuality({ ...snapshot, contacts: [change.after] });
    const cleanedAfter = mergedQuality.findings.find(
      ({ contactId, suggestedAction }) =>
        contactId === change.after.id && suggestedAction === 'update',
    )?.after;
    return cleanedAfter
      ? {
          ...change,
          after: cleanedAfter,
          reasons: [...change.reasons, 'Clean repeated fields and whitespace'],
        }
      : change;
  });

  const qualityChanges: ProposedChange[] = qualityAnalysis.findings.flatMap(
    (finding): ProposedChange[] => {
    if (mergeContactIds.has(finding.contactId) || finding.suggestedAction === 'none') return [];
    const common = {
      id: `quality:${finding.contactId}`,
      origin: 'rule' as const,
      reasons: finding.issueKinds.map((kind) => reasonLabels[kind]),
      decision: 'pending' as const,
      contactId: finding.contactId,
      before: finding.before,
    };
    if (finding.suggestedAction === 'delete') {
      return [{ ...common, kind: 'delete', confidence: createConfidenceScore(0.85) }];
    }
    if (!finding.after) return [];
    return [
      {
        ...common,
        kind: 'update',
        confidence: createConfidenceScore(1),
        after: finding.after,
      },
    ];
    },
  );

  return createChangeSet({
    id: `beautification:${snapshot.id}`,
    snapshotId: snapshot.id,
    createdAt,
    changes: [...mergeChanges, ...qualityChanges],
  });
}
