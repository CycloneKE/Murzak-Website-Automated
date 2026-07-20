import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu, X, User, LogIn, ChevronDown, Sun, Moon } from "lucide-react";
import { Page, NavItem } from "../types";
import Logo from "./Logo";
import { useTheme } from "../context/ThemeContext";

interface HeaderProps {
  activePage: Page;
  onNavigate: (page: Page | string) => void;
  isLoggedIn: boolean;
  onOpenSales?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  activePage,
  onNavigate,
  isLoggedIn,
  onOpenSales,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const location = useLocation();
  const { effective, toggle } = useTheme();

  useEffect(() => {
    if (isMenuOpen) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    } else {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };
  }, [isMenuOpen]);

  useEffect(() => {
    setIsMenuOpen(false);
    setProductsOpen(false);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  }, [location.pathname]);

  const navItems = [
    { label: "Home", page: "home" },
    { label: "Murzak Cloud", page: "cloud" },
    { 
      label: "Products", 
      page: "products",
      submenu: [
        { group: "Ready-Made Systems", items: [
          { label: "POS & Inventory", page: "pos" },
          { label: "Murzak ERP", page: "erp" },
          { label: "CRM & Helpdesk", page: "crm" },
        ]},
        { group: "Custom Build & Hosting", items: [
          { label: "App Hosting (BYOA)", page: "deploy" },
          { label: "Custom Software", page: "custom-software" },
        ]},
        { group: "Industries", items: [
          { label: "For Retail", page: "for-retail" },
          { label: "For Clinics", page: "for-clinics" },
          { label: "For Logistics", page: "for-logistics" },
          { label: "For Services", page: "for-services" },
        ]}
      ]
    },
    { label: "Pricing", page: "pricing" },
    { label: "About", page: "about" },
  ];

  const handleMobileNav = (page: string) => {
    setIsMenuOpen(false);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
    onNavigate(page as Page);
  };

  const handleSalesClick = () => {
    setIsMenuOpen(false);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
    if (onOpenSales) {
      onOpenSales();
    } else {
      onNavigate("contact");
    }
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 glass-panel border-b-0 transition-all duration-300">
        <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10 opacity-30">
          <div className="absolute top-[-60px] right-[30%] w-[500px] h-[100px] bg-murzak-brand1/20 blur-[80px] rounded-full animate-drift" />
        </div>

        <div className="max-w-[1536px] mx-auto px-4 sm:px-6 lg:px-12">
          <div className="flex items-center justify-between h-16 sm:h-20 lg:h-24 transition-all">
            <button
              className="flex items-center cursor-pointer group focus:outline-none shrink-0"
              onClick={() => handleMobileNav("home")}
            >
              <Logo className="scale-90 sm:scale-100 origin-left transition-transform group-hover:scale-105" />
            </button>

            {/* Desktop Navigation */}
            <div className="hidden xl:flex flex-grow items-center justify-center px-4">
              <nav className="flex items-center gap-x-8" aria-label="Main Navigation">
                {navItems.map((item) => (
                  <div key={item.page} className="relative group/nav">
                    <button
                      onClick={() => item.submenu ? onNavigate(item.page) : onNavigate(item.page as Page)}
                      className={`flex items-center gap-1.5 text-sm font-semibold transition-all relative py-2 group focus:outline-none whitespace-nowrap ${
                        activePage === item.page || (item.submenu && item.submenu.some(g => g.items.some(i => i.page === activePage)))
                          ? "text-murzak-brand2"
                          : "text-murzak-muted dark:text-slate-400 hover:text-murzak-accent"
                      }`}
                    >
                      {item.label}
                      {item.submenu && <ChevronDown size={16} className="group-hover/nav:rotate-180 transition-transform" />}
                      <span
                        className={`absolute bottom-0 left-0 h-[2px] bg-murzak-accent transition-all duration-300 ease-out origin-left ${
                          activePage === item.page || (item.submenu && item.submenu.some(g => g.items.some(i => i.page === activePage))) ? "w-full scale-x-100" : "w-full scale-x-0 group-hover:scale-x-100"
                        }`}
                      />
                    </button>

                    {item.submenu && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 pt-6 opacity-0 translate-y-2 pointer-events-none group-hover/nav:opacity-100 group-hover/nav:translate-y-0 group-hover/nav:pointer-events-auto transition-all duration-300">
                        <div className="glass-panel rounded-3xl p-8 shadow-xl flex gap-12 w-[650px]">
                          {item.submenu.map(group => (
                            <div key={group.group} className="flex-1">
                              <h4 className="font-mono text-xs font-semibold tracking-wider text-murzak-accent mb-4 uppercase">{group.group}</h4>
                              <ul className="space-y-3">
                                {group.items.map(sub => (
                                  <li key={sub.page}>
                                    <button onClick={() => onNavigate(sub.page as Page)} className="text-sm font-medium text-murzak-ink dark:text-slate-100 hover:text-murzak-accent transition-colors block text-left">
                                      {sub.label}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </nav>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-4 shrink-0 ml-auto">
              <div className="hidden sm:flex items-center gap-2 lg:gap-4">
                {isLoggedIn ? (
                  <button
                    onClick={() => onNavigate("portal")}
                    className="bg-brand-gradient text-murzak-ink px-5 sm:px-6 py-2.5 sm:py-3 rounded-full font-semibold text-sm hover:scale-[1.02] transition-all shadow-md flex items-center gap-2"
                  >
                    <User className="w-4 h-4" /> Dashboard
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => onNavigate("login")}
                      className="flex items-center gap-2 bg-white border border-murzak-border text-murzak-ink font-semibold text-sm hover:border-murzak-accent hover:text-murzak-accent transition-all px-4 sm:px-6 py-2 sm:py-2.5 rounded-full shadow-sm"
                    >
                      <LogIn className="w-4 h-4 text-murzak-accent" /> Login
                    </button>
                    <button
                      onClick={handleSalesClick}
                      className="bg-brand-gradient text-murzak-ink px-5 sm:px-6 py-2 sm:py-2.5 rounded-full font-semibold text-sm hover:scale-[1.02] transition-all shadow-md whitespace-nowrap"
                    >
                      Talk to Sales
                    </button>
                  </>
                )}
              </div>

              <button
                onClick={toggle}
                className="p-2.5 sm:p-3 rounded-full text-murzak-ink dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-murzak-accent"
                aria-label={effective === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={effective === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {effective === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              <button
                onClick={() => setIsMenuOpen((v) => !v)}
                className="xl:hidden p-2.5 sm:p-3 text-murzak-ink dark:text-slate-100 relative z-[70]"
                aria-label={isMenuOpen ? "Close menu" : "Open menu"}
              >
                {isMenuOpen ? <X className="w-6 h-6 sm:w-7 sm:h-7" /> : <Menu className="w-6 h-6 sm:w-7 sm:h-7" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-[55] bg-black/15 dark:bg-black/40 backdrop-blur-sm xl:hidden animate-fade-in"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      <aside
        className={`fixed top-0 right-0 bottom-0 z-[60] w-64 max-w-[360px] bg-white/90 dark:bg-murzak-ink/95 backdrop-blur-md sm:backdrop-blur-2xl
          border-l border-slate-200 dark:border-murzak-border flex flex-col p-6 sm:p-8 transition-transform duration-500 ease-in-out xl:hidden h-dvh overflow-hidden
          ${isMenuOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex justify-between items-center mb-10 sm:mb-14 pt-1">
          <Logo className="scale-90 origin-left" />
          <button
            onClick={() => setIsMenuOpen(false)}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-black/5 text-murzak-ink dark:text-slate-100 transition"
            aria-label="Close menu"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
        <nav className="space-y-4 flex flex-col pb-6">
          {navItems.map((item) => (
            <div key={item.page} className="flex flex-col">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => item.submenu ? setProductsOpen(!productsOpen) : handleMobileNav(item.page)}
                  className={`text-lg sm:text-xl font-[900] uppercase text-left tracking-tight py-2 transition-colors ${
                    activePage === item.page || (item.submenu && item.submenu.some(g => g.items.some(i => i.page === activePage))) ? "text-murzak-accent" : "text-murzak-ink dark:text-slate-100 hover:text-murzak-accent"
                  }`}
                >
                  {item.label}
                </button>
                {item.submenu && (
                  <button onClick={() => setProductsOpen(!productsOpen)} className="p-2 text-slate-500">
                    <ChevronDown size={20} className={`transition-transform ${productsOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {item.submenu && productsOpen && (
                <div className="pl-4 mt-2 space-y-4 border-l-2 border-murzak-accent/30">
                  {item.submenu.map(group => (
                    <div key={group.group}>
                      <div className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mb-2">{group.group}</div>
                      <div className="flex flex-col space-y-2">
                        {group.items.map(sub => (
                          <button key={sub.page} onClick={() => handleMobileNav(sub.page)} className="text-sm font-bold text-left text-slate-600 dark:text-slate-400 hover:text-murzak-accent transition-colors py-1">
                            {sub.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button onClick={() => handleMobileNav('products')} className="text-sm font-bold text-left text-murzak-accent mt-2">
                    View All Products →
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>
        </div>

        <div className="pt-8 border-t border-slate-200 dark:border-murzak-border space-y-4">
          {isLoggedIn ? (
            <button
              onClick={() => handleMobileNav("portal")}
              className="w-full bg-murzak-accent text-murzak-ink px-5 py-3.5 rounded-xl font-black text-micro sm:text-micro uppercase flex items-center justify-center gap-2"
            >
              <User className="w-4 h-4 sm:w-[18px] sm:h-[18px]" /> Client Dashboard
            </button>
          ) : (
            <div className="flex flex-col gap-4">
              <button
                onClick={() => handleMobileNav("login")}
                className="w-full bg-slate-100 dark:bg-black/5 text-murzak-ink dark:text-slate-100 px-5 py-3.5 rounded-xl font-black text-micro sm:text-micro uppercase border border-slate-200 dark:border-murzak-border"
              >
                Account Login
              </button>
              <button
                onClick={handleSalesClick}
                className="w-full bg-murzak-accent text-murzak-ink px-5 py-3.5 rounded-xl font-black text-micro sm:text-micro uppercase shadow-xl hover:scale-[1.02] transition-all"
              >
                Talk to Sales
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default Header;
