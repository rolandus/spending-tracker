import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback } from 'react'
import { getAccounts } from '../server/functions/import'
import {
  parseAndNormalize,
  detectDuplicates,
  assignExistingMerchants,
  requestAISuggestions,
  commitImport,
} from '../server/functions/import-pipeline'
import { getPendingMerchants, updateMerchant } from '../server/functions/merchants'
import { getCategories } from '../server/functions/categories'
import type { NormalizedTransaction, PipelineTransaction } from '../server/importers'
import type { PendingMerchant } from '../server/functions/ai-merchants'
import type { PatternInput } from '../shared/pattern-matching'
import { PatternRow } from '../components/PatternRow'

export const Route = createFileRoute('/import')({
  loader: async () => {
    const [accounts, categoryRows] = await Promise.all([getAccounts(), getCategories()])
    return { accounts, categories: categoryRows.map((c) => c.name) }
  },
  component: ImportPage,
})

type Step = 'upload' | 'parsed' | 'merchants' | 'review' | 'done'

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'parsed', label: 'Parse' },
  { key: 'merchants', label: 'Merchants' },
  { key: 'review', label: 'Review' },
]

// ── Step Indicator ───────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const stepOrder = STEPS.map((s) => s.key)
  const currentIndex = stepOrder.indexOf(current === 'done' ? 'review' : current)

  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((s, i) => {
        const isCompleted = i < currentIndex || current === 'done'
        const isCurrent = i === currentIndex && current !== 'done'
        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-8 ${isCompleted ? 'bg-blue-500' : 'bg-slate-300'}`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                isCompleted
                  ? 'bg-blue-100 text-blue-700'
                  : isCurrent
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {isCompleted && <span>&#10003;</span>}
              {s.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Editable Suggestion Row ──────────────────────────────────────────

function EditableSuggestionRow({
  merchant,
  isConfirmed,
  isSkipped,
  categories,
  onConfirm,
  onSkip,
}: {
  merchant: PendingMerchant
  isConfirmed: boolean
  isSkipped: boolean
  categories: string[]
  onConfirm: (id: number) => void
  onSkip: (id: number) => void
}) {
  const [name, setName] = useState(merchant.name)
  const [patterns, setPatterns] = useState<PatternInput[]>(
    merchant.patterns.length > 0
      ? merchant.patterns
      : [{ pattern: '', matchType: 'contains' }],
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const hasIgnoredPatterns = patterns.some((p) => p.defaultIgnored)

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
    setSaveError(null)
  }

  const handleNameChange = (newName: string) => {
    setName(newName)
    markDirty()
  }

  const handlePatternChange = (index: number, field: keyof PatternInput, value: string | boolean) => {
    setPatterns((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value === '' ? null : value } : p)),
    )
    markDirty()
  }

  const handleAddPattern = () => {
    setPatterns((prev) => [...prev, { pattern: '', matchType: 'contains' as const }])
    markDirty()
  }

  const handleRemovePattern = (index: number) => {
    setPatterns((prev) => prev.filter((_, i) => i !== index))
    markDirty()
  }

  const handleSave = async () => {
    const validPatterns = patterns.filter((p) => p.pattern.trim())
    if (!name.trim() || validPatterns.length === 0) return
    setSaving(true)
    try {
      await updateMerchant({
        data: {
          id: merchant.id,
          name: name.trim(),
          patterns: validPatterns,
        },
      })
      setDirty(false)
      setSaved(true)
    } catch (err) {
      console.error('Failed to save merchant:', merchant.id, err)
      setSaveError(String(err instanceof Error ? err.message : err))
    } finally {
      setSaving(false)
    }
  }

  if (isSkipped) return null

  return (
    <tr className={`border-b border-slate-100 align-top ${isConfirmed ? 'bg-green-50' : ''} ${hasIgnoredPatterns ? 'bg-amber-50/30' : ''}`}>
      <td className="px-3 py-2">
        <div className="space-y-1">
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-medium"
          />
          <div className="flex gap-1 flex-wrap">
            {merchant.modifiesMerchantId ? (
              <span className="text-[10px] font-medium text-amber-600 bg-amber-50 rounded px-1 py-0.5">
                Modifies existing
              </span>
            ) : (
              <span className="text-[10px] font-medium text-blue-600 bg-blue-50 rounded px-1 py-0.5">
                New merchant
              </span>
            )}
            {hasIgnoredPatterns && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-100 rounded px-1 py-0.5">
                Ignored
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="space-y-1">
          {patterns.map((p, i) => (
            <PatternRow
              key={i}
              pattern={p}
              index={i}
              categories={categories}
              canRemove={patterns.length > 1}
              onChange={handlePatternChange}
              onRemove={handleRemovePattern}
            />
          ))}
          <button
            onClick={handleAddPattern}
            className="text-blue-600 hover:text-blue-700 text-xs"
          >
            + Add pattern
          </button>
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex flex-col gap-1">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || patterns.every((p) => !p.pattern.trim())}
              className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {saved && !dirty && (
            <span className="text-[10px] text-green-600 font-medium">✓ Saved</span>
          )}
          {saveError && (
            <span className="text-[10px] text-red-600 font-medium">Error: {saveError}</span>
          )}
          {isConfirmed ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-100 text-green-700 text-xs font-medium">
              &#10003; Confirmed
            </span>
          ) : (
            <>
              <button
                onClick={() => onConfirm(merchant.id)}
                className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
              >
                Confirm
              </button>
              <button
                onClick={() => onSkip(merchant.id)}
                className="px-3 py-1 rounded border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-50"
              >
                Skip
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Main Import Page ─────────────────────────────────────────────────

function ImportPage() {
  const { accounts, categories: CATEGORIES } = Route.useLoaderData()

  // Wizard step
  const [step, setStep] = useState<Step>('upload')

  // Step 1: Upload state
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [files, setFiles] = useState<File[]>([])

  // Step 2: Parse state
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [duplicateCount, setDuplicateCount] = useState(0)
  const [totalParsed, setTotalParsed] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')

  // Step 3: Merchant state
  const [pipelineTransactions, setPipelineTransactions] = useState<PipelineTransaction[]>([])
  const [autoAssignedCount, setAutoAssignedCount] = useState(0)
  const [pendingMerchants, setPendingMerchants] = useState<PendingMerchant[]>([])
  const [confirmedMerchantIds, setConfirmedMerchantIds] = useState<Set<number>>(new Set())
  const [skippedMerchantIds, setSkippedMerchantIds] = useState<Set<number>>(new Set())

  // Step 4: Review state (transactions with final category edits)
  const [reviewTransactions, setReviewTransactions] = useState<PipelineTransaction[]>([])

  // Done state
  const [commitResult, setCommitResult] = useState<{
    inserted: number
    skipped: number
    errors: string[]
    merchantsConfirmed: number
  } | null>(null)

  // ── Step 1 handlers ──────────────────────────────────────────────

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files))
    }
  }, [])

  const handleUploadSubmit = useCallback(async () => {
    if (!selectedAccountId || files.length === 0) return

    setLoading(true)
    setLoadingMessage('Parsing CSV files...')
    const allTransactions: NormalizedTransaction[] = []
    const allErrors: string[] = []

    for (const file of files) {
      const csvContent = await file.text()
      const result = await parseAndNormalize({
        data: { accountId: selectedAccountId, csvContent, fileName: file.name },
      })
      allTransactions.push(...result.transactions)
      allErrors.push(...result.errors)
    }

    setTotalParsed(allTransactions.length)
    setParseErrors(allErrors)

    if (allTransactions.length === 0) {
      setLoading(false)
      setStep('parsed')
      return
    }

    setLoadingMessage('Checking for duplicates...')
    const dedupResult = await detectDuplicates({ data: { transactions: allTransactions } })
    setDuplicateCount(dedupResult.duplicateCount)

    setLoading(false)

    if (dedupResult.newTransactions.length === 0) {
      setPipelineTransactions([])
      setStep('parsed')
      return
    }

    // Store new transactions temporarily for the next step
    setPipelineTransactions(
      dedupResult.newTransactions.map((t) => ({
        ...t,
        merchantId: null,
        merchantName: null,
      })),
    )
    setStep('parsed')
  }, [selectedAccountId, files])

  // ── Step 2 → 3 transition ────────────────────────────────────────

  const handleContinueToMerchants = useCallback(async () => {
    setLoading(true)
    setLoadingMessage('Matching against existing merchants...')

    const rawTransactions: NormalizedTransaction[] = pipelineTransactions.map(
      ({ merchantId: _mid, merchantName: _mname, merchantStatus: _ms, ...rest }) => rest,
    )

    // Step 1: Match transactions against existing merchant patterns (confirmed + pending)
    const assignResult = await assignExistingMerchants({
      data: {
        transactions: rawTransactions.map((t) => ({ ...t, merchantId: null, merchantName: null })),
      },
    })

    let finalTransactions = assignResult.transactions
    let totalAutoAssigned = assignResult.autoAssignedCount

    // Step 2: If unassigned descriptions remain, call AI to create new pending merchants
    if (assignResult.unassignedDescriptions.length > 0) {
      setLoadingMessage('Analyzing transactions with AI...')
      try {
        await requestAISuggestions({
          data: {
            descriptions: assignResult.unassignedDescriptions,
            accountId: selectedAccountId!,
          },
        })

        // Step 3: Second assignment pass — new pending merchants now match
        setLoadingMessage('Re-matching with AI suggestions...')
        const secondPass = await assignExistingMerchants({
          data: { transactions: finalTransactions },
        })
        finalTransactions = secondPass.transactions
        totalAutoAssigned = secondPass.autoAssignedCount
      } catch (err) {
        // AI is optional — if it fails, continue without suggestions
        console.error('AI suggestion error:', err)
      }
    }

    setPipelineTransactions(finalTransactions)
    setAutoAssignedCount(totalAutoAssigned)

    // Collect pending merchants that matched any import transaction
    const pendingIds = new Set<number>()
    for (const txn of finalTransactions) {
      if (txn.merchantStatus === 'pending' && txn.merchantId) {
        pendingIds.add(txn.merchantId)
      }
    }

    // Fetch full pending merchant data from the server
    if (pendingIds.size > 0) {
      const allPending = await getPendingMerchants()
      const relevantPending = allPending.filter((pm) => pendingIds.has(pm.id))
      setPendingMerchants(relevantPending)
    } else {
      setPendingMerchants([])
    }

    setLoading(false)
    setStep('merchants')
  }, [pipelineTransactions, selectedAccountId])

  // ── Step 3: Merchant review handlers ──────────────────────────────

  const handleConfirmMerchant = useCallback((id: number) => {
    setConfirmedMerchantIds((prev) => new Set([...prev, id]))
    setSkippedMerchantIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const handleSkipMerchant = useCallback((id: number) => {
    setSkippedMerchantIds((prev) => new Set([...prev, id]))
    setConfirmedMerchantIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const handleConfirmAll = useCallback(() => {
    const allIds = new Set(pendingMerchants.map((pm) => pm.id))
    setConfirmedMerchantIds(allIds)
    setSkippedMerchantIds(new Set())
  }, [pendingMerchants])

  const handleSkipAll = useCallback(() => {
    const allIds = new Set(pendingMerchants.map((pm) => pm.id))
    setSkippedMerchantIds(allIds)
    setConfirmedMerchantIds(new Set())
  }, [pendingMerchants])

  // ── Step 3 → 4 transition ────────────────────────────────────────

  const handleContinueToReview = useCallback(async () => {
    setLoading(true)
    setLoadingMessage('Re-matching transactions with updated merchants...')

    try {
      // Strip merchant assignments, then re-run server-side matching from the DB.
      // This picks up any edits the user saved to pending merchants.
      // For skipped merchants, we exclude their IDs so they don't get re-assigned.
      const rawTransactions: PipelineTransaction[] = pipelineTransactions.map((txn) => ({
        ...txn,
        merchantId: null,
        merchantName: null,
        merchantStatus: undefined,
        ignored: 0,
        category: null,
      }))

      const result = await assignExistingMerchants({
        data: { transactions: rawTransactions },
      })

      // Clear assignments from skipped merchants
      const reviewed = result.transactions.map((txn) => {
        if (txn.merchantId && skippedMerchantIds.has(txn.merchantId)) {
          return { ...txn, merchantId: null, merchantName: null, merchantStatus: undefined }
        }
        return txn
      })

      setReviewTransactions(reviewed)
      setStep('review')
    } catch (err) {
      console.error('Failed to re-match transactions:', err)
      alert(`Error re-matching transactions: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [pipelineTransactions, skippedMerchantIds])

  // ── Step 4: Review handlers ──────────────────────────────────────

  const handleCategoryChange = useCallback((index: number, category: string) => {
    setReviewTransactions((prev) =>
      prev.map((t, i) => (i === index ? { ...t, category: category || null } : t)),
    )
  }, [])

  const handleCommit = useCallback(async () => {
    setLoading(true)
    setLoadingMessage('Importing transactions...')

    try {
      const result = await commitImport({
        data: {
          transactions: reviewTransactions,
          confirmedMerchantIds: Array.from(confirmedMerchantIds),
        },
      })

      setCommitResult(result)
      setStep('done')
    } catch (err) {
      console.error('Failed to commit import:', err)
      alert(`Error importing transactions: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [reviewTransactions, confirmedMerchantIds])

  // ── Reset ─────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setStep('upload')
    setFiles([])
    setParseErrors([])
    setDuplicateCount(0)
    setTotalParsed(0)
    setPipelineTransactions([])
    setAutoAssignedCount(0)
    setPendingMerchants([])
    setConfirmedMerchantIds(new Set())
    setSkippedMerchantIds(new Set())
    setReviewTransactions([])
    setCommitResult(null)
  }, [])

  // ── Loading overlay ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <h1 className="text-2xl font-bold">Import Transactions</h1>
        <StepIndicator current={step} />
        <div className="bg-white rounded-lg border border-slate-200 p-12 flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <p className="text-slate-600 text-sm">{loadingMessage}</p>
        </div>
      </div>
    )
  }

  // ── Render current step ───────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-bold">Import Transactions</h1>
      <StepIndicator current={step} />

      {/* ── STEP 1: Upload ─────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
          <div>
            <label htmlFor="account" className="block text-sm font-medium text-slate-700 mb-1">
              Account
            </label>
            <select
              id="account"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedAccountId ?? ''}
              onChange={(e) =>
                setSelectedAccountId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Select an account...</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.institution})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="csv-files" className="block text-sm font-medium text-slate-700 mb-1">
              CSV Files
            </label>
            <input
              id="csv-files"
              type="file"
              accept=".csv"
              multiple
              onChange={handleFileChange}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {files.length > 0 && (
              <p className="text-sm text-slate-500 mt-1">
                {files.length} file{files.length > 1 ? 's' : ''} selected
              </p>
            )}
          </div>

          <button
            onClick={handleUploadSubmit}
            disabled={!selectedAccountId || files.length === 0}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Upload &amp; Parse
          </button>
        </div>
      )}

      {/* ── STEP 2: Parse Results ──────────────────────────────── */}
      {step === 'parsed' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-3">
            <h2 className="text-lg font-semibold">Parse Results</h2>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-slate-500">Parsed:</span>{' '}
                <span className="font-semibold">{totalParsed}</span>
              </div>
              <div>
                <span className="text-slate-500">Duplicates removed:</span>{' '}
                <span className="font-semibold">{duplicateCount}</span>
              </div>
              <div>
                <span className="text-slate-500">New transactions:</span>{' '}
                <span className="font-semibold text-green-700">
                  {pipelineTransactions.length}
                </span>
              </div>
            </div>

            {parseErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <p className="text-sm font-medium text-red-700 mb-1">Parse errors:</p>
                <ul className="text-sm text-red-700 list-disc list-inside">
                  {parseErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('upload')}
              className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={handleContinueToMerchants}
              disabled={pipelineTransactions.length === 0}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Continue &mdash; Assign Merchants
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Merchant Review ────────────────────────────── */}
      {step === 'merchants' && (
        <div className="space-y-4">
          {/* Auto-assigned summary */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-lg font-semibold mb-2">Merchant Assignment</h2>
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-green-700">{autoAssignedCount}</span>{' '}
              transactions matched existing merchant rules.{' '}
              <span className="font-semibold text-slate-700">
                {pipelineTransactions.filter((t) => !t.merchantId && !t.ignored).length}
              </span>{' '}
              remain unassigned.
            </p>
          </div>

          {/* Pending Merchants — Editable */}
          {pendingMerchants.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold">AI Suggestions</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Review and edit suggestions. You can modify names, patterns, categories, and types before confirming.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmAll}
                    className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                  >
                    Confirm All
                  </button>
                  <button
                    onClick={handleSkipAll}
                    className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-50"
                  >
                    Skip All
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Patterns</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingMerchants.map((pm) => (
                      <EditableSuggestionRow
                        key={pm.id}
                        merchant={pm}
                        isConfirmed={confirmedMerchantIds.has(pm.id)}
                        isSkipped={skippedMerchantIds.has(pm.id)}
                        categories={CATEGORIES}
                        onConfirm={handleConfirmMerchant}
                        onSkip={handleSkipMerchant}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {skippedMerchantIds.size > 0 && (
                <p className="text-xs text-slate-400 mt-2">
                  {skippedMerchantIds.size} suggestion(s) skipped
                </p>
              )}
            </div>
          )}

          {pendingMerchants.length === 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <p className="text-sm text-slate-500">
                All transactions matched existing merchants. No pending merchants to review.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep('parsed')}
              className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={handleContinueToReview}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              Continue &mdash; Review Transactions
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Final Review ───────────────────────────────── */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">
                  Review Transactions ({reviewTransactions.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review and adjust categories before importing.
                </p>
              </div>
              <div className="text-xs text-slate-500 space-x-4">
                <span className="text-green-700 font-medium">
                  {reviewTransactions.filter((t) => t.merchantName).length} with merchant
                </span>
                <span>
                  {reviewTransactions.filter((t) => t.category).length} with category
                </span>
                {reviewTransactions.some((t) => t.ignored) && (
                  <span className="text-amber-600 font-medium">
                    {reviewTransactions.filter((t) => t.ignored).length} ignored
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200 sticky top-0 bg-white">
                  <tr>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2">Merchant</th>
                    <th className="px-2 py-2">Category</th>
                    <th className="px-2 py-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewTransactions.map((txn, i) => (
                    <tr
                      key={i}
                      className={`border-b border-slate-50 hover:bg-slate-50 ${txn.ignored ? 'opacity-50' : ''}`}
                    >
                      <td className="px-2 py-1.5 text-xs tabular-nums whitespace-nowrap">
                        {txn.date}
                      </td>
                      <td
                        className="px-2 py-1.5 text-xs font-mono truncate max-w-[300px]"
                        title={txn.description}
                      >
                        {txn.description}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-xs tabular-nums text-right whitespace-nowrap ${
                          txn.amount < 0 ? 'text-red-700' : 'text-green-700'
                        }`}
                      >
                        {txn.amount < 0 ? '-' : ''}$
                        {Math.abs(txn.amount).toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {txn.ignored ? (
                          <span className="bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded text-[10px] font-medium">
                            Ignored
                          </span>
                        ) : txn.merchantName ? (
                          <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-medium">
                            {txn.merchantName}
                          </span>
                        ) : (
                          <span className="text-slate-400">&mdash;</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={txn.category ?? ''}
                          onChange={(e) => handleCategoryChange(i, e.target.value)}
                          disabled={!!txn.ignored}
                          className="rounded border border-slate-200 px-1 py-0.5 text-xs w-full disabled:opacity-50"
                        >
                          <option value="">&mdash;</option>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-500 whitespace-nowrap">
                        {txn.transactionType}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('merchants')}
              className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={handleCommit}
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              Import {reviewTransactions.length} Transactions
            </button>
          </div>
        </div>
      )}

      {/* ── DONE ───────────────────────────────────────────────── */}
      {step === 'done' && commitResult && (
        <div className="space-y-4">
          <div className="bg-green-50 rounded-lg border border-green-200 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-green-800">Import Complete</h2>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-green-700 font-medium">{commitResult.inserted}</span>{' '}
                <span className="text-slate-600">inserted</span>
              </div>
              {commitResult.skipped > 0 && (
                <div>
                  <span className="text-slate-500 font-medium">{commitResult.skipped}</span>{' '}
                  <span className="text-slate-600">skipped</span>
                </div>
              )}
              {commitResult.merchantsConfirmed > 0 && (
                <div>
                  <span className="text-blue-700 font-medium">
                    {commitResult.merchantsConfirmed}
                  </span>{' '}
                  <span className="text-slate-600">merchants confirmed</span>
                </div>
              )}
            </div>

            {commitResult.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3 mt-2">
                <p className="text-sm font-medium text-red-700 mb-1">Errors:</p>
                <ul className="text-sm text-red-700 list-disc list-inside">
                  {commitResult.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {commitResult.errors.length > 5 && (
                    <li>... and {commitResult.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Import More
          </button>
        </div>
      )}
    </div>
  )
}
