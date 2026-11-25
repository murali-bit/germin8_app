import { lazy, Suspense, type ComponentType } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/system/ErrorBoundary';
import { RouteLoader } from './components/system/RouteLoader';
import { OfflineBanner } from './components/system/OfflineBanner';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';

/* Lazy-load every page except the home page. */
const page = <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) =>
  lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));

// Solutions
const PricingPage = page(() => import('./pages/PricingPage'), 'PricingPage');
const ProductsOverviewPage = page(() => import('./pages/products/ProductsOverviewPage'), 'ProductsOverviewPage');
const TallyToZohoPage = page(() => import('./pages/products/TallyToZohoPage'), 'TallyToZohoPage');
const OfficeManagementPage = page(() => import('./pages/products/SolutionDetailPage'), 'OfficeManagementPage');
const IncorporationRocPage = page(() => import('./pages/products/SolutionDetailPage'), 'IncorporationRocPage');
const FinancialStatementsPage = page(() => import('./pages/products/SolutionDetailPage'), 'FinancialStatementsPage');
const CustomAutomationPage = page(() => import('./pages/products/CustomAutomationPage'), 'CustomAutomationPage');
const MCAAutomationPage = page(() => import('./pages/products/MCAAutomationPage'), 'MCAAutomationPage');
const FinancialMigrationPage = page(() => import('./pages/products/FinancialMigrationPage'), 'FinancialMigrationPage');
const FutureProductsPage = page(() => import('./pages/products/FutureProductsPage'), 'FutureProductsPage');
const StartupsPage = page(() => import('./pages/solutions/AudiencePage'), 'StartupsPage');
const ConsultantsPage = page(() => import('./pages/solutions/AudiencePage'), 'ConsultantsPage');

// Company database
const CompaniesPage = page(() => import('./pages/companies/CompaniesPage'), 'CompaniesPage');
const DatabaseDashboardPage = page(() => import('./pages/companies/DatabaseDashboardPage'), 'DatabaseDashboardPage');
const CompanyDetailPage = page(() => import('./pages/companies/CompanyDetailPage'), 'CompanyDetailPage');
const DirectorPage = page(() => import('./pages/companies/DirectorPage'), 'DirectorPage');

// Resources
const ResourcesOverviewPage = page(() => import('./pages/resources/ResourcesOverviewPage'), 'ResourcesOverviewPage');
const ToolsLibraryPage = page(() => import('./pages/resources/ToolsLibraryPage'), 'ToolsLibraryPage');
const ToolGuidePage = page(() => import('./pages/resources/ToolsLibraryPage'), 'ToolGuidePage');
const BlogPage = page(() => import('./pages/resources/BlogPage'), 'BlogPage');
const BlogDetailPage = page(() => import('./pages/resources/BlogDetailPage'), 'BlogDetailPage');
const FAQPage = page(() => import('./pages/resources/FAQPage'), 'FAQPage');

// Guides and documentation
const GuidesOverviewPage = page(() => import('./pages/guides/GuidesOverviewPage'), 'GuidesOverviewPage');
const TallyMigrationGuidePage = page(() => import('./pages/guides/TallyMigrationGuidePage'), 'TallyMigrationGuidePage');
const MCAGuidePage = page(() => import('./pages/guides/MCAGuidePage'), 'MCAGuidePage');
const AccountSetupGuidePage = page(() => import('./pages/guides/AccountSetupGuidePage'), 'AccountSetupGuidePage');
const GettingStartedGuidePage = page(() => import('./pages/guides/GettingStartedGuidePage'), 'GettingStartedGuidePage');
const TroubleshootingGuidePage = page(() => import('./pages/guides/TroubleshootingGuidePage'), 'TroubleshootingGuidePage');
const DataValidationGuidePage = page(() => import('./pages/guides/DataValidationGuidePage'), 'DataValidationGuidePage');
const DocsOverviewPage = page(() => import('./pages/docs/DocsOverviewPage'), 'DocsOverviewPage');
const DocsTallyPage = page(() => import('./pages/docs/DocsTallyPage'), 'DocsTallyPage');
const DocsMCAPage = page(() => import('./pages/docs/DocsMCAPage'), 'DocsMCAPage');
const DocsInstallPage = page(() => import('./pages/docs/DocsInstallPage'), 'DocsInstallPage');
const DocsBrowserExtPage = page(() => import('./pages/docs/DocsBrowserExtPage'), 'DocsBrowserExtPage');
const DocsWorkflowsPage = page(() => import('./pages/docs/DocsWorkflowsPage'), 'DocsWorkflowsPage');
const DocsIntegrationsPage = page(() => import('./pages/docs/DocsIntegrationsPage'), 'DocsIntegrationsPage');
const DocsTroubleshootingPage = page(() => import('./pages/docs/DocsTroubleshootingPage'), 'DocsTroubleshootingPage');

// Company
const AboutPage = page(() => import('./pages/about/AboutPage'), 'AboutPage');
const CareersPage = page(() => import('./pages/CareersPage'), 'CareersPage');
const ContactPage = page(() => import('./pages/ContactPage'), 'ContactPage');
const BookDemoPage = page(() => import('./pages/BookDemoPage'), 'BookDemoPage');
const SupportPage = page(() => import('./pages/SupportPage'), 'SupportPage');
const SecurityPage = page(() => import('./pages/SecurityPage'), 'SecurityPage');
const PrivacyPolicyPage = page(() => import('./pages/PrivacyPolicyPage'), 'PrivacyPolicyPage');
const TermsPage = page(() => import('./pages/TermsPage'), 'TermsPage');
const CookiePolicyPage = page(() => import('./pages/CookiePolicyPage'), 'CookiePolicyPage');
const SitemapPage = page(() => import('./pages/SitemapPage'), 'SitemapPage');
const NotFoundPage = page(() => import('./pages/NotFoundPage'), 'NotFoundPage');

// Account (full-screen, outside the main layout)
const LoginPage = page(() => import('./pages/auth/LoginPage'), 'LoginPage');
const SignupPage = page(() => import('./pages/auth/SignupPage'), 'SignupPage');
const ForgotPasswordPage = page(() => import('./pages/auth/ForgotPasswordPage'), 'ForgotPasswordPage');

/**
 * Old addresses from the previous site, forwarded to the closest new page so
 * existing links and search results keep working.
 */
const REDIRECTS: [string, string][] = [
  ['/features', '/products'],
  ['/products/features', '/products'],
  ['/products/accounting-automation', '/products/custom-automation'],
  ['/automation', '/products'],
  ['/automation/ai-agents', '/products/custom-automation'],
  ['/automation/financial-automation', '/products/financial-statements'],
  ['/automation/accounting-automation', '/products/office-management'],
  ['/automation/document-processing', '/products/financial-statements'],
  ['/automation/data-reconciliation', '/products/tally-to-zoho'],
  ['/automation/browser-automation', '/products/incorporation-roc'],
  ['/solutions', '/products'],
  ['/solutions/overview', '/products'],
  ['/solutions-overview', '/products'],
  ['/solutions/ca-firms', '/for/consultants'],
  ['/solutions/accounting-teams', '/for/startups'],
  ['/solutions/small-businesses', '/for/startups'],
  ['/solutions/enterprises', '/products/financial-data-migration'],
  ['/industries', '/products'],
  ['/industries/accounting', '/for/consultants'],
  ['/industries/financial-services', '/for/startups'],
  ['/industries/professional-services', '/for/consultants'],
  ['/industries/corporate-compliance', '/products/incorporation-roc'],
  ['/case-studies', '/resources'],
  ['/case-studies-roi', '/resources'],
  ['/case-studies/:slug', '/resources'],
  ['/webinars', '/resources'],
  ['/about/our-story', '/about'],
  ['/about/mission-vision', '/about'],
  ['/about/our-team', '/about'],
  ['/about/partners', '/about'],
  ['/register', '/signup'],
];

export default function App() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} standalone={false}>
    <OfflineBanner />
    <Suspense fallback={<RouteLoader />}>
      <Routes>
        {/* Account pages */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />

          {/* Solutions */}
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/products" element={<ProductsOverviewPage />} />
          <Route path="/products/tally-to-zoho" element={<TallyToZohoPage />} />
          <Route path="/products/office-management" element={<OfficeManagementPage />} />
          <Route path="/products/incorporation-roc" element={<IncorporationRocPage />} />
          <Route path="/products/financial-statements" element={<FinancialStatementsPage />} />
          <Route path="/products/custom-automation" element={<CustomAutomationPage />} />
          <Route path="/products/mca-automation" element={<MCAAutomationPage />} />
          <Route path="/products/financial-data-migration" element={<FinancialMigrationPage />} />
          <Route path="/products/future-products" element={<FutureProductsPage />} />
          <Route path="/for/startups" element={<StartupsPage />} />
          <Route path="/for/consultants" element={<ConsultantsPage />} />

          {/* Company database */}
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/dashboard" element={<DatabaseDashboardPage />} />
          <Route path="/company/:slug" element={<CompanyDetailPage />} />
          <Route path="/director/:din" element={<DirectorPage />} />

          {/* Resources */}
          <Route path="/resources" element={<ResourcesOverviewPage />} />
          <Route path="/resources/tools" element={<ToolsLibraryPage />} />
          <Route path="/resources/tools/:slug" element={<ToolGuidePage />} />
          <Route path="/blog" element={<BlogPage />} />
          <Route path="/blog/:slug" element={<BlogDetailPage />} />
          <Route path="/faq" element={<FAQPage />} />

          {/* Guides and documentation */}
          <Route path="/guides" element={<GuidesOverviewPage />} />
          <Route path="/guides/tally-to-zoho-migration" element={<TallyMigrationGuidePage />} />
          <Route path="/guides/mca-automation" element={<MCAGuidePage />} />
          <Route path="/guides/account-setup" element={<AccountSetupGuidePage />} />
          <Route path="/guides/getting-started" element={<GettingStartedGuidePage />} />
          <Route path="/guides/troubleshooting" element={<TroubleshootingGuidePage />} />
          <Route path="/guides/data-validation" element={<DataValidationGuidePage />} />
          <Route path="/docs" element={<DocsOverviewPage />} />
          <Route path="/docs/tally-migration" element={<DocsTallyPage />} />
          <Route path="/docs/mca-automation" element={<DocsMCAPage />} />
          <Route path="/docs/installation" element={<DocsInstallPage />} />
          <Route path="/docs/browser-extension" element={<DocsBrowserExtPage />} />
          <Route path="/docs/workflows" element={<DocsWorkflowsPage />} />
          <Route path="/docs/integrations" element={<DocsIntegrationsPage />} />
          <Route path="/docs/troubleshooting" element={<DocsTroubleshootingPage />} />

          {/* Company */}
          <Route path="/about" element={<AboutPage />} />
          <Route path="/careers" element={<CareersPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/book-a-demo" element={<BookDemoPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/terms-and-conditions" element={<TermsPage />} />
          <Route path="/cookie-policy" element={<CookiePolicyPage />} />
          <Route path="/sitemap" element={<SitemapPage />} />

          {/* Old addresses */}
          {REDIRECTS.map(([from, to]) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
