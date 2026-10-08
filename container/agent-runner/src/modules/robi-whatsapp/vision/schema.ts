import { z } from 'zod';
const confidence = z.number().min(0).max(1);
const positive = z.number().finite().nonnegative();
const range = z.strictObject({ min: positive, max: positive }).refine((v) => v.min <= v.max, 'Invalid estimate range');
const base = { uncertaintyNotes: z.array(z.string().max(1000)).max(30), confidence };
export const mealClassifications = ['circle', 'triangle', 'square', 'snack', 'cheat', 'unclassified'] as const;
export const classificationReaction = { circle: '⭕', triangle: '🔺', square: '⬜', snack: '🍎' } as const;
const food = z.strictObject({
  ...base,
  type: z.literal('food'),
  foods: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(200),
        confidence,
        estimatedAmount: z.strictObject({ value: positive, unit: z.string().max(40) }).optional(),
        estimatedGrams: positive.optional(),
      }),
    )
    .max(50),
  estimatedNutrition: z.strictObject({ calories: range.optional(), proteinGrams: range.optional() }),
  mealClassification: z.strictObject({ type: z.enum(mealClassifications), confidence }).optional(),
  visibleVegetables: z.boolean().optional(),
  visibleProteinSource: z.boolean().optional(),
  visibleCarbohydrateSource: z.boolean().optional(),
});
const workout = z.strictObject({
  ...base,
  type: z.literal('workout_summary'),
  sport: z.enum(['running', 'cycling', 'swimming', 'strength', 'walking', 'surfing', 'functional', 'other']).optional(),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  durationSeconds: positive.optional(),
  distanceMeters: positive.optional(),
  pace: z
    .strictObject({ averageSecondsPerKm: positive.optional(), averageSecondsPer100m: positive.optional() })
    .optional(),
  speed: z.strictObject({ averageKph: positive.optional() }).optional(),
  heartRate: z
    .strictObject({
      average: z.number().int().min(20).max(250).optional(),
      max: z.number().int().min(20).max(250).optional(),
    })
    .optional(),
  cadence: positive.optional(),
  calories: positive.optional(),
  elevation: z.strictObject({ gainMeters: positive.optional() }).optional(),
  trainingEffect: z
    .strictObject({ aerobic: z.number().min(0).max(5).optional(), anaerobic: z.number().min(0).max(5).optional() })
    .optional(),
  splits: z
    .array(
      z.strictObject({
        index: z.number().int().positive(),
        distanceMeters: positive.optional(),
        durationSeconds: positive.optional(),
        paceSecondsPerKm: positive.optional(),
        heartRate: positive.optional(),
      }),
    )
    .max(300)
    .optional(),
  exercises: z
    .array(
      z.strictObject({
        name: z.string().max(200),
        sets: positive.optional(),
        reps: positive.optional(),
        weightKg: positive.optional(),
      }),
    )
    .max(100)
    .optional(),
  otherVisibleMetrics: z
    .record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))
    .optional(),
});
export const imageAnalysisSchema = z.discriminatedUnion('type', [
  food,
  workout,
  z.strictObject({ ...base, type: z.literal('fitness_related'), description: z.string().max(2000) }),
  z.strictObject({ ...base, type: z.literal('other'), description: z.string().max(2000) }),
  z.strictObject({ ...base, type: z.literal('unknown'), description: z.string().max(2000) }),
]);
export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;
export const analysisInputSchema = z.strictObject({
  imageIds: z.array(z.string().min(1)).min(1).max(20),
  analysis: imageAnalysisSchema,
});
