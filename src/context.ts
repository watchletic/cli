type JsonRecord = Record<string, any>

export type AgentContextInput = {
  generatedAt: string
  from: string
  to: string
  timeZone: string
  requestedRecentActivities: number
  settings: unknown
  activities: unknown
  readiness: unknown
  analytics: unknown
  trainingLoad: unknown
  fitness: unknown
  structuredWorkouts: unknown
}

const SETTINGS_KEYS = [
  'updatedAt',
  'revision',
  'isMetric',
  'isTemperatureCelsius',
  'weekStartsOn',
  'maxHeartRate',
  'isHRZonesPercentage',
  'amountHRZones',
  'heartRateZone1',
  'heartRateZone2',
  'heartRateZone3',
  'heartRateZone4',
  'heartRateZone5',
  'heartRateZone6',
  'heartRateZone7',
  'runningPowerCP',
  'preferIntervalAsTarget',
  'alwaysTriggerNextLapManually',
  'intervalCountInRepeatOnly',
  'addToImportedSinglePaceRange',
  'addToImportedSingleSpeedRange',
  'addToImportedSingleBPMRange',
  'addToImportedSinglePowerRange',
] as const

const ACTIVITY_KEYS = [
  'id',
  'title',
  'activityType',
  'date',
  'distanceMeters',
  'durationSeconds',
  'isIndoor',
  'analyticsExcluded',
  'trainingLoad',
  'rawDataAvailable',
] as const

export function buildAgentContext(input: AgentContextInput) {
  const activities = records(input.activities).map((activity) =>
    pick(activity, ACTIVITY_KEYS),
  )
  const readiness = summarizeReadiness(records(input.readiness))
  const analytics = record(input.analytics)
  const analyticsProfiles = records(analytics.data)
  const recentAnalyticsProfiles = analyticsProfiles.filter(
    (profile) => profile.windowDays === 90,
  )
  const workouts = records(input.structuredWorkouts)

  return {
    schemaVersion: 2,
    generatedAt: input.generatedAt,
    range: {
      from: input.from,
      to: input.to,
      timeZone: input.timeZone,
    },
    settings: pick(record(input.settings), SETTINGS_KEYS),
    recentActivities: activities,
    readiness,
    analytics: {
      windowDays: recentAnalyticsProfiles.length > 0 ? 90 : null,
      profiles: (recentAnalyticsProfiles.length > 0
        ? recentAnalyticsProfiles
        : analyticsProfiles
      ).map(summarizeAnalyticsProfile),
      processing: analytics.processing === true,
      processingStatus:
        analytics.processingStatus ??
        (analytics.processing === true ? 'processing' : 'ready'),
    },
    trainingLoad: summarizeTrainingLoad(input.trainingLoad, input.fitness),
    upcomingStructuredWorkouts: workouts
      .slice(0, 20)
      .map(summarizeStructuredWorkout),
    completeness: {
      rawSamplesIncluded: false,
      analyticsCurvesIncluded: false,
      cloudOnly: true,
      recentActivitiesReturned: activities.length,
      recentActivitiesLimit: input.requestedRecentActivities,
      readinessEntriesIncluded: readiness.recent.length,
      upcomingStructuredWorkoutsReturned: Math.min(workouts.length, 20),
      upcomingStructuredWorkoutsTruncated: workouts.length > 20,
      analyticsProcessing: analytics.processing === true,
      note: 'Use IDs to fetch full analytics or raw channels only for a specific question.',
    },
  }
}

function summarizeReadiness(entries: JsonRecord[]) {
  const recent = [...entries]
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, 14)
    .map((entry) =>
      pick(entry, [
        'date',
        'hrvMs',
        'restingHrBpm',
        'sleepSeconds',
        'hrvType',
      ] as const),
    )
  return {
    latest: recent[0] ?? null,
    recent,
    trends: {
      hrvMs: metricTrend(recent, 'hrvMs'),
      restingHrBpm: metricTrend(recent, 'restingHrBpm'),
      sleepSeconds: metricTrend(recent, 'sleepSeconds'),
    },
  }
}

function metricTrend(entries: JsonRecord[], key: string) {
  const current = average(entries.slice(0, 7), key)
  const previous = average(entries.slice(7, 14), key)
  return compact({
    recent7Average: current.value,
    recent7Samples: current.samples,
    previous7Average: previous.value,
    previous7Samples: previous.samples,
    change:
      current.value === undefined || previous.value === undefined
        ? undefined
        : rounded(current.value - previous.value),
  })
}

function average(entries: JsonRecord[], key: string) {
  const values = entries
    .map((entry) => entry[key])
    .filter((value): value is number => typeof value === 'number')
  return {
    value:
      values.length === 0
        ? undefined
        : rounded(
            values.reduce((sum, value) => sum + value, 0) / values.length,
          ),
    samples: values.length,
  }
}

function summarizeAnalyticsProfile(profile: JsonRecord) {
  return compact({
    activityType: profile.activityType,
    windowDays: profile.windowDays,
    asOfDate: profile.asOfDate,
    status: profile.status,
    analyzedWorkoutCount: profile.analyzedWorkoutCount,
    eligibleWorkoutCount: profile.eligibleWorkoutCount,
    distanceTotals: records(profile.distanceYears)
      .map((year) => pick(year, ['year', 'totalMeters'] as const))
      .sort((left, right) => Number(right.year) - Number(left.year))
      .slice(0, 5),
    metrics: records(profile.metrics).map(summarizeAnalyticsMetric),
    dfa: profile.dfa ? summarizeDfa(record(profile.dfa)) : undefined,
    updatedAt: profile.updatedAt,
  })
}

function summarizeAnalyticsMetric(metric: JsonRecord) {
  return {
    metric: metric.metric,
    source: metric.source,
    contributingWorkoutCount: metric.contributingWorkoutCount,
    estimates: records(metric.estimates).map((estimate) => {
      const supportingPoints = records(estimate.supportingPoints)
      return compact({
        ...pick(estimate, [
          'type',
          'value',
          'unit',
          'model',
          'confidence',
          'confidenceScore',
          'supportingPointCount',
          'note',
        ] as const),
        supportingActivityIds: uniqueStrings(
          supportingPoints.map((point) => point.historyItemId),
        ).slice(0, 3),
      })
    }),
    highlights: curveHighlights(records(metric.curve)),
  }
}

function curveHighlights(points: JsonRecord[]) {
  const chosen: JsonRecord[] = []
  const add = (point: JsonRecord | undefined) => {
    if (
      point &&
      !chosen.some(
        (candidate) => candidate.durationSeconds === point.durationSeconds,
      )
    )
      chosen.push(point)
  }
  for (const duration of [300, 1200, 3600])
    add(points.find((point) => point.durationSeconds === duration))
  if (chosen.length === 0) {
    add(points[0])
    add(points[points.length - 1])
  }
  return chosen.slice(0, 3).map(activityPoint)
}

function activityPoint(point: JsonRecord) {
  return compact({
    durationSeconds: point.durationSeconds,
    value: point.value,
    activityId: point.historyItemId,
    activityTitle: point.workoutName,
    activityDate: point.workoutDate,
  })
}

function summarizeDfa(dfa: JsonRecord) {
  const threshold = record(dfa.aerobicThresholdEstimate)
  return compact({
    contributingWorkoutCount: dfa.contributingWorkoutCount,
    goodQualityWorkoutCount: dfa.goodQualityWorkoutCount,
    lowHeartRateWorkoutCount: records(dfa.lowHeartRateWorkouts).length,
    maxHeartRateBpm: dfa.maxHeartRateBpm,
    aerobicThresholdEstimate: dfa.aerobicThresholdEstimate
      ? compact({
          ...pick(threshold, [
            'heartRateBpm',
            'powerWatts',
            'speedMetersPerSecond',
            'confidence',
            'confidenceScore',
          ] as const),
          sourceActivityIds: uniqueStrings(
            records(threshold.sourceWorkouts).map(
              (workout) => workout.historyItemId,
            ),
          ).slice(0, 3),
        })
      : undefined,
    recentWorkouts: records(dfa.recentWorkouts)
      .slice(0, 2)
      .map((workout) =>
        compact({
          activityId: workout.historyItemId,
          activityTitle: workout.workoutName,
          activityDate: workout.workoutDate,
          quality: workout.quality,
          interpretation: workout.interpretation,
          medianAlpha1: workout.medianAlpha1,
          coverage: workout.coverage,
          measuredDurationSeconds: workout.measuredDurationSeconds,
          averageHeartRateBpm: workout.averageHeartRateBpm,
          averagePowerWatts: workout.averagePowerWatts,
          averageSpeedMetersPerSecond: workout.averageSpeedMetersPerSecond,
          trend: workout.trend,
        }),
      ),
  })
}

function summarizeTrainingLoad(
  configurationValue: unknown,
  fitnessValue: unknown,
) {
  const configuration = record(configurationValue)
  const fitness = record(fitnessValue)
  return {
    current: fitness.summary ?? null,
    recent: records(fitness.points)
      .slice(-14)
      .map((point) =>
        pick(point, [
          'date',
          'trainingLoad',
          'fitness',
          'fatigue',
          'form',
          'rampRate7Days',
        ] as const),
      ),
    processing: fitness.processing === true,
    processingStatus:
      fitness.processingStatus ??
      (fitness.processing === true ? 'processing' : 'ready'),
    configuration: {
      initialized: configuration.initialized === true,
      sports: records(configuration.sports).map((sport) =>
        pick(sport, [
          'activityType',
          'sourcePriority',
          'enabledSources',
        ] as const),
      ),
      references: records(configuration.references).map((reference) =>
        pick(reference, [
          'scope',
          'referenceKey',
          'useAutomatic',
          'manualValue',
          'effectiveValue',
          'effectiveOrigin',
          'automaticUnit',
          'automaticSource',
          'automaticConfidence',
          'automaticConfidenceScore',
          'automaticAsOfDate',
        ] as const),
      ),
      revision: configuration.revision,
    },
  }
}

function summarizeStructuredWorkout(workout: JsonRecord) {
  const notes = typeof workout.notes === 'string' ? workout.notes : null
  return compact({
    ...pick(workout, [
      'id',
      'title',
      'date',
      'activityType',
      'locationType',
      'isMetric',
      'isRecurring',
      'recurringUntil',
      'completedAt',
      'external',
      'revision',
    ] as const),
    notes: notes && notes.length > 500 ? `${notes.slice(0, 500)}…` : notes,
    notesTruncated: notes ? notes.length > 500 : undefined,
    partsSummary: summarizeWorkoutParts(records(workout.parts)),
  })
}

function summarizeWorkoutParts(parts: JsonRecord[]) {
  let plannedStepCount = 0
  let estimatedDurationSeconds = 0
  let estimatedDistanceMeters = 0
  const targetTypes = new Set<string>()
  const titles: string[] = []

  const visit = (part: JsonRecord, multiplier: number) => {
    const repeats =
      typeof part.repeats === 'number' && part.repeats > 0 ? part.repeats : 1
    const children = records(part.repeatParts)
    if (children.length > 0) {
      for (const child of children) visit(child, multiplier * repeats)
      return
    }
    plannedStepCount += multiplier
    if (typeof part.title === 'string' && titles.length < 8)
      titles.push(part.title)
    if (typeof part.targetType === 'string') targetTypes.add(part.targetType)
    if (typeof part.goalValue !== 'number') return
    if (part.goalType === 'duration')
      estimatedDurationSeconds += part.goalValue * multiplier
    if (part.goalType === 'distance' || part.goalType === 'distanceSmall')
      estimatedDistanceMeters += part.goalValue * multiplier
  }
  for (const part of parts) visit(part, 1)

  return compact({
    plannedStepCount,
    estimatedDurationSeconds:
      estimatedDurationSeconds > 0
        ? rounded(estimatedDurationSeconds)
        : undefined,
    estimatedDistanceMeters:
      estimatedDistanceMeters > 0
        ? rounded(estimatedDistanceMeters)
        : undefined,
    targetTypes: [...targetTypes],
    stepTitles: titles,
  })
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is JsonRecord =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      )
    : []
}

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function pick<const Keys extends readonly string[]>(
  source: JsonRecord,
  keys: Keys,
) {
  const result: JsonRecord = {}
  for (const key of keys)
    if (Object.prototype.hasOwnProperty.call(source, key))
      result[key] = source[key]
  return result
}

function compact(value: JsonRecord) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  )
}

function uniqueStrings(values: unknown[]) {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === 'string'),
    ),
  ]
}

function rounded(value: number) {
  return Math.round(value * 100) / 100
}
