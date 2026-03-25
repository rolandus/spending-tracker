import { importAmex } from './amex'
import { importCapitalOne } from './capital-one'
import { importChase } from './chase'
import { importFidelity } from './fidelity'
import { importLakeRidge } from './lake-ridge'
import { importSchwab } from './schwab'
import type { ImporterFn } from './types'

export type { NormalizedTransaction, PipelineTransaction, ImportResult, ImporterFn } from './types'

/**
 * Map institution identifiers to their importer functions.
 */
export const importers: Record<string, ImporterFn> = {
  amex: importAmex,
  capital_one: importCapitalOne,
  chase: importChase,
  fidelity: importFidelity,
  lake_ridge: importLakeRidge,
  schwab: importSchwab,
}

/**
 * Get the importer for a given institution.
 */
export function getImporter(institution: string): ImporterFn {
  const importer = importers[institution]
  if (!importer) {
    throw new Error(`No importer found for institution: ${institution}`)
  }
  return importer
}
