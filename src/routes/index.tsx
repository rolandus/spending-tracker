import { createFileRoute, Link } from '@tanstack/react-router'
import { getTransactionStats } from '../server/functions/transactions'

export const Route = createFileRoute('/')({
  loader: () => getTransactionStats(),
  component: DashboardPage,
})

function DashboardPage() {
  const stats = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Total Transactions</p>
          <p className="text-3xl font-bold mt-1">{stats.totalTransactions.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Accounts</p>
          <p className="text-3xl font-bold mt-1">{stats.byAccount.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-6 flex items-center justify-center">
          <Link
            to="/import"
            className="text-blue-600 hover:text-blue-700 font-medium no-underline"
          >
            Import CSV &rarr;
          </Link>
        </div>
      </div>

      {stats.byAccount.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold">Transactions by Account</h2>
          </div>
          <div className="divide-y divide-slate-200">
            {stats.byAccount.map((item) => (
              <div key={item.accountId} className="px-6 py-3 flex items-center justify-between">
                <span className="text-sm font-medium">{item.accountName}</span>
                <span className="text-sm text-slate-500">{item.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.totalTransactions === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-500">
          <p className="text-lg mb-2">No transactions yet</p>
          <p>
            <Link to="/import" className="text-blue-600 hover:text-blue-700 no-underline">
              Import your first CSV file
            </Link>{' '}
            to get started.
          </p>
        </div>
      )}
    </div>
  )
}
