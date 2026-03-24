/**
 * Zod schemas for session API endpoints.
 *
 * TypeScript types are derived directly from schemas via `z.infer<>` —
 * never written by hand. This guarantees compile-time and runtime types
 * are always in sync.
 *
 * @example
 * ```ts
 * import { createSessionSchema } from './sessionSchemas.ts'
 * const result = createSessionSchema.safeParse(req.body)
 * ```
 */
import { z } from 'zod'

// ── Create session ────────────────────────────────────────────────────────────

export const createSessionSchema = z.object({
  direction: z.enum(['SOURCE_TO_TARGET', 'TARGET_TO_SOURCE']).default('SOURCE_TO_TARGET'),
  size: z.number().int().min(1).max(50).default(12),
  repetitionSize: z.number().int().min(1).max(50).default(24),
  veteranSize: z.number().int().min(1).max(50).default(24),
})

export type CreateSessionRequest = z.infer<typeof createSessionSchema>

// ── Create starred session ─────────────────────────────────────────────────────

export const createStarredSessionSchema = z.object({
  direction: z.enum(['SOURCE_TO_TARGET', 'TARGET_TO_SOURCE']).default('SOURCE_TO_TARGET'),
})

export type CreateStarredSessionRequest = z.infer<typeof createStarredSessionSchema>

// ── Submit answer ─────────────────────────────────────────────────────────────

export const submitAnswerSchema = z.object({
  /** The vocabId of the word being answered. */
  vocabId: z.string().min(1),
  /**
   * The user's answer(s). One answer is required for single-translation words;
   * two are required when the vocab entry has two or more translations.
   */
  answers: z.array(z.string()).min(1),
  /**
   * Whether the user clicked the hint button at least once during this session.
   * When `true`, the perfect session bonus is not awarded even if all answers
   * were correct. Defaults to `false`.
   */
  hintsUsed: z.boolean().default(false),
})

export type SubmitAnswerRequest = z.infer<typeof submitAnswerSchema>
