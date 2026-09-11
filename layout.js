import './globals.css';

export const metadata = {
  title: 'SiteVisit IQ',
  description: 'Clover Capital Partners — site visit app',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d1620',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="SiteVisit IQ" />
      </head>
      <body>{children}</body>
    </html>
  );
}
