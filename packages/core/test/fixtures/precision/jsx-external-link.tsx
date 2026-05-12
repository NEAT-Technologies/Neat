// Verbatim minimisation of ~/neat-experiment/bugs/0006-dashboard-to-medusa-from-changelog-link.md.
//
// The v0.3.0 extractor pulled the URL out of a JSX `<Link>` external-link prop
// and registered it as a CALLS edge from `@medusajs/dashboard` to
// `@medusajs/medusa`, mapping medusajs.com to the medusa package by substring.
// The link is a user-clickable hyperlink to the public marketing site, not a
// service-to-service call.
//
// Filter: JSX external-link exclusion (ADR-065 #3).
// Expected: zero EXTRACTED edges produced from this file.

import * as React from 'react'

declare const TimelineVertical: React.ComponentType<{ className?: string }>
declare const Link: React.ComponentType<{
  to: string
  target?: string
  children?: React.ReactNode
}>
declare const DropdownMenu: { Item: React.ComponentType<{ asChild?: boolean; children?: React.ReactNode }> }

export function ChangelogMenuItem(): JSX.Element {
  return (
    <DropdownMenu.Item asChild>
      <Link to="https://medusajs.com/changelog/" target="_blank">
        <TimelineVertical className="text-ui-fg-subtle me-2" />
        Changelog
      </Link>
    </DropdownMenu.Item>
  )
}
