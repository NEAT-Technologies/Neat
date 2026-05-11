import dynamic from 'next/dynamic'

// ADR-062 §4 (2026-05-11 amendment) — /incidents renders client-only.
// Same shape as app/page.tsx: the IncidentsClient subtree reads the URL
// and localStorage synchronously inside its useState lazy initializer,
// which would diverge from the SSR pass; removing the SSR pass keeps the
// resolution chain honest and avoids the double-fetch the deferred shape
// produced on every page load.
const IncidentsClient = dynamic(
  () => import('./IncidentsClient').then((m) => m.IncidentsClient),
  { ssr: false },
)

export default function IncidentsPage(): JSX.Element {
  return <IncidentsClient />
}
