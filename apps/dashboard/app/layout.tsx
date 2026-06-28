import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { Shell } from '@/components/shell/shell'
import { SwRegister } from '@/components/sw-register'
import { SplashGate } from '@/components/splash-screen'
import { ToastProvider } from '@/components/ui/toast'

export const metadata: Metadata = {
  title: 'Emit Infra',
  description: 'Infrastructure management dashboard',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Emit Infra',
  },
}

export const viewport: Viewport = {
  themeColor: '#10b981',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ToastProvider>
          <Shell>{children}</Shell>
          <SwRegister />
          <SplashGate />
        </ToastProvider>
      </body>
    </html>
  )
}
