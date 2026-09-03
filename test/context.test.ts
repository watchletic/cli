import { describe, expect, it } from 'vitest'
import { buildAgentContext } from '../src/context.js'

const curve = Array.from({ length: 4_000 }, (_, index) => ({
  durationSeconds: index + 1,
  value: 300 - index / 100,
  historyItemId: `activity-${index}`,
  workoutName: `Workout ${index}`,
  workoutDate: '2026-09-01',
  startOffsetSeconds: index,
}))

function fixture() {
  return buildAgentContext({
    generatedAt: '2026-09-03T10:00:00Z',
    from: '2026-08-01',
    to: '2026-09-17',
    timeZone: 'Europe/Stockholm',
    requestedRecentActivities: 30,
    settings: {
      isMetric: true,
      weekStartsOn: 1,
      liveTrackingRecipients: [{ email: 'private@example.com' }],
    },
    activities: [
      {
        id: 'activity-1',
        title: 'Intervals',
        activityType: 'running',
        date: '2026-09-01T10:00:00Z',
        durationSeconds: 3_600,
        config: { id: 'config-id', ownerId: 'owner-id' },
        rawDataAvailable: true,
      },
    ],
    readiness: Array.from({ length: 14 }, (_, index) => ({
      id: `readiness-${index}`,
      date: `2026-08-${String(31 - index).padStart(2, '0')}`,
      hrvMs: 60 + index,
      restingHrBpm: 50 + index,
      sleepSeconds: 28_800 - index * 60,
      ownerId: 'owner-id',
    })),
    analytics: {
      data: [
        {
          activityType: 'running',
          windowDays: 90,
          asOfDate: '2026-09-03',
          status: 'ready',
          analyzedWorkoutCount: 20,
          eligibleWorkoutCount: 22,
          distanceYears: [{ year: 2026, totalMeters: 500_000, points: curve }],
          metrics: [
            {
              metric: 'power',
              source: 'strydPower',
              contributingWorkoutCount: 20,
              curve,
              estimates: [
                {
                  type: 'criticalPower',
                  value: 300,
                  unit: 'w',
                  model: 'test',
                  confidence: 'high',
                  confidenceScore: 0.9,
                  supportingPointCount: 4_000,
                  supportingPoints: curve,
                },
              ],
            },
          ],
        },
      ],
      processing: false,
      processingStatus: 'ready',
    },
    trainingLoad: {
      initialized: true,
      sports: [
        {
          activityType: 'running',
          sourcePriority: ['strydPower'],
          enabledSources: ['strydPower'],
        },
      ],
      references: [
        {
          scope: 'running',
          referenceKey: 'strydCriticalPower',
          effectiveValue: 300,
          effectiveOrigin: 'automatic',
          automaticWindowEstimates: curve,
        },
      ],
      revision: '2026-09-03T10:00:00Z',
    },
    fitness: {
      summary: {
        date: '2026-09-03',
        fitness: 42,
        fatigue: 38,
        form: 4,
      },
      points: curve.map((_, index) => ({
        date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
        trainingLoad: index,
        fitness: index / 10,
        fatigue: index / 8,
        form: index / -40,
        workouts: curve,
      })),
      processing: false,
      processingStatus: 'ready',
    },
    structuredWorkouts: [
      {
        id: 'workout-1',
        title: 'Tempo',
        date: '2026-09-05',
        activityType: 'running',
        notes: 'A'.repeat(1_000),
        parts: [
          {
            repeats: 3,
            repeatParts: [
              {
                title: 'Tempo interval',
                goalType: 'duration',
                goalValue: 300,
                targetType: 'pace',
              },
            ],
          },
        ],
      },
    ],
  })
}

describe('agent context', () => {
  it('keeps useful summaries and drill-down activity IDs', () => {
    const context = fixture()

    expect(context.schemaVersion).toBe(2)
    expect(context.analytics.windowDays).toBe(90)
    expect(context.analytics.profiles[0]!.metrics[0]!.highlights).toHaveLength(
      3,
    )
    expect(
      context.analytics.profiles[0]!.metrics[0]!.estimates[0]!
        .supportingActivityIds,
    ).toHaveLength(3)
    expect(context.trainingLoad.current).toMatchObject({ fitness: 42, form: 4 })
    expect(context.readiness.trends.hrvMs).toEqual({
      recent7Average: 63,
      recent7Samples: 7,
      previous7Average: 70,
      previous7Samples: 7,
      change: -7,
    })
    expect(context.upcomingStructuredWorkouts[0]!.partsSummary).toMatchObject({
      plannedStepCount: 3,
      estimatedDurationSeconds: 900,
      targetTypes: ['pace'],
    })
  })

  it('removes bulk curves, private context, and repetitive workout data', () => {
    const serialized = JSON.stringify(fixture())

    expect(serialized).not.toContain('supportingPoints')
    expect(serialized).not.toContain('automaticWindowEstimates')
    expect(serialized).not.toContain('liveTrackingRecipients')
    expect(serialized).not.toContain('private@example.com')
    expect(serialized).not.toContain('ownerId')
    expect(serialized).not.toContain('config-id')
    expect(Buffer.byteLength(serialized)).toBeLessThan(40_000)
  })
})
