import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";

import Header from "./components/Header";
import Footer from "./components/Footer";
import InteractiveBackground from "./components/InteractiveBackground";

import Home from "./pages/Home";
import Cloud from "./pages/Cloud";
import Pricing from "./pages/Pricing";
import Solutions from "./pages/Solutions";
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

  // Dark-only: the marketing pages render light text on the fixed dark site
  // backdrop, so a light theme leaves the header, gradients and hero copy
  // unreadable. Light mode was removed; the app is committed to the dark brand.

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
    window.document.documentElement.classList.add("dark");
    localStorage.setItem("theme", "dark");
  }, []);

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

  const handleLogin = (u: User) => {
    setUser(u);
    setIsLoggedIn(true);
    navigate("/portal/overview");
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
    return <div className="h-screen flex items-center justify-center">Loading…</div>;
  }

  return (
    <div className="flex flex-col min-h-screen max-w-[100vw] overflow-x-hidden relative">
      <InteractiveBackground isDarkMode={true} />

      <div className={`relative z-10 flex flex-col min-h-screen w-full ${(isPortalRoute || isPaymentRoute) ? "bg-white/95 dark:bg-murzak-deep backdrop-blur-md rounded-t-[40px] shadow-2xl" : "bg-transparent"}`}>
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
              <Route path="/cloud" element={<Cloud onNavigate={onNavigate} isLoading={isPageLoading} />} />
              <Route path="/pricing" element={<Pricing onNavigate={onNavigate} onSelectPlan={handleSelectPlan} isLoading={isPageLoading} />} />
              <Route path="/solutions" element={<Solutions onNavigate={onNavigate} isLoading={isPageLoading} />} />
              <Route path="/products" element={<Products onNavigate={onNavigate} isLoading={isPageLoading} />} />
              <Route path="/about" element={<About onNavigate={onNavigate} isLoading={isPageLoading} />} />
              <Route path="/contact" element={<ContactPage onNavigate={onNavigate} />} />
              <Route path="/test-request" element={<TestRequest onNavigate={onNavigate} />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/sla" element={<SLA />} />

              <Route path="/login" element={<Login onLogin={handleLogin} onNavigate={onNavigate} initialPlan={pendingPlan} defaultMode="login" />} />

              <Route
                path="/portal/*"
                element={
                  <RequireAuth user={user}>
                  <Portal
                    user={user}
                    onLogout={handleLogout}
                    onNavigate={onNavigate}
                    onUserUpdate={handleLogin}
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
      
      <SalesModal isOpen={isSalesModalOpen} onClose={() => setIsSalesModalOpen(false)} />
    </div>
  );
};

export default App;
