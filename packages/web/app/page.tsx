import dynamic from 'next/dynamic'

// ADR-062 — AppShell renders client-only. The Next.js server emits the
// static HTML shell (head, fonts, CSS); the React tree builds on mount.
// Removing { ssr: false } reintroduces the hydration bug ADR-062 closed.
const AppShell = dynamic(
  () => import('./components/AppShell').then((m) => m.AppShell),
  { ssr: false },
)

export default function Home(): JSX.Element {
  return <AppShell />
}
