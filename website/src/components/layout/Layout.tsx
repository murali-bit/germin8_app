import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navigation } from './Navigation';
import { Footer } from './Footer';
import { ScrollToTop } from './ScrollToTop';

export const Layout: React.FC = () => {
  // The homepage renders its own navigation inside the hero.
  const isHome = useLocation().pathname === '/';
  return (
    <div className="flex flex-col min-h-screen bg-white text-ink-950 font-sans">
      <ScrollToTop />
      {!isHome && <Navigation />}
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};
