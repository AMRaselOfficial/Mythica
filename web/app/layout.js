import './globals.css';
import { AuthProvider } from '../contexts/AuthContext.js';
import Nav from './components/Nav.js';

export const metadata = {
  title: 'Mythica — A Dark-Fantasy Collection & Adventure Game',
  description:
    'Hunt the night wilds, collect sprites and weapons, trade with fellow travelers, and rise through the dark fantasy realm of Mythica.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
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
