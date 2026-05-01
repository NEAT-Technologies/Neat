import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NEAT',
  description: 'Live semantic graph of your software systems.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
