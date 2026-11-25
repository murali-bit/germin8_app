import { useEffect } from 'react';
import { WIZARD_SCREEN } from '../../importWizard';

// Dependency Manager, Import Instructions and Import Tracker are now one screen, the Import Wizard. Their old
// addresses (bookmarks, links in reports) open the wizard; the address bar is replaced, so browser Back does not loop.
export default function ImportWizardRedirect({ onNavigate }) {
  useEffect(() => { onNavigate(WIZARD_SCREEN, {}, { replace: true }); }, [onNavigate]);
  return null;
}
