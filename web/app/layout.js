import './globals.css';
import { AuthProvider } from '../contexts/AuthContext.js';
import Nav from './components/Nav.js';

export const metadata = {
  title: 'Mythica — A Dark-Fantasy Collection & Adventure Game',
  description:
    'Hunt the night wilds, collect sprites and weapons, trade with fellow travelers, and rise through the dark fantasy realm of Mythica. Free to play — start your legend today.',
  keywords: [
    'Mythica',
    'dark fantasy game',
    'collection game',
    'adventure game',
    'free browser game',
    'fantasy RPG',
    'sprite collection',
    'trading game',
    'online game',
    'hunt game',
  ],
  authors: [{ name: 'Mythica' }],
  creator: 'Mythica',
  publisher: 'Mythica',
  metadataBase: new URL('https://mythica.bond'),
  alternates: {
    canonical: 'https://mythica.bond/',
  },
  openGraph: {
    type: 'website',
    url: 'https://mythica.bond/',
    title: 'Mythica — A Dark-Fantasy Collection & Adventure Game',
    description:
      'Hunt the night wilds, collect sprites and weapons, trade with fellow travelers, and rise through the dark fantasy realm of Mythica. Free to play.',
    siteName: 'Mythica',
    locale: 'en_US',
    images: [
      {
        url: 'https://mythica.bond/assets/logo/mythica-logo.webp',
        width: 1200,
        height: 630,
        alt: 'Mythica — Dark-Fantasy Collection & Adventure Game',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mythica — A Dark-Fantasy Collection & Adventure Game',
    description:
      'Hunt the night wilds, collect sprites and weapons, trade with fellow travelers, and rise through the dark fantasy realm of Mythica. Free to play.',
    images: ['https://mythica.bond/assets/logo/mythica-logo.webp'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: '5y9XWXhhvo0qfegJ9qzaol8f9Cks1GFt-h-32IzFcJk',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'VideoGame',
              name: 'Mythica',
              url: 'https://mythica.bond/',
              description:
                'Hunt the night wilds, collect sprites and weapons, trade with fellow travelers, and rise through the dark fantasy realm of Mythica.',
              genre: ['Role-Playing Game', 'Adventure', 'Collection'],
              gamePlatform: 'Web Browser',
              applicationCategory: 'Game',
              operatingSystem: 'Any',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
              author: {
                '@type': 'Organization',
                name: 'Mythica',
                url: 'https://mythica.bond/',
              },
            }),
          }}
        />
        <AuthProvider>
          <Nav />
          <main>{children}</main>
          <footer className="footer">
            <p>Mythica — an original dark-fantasy tale. All creatures, names, and art are original works.</p>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
// Build timestamp: 20261003072935 - force clean rebuild
