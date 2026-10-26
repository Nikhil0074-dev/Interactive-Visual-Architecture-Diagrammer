import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Architecture Diagrammer', description: 'Describe a system in plain English and get an editable architecture diagram.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
