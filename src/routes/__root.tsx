import { HeadContent, Outlet, Scripts, createRootRoute, Link } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Spending Tracker' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="px-3 py-2 rounded-md text-sm font-medium transition-colors"
      activeProps={{ className: 'bg-blue-100 text-blue-700' }}
      inactiveProps={{ className: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' }}
    >
      {children}
    </Link>
  )
}

function RootComponent() {
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <Link to="/" className="text-lg font-bold text-slate-900 no-underline">
              Spending Tracker
            </Link>
            <nav className="flex items-center gap-1">
              <NavLink to="/transactions">Transactions</NavLink>
              <NavLink to="/categories">Categories</NavLink>
              <NavLink to="/merchants">Merchants</NavLink>
              <NavLink to="/reports">Reports</NavLink>
              <NavLink to="/import">Import</NavLink>
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  )
}
