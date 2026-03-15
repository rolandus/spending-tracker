import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback } from 'react'
import { getAccounts } from '../server/functions/import'
import {
  parseAndNormalize,
  detectDuplicates,
  assignInstitutionTransactions,
  assignExistingMerchants,
  requestAISuggestions,
  commitImport,
} from '../server/functions/import-pipeline'
import { getPendingMerchants } from '../server/functions/merchants'
import { CATEGORIES } from '../shared/categories'
import type { NormalizedTransaction, PipelineTransaction } from '../server/importers'
import type { PendingMerchant } from '../server/functions/ai-merchants'

export const Route = createFileRoute('/import')({
  loader: () => getAccounts(),
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

// ── Pending Merchant Row ─────────────────────────────────────────────

function PendingMerchantRow({
  merchant,
  isConfirmed,
  onConfirm,
  onSkip,
}: {
  merchant: PendingMerchant
  isConfirmed: boolean
  onConfirm: (id: number) => void
  onSkip: (id: number) => void
}) {
  return (
    <tr className={`border-b border-slate-100 align-top ${isConfirmed ? 'bg-green-50' : ''}`}>
      <td className="px-3 py-2">
        {merchant.modifiesMerchantId && (
          <span className="block text-[10px] font-medium text-amber-600 bg-amber-50 rounded px-1 py-0.5 mb-1 w-fit">
            Adds patterns to existing merchant
          </span>
        )}
        <span className="text-sm font-medium">{merchant.name}</span>
      </td>
      <td className="px-3 py-2">
        <div className="space-y-1">
          {merchant.patterns.map((p, i) => (
            <div key={i} className="flex gap-1 items-center">
              <span className="flex-1 rounded bg-slate-50 border border-slate-200 px-2 py-1 text-xs font-mono">
                {p.pattern}
              </span>
              <span className="text-[10px] text-slate-500 bg-slate-100 rounded px-1 py-0.5">
                {p.matchType.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-slate-600">
        {merchant.defaultCategory ?? '—'}
      </td>
      <td className="px-3 py-2 text-right">
        {isConfirmed ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-100 text-green-700 text-xs font-medium">
            &#10003; Confirmed
          </span>
        ) : (
          <div className="flex flex-col gap-1">
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
          </div>
        )}
      </td>
    </tr>
  )
}

// ── Main Import Page ─────────────────────────────────────────────────

function ImportPage() {
  const accounts = Route.useLoaderData()

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
      // All duplicates, skip to parsed results
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
    setLoadingMessage('Assigning institution transactions...')

    const rawTransactions: NormalizedTransaction[] = pipelineTransactions.map(
      ({ merchantId: _mid, merchantName: _mname, merchantStatus: _ms, ...rest }) => rest,
    )

    // Step 1: Assign institution transactions (checks, fees, interest)
    const institutionResult = await assignInstitutionTransactions({
      data: { transactions: rawTransactions, accountId: selectedAccountId! },
    })

    // Step 2: Match remaining transactions against existing merchant patterns (confirmed + pending)
    setLoadingMessage('Matching against existing merchants...')
    const assignResult = await assignExistingMerchants({
      data: { transactions: institutionResult.transactions },
    })

    let finalTransactions = assignResult.transactions
    let totalAutoAssigned = assignResult.autoAssignedCount

    // Step 3: If unassigned descriptions remain, call AI to create new pending merchants
    if (assignResult.unassignedDescriptions.length > 0) {
      setLoadingMessage('Analyzing transactions with AI...')
      try {
        await requestAISuggestions({
          data: { descriptions: assignResult.unassignedDescriptions },
        })

        // Step 4: Second assignment pass — new pending merchants now match
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

    // Build pending merchant info from the transaction data
    const pendingMap = new Map<number, PendingMerchant>()
    for (const txn of finalTransactions) {
      if (txn.merchantStatus === 'pending' && txn.merchantId && !pendingMap.has(txn.merchantId)) {
        // We have the ID and name from the transaction — patterns will be fetched from AI result
        // For now we store minimal info; the full pending merchant data comes from the second pass
        pendingMap.set(txn.merchantId, {
          id: txn.merchantId,
          name: txn.merchantName ?? 'Unknown',
          defaultCategory: txn.category ?? null,
          status: 'pending',
          modifiesMerchantId: null,
          patterns: [],
        })
      }
    }

    // We need the full pending merchant data — fetch it from the server
    if (pendingIds.size > 0) {
      // The pending merchants were created by requestAISuggestions and saved to DB
      // Re-fetch them to get full data including patterns
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

  const handleContinueToReview = useCallback(() => {
    setReviewTransactions([...pipelineTransactions])
    setStep('review')
  }, [pipelineTransactions])

  // ── Step 4: Review handlers ──────────────────────────────────────

  const handleCategoryChange = useCallback((index: number, category: string) => {
    setReviewTransactions((prev) =>
      prev.map((t, i) => (i === index ? { ...t, category: category || null } : t)),
    )
  }, [])

  const handleCommit = useCallback(async () => {
    setLoading(true)
    setLoadingMessage('Importing transactions...')

    const result = await commitImport({
      data: {
        transactions: reviewTransactions,
        confirmedMerchantIds: Array.from(confirmedMerchantIds),
      },
    })

    setCommitResult(result)
    setLoading(false)
    setStep('done')
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

          {/* Pending Merchants */}
          {pendingMerchants.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold">Pending Merchants</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    AI-suggested merchants that matched import transactions. Confirm to make permanent, or skip to leave pending.
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
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingMerchants
                      .filter((pm) => !skippedMerchantIds.has(pm.id))
                      .map((pm) => (
                        <PendingMerchantRow
                          key={pm.id}
                          merchant={pm}
                          isConfirmed={confirmedMerchantIds.has(pm.id)}
                          onConfirm={handleConfirmMerchant}
                          onSkip={handleSkipMerchant}
                        />
                      ))}
                  </tbody>
                </table>
              </div>
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
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={txn.category ?? ''}
                          onChange={(e) => handleCategoryChange(i, e.target.value)}
                          disabled={!!txn.ignored}
                          className="rounded border border-slate-200 px-1 py-0.5 text-xs w-full disabled:opacity-50"
                        >
                          <option value="">—</option>
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
