import type { Metadata } from 'next'
import './globals.css'
import { Shell } from '@/components/shell'

export const metadata: Metadata = {
  title: 'emit-infra',
  description: 'Infrastructure management dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  )
}
