import './globals.css';
import ClientSwitcher from './_components/ClientSwitcher';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Signal — WOW!SGNL',
  description: 'Rapid response engine',
  applicationName: 'Signal',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Signal',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-neutral-900 bg-neutral-950/90 backdrop-blur sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-6 py-2 flex justify-end items-center">
            <ClientSwitcher />
          </div>
        </header>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
