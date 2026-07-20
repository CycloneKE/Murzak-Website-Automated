import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";

import Header from "./components/Header";
import Footer from "./components/Footer";
import InteractiveBackground from "./components/InteractiveBackground";

import Home from "./pages/Home";
import Cloud from "./pages/Cloud";
import Pricing from "./pages/Pricing";
import Products from "./pages/Products";
import About from "./pages/About";
import ContactPage from "./pages/ContactPage";
import TestRequest from "./pages/TestRequest";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import SLA from "./pages/SLA";
import Login from "./pages/Login";
import Portal from "./pages/Portal";
import Payment from "./pages/Payment";
import SalesModal from './components/SalesModal';
import RequireAuth from "./components/RequireAuth";
import { DeployWizard } from "./pages/DeployWizard/DeployWizard";

import MurzakPOS from "./pages/products/MurzakPOS";
import MurzakERP from "./pages/products/MurzakERP";
import MurzakCRM from "./pages/products/MurzakCRM";
import CustomSoftware from "./pages/products/CustomSoftware";

import ForRetail from "./pages/for/ForRetail";
import ForHealthcare from "./pages/for/ForHealthcare";
import ForLogistics from "./pages/for/ForLogistics";
import ForServices from "./pages/for/ForServices";

import { Page, User } from "./types";
import { logPageView } from "./services/firebase";

// ---- Map Page keys -> URL paths ----
const pageToPath: Record<Page, string> = {
  home: "/",
  services: "/services",
  cloud: "/cloud",
  pricing: "/pricing",
  solutions: "/solutions",
  products: "/products",
  about: "/about",
  contact: "/contact",
  "test-request": "/test-request",
  privacy: "/privacy",
  terms: "/terms",
  sla: "/sla",
  login: "/login",
  portal: "/portal",
  payment: "/payment",
  pos: "/products/pos",
  erp: "/products/erp",
  crm: "/products/crm",
  "custom-software": "/products/custom",
  "for-retail": "/for/retail",
  "for-clinics": "/for/clinics",
  "for-logistics": "/for/logistics",
  "for-services": "/for/services",
  deploy: "/deploy",
};

// Only exact non-nested pages belong here
const pathToPage: Record<string, Page> = {
  "/": "home",
  "/services": "services",
  "/cloud": "cloud",
  "/pricing": "pricing",
  "/solutions": "solutions",
  "/products": "products",
  "/about": "about",
  "/contact": "contact",
  "/test-request": "test-request",
  "/privacy": "privacy",
  "/terms": "terms",
  "/sla": "sla",
  "/login": "login",
  "/portal": "portal",   // base (nested handled below)
  "/payment": "payment",
  "/products/pos": "pos",
  "/products/erp": "erp",
  "/products/crm": "crm",
  "/products/custom": "custom-software",
  "/for/retail": "for-retail",
  "/for/clinics": "for-clinics",
  "/for/logistics": "for-logistics",
  "/for/services": "for-services",
  "/deploy": "deploy",
};

const pageMetadata: Record<Page, { title: string; description: string }> = {
  home: { title: "Murzak Technologies | Custom Software & Cloud Hosting Nairobi", description: "East Africa's trusted partner for custom enterprise software development." },
  services: { title: "Custom Software Development & ERP Systems Nairobi | Murzak", description: "Professional software engineering for Kenyan enterprises." },
  cloud: { title: "Managed Cloud Hosting & Secure VPS Kenya | Murzak Cloud", description: "Fast, secure, and locally-managed cloud hosting in Nairobi." },
  pricing: { title: "Pricing Plans | Custom Software & Managed Cloud Nairobi", description: "Transparent pricing for Murzak services." },
  solutions: { title: "Solutions | Fixes for Real Business Problems | Murzak", description: "Hosting, business systems and custom software that solve the problems slowing your business down." },
  products: { title: "Products | Ready-Made Systems & Custom Software | Murzak", description: "Hosted ERP, POS and CRM you can use today — or bespoke software built around your workflow." },
  about: { title: "About Murzak Technologies | Our Mission for East Africa", description: "Nairobi-born technology company bridging the gap." },
  contact: { title: "Contact Us | Custom Software Sales & Support Nairobi", description: "Get in touch with Murzak Technologies." },
  "test-request": { title: "Request Murzak Cloud Trial | 36-Hour Free Evaluation", description: "Experience the performance of Murzak Cloud." },
  privacy: { title: "Privacy Policy | Murzak Technologies Data Compliance", description: "Data protection as per the Kenya Data Protection Act 2019." },
  terms: { title: "Terms of Service | Legal Framework for Murzak Services", description: "Standard terms and conditions." },
  sla: { title: "Service Level Agreement (SLA) | Murzak Cloud Guarantee", description: "Our commitment to 99.9% uptime." },
  login: { title: "Client Login | Murzak Technologies Secure Portal", description: "Access your cloud clusters and software project dashboards." },
  portal: { title: "Client Portal | Murzak Technologies Dashboard", description: "Managed Murzak Cloud and Software project status." },
  payment: { title: "Secure Checkout | Murzak Technologies Payment Gateway", description: "Process your subscription or setup fees securely." },
  pos: { title: "Murzak POS & Inventory | Cloud Point of Sale Kenya", description: "Fast, multi-branch POS with M-Pesa integration." },
  erp: { title: "Murzak ERP | Business Management System Kenya", description: "Accounting, Inventory, and HR configured for Kenya." },
  crm: { title: "Murzak CRM & Helpdesk | Customer Management", description: "Track every lead and ticket seamlessly." },
  "custom-software": { title: "Custom Software Development Nairobi | Murzak", description: "Bespoke operational systems and portals." },
  "for-retail": { title: "Tech Stack for Retail & Shops | Murzak", description: "POS and inventory for Kenyan retail." },
  "for-clinics": { title: "Tech Stack for Clinics | Murzak", description: "Healthcare ERP and booking systems." },
  "for-logistics": { title: "Tech Stack for Logistics | Murzak", description: "Dispatch and fleet management systems." },
  "for-services": { title: "Tech Stack for Professional Services | Murzak", description: "CRM and invoicing for agencies and firms." },
  deploy: { title: "Deploy Your App | Murzak", description: "Deploy your GitHub repository instantly to our global edge network." },
};

// Above-the-fold hero background per route — preloaded on navigation so the
// browser fetches it immediately instead of discovering it only once CSS
// parses the bg-fixed rule (which otherwise costs a visible fade-in).
const heroImages: Partial<Record<Page, string>> = {
  home: "/images/server-man.webp",
  cloud: "/images/server-glow.webp",
  products: "/images/products-hero.webp",
  about: "/images/about-hero.webp",
  "custom-software": "/images/custom-software-hero.webp",
  login: "/images/data-center.webp",
};

const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Derive activePage from URL (handle nested portal routes)
  const activePage: Page = useMemo(() => {
    if (location.pathname.startsWith("/portal")) return "portal";
    if (location.pathname === "/payment") return "payment";
    return pathToPage[location.pathname] || "home";
  }, [location.pathname]);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [isBackendDown, setIsBackendDown] = useState(false);

  // Single authoritative session hydration. /api/auth/me reads the server-side
  // session (httpOnly cookie); on any failure we reset to logged-out so a stale
  // client state can never keep the portal open after the server says otherwise.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (res.ok && data.ok && data.user) {
          console.log("APP.TSX /API/AUTH/ME USER:", JSON.stringify(data.user));
          setUser(data.user);
          setIsLoggedIn(true);
        } else {
          setUser(null);
          setIsLoggedIn(false);
        }
      } catch {
        if (mounted) {
          setUser(null);
          setIsLoggedIn(false);
        }
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleApiError = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.status === 502 || customEvent.detail?.status === 503) {
        setIsBackendDown(true);
      }
    };
    window.addEventListener('api-gateway-error', handleApiError);
    return () => window.removeEventListener('api-gateway-error', handleApiError);
  }, []);

  // Mid-session 401 (cookie expired, session store restarted, etc.) — clear
  // client state and bounce to login with a "session expired" reason so the
  // banner only shows for a genuine expiry, never a cold logged-out visit
  // (the boot-time /api/auth/me call is exempt in the interceptor above).
  const sessionExpiredHandled = useRef(false);
  useEffect(() => {
    const handleSessionExpired = () => {
      if (sessionExpiredHandled.current || booting) return;
      sessionExpiredHandled.current = true;
      setUser(null);
      setIsLoggedIn(false);
      const returnTo = encodeURIComponent(location.pathname + location.search);
      navigate(`/login?returnTo=${returnTo}&reason=session-expired`);
    };
    window.addEventListener('session-expired', handleSessionExpired);
    return () => window.removeEventListener('session-expired', handleSessionExpired);
  }, [booting, location.pathname, location.search, navigate]);

  // GA4 page_view on every route change (no-op unless Firebase Analytics is configured).
  useEffect(() => {
    const meta = pageMetadata[activePage] || pageMetadata.home;
    logPageView(location.pathname + location.search, meta.title);
  }, [location.pathname, location.search, activePage]);

  useEffect(() => {
    const meta = pageMetadata[activePage] || pageMetadata.home;
    document.title = meta.title;
    window.scrollTo({ top: 0, behavior: "auto" });

    setIsPageLoading(true);
    const timer = setTimeout(() => setIsPageLoading(false), 700);
    return () => clearTimeout(timer);
  }, [activePage]);

  // Preload the current route's hero background so the browser starts
  // fetching it immediately on navigation rather than waiting to parse the
  // bg-fixed CSS rule that references it.
  useEffect(() => {
    const href = heroImages[activePage];
    if (!href) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = href;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [activePage]);


  const onNavigate = (pageOrPath: Page | string) => {
    // If a full path (e.g. "/pricing#pricing-plans") is passed, use it directly
    if (typeof pageOrPath === "string" && pageOrPath.startsWith("/")) {
      navigate(pageOrPath);
      return;
    }

    // Otherwise, assume it's a Page key and map to path
    const path = pageToPath[pageOrPath as Page] || "/";
    navigate(path);
  };

  const handleLogin = (u: User, returnTo?: string) => {
    setUser(u);
    setIsLoggedIn(true);
    sessionExpiredHandled.current = false;
    navigate(returnTo || "/portal/overview");
  };

  const handleUserUpdate = (u: User) => {
    setUser(u);
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    // Tear down the server-side session (and its cookie) first, so a refresh
    // can't silently re-authenticate from a still-valid session.
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch {
      /* even if the network call fails, still clear local state below */
    }
    setUser(null);
    setIsLoggedIn(false);
    navigate("/");
  };

  const handleSelectPlan = async (planName: string, returnTo = "/portal/billing") => {
    setPendingPlan(planName);

    try {
      await fetch("/api/plan/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ planName }),
      });
    } catch (e) {
      console.error("Failed to store plan selection", e);
    }

    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const handlePaymentSuccess = (freshUser?: User) => {
    if (freshUser) {
      setUser(freshUser);
    } else if (user) {
      setUser({ ...user, accountStatus: "Provisioning" as const });
    }
    navigate("/portal/overview");
  };

  const isPortalRoute = location.pathname.startsWith("/portal");
  const isPaymentRoute = location.pathname === "/payment";
  const hideChrome = isPortalRoute || location.pathname === "/login" || isPaymentRoute;

  if (booting) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center relative overflow-hidden bg-murzak-base">
        <InteractiveBackground isDarkMode={false} />
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-black/5 backdrop-blur-xl border border-murzak-border flex items-center justify-center shadow-[0_0_30px_rgba(0,189,252,0.2)] animate-glow-pulse mb-6">
            <div className="w-8 h-8 rounded-full border-t-2 border-b-2 border-murzak-accent animate-spin"></div>
          </div>
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 animate-pulse">
            Authenticating...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-[100vw] overflow-x-hidden relative">
      <InteractiveBackground isDarkMode={false} />

      <div className={`relative z-10 flex flex-col min-h-screen w-full ${(isPortalRoute || isPaymentRoute) ? "bg-white/95 dark:bg-murzak-ink/95 backdrop-blur-md rounded-t-[40px] shadow-2xl" : "bg-transparent"}`}>
        {!hideChrome && (
          <Header
            activePage={activePage}
            onNavigate={onNavigate}
            isLoggedIn={isLoggedIn}
            onOpenSales={() => setIsSalesModalOpen(true)}
          />
        )}
  
        <main className={`flex-grow relative ${!hideChrome ? "pt-16 sm:pt-20 lg:pt-28" : ""}`}>
          <div className="max-w-full overflow-x-hidden">
            <Routes>
              <Route path="/" element={<Home onNavigate={onNavigate} isLoading={isPageLoading} />} />
              <Route path="/services" element={<Navigate to="/products" replace />} />
              <Route path="/cloud" element={<Cloud onNavigate={onNavigate} isLoading={isPageLoading} isLoggedIn={isLoggedIn} />} />
              <Route path="/pricing" element={<Pricing onNavigate={onNavigate} onSelectPlan={handleSelectPlan} isLoading={isPageLoading} isLoggedIn={isLoggedIn} user={user} onUserUpdate={handleUserUpdate} />} />
              {/* Solutions merged into Products — redirect legacy links. */}
              <Route path="/solutions" element={<Navigate to="/products" replace />} />
              <Route path="/products" element={<Products onNavigate={onNavigate} isLoading={isPageLoading} />} />
              <Route path="/about" element={<About onNavigate={onNavigate} isLoading={isPageLoading} />} />
              <Route path="/contact" element={<ContactPage onNavigate={onNavigate} />} />
              <Route path="/test-request" element={<TestRequest onNavigate={onNavigate} />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/sla" element={<SLA />} />

              <Route path="/products/pos" element={<MurzakPOS onNavigate={onNavigate} />} />
              <Route path="/products/erp" element={<MurzakERP onNavigate={onNavigate} />} />
              <Route path="/products/crm" element={<MurzakCRM onNavigate={onNavigate} />} />
              <Route path="/products/custom" element={<CustomSoftware onNavigate={onNavigate} />} />
              
              <Route path="/for/retail" element={<ForRetail onNavigate={onNavigate} />} />
              <Route path="/for/clinics" element={<ForHealthcare onNavigate={onNavigate} />} />
              <Route path="/for/logistics" element={<ForLogistics onNavigate={onNavigate} />} />
              <Route path="/for/services" element={<ForServices onNavigate={onNavigate} />} />

              <Route
                path="/deploy"
                element={
                  <RequireAuth user={user}>
                    <DeployWizard />
                  </RequireAuth>
                }
              />

              <Route path="/login" element={<Login onLogin={handleLogin} onNavigate={onNavigate} initialPlan={pendingPlan} defaultMode="login" />} />

              <Route
                path="/portal/*"
                element={
                  <RequireAuth user={user}>
                  <Portal
                    user={user}
                    onLogout={handleLogout}
                    onNavigate={onNavigate}
                    onUserUpdate={handleUserUpdate}
                  />
                  </RequireAuth>
                }/>

              <Route
                path="/payment/:invoiceDocName"
                element={
                  <RequireAuth user={user}>
                    <Payment onNavigate={onNavigate} onSuccess={handlePaymentSuccess} />
                  </RequireAuth>
                }
              />

              <Route
                path="/payment"
                element={<Navigate to="/portal/billing" replace />}
              />

              {/* 404 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>

        {!hideChrome && <Footer onNavigate={onNavigate} />}
      </div>

      {isBackendDown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="bg-gray-900 border border-red-900/50 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center mx-4">
            <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-murzak-ink dark:text-slate-100 mb-2">Service Temporarily Unavailable</h2>
            <p className="text-gray-400 mb-6">
              Our backend systems are currently undergoing maintenance or experiencing high traffic. Please try again in a few minutes.
            </p>
            <button 
              onClick={() => window.location.reload()} 
              className="bg-murzak-success hover:bg-murzak-success/90 text-black font-semibold py-3 px-6 rounded-lg transition-colors w-full"
            >
              Reload Page
            </button>
          </div>
        </div>
      )}
      
      <SalesModal isOpen={isSalesModalOpen} onClose={() => setIsSalesModalOpen(false)} />
    </div>
  );
};

export default App;
