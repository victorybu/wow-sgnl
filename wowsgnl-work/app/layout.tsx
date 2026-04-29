import './globals.css';
export const metadata = { title: 'Signal — WOW!SGNL', description: 'Rapid response engine' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
