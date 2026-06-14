import React, { useState } from "react";
import {
  Mail, MapPin, Clock, Send, RefreshCw, CheckCircle2, AlertCircle,
  User as UserIcon, Building, MessageSquare,
} from "lucide-react";
import { Page } from "../types";
import { createClientRequest } from "../services/requests";

interface ContactPageProps {
  onNavigate?: (page: Page | string) => void;
}

// Central place to update public contact details.
const SUPPORT_EMAIL = "support@murzaktech.com";

const ContactPage: React.FC<ContactPageProps> = () => {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [refId, setRefId] = useState("");
  const [serverError, setServerError] = useState("");

  const validate = () => {
    const errs: Record<string, string> = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.name.trim()) errs.name = "Your name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!emailRegex.test(form.email)) errs.email = "Enter a valid email";
    if (!form.company.trim()) errs.company = "Company name is required";
    if (!form.message.trim()) errs.message = "Please tell us how we can help";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      const [firstName, ...rest] = form.name.trim().split(" ");
      const res = await createClientRequest({
        firstName,
        lastName: rest.join(" ") || "-",
        email: form.email.trim(),
        companyName: form.company.trim(),
        message: form.message.trim(),
        requestType: "Sales Inquiry",
        pageUrl: typeof window !== "undefined" ? window.location.href : "",
      });
      setRefId(res?.id || "");
      setSuccess(true);
    } catch (err: any) {
      setServerError(err?.message || "Something went wrong. Please email us directly.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = (k: string) =>
    `w-full bg-slate-50 dark:bg-white/5 border ${
      errors[k] ? "border-red-500" : "border-slate-200 dark:border-white/10"
    } rounded-2xl pl-11 pr-4 py-3.5 text-sm font-semibold text-murzak-navy dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-murzak-cyan transition`;

  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-20">
      <div className="text-center mb-12 sm:mb-16">
        <p className="font-mono text-[10px] font-black text-murzak-cyan uppercase tracking-[0.3em] mb-4">Get in touch</p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-[900] text-murzak-navy dark:text-white tracking-tighter">
          Talk to a <span className="text-murzak-gradient">real person.</span>
        </h1>
        <p className="mt-5 text-sm sm:text-base font-bold text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Tell us what you're trying to do — in plain words. Our Nairobi team usually replies within one business day.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-10">
        {/* Contact details */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-murzak-navy text-white p-7 sm:p-9 rounded-[2.5rem] border border-white/10 shadow-xl space-y-7">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-murzak-cyan/15 text-murzak-cyan"><Mail size={18} /></div>
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Email us</p>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm font-black hover:text-murzak-cyan transition break-all">{SUPPORT_EMAIL}</a>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-murzak-cyan/15 text-murzak-cyan"><MapPin size={18} /></div>
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Location</p>
                <p className="text-sm font-black">Nairobi, Kenya</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-murzak-cyan/15 text-murzak-cyan"><Clock size={18} /></div>
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Hours</p>
                <p className="text-sm font-black">Mon–Fri · 8:00–18:00 EAT</p>
              </div>
            </div>
          </div>
        </div>

        {/* Form / success */}
        <div className="lg:col-span-3">
          <div className="bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-xl border border-slate-100 dark:border-white/5 p-6 sm:p-10 rounded-[2.5rem] shadow-xl">
            {success ? (
              <div className="text-center py-10 animate-fade-in">
                <CheckCircle2 size={56} className="text-emerald-500 mx-auto mb-6" />
                <h3 className="text-2xl font-black text-murzak-navy dark:text-white tracking-tight mb-3">Message received</h3>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400 leading-relaxed max-w-md mx-auto">
                  Thanks{form.name ? `, ${form.name.split(" ")[0]}` : ""}! We've logged your enquiry{refId ? ` (ref ${refId})` : ""} and a
                  member of our team will reach out by email shortly.
                </p>
                <button
                  onClick={() => { setSuccess(false); setForm({ name: "", email: "", company: "", message: "" }); }}
                  className="mt-8 text-[10px] font-black text-murzak-cyan uppercase tracking-widest hover:underline"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {serverError && (
                  <div className="p-3.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl text-red-600 text-[11px] font-bold flex items-center gap-2">
                    <AlertCircle size={14} /> {serverError}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <div className="relative">
                      <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (errors.name) setErrors({ ...errors, name: "" }); }} placeholder="Full name" className={inputCls("name")} />
                    </div>
                    {errors.name && <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest mt-1.5 ml-1">{errors.name}</p>}
                  </div>
                  <div>
                    <div className="relative">
                      <Building className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input value={form.company} onChange={(e) => { setForm({ ...form, company: e.target.value }); if (errors.company) setErrors({ ...errors, company: "" }); }} placeholder="Company" className={inputCls("company")} />
                    </div>
                    {errors.company && <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest mt-1.5 ml-1">{errors.company}</p>}
                  </div>
                </div>
                <div>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); if (errors.email) setErrors({ ...errors, email: "" }); }} placeholder="Work email" className={inputCls("email")} autoComplete="email" />
                  </div>
                  {errors.email && <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest mt-1.5 ml-1">{errors.email}</p>}
                </div>
                <div>
                  <div className="relative">
                    <MessageSquare className="absolute left-4 top-4 text-slate-400" size={16} />
                    <textarea value={form.message} onChange={(e) => { setForm({ ...form, message: e.target.value }); if (errors.message) setErrors({ ...errors, message: "" }); }} placeholder="How can we help?" rows={5} className={`${inputCls("message")} resize-none pt-3.5`} />
                  </div>
                  {errors.message && <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest mt-1.5 ml-1">{errors.message}</p>}
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:scale-[1.01] transition-all shadow-xl flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {submitting ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                  {submitting ? "Sending..." : "Send message"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactPage;
