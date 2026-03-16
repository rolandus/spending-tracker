import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState, useMemo, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { getTransactions, updateTransaction, type TransactionWithAccount } from '../server/functions/transactions'
import { getAccounts } from '../server/functions/import'
import { getCategories } from '../server/functions/categories'
import { CategoryPicker } from '../components/CategoryPicker'

interface TransactionsSearch {
  accountId?: number
  dateFrom?: string
  dateTo?: string
  transactionType?: string
  search?: string
  showIgnored?: boolean
  page?: number
}

export const Route = createFileRoute('/transactions/')({
  validateSearch: (search: Record<string, unknown>): TransactionsSearch => ({
    accountId: search.accountId ? Number(search.accountId) : undefined,
    dateFrom: search.dateFrom as string | undefined,
    dateTo: search.dateTo as string | undefined,
    transactionType: search.transactionType as string | undefined,
    search: search.search as string | undefined,
    showIgnored: search.showIgnored === true || search.showIgnored === 'true' ? true : undefined,
    page: search.page ? Number(search.page) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [txnResult, accounts, categoryRows] = await Promise.all([
      getTransactions({ data: { ...deps, pageSize: 50 } }),
      getAccounts(),
      getCategories(),
    ])
    return { txnResult, accounts, categories: categoryRows.map((c) => c.name) }
  },
  component: TransactionsPage,
})

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return amount < 0 ? `-$${formatted}` : `$${formatted}`
}

const TRANSACTION_TYPES = [
  { value: '', label: 'All types' },
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'internal_transfer', label: 'Transfer' },
  { value: 'cc_payment', label: 'CC Payment' },
  { value: 'refund', label: 'Refund' },
  { value: 'unknown', label: 'Unknown' },
]

function CategoryCell({
  transactionId,
  category,
  categories,
  onUpdated,
}: {
  transactionId: number
  category: string | null
  categories: string[]
  onUpdated: () => void
}) {
  const [open, setOpen] = useState(false)

  const handleChange = async (newCategory: string | null) => {
    await updateTransaction({ data: { id: transactionId, category: newCategory } })
    onUpdated()
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        className={`inline-block px-2 py-0.5 rounded text-xs font-medium cursor-pointer ${
          category
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
            : 'bg-slate-100 text-slate-400 hover:bg-slate-200 italic'
        }`}
        onClick={() => setOpen(!open)}
      >
        {category ?? 'uncategorized'}
      </button>
      {open && (
        <CategoryPicker
          value={category}
          onChange={handleChange}
          onClose={() => setOpen(false)}
          categories={categories}
        />
      )}
    </div>
  )
}

function TransactionsPage() {
  const { txnResult, accounts, categories } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()

  // Local search state for debounced text input
  const [searchText, setSearchText] = useState(search.search ?? '')

  const handleCategoryUpdate = useCallback(() => {
    router.invalidate()
  }, [router])

  const handleToggleIgnored = useCallback(async (id: number, currentIgnored: number) => {
    await updateTransaction({ data: { id, ignored: currentIgnored ? 0 : 1 } })
    router.invalidate()
  }, [router])

  const updateSearch = (updates: Partial<TransactionsSearch>) => {
    navigate({
      to: '/transactions',
      search: (prev: TransactionsSearch) => ({
        ...prev,
        ...updates,
        // Reset page when filters change (unless we're explicitly setting page)
        page: 'page' in updates ? updates.page : 1,
      }),
    })
  }

  const columns = useMemo<ColumnDef<TransactionWithAccount>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Date',
        cell: (info) => info.getValue<string>(),
        size: 100,
      },
      {
        accessorKey: 'accountName',
        header: 'Account',
        cell: (info) => info.getValue<string>(),
        size: 140,
      },
      {
        accessorKey: 'description',
        header: 'Description',
        cell: (info) => {
          const merchantName = info.row.original.merchantName
          const description = info.getValue<string>()
          return (
            <div className="truncate max-w-md" title={description}>
              {merchantName && (
                <span className="text-xs font-medium text-blue-600 mr-1.5">{merchantName}</span>
              )}
              <span className={merchantName ? 'text-slate-400 text-xs' : ''}>
                {description}
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: 'amount',
        header: () => <span className="text-right block">Amount</span>,
        cell: (info) => {
          const amount = info.getValue<number>()
          return (
            <span className={`text-right block font-mono text-sm ${amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {formatCurrency(amount)}
            </span>
          )
        },
        size: 110,
      },
      {
        accessorKey: 'transactionType',
        header: 'Type',
        cell: (info) => {
          const type = info.getValue<string>()
          const colors: Record<string, string> = {
            expense: 'bg-red-100 text-red-700',
            income: 'bg-green-100 text-green-700',
            internal_transfer: 'bg-slate-100 text-slate-700',
            cc_payment: 'bg-blue-100 text-blue-700',
            refund: 'bg-amber-100 text-amber-700',
            unknown: 'bg-slate-100 text-slate-500',
          }
          return (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[type] ?? colors.unknown}`}>
              {type.replace('_', ' ')}
            </span>
          )
        },
        size: 120,
      },
      {
        accessorKey: 'paymentMethod',
        header: 'Method',
        cell: (info) => info.getValue<string | null>()?.replace('_', ' ') ?? '',
        size: 100,
      },
      {
        accessorKey: 'cardholder',
        header: 'Cardholder',
        cell: (info) => info.getValue<string | null>() ?? '',
        size: 120,
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: (info) => (
          <CategoryCell
            transactionId={info.row.original.id}
            category={info.getValue<string | null>()}
            categories={categories}
            onUpdated={handleCategoryUpdate}
          />
        ),
        size: 140,
      },
      ...(search.showIgnored
        ? [
            {
              id: 'actions',
              header: '',
              cell: (info: { row: { original: TransactionWithAccount } }) => (
                <button
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    info.row.original.ignored
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleIgnored(info.row.original.id, info.row.original.ignored)
                  }}
                >
                  {info.row.original.ignored ? 'Unignore' : 'Ignore'}
                </button>
              ),
              size: 80,
            } as ColumnDef<TransactionWithAccount>,
          ]
        : []),
    ],
    [search.showIgnored],
  )

  const table = useReactTable({
    data: txnResult.transactions,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Transactions</h1>
        <span className="text-sm text-slate-500">
          {txnResult.total.toLocaleString()} total
        </span>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Account</label>
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={search.accountId ?? ''}
            onChange={(e) => updateSearch({ accountId: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={search.transactionType ?? ''}
            onChange={(e) => updateSearch({ transactionType: e.target.value || undefined })}
          >
            {TRANSACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
          <input
            type="date"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={search.dateFrom ?? ''}
            onChange={(e) => updateSearch({ dateFrom: e.target.value || undefined })}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
          <input
            type="date"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={search.dateTo ?? ''}
            onChange={(e) => updateSearch({ dateTo: e.target.value || undefined })}
          />
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Search</label>
          <input
            type="text"
            placeholder="Search descriptions..."
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateSearch({ search: searchText || undefined })
              }
            }}
            onBlur={() => updateSearch({ search: searchText || undefined })}
          />
        </div>

        <div className="flex items-center gap-1.5 self-end pb-0.5">
          <input
            type="checkbox"
            id="showIgnored"
            checked={!!search.showIgnored}
            onChange={(e) => updateSearch({ showIgnored: e.target.checked || undefined })}
            className="rounded border-slate-300"
          />
          <label htmlFor="showIgnored" className="text-xs text-slate-500 cursor-pointer select-none">
            Show ignored
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-slate-200 bg-slate-50">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider"
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${row.original.ignored ? 'opacity-50' : ''}`}
                    onClick={() => navigate({ to: '/transactions/$id', params: { id: String(row.original.id) } })}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {txnResult.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Page {txnResult.page} of {txnResult.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm disabled:opacity-50"
              disabled={txnResult.page <= 1}
              onClick={() => updateSearch({ page: txnResult.page - 1 })}
            >
              Previous
            </button>
            <button
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm disabled:opacity-50"
              disabled={txnResult.page >= txnResult.totalPages}
              onClick={() => updateSearch({ page: txnResult.page + 1 })}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
