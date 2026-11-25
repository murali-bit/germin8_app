import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/layout/Navbar';
import Sidebar from './components/layout/Sidebar';
import Login from './screens/Login';
import { api, checkStoredMigration, clearCurrentJobId, clearJobCache, getCurrentJobId, MIGRATION_SELECTED } from './api';

import Screen11_Dashboard from './screens/app/Screen11_Dashboard';
import Screen12_NewMigration from './screens/app/Screen12_NewMigration';
import Screen13_TallyExportGuide from './screens/app/Screen13_TallyExportGuide';
import Screen14_ExportCatalogue from './screens/app/Screen14_ExportCatalogue';
import Screen15_UploadCenter from './screens/app/Screen15_UploadCenter';
import Screen16_CompletenessCheck from './screens/app/Screen16_CompletenessCheck';
import Screen17_ProcessingStatus from './screens/app/Screen17_ProcessingStatus';
import Screen18_DataExplorer from './screens/app/Screen18_DataExplorer';
import Screen19_SmartMapping from './screens/app/Screen19_SmartMapping';
import Screen20_TransactionClassification from './screens/app/Screen20_TransactionClassification';
import Screen22_TemplateLibrary from './screens/app/Screen22_TemplateLibrary';
import Screen23_TemplateMapping from './screens/app/Screen23_TemplateMapping';
import Screen24_ValidationCenter from './screens/app/Screen24_ValidationCenter';
import Screen25_ExportCenter from './screens/app/Screen25_ExportCenter';
import Screen28_RejectionManager from './screens/app/Screen28_RejectionManager';
import Screen29_IdentifierTracker from './screens/app/Screen29_IdentifierTracker';
import Screen30_Reconciliation from './screens/app/Screen30_Reconciliation';
import Screen31_MigrationReports from './screens/app/Screen31_MigrationReports';
import Screen32_CompanySettings from './screens/app/Screen32_CompanySettings';
import Screen33_MappingProfiles from './screens/app/Screen33_MappingProfiles';
import Screen34_SystemSettings from './screens/app/Screen34_SystemSettings';
import Screen35_HelpSupport from './screens/app/Screen35_HelpSupport';
import PrepareMigration from './screens/app/PrepareMigration';
import VoucherReconciliation from './screens/app/VoucherReconciliation';
import ZohoCheck from './screens/app/ZohoCheck';
import Screen40_ImportWizard from './screens/app/Screen40_ImportWizard';
import ImportWizardRedirect from './screens/app/ImportWizardRedirect';
import NotFound from './screens/app/NotFound';
import WizardNav from './components/WizardNav';
import { parseHash, buildHash, isKnownScreen, sameRoute, flowPosition, historyMove, screenKey, HOME, NOT_FOUND } from './navigation';

const SCREENS = {
  'screen-11': Screen11_Dashboard,
  'screen-12': Screen12_NewMigration,
  'screen-13': Screen13_TallyExportGuide,
  'screen-14': Screen14_ExportCatalogue,
  'screen-15': Screen15_UploadCenter,
  'screen-16': Screen16_CompletenessCheck,
  'screen-17': Screen17_ProcessingStatus,
  'screen-18': Screen18_DataExplorer,
  'screen-19': Screen19_SmartMapping,
  'screen-20': Screen20_TransactionClassification,
  'screen-21': ImportWizardRedirect, // was Dependency Manager: now the Import Wizard
  'screen-22': Screen22_TemplateLibrary,
  'screen-23': Screen23_TemplateMapping,
  'screen-24': Screen24_ValidationCenter,
  'screen-25': Screen25_ExportCenter,
  'screen-26': ImportWizardRedirect, // was Import Instructions
  'screen-27': ImportWizardRedirect, // was Import Tracker
  'screen-28': Screen28_RejectionManager,
  'screen-29': Screen29_IdentifierTracker,
  'screen-30': Screen30_Reconciliation,
  'screen-31': Screen31_MigrationReports,
  'screen-32': Screen32_CompanySettings,
  'screen-33': Screen33_MappingProfiles,
  'screen-34': Screen34_SystemSettings,
  'screen-35': Screen35_HelpSupport,
  'screen-36': PrepareMigration,
  'screen-37': VoucherReconciliation,
  'screen-38': ZohoCheck,
  'screen-40': Screen40_ImportWizard,
};

// The screen shown follows the address (#/upload-center): in-app links push an entry onto the browser history, so
// the browser's Back and Forward buttons move between screens, and a reload stays on the same screen.
const readRoute = () => parseHash(window.location.hash);

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const currentScreen = route.screen;
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  // the migration shown: choosing another one in the header remounts the screen, which then reads the new one
  const [jobKey, setJobKey] = useState(getCurrentJobId);
  // below 1024 px the menu is a drawer, opened with the menu button in the header
  const [menuOpen, setMenuOpen] = useState(false);
  // set by the browser's Back / Forward: the screen shown then is scrolled back to where it was
  const restoreScroll = React.useRef(false);

  // onNavigate(screen, params?, { replace }?): an unknown screen id shows the "page does not exist" page.
  const navigate = useCallback((screen, params = {}, options = {}) => {
    setMenuOpen(false);
    restoreScroll.current = false;
    clearJobCache(); // a new page reads the migration once more (shared by the parts of that page)
    const next = isKnownScreen(screen) ? { screen, params: params || {} } : { screen: NOT_FOUND, params: {}, unknown: String(screen ?? '') };
    const hash = next.screen === NOT_FOUND ? buildHash(next.unknown) : buildHash(next.screen, next.params);
    try {
      const here = window.location.hash;
      const state = window.history.state;
      const move = historyMove(here, hash, state, options);
      // the browser's Back: popstate then shows the page (the screen state follows the address)
      if (move === 'back') { window.history.back(); return; }
      if (move === 'replace') window.history.replaceState({ from: state?.from ?? null }, '', hash);
      else if (move === 'push') window.history.pushState({ from: here }, '', hash);
    } catch { /* the address bar cannot be changed here: the screen still changes */ }
    setRoute(prev => (sameRoute(prev, next) && prev.unknown === next.unknown ? prev : next));
  }, []);
  const setCurrentScreen = navigate;

  useEffect(() => {
    // the browser's Back or Forward: the page comes back where it was scrolled to
    const onMove = () => { clearJobCache(); setMenuOpen(false); restoreScroll.current = true; setRoute(readRoute()); };
    window.addEventListener('popstate', onMove);
    window.addEventListener('hashchange', onMove);
    if (!window.location.hash) { try { window.history.replaceState(null, '', buildHash(HOME)); } catch { /* ignore */ } }
    return () => { window.removeEventListener('popstate', onMove); window.removeEventListener('hashchange', onMove); };
  }, []);

  // Another migration chosen (header list, Dashboard): the same page stays open and shows it.
  useEffect(() => {
    const onSelect = () => { setMenuOpen(false); setJobKey(getCurrentJobId()); };
    window.addEventListener(MIGRATION_SELECTED, onSelect);
    return () => window.removeEventListener(MIGRATION_SELECTED, onSelect);
  }, []);

  // Signed in (or still signed in from before): the stored migration is kept only when it is this user's and in this
  // user's list, so no screen opens a migration the user cannot see.
  const checkSession = useCallback(() => api.get('/auth/me')
    .then(async me => { await checkStoredMigration(me?.email); setJobKey(getCurrentJobId()); setUser(me); })
    .catch(() => setUser(null)), []);
  useEffect(() => {
    checkSession();
    const signedOut = () => setUser(null);
    window.addEventListener('auth-required', signedOut);
    return () => window.removeEventListener('auth-required', signedOut);
  }, [checkSession]);

  // Moving to another screen starts at its top. A reload of the page stays where the user was: the scroll position of
  // each address is kept for the browser tab, and put back once the screen has loaded enough content to reach it.
  const firstScreen = React.useRef(true);
  useEffect(() => {
    const main = document.getElementById('main-content');
    if (!main) return undefined;
    const key = `scroll:${window.location.hash}`;
    let timer = null;
    if (firstScreen.current || restoreScroll.current) {
      firstScreen.current = false;
      restoreScroll.current = false;
      let wanted = 0;
      try { wanted = Number(sessionStorage.getItem(key)) || 0; } catch { wanted = 0; }
      let tries = 0;
      const restore = () => {
        if (!wanted) return;
        main.scrollTo(0, wanted);
        if (main.scrollTop < wanted - 4 && ++tries < 40) timer = setTimeout(restore, 150); // the lists are still loading
      };
      restore();
    } else main.scrollTo(0, 0);
    let pending = false;
    const remember = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; try { sessionStorage.setItem(key, String(Math.round(main.scrollTop))); } catch { /* not kept */ } });
    };
    main.addEventListener('scroll', remember, { passive: true });
    return () => { clearTimeout(timer); main.removeEventListener('scroll', remember); };
  }, [currentScreen, user === undefined || user === null]);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    clearCurrentJobId(); // the next person to sign in does not land on this migration
    setJobKey(null);
    setUser(null);
    setCurrentScreen(HOME);
  };

  if (user === undefined) return <div role="status" className="h-screen flex items-center justify-center bg-page text-[14px] text-muted">Loading…</div>;
  if (user === null) return <Login onSignedIn={checkSession} />;

  const Screen = SCREENS[currentScreen];
  // New Migration draws its own Back and Continue (Continue saves the details first); the Import Wizard has its own
  // steps with Back and Next pinned to the bottom.
  const inFlow = !!flowPosition(currentScreen) && currentScreen !== 'screen-12' && currentScreen !== 'screen-40';

  return (
    <div className="h-screen flex bg-page text-ink antialiased overflow-hidden">
      <Sidebar currentScreen={currentScreen} onNavigate={setCurrentScreen} user={user} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <Navbar onNavigate={setCurrentScreen} user={user} onLogout={logout} onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} jobKey={jobKey} />
        <main id="main-content" className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-page">
          {inFlow && <div className="px-4 sm:px-6 md:px-8 pt-5 max-w-6xl mx-auto"><WizardNav key={`nav-top|${jobKey || ''}`} screen={currentScreen} onNavigate={setCurrentScreen} position="top" /></div>}
          {Screen
            ? <Screen key={`${jobKey || 'none'}|${screenKey(currentScreen, route.params)}`} onNavigate={setCurrentScreen} user={user} params={route.params} />
            : <NotFound onNavigate={setCurrentScreen} unknown={route.unknown} />}
          {inFlow && <WizardNav key={`nav-bottom|${jobKey || ''}`} screen={currentScreen} onNavigate={setCurrentScreen} position="bottom" />}
        </main>
      </div>
    </div>
  );
}
