import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Deepi Talk — Just a conversation.',
  description: 'Find your people by ID. Start a conversation.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
