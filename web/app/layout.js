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
  // Favicon + touch icon: these are what browsers and Google Search
  // show next to the site name. Previously no icon was declared at all.
  icons: {
    icon: [
      { url: 'https://mythica.bond/favicon.ico' },
      { url: 'https://mythica.bond/favicon.png', type: 'image/png' },
    ],
    shortcut: 'https://mythica.bond/favicon.ico',
    apple: 'https://mythica.bond/apple-touch-icon.png',
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
        // Real 1200x630 share image (og-image.jpg). The old tag declared
        // 1200x630 but pointed at the 1024x1024 square logo, so link
        // previews cropped it badly.
        url: 'https://mythica.bond/og-image.jpg',
        width: 1200,
        height: 630,
        type: 'image/jpeg',
        alt: 'Mythica — Dark-Fantasy Collection & Adventure Game',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mythica — A Dark-Fantasy Collection & Adventure Game',
    description:
      'Hunt the night wilds, collect sprites and weapons, trade with fellow travelers, and rise through the dark fantasy realm of Mythica. Free to play.',
    images: ['https://mythica.bond/og-image.jpg'],
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
  themeColor: '#0a0d18',
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
              image: 'https://mythica.bond/og-image.jpg',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
              author: {
                '@type': 'Organization',
                name: 'Mythica',
                url: 'https://mythica.bond/',
                logo: 'https://mythica.bond/assets/logo/mythica-logo.png',
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Mythica',
              url: 'https://mythica.bond/',
              description:
                'Mythica — a free dark-fantasy collection and adventure game for web browsers.',
              // This logo field is what Google uses for the site logo in
              // search results. It must be a real, crawlable image URL.
              logo: 'https://mythica.bond/assets/logo/mythica-logo.png',
              sameAs: ['https://www.facebook.com/mythica.bond/'],
            }),
          }}
        />
        <AuthProvider>
          <Nav />
          <main>{children}</main>
          <footer className="footer">
            <p>Mythica — an original dark-fantasy tale. All creatures, names, and art are original works.</p>
            <div className="footer-social">
              <span>Follow Mythica:</span>
              <a
                href="https://www.facebook.com/mythica.bond/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Mythica on Facebook (opens in a new tab)"
              >
                Facebook
              </a>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
// Build timestamp: 20261003072935 - force clean rebuild
