import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback } from 'react'
import { getAccounts, importCSV } from '../server/functions/import'
import type { ImportResult } from '../server/importers'

export const Route = createFileRoute('/import')({
  loader: () => getAccounts(),
  component: ImportPage,
})

function ImportPage() {
  const accounts = Route.useLoaderData()
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<Array<{ fileName: string; result: ImportResult }>>([])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files))
      setResults([])
    }
  }, [])

  const handleImport = useCallback(async () => {
    if (!selectedAccountId || files.length === 0) return

    setImporting(true)
    setResults([])
    const newResults: Array<{ fileName: string; result: ImportResult }> = []

    for (const file of files) {
      const csvContent = await file.text()
      try {
        const result = await importCSV({
          data: {
            accountId: selectedAccountId,
            csvContent,
            fileName: file.name,
          },
        })
        newResults.push({ fileName: file.name, result })
      } catch (err) {
        newResults.push({
          fileName: file.name,
          result: {
            inserted: 0,
            skipped: 0,
            errors: [err instanceof Error ? err.message : String(err)],
          },
        })
      }
    }

    setResults(newResults)
    setImporting(false)
  }, [selectedAccountId, files])

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Import Transactions</h1>

      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
        {/* Account selector */}
        <div>
          <label htmlFor="account" className="block text-sm font-medium text-slate-700 mb-1">
            Account
          </label>
          <select
            id="account"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={selectedAccountId ?? ''}
            onChange={(e) => setSelectedAccountId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select an account...</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.institution})
              </option>
            ))}
          </select>
        </div>

        {/* File input */}
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

        {/* Import button */}
        <button
          onClick={handleImport}
          disabled={!selectedAccountId || files.length === 0 || importing}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Import Results</h2>
          {results.map(({ fileName, result }, i) => (
            <div
              key={i}
              className={`rounded-lg border p-4 ${
                result.errors.length > 0
                  ? 'bg-red-50 border-red-200'
                  : 'bg-green-50 border-green-200'
              }`}
            >
              <p className="font-medium text-sm">{fileName}</p>
              <div className="mt-1 text-sm space-x-4">
                <span className="text-green-700">{result.inserted} inserted</span>
                <span className="text-slate-500">{result.skipped} skipped (duplicates)</span>
                {result.errors.length > 0 && (
                  <span className="text-red-700">{result.errors.length} errors</span>
                )}
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-2 text-sm text-red-700 list-disc list-inside">
                  {result.errors.slice(0, 5).map((err, j) => (
                    <li key={j}>{err}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>... and {result.errors.length - 5} more</li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
