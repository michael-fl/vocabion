/**
 * Zod validation schemas for the stars purchase API.
 *
 * @example
 * ```ts
 * import { purchaseStarsSchema } from './starsSchemas.ts'
 * const result = purchaseStarsSchema.safeParse(req.body)
 * ```
 */
import { z } from 'zod'

import { MAX_STARS_PER_OFFER } from '../features/stars/StarsService.ts'

export const purchaseStarsSchema = z.object({
  count: z.number().int().min(1).max(MAX_STARS_PER_OFFER),
})
