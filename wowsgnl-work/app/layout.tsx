import './globals.css';
import ClientSwitcher from './_components/ClientSwitcher';

export const metadata = { title: 'Signal — WOW!SGNL', description: 'Rapid response engine' };

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
      </body>
    </html>
  );
}
