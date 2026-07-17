
import React, { useState, useEffect } from 'react';
import { Lock, Mail, ArrowRight, ShieldCheck, RefreshCw, ChevronLeft, User as UserIcon, Building, Smartphone, FileText, Code, CheckSquare, AlertCircle, Eye, EyeOff } from 'lucide-react';
import Logo from '../components/Logo';
import { Page, User } from '../types';
import { firebaseEnabled, getGoogleIdToken } from '../services/firebase';
import { useLocation, useNavigate } from "react-router-dom";

interface LoginProps {
  onLogin: (user: User, returnTo?: string) => void;
  onNavigate: (page: Page) => void;
  initialPlan?: string | null;
  defaultMode?: 'login' | 'signup';
}

  const Login: React.FC<LoginProps> = ({ onLogin, onNavigate, initialPlan, defaultMode = 'login' }) => {
    const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(() => {
    return defaultMode;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const location = useLocation();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [pendingAttachError, setPendingAttachError] = useState<string>("");
  const [googleLoading, setGoogleLoading] = useState(false);

  const params = new URLSearchParams(location.search);
  const returnTo = params.get("returnTo") || "/portal/overview";

  // Handle password-reset links and email-verification redirects.
  useEffect(() => {
    const token = params.get("reset");
    const verify = params.get("verify");
    if (token) {
      setResetToken(token);
      setMode("reset");
    }
    if (verify === "success") {
      setInfo("Your email has been verified. You can now log in.");
    } else if (verify === "invalid") {
      setError("That verification link is invalid or has expired.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    password: '',
    purpose: '',
    sourceCode: '',
    authorized: false
  });

  useEffect(() => {
    if (defaultMode) setMode(defaultMode);
  }, [defaultMode]);

  useEffect(() => {
    const selected = JSON.parse(localStorage.getItem("murzak_selected_plan") || "null");
    if (selected?.plan !== "Test") return;

    // Force signup only if not explicitly logging in
    if (defaultMode !== "login") {
      setMode("signup");
    }

    // Prefill from whatever we already stored
    setFormData((prev) => ({
      ...prev,
      name: selected.contactName || prev.name,
      company: selected.company || prev.company,
      email: selected.email || prev.email,
      purpose: selected.testingGoal || prev.purpose, // if you want to map it here
    }));

    // If we have a Test Plan Invoice id, fetch the authoritative data
    const id = selected.test_invoice_id;
    if (!id) return;

    (async () => {
      try {
        const res = await fetch(`/api/test-plan/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;

        const t = data.trial;
        setFormData((prev) => ({
          ...prev,
          name: t.contactName || prev.name,
          company: t.company || prev.company,
          email: t.email || prev.email,
          purpose: t.testingGoal || prev.purpose,
        }));

        // Keep localStorage updated so it persists
        localStorage.setItem("murzak_selected_plan", JSON.stringify({
          ...selected,
          contactName: t.contactName,
          email: t.email,
          company: t.company,
          testingGoal: t.testingGoal,
          usageLevel: t.usageLevel,
        }));
      } catch (e) {
        console.warn("Trial prefill failed", e);
      }
   })();
  }, []);

  // If a pending cloud-launch selection carries a repo URL (App Hosting),
  // prefill the signup form's repo field so the visitor doesn't retype it.
  useEffect(() => {
    try {
      const pendingRaw = localStorage.getItem("murzak_plan_selection_pending");
      if (!pendingRaw) return;
      const pending = JSON.parse(pendingRaw);
      if (pending?.repoUrl) {
        setFormData((prev) => (prev.sourceCode ? prev : { ...prev, sourceCode: pending.repoUrl }));
      }
    } catch (e) {
      console.warn("Repo URL prefill failed", e);
    }
  }, []);

  const validate = () => {
    const errs: Record<string, string> = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.email.trim()) {
      errs.email = 'Email is required';
    } else if (!emailRegex.test(formData.email)) {
      errs.email = 'Invalid email format';
    }

    if (!formData.password.trim()) {
      errs.password = 'Password is required';
    } else if (formData.password.length < 8) {
      errs.password = 'Minimum 8 characters';
    }

    if (mode === 'signup') {
      if (!formData.name.trim()) errs.name = 'Full name required';
      if (!formData.company.trim()) errs.company = 'Business name required';
      if (!formData.purpose.trim()) errs.purpose = 'Purpose is required';
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

const attachPendingSelection = async (currentUser?: User) => {
  const pendingRaw = localStorage.getItem("murzak_plan_selection_pending");
  if (!pendingRaw) return;

  const pending = JSON.parse(pendingRaw);

  const upgradeIntent = !!pending.upgradeIntent;
  const upgradeMode = pending.upgradeMode || "";

  const currentPlan = (currentUser?.plan || "None").trim();
  const pendingPlan = (pending.plan || "None").trim();

  // ✅ Only block mismatches when NOT in upgrade mode
  if (!upgradeIntent && currentPlan !== "None" && currentPlan !== pendingPlan) {
    throw new Error(
      `Plan mismatch: you are on ${currentPlan}, but your selection is for ${pendingPlan}. Use Add-ons or change plan.`
    );
  }

  const res = await fetch("/api/plan/attach-selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      planKey: pendingPlan,
      selectedServices: pending.selectedServices || [],
      upgradeIntent,
      upgradeMode,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (data?.code === "PLAN_LIMIT_EXCEEDED") {
      localStorage.removeItem("murzak_plan_selection_pending");
      sessionStorage.removeItem("murzak_upgrade_intent");
      sessionStorage.removeItem("murzak_upgrade_mode");
    }

    // ✅ Keep error visible (don't auto-clear here)
    throw new Error(data?.message || data?.error || "Failed to attach selection.");
  }

  // Update app user state immediately (portal will reflect changes)
  if (data?.user) onLogin(data.user);

  // A cloud-launch selection may carry the repo URL for an App Hosting
  // deploy; persist it now so provisioning has a repo to build from.
  if (typeof pending.repoUrl === "string" && pending.repoUrl.trim()) {
    try {
      const r = await fetch("/api/portal/account/repo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ repoUrl: pending.repoUrl.trim() }),
      });
      if (!r.ok) {
        console.warn("Pending repo URL save failed (editable later in Portal):", r.status);
      }
    } catch (e) {
      console.warn("Pending repo URL save failed (editable later in Portal):", e);
    }
  }

  // ✅ success: clear pending selection + upgrade flags
  localStorage.removeItem("murzak_plan_selection_pending");
  sessionStorage.removeItem("murzak_upgrade_intent");
  sessionStorage.removeItem("murzak_upgrade_mode");

  // Find if an unpaid invoice was just generated
  if (data?.invoices && Array.isArray(data.invoices)) {
    const unpaidInvoice = data.invoices.find((inv: any) => inv.status === "Unpaid");
    if (unpaidInvoice) {
      return unpaidInvoice.docName || unpaidInvoice.name;
    }
  }
  return null;
};

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!validate()) return;

  setIsSubmitting(true);
  setError("");
  setPendingAttachError("");

  try {
    if (mode === "login") {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === "Account has no password set." || data?.error?.includes("Google")) {
          throw new Error("This account uses Google sign-in. Please click 'Continue with Google'.");
        }
        throw new Error(data?.error || "Login failed");
      }

      try {
        const generatedInvoiceId = await attachPendingSelection(data.user);
        if (generatedInvoiceId) {
          onLogin(data.user, `/payment/${generatedInvoiceId}`);
          return;
        }
      } catch (e: any) {
        const msg = e?.message || "Unable to attach your selected plan/services.";
        console.warn("Attach pending selection failed:", msg);
        // Navigate using react-router state so Portal can show it immediately
        navigate("/portal/overview", { state: { attachError: msg } });
        // update user without navigating from onLogin since we already navigated
        onLogin(data.user, "/portal/overview");
        return;
      }

      const selected = JSON.parse(localStorage.getItem("murzak_selected_plan") || "null");
      if (selected?.plan === "Test" && selected?.email) {
        onLogin(data.user, "/portal");
        return;
      }

      onLogin(data.user, returnTo);
      return;
    }

    // ---- SIGNUP ----
    const planToAssign = initialPlan
      ? initialPlan.includes("Test")
        ? "Test"
        : (initialPlan.split(" ")[0] as any)
      : "None";

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name: formData.name,
        email: formData.email,
        company: formData.company,
        password: formData.password,
        purpose: formData.purpose,
        sourceCode: formData.sourceCode,
        plan: planToAssign,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Signup failed");

    try {
      const generatedInvoiceId = await attachPendingSelection(data.user);
      if (generatedInvoiceId) {
        onLogin(data.user, `/payment/${generatedInvoiceId}`);
        return;
      }
    } catch (e: any) {
      const msg = e?.message || "Unable to attach your selected plan/services.";
      sessionStorage.setItem("murzak_pending_attach_error", msg);
      console.warn("Attach pending selection failed:", msg);

      navigate("/portal/overview");
      onLogin(data.user, "/portal/overview");
      return;      
    }

    onLogin(data.user, returnTo);
  } catch (err: any) {
    console.error(err);
    setError(err.message || "Request failed");
  } finally {
    setIsSubmitting(false);
  }
};

const handleGoogle = async () => {
  setError("");
  setPendingAttachError("");
  setGoogleLoading(true);
  try {
    const idToken = await getGoogleIdToken();

    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ idToken }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Google sign-in failed");

    // Mirror the password-login success path.
    try {
      const generatedInvoiceId = await attachPendingSelection(data.user);
      if (generatedInvoiceId) {
        onLogin(data.user, `/payment/${generatedInvoiceId}`);
        return;
      }
    } catch (e: any) {
      const msg = e?.message || "Unable to attach your selected plan/services.";
      console.warn("Attach pending selection failed:", msg);
      navigate("/portal/overview", { state: { attachError: msg } });
      onLogin(data.user, "/portal/overview");
      return;
    }

    onLogin(data.user, returnTo);
  } catch (err: any) {
    // Popup-closed / cancelled shouldn't read as a hard error.
    const code = err?.code || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      return;
    }
    console.error(err);
    setError(err?.message || "Google sign-in failed");
  } finally {
    setGoogleLoading(false);
  }
};

const handleForgot = async (e: React.FormEvent) => {
  e.preventDefault();
  setError("");
  setInfo("");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(formData.email)) {
    setFieldErrors({ email: "Enter a valid email" });
    return;
  }
  setIsSubmitting(true);
  try {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formData.email }),
    });
    const data = await res.json().catch(() => ({}));
    setInfo(data?.message || "If an account exists for that email, a reset link has been sent.");
  } catch (err: any) {
    setError("Something went wrong. Please try again.");
  } finally {
    setIsSubmitting(false);
  }
};

const handleReset = async (e: React.FormEvent) => {
  e.preventDefault();
  setError("");
  setInfo("");
  if (formData.password.length < 8) {
    setFieldErrors({ password: "Minimum 8 characters" });
    return;
  }
  setIsSubmitting(true);
  try {
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: formData.password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Could not reset password.");
    setInfo("Your password has been reset. You can now log in.");
    setMode("login");
    setFormData((p) => ({ ...p, password: "" }));
    navigate("/login", { replace: true });
  } catch (err: any) {
    setError(err.message || "Could not reset password.");
  } finally {
    setIsSubmitting(false);
  }
};

  const inputStyles = (name: string) => `
    w-full bg-slate-100/50 dark:bg-white/10
    border ${fieldErrors[name] ? "border-red-500" : "border-slate-200 dark:border-white/20"} rounded-xl sm:rounded-2xl py-3 sm:py-4
    pl-11 sm:pl-12 pr-10 text-sm sm:text-base font-semibold text-murzak-navy dark:text-white
    placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-murzak-cyan transition-all duration-200
  `;

  const labelStyles = "text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block";

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center p-3 sm:p-4 lg:p-6 relative overflow-hidden">
      <div className="absolute top-6 lg:top-10 left-6 lg:left-10 z-20">
        <button onClick={() => onNavigate('home')} className="flex items-center gap-2 text-slate-300 font-black text-[10px] uppercase tracking-[0.2em] hover:text-murzak-cyan transition-colors drop-shadow">
          <ChevronLeft size={16} /> Back
        </button>
      </div>

      <div className="max-w-4xl w-full relative z-10 py-10">
        <div className="text-center mb-10">
          <Logo className="h-12 lg:h-14 mx-auto mb-8" />
          <h1 className="text-3xl lg:text-5xl font-[900] text-white tracking-tighter uppercase drop-shadow-lg">
            {mode === 'login' && 'Client Dashboard'}
            {mode === 'signup' && 'Account Setup'}
            {mode === 'forgot' && 'Reset Password'}
            {mode === 'reset' && 'Set New Password'}
          </h1>
        </div>

        <form noValidate onSubmit={mode === 'forgot' ? handleForgot : mode === 'reset' ? handleReset : handleSubmit} className=" bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-md sm:backdrop-blur-xl lg:backdrop-blur-2xl p-5 sm:p-8 lg:p-14
           rounded-[2.25rem] sm:rounded-[3rem] shadow-xl sm:shadow-2xl lg:shadow-3xl border border-slate-100 dark:border-white/5 space-y-6 sm:space-y-8">
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl text-red-600 text-xs font-bold text-center flex items-center justify-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          {info && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl text-emerald-600 text-xs font-bold text-center flex items-center justify-center gap-2">
              <ShieldCheck size={16} /> {info}
            </div>
          )}

          {mode === 'forgot' && (
            <div className="space-y-4">
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                Enter the email tied to your account and we'll send you a secure reset link.
              </p>
              <div className="space-y-1">
                <label className={labelStyles}>Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input type="email" value={formData.email}
                    onChange={e => { setFormData({ ...formData, email: e.target.value }); if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: '' }); }}
                    placeholder="sam@company.co.ke" className={inputStyles('email')} autoComplete="email" inputMode="email" />
                </div>
                {fieldErrors.email && <p className="text-[8px] text-red-500 font-bold uppercase tracking-widest mt-1 ml-1">{fieldErrors.email}</p>}
              </div>
            </div>
          )}

          {mode === 'reset' && (
            <div className="space-y-4">
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                Choose a new password (minimum 8 characters).
              </p>
              <div className="space-y-1">
                <label className={labelStyles}>New Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input type={showPassword ? "text" : "password"} value={formData.password}
                    onChange={e => { setFormData({ ...formData, password: e.target.value }); if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' }); }}
                    placeholder="••••••••" className={inputStyles('password')} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-400 hover:text-murzak-cyan transition"
                    aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Eye className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                </div>
                {fieldErrors.password && <p className="text-[8px] text-red-500 font-bold uppercase tracking-widest mt-1 ml-1">{fieldErrors.password}</p>}
              </div>
            </div>
          )}

          {(mode === 'login' || mode === 'signup') && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 lg:gap-10">
            <div className="space-y-6">
              <h3 className="text-[10px] font-black text-murzak-cyan uppercase tracking-[0.4em] mb-4">Your Details</h3>
              {mode === 'signup' && (
                <>
                  <div className="space-y-1">
                    <label className={labelStyles}>Full Name</label>
                    <div className="relative">
                      <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input type="text" value={formData.name} onChange={e => { setFormData({...formData, name: e.target.value}); if(fieldErrors.name) setFieldErrors({...fieldErrors, name: ''}); }} placeholder="Samuel Okoth" className={inputStyles('name')} />                      
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className={labelStyles}>Business Name</label>
                    <div className="relative">
                      <Building className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input type="text" value={formData.company} onChange={e => { setFormData({...formData, company: e.target.value}); if(fieldErrors.company) setFieldErrors({...fieldErrors, company: ''}); }} placeholder="My Company Ltd" className={inputStyles('company')} />
                    </div>
                    {fieldErrors.company && <p className="text-[8px] text-red-500 font-bold uppercase tracking-widest mt-1 ml-1">{fieldErrors.company}</p>}
                  </div>
                </>
              )}
              <div className="space-y-1">
                <label className={labelStyles}>Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input type="email" value={formData.email} 
                    onChange={e => { 
                      setFormData({...formData, email: e.target.value}); 
                      if(fieldErrors.email) setFieldErrors({...fieldErrors, email: ''}); 
                    }} 
                    placeholder="sam@company.co.ke" 
                    className={inputStyles('email')} 
                    autoComplete="email"
                    inputMode="email"
                  />
                </div>
                {fieldErrors.email && <p className="text-[8px] text-red-500 font-bold uppercase tracking-widest mt-1 ml-1">{fieldErrors.email}</p>}
              </div>
              <div className="space-y-1">
                <label className={labelStyles}>Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/3 -translate-y-1/2 text-slate-400" size={18} />

                  <input type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => {
                      setFormData({ ...formData, password: e.target.value });
                      if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: "" });
                    }}
                    placeholder="••••••••"
                    className={inputStyles("password")}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />

                  {/* Show/Hide toggle button */}
                  <button type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/4 -translate-y-1/3 p-2 rounded-lg text-slate-400 hover:text-murzak-cyan hover:bg-slate-200/50 dark:hover:bg-white/10 transition"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4 sm:w-5 sm:h-5" />
                    ) : (
                      <Eye className="w-4 h-4 sm:w-5 sm:h-5" />
                    )}
                  </button>
                </div>

                {fieldErrors.password && <p className="text-[8px] text-red-500 font-bold uppercase tracking-widest mt-1 ml-1">{fieldErrors.password}</p>}
              </div>
            </div>

            {mode === 'signup' ? (
              <div className="space-y-6">
                <h3 className="text-[10px] font-black text-murzak-cyan uppercase tracking-[0.4em] mb-4">Project Setup</h3>
                <div className="space-y-1">
                  <label className={labelStyles}>What is the goal of this project?</label>
                  <div className="relative">
                    <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input type="text" value={formData.purpose} onChange={e => { setFormData({...formData, purpose: e.target.value}); if(fieldErrors.purpose) setFieldErrors({...fieldErrors, purpose: ''}); }} placeholder="e.g. Launching Logistics App" className={inputStyles('purpose')} />
                  </div>
                  {fieldErrors.purpose && <p className="text-[8px] text-red-500 font-bold uppercase tracking-widest mt-1 ml-1">{fieldErrors.purpose}</p>}
                </div>
                <div className="space-y-1">
                  <label className={labelStyles}>Link to your Project Files (optional)</label>
                  <div className="relative">
                    <Code className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input type="text" value={formData.sourceCode} onChange={e => setFormData({...formData, sourceCode: e.target.value})} placeholder="e.g. GitHub URL or App Link" className={inputStyles('sourceCode')} />
                  </div>
                </div>
                <div className="pt-4">
                  <button 
                    type="button" 
                    onClick={() => setFormData({...formData, authorized: !formData.authorized})}
                    className={`w-full p-5 rounded-[1.5rem] border flex items-center gap-4 transition-all ${formData.authorized ? 'bg-murzak-cyan/10 border-murzak-cyan shadow-lg' : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10'}`}
                  >
                    <div className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-all flex-shrink-0 ${formData.authorized ? 'bg-murzak-cyan border-murzak-cyan text-murzak-navy' : 'border-slate-300'}`}>
                      {formData.authorized && <CheckSquare size={14} />}
                    </div>
                    <span className="text-[9px] font-black uppercase text-left tracking-widest leading-tight">I authorize Murzak to help set up and host my system securely.</span>
                  </button>
                  {mode === 'signup' && !formData.authorized && <p className="text-[7px] font-black uppercase tracking-widest text-slate-400 mt-2 text-center">Authorization required to proceed</p>}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 sm:p-10 text-center space-y-6 bg-slate-50 dark:bg-white/5 rounded-[2.25rem] sm:rounded-[3rem] border border-dashed border-slate-200 dark:border-white/10">
                <ShieldCheck className="w-10 h-10 sm:w-16 sm:h-16 text-murzak-cyan opacity-40 animate-pulse" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 leading-relaxed">Secure Login <br /> Encrypted connection active.</p>
              </div>
            )}
          </div>
          )}

          {mode === 'login' && (
            <div className="text-right -mt-2">
              <button type="button"
                onClick={() => { setMode('forgot'); setError(''); setInfo(''); setFieldErrors({}); }}
                className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.18em] hover:text-murzak-cyan transition-colors">
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || (mode === 'signup' && !formData.authorized)}
            className="w-full bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy px-6 sm:px-8 py-4 sm:py-5 rounded-xl sm:rounded-2xl
                        font-black text-sm sm:text-base lg:text-lg hover:scale-[1.02] sm:hover:scale-105 transition-all shadow-xl sm:shadow-2xl flex items-center justify-center group disabled:opacity-50">
            {isSubmitting ? (
              <RefreshCw className="animate-spin w-5 h-5 sm:w-6 sm:h-6" />
            ) : (
              <>
                {mode === 'login' && 'Open My Portal'}
                {mode === 'signup' && 'Create My Project & Launch'}
                {mode === 'forgot' && 'Send Reset Link'}
                {mode === 'reset' && 'Update Password'}
                <ArrowRight size={20} className="w-4 h-4 sm:w-5 sm:h-5 ml-3 group-hover:translate-x-2 transition-transform" />
              </>
            )}
          </button>

          {(mode === 'login' || mode === 'signup') && firebaseEnabled && (
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Or</span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
              </div>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading || isSubmitting}
                className="w-full bg-white dark:bg-white/10 border border-slate-200 dark:border-white/15 text-murzak-navy dark:text-white
                           px-6 py-4 sm:py-5 rounded-xl sm:rounded-2xl font-black text-sm sm:text-base hover:bg-slate-50 dark:hover:bg-white/15
                           transition-all shadow-sm flex items-center justify-center gap-3 disabled:opacity-50">
                {googleLoading ? (
                  <RefreshCw className="animate-spin w-5 h-5" />
                ) : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                    </svg>
                    Continue with Google
                  </>
                )}
              </button>
            </div>
          )}
        </form>

        <div className="mt-12 text-center">
          {(mode === 'forgot' || mode === 'reset') ? (
            <button
              onClick={() => { setMode('login'); setError(''); setInfo(''); setFieldErrors({}); }}
              className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] hover:text-murzak-cyan transition-colors drop-shadow"
            >
              ← Back to Log In
            </button>
          ) : (
            <button
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setInfo(''); setFieldErrors({}); }}
              className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] hover:text-murzak-cyan transition-colors drop-shadow"
            >
              {mode === 'login' ? "Need a New Account? Get Started" : "Already Have an Account? Log In"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
