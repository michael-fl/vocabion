/**
 * Zod schemas for vocabulary API endpoints.
 *
 * TypeScript types are derived directly from schemas via `z.infer<>` —
 * never written by hand. This guarantees compile-time and runtime types
 * are always in sync.
 *
 * @example
 * ```ts
 * import { createVocabEntrySchema } from './vocabSchemas.ts'
 * const result = createVocabEntrySchema.safeParse(req.body)
 * ```
 */
import { z } from 'zod'

// ── Create / Update ───────────────────────────────────────────────────────────

export const createVocabEntrySchema = z.object({
  de: z.array(z.string().min(1)).min(1),
  en: z.array(z.string().min(1)).min(1),
})

export type CreateVocabEntryRequest = z.infer<typeof createVocabEntrySchema>

export const updateVocabEntrySchema = z.object({
  de: z.array(z.string().min(1)).min(1),
  en: z.array(z.string().min(1)).min(1),
})

export type UpdateVocabEntryRequest = z.infer<typeof updateVocabEntrySchema>

// ── Add or merge ──────────────────────────────────────────────────────────────

export const addOrMergeVocabSchema = z.object({
  de: z.array(z.string().min(1)).min(1),
  en: z.array(z.string().min(1)).min(1),
})

export type AddOrMergeVocabRequest = z.infer<typeof addOrMergeVocabSchema>

// ── Set bucket ────────────────────────────────────────────────────────────────

export const setBucketSchema = z.object({
  bucket: z.number().int().min(0),
})

export type SetBucketRequest = z.infer<typeof setBucketSchema>

// ── Spend credits ─────────────────────────────────────────────────────────────

export const spendCreditsSchema = z.object({
  amount: z.number().int().min(1),
})

export type SpendCreditsRequest = z.infer<typeof spendCreditsSchema>

// ── Set marked ────────────────────────────────────────────────────────────────

export const setMarkedSchema = z.object({
  marked: z.boolean(),
})

export type SetMarkedRequest = z.infer<typeof setMarkedSchema>

// ── Refund credits ────────────────────────────────────────────────────────────

export const refundCreditsSchema = z.object({
  amount: z.number().int().min(1),
})

export type RefundCreditsRequest = z.infer<typeof refundCreditsSchema>

// ── Import ────────────────────────────────────────────────────────────────────

const importEntrySchema = z.object({
  de: z.array(z.string().min(1)).min(1),
  en: z.array(z.string().min(1)).min(1),
  bucket: z.number().int().min(0).optional(),
})

export const importVocabSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  entries: z.array(importEntrySchema),
})

export type ImportVocabRequest = z.infer<typeof importVocabSchema>
