
import React, { useState, useEffect, initialMode } from 'react';
import { 
  X, ArrowRight, CheckCircle2, RefreshCw, 
  Terminal, Package, Bus, Briefcase, 
  User, Mail, Building, Send, ChevronLeft, AlertCircle
} from 'lucide-react';
import { logLeadToCRM, generateReferenceId } from '../services/erpnext';
import { createClientRequest } from "../services/requests";

interface SalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: SalesMode; // 'select' | 'demo' | 'quote'
}

type SalesMode = 'select' | 'demo' | 'quote';

const SalesModal: React.FC<SalesModalProps> = ({ isOpen, onClose, initialMode }) => {
  const [mode, setMode] = useState<SalesMode>(initialMode || 'select');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [refId, setRefId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    interest: 'Logistics Engine', // For Demo
    scope: '', // For Quote
    budget: 'Enterprise' // For Quote
  });

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setMode(initialMode || 'select');
      setIsSuccess(false);
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [isOpen, initialMode]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = 'Please provide your name';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email.trim()) {
      errs.email = 'Work email is required';
    } else if (!emailRegex.test(formData.email)) {
      errs.email = 'Please use a valid business email';
    }
    if (mode === 'quote' && !formData.scope.trim()) {
      errs.scope = 'Briefly describe what you would like us to build';
    }
    if (!formData.company.trim()) errs.company = 'Company name is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const fullName = formData.name.trim().replace(/\s+/g, " ");
      const [firstName, ...rest] = fullName.split(" ");
      const lastName = rest.join(" ") || ".";
      const pageUrl = window.location.href;
      const requestType = mode === "demo" ? "Demo Request" : "Sales Inquiry";

      // Build a message that includes the mode-specific fields you added
      const message =
        mode === "demo"
          ? [
              "Demo request from Client-On Site",
              `Interest: ${formData.interest}`,
              `Message: ${formData.scope?.trim() ? formData.scope.trim() : "(none)"}`,
            ].join("\n")
          : [
              "Quote request from Client-On Site",
              `Entity scale: ${formData.budget}`,
              `Requirements: ${formData.scope.trim()}`,
            ].join("\n");

      const resp = await createClientRequest({
        firstName,
        lastName,
        email: formData.email.trim(),
        companyName: formData.company.trim(),
        message,
        requestType,
        pageUrl,
      });

      // Optional: use resp.id as reference; or keep your own ref generator
      setRefId(resp.id);
      setIsSuccess(true);
    } catch (err: any) {
      // You can surface a toast/banner here
      console.error(err);
      setErrors((prev) => ({
        ...prev,
        submit: err?.message || "Failed to submit request.",
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputClasses = (name: string) => `w-full bg-slate-50 dark:bg-white/5 border ${errors[name] ? "border-red-500" : "border-slate-200 dark:border-white/10"} rounded-xl px-11 sm:px-12
    py-3.5 sm:py-4 text-sm font-bold text-murzak-navy dark:text-white placeholder:text-slate-400
    focus:outline-none focus:ring-2 focus:ring-murzak-cyan transition-all
  `;

  const labelClasses = "block text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 ml-1";

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-6 lg:p-8">
      <div className="absolute inset-0 bg-black/20 dark:bg-black/35 backdrop-blur-sm sm:backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full max-w-4xl bg-white dark:bg-murzak-navy rounded-[1.75rem] sm:rounded-[3rem] shadow-xl sm:shadow-3xl overflow-hidden
                       border border-slate-100 dark:border-white/5 flex flex-col md:flex-row transition-all animate-fade-in max-h-[92vh] sm:max-h-[88vh]">
        {/* Left Side: Brand Context */}
        <div className="w-full md:w-2/5 bg-murzak-navy p-6 sm:p-8 lg:p-14 flex flex-col justify-between relative overflow-hidden text-white">
           <div className="absolute -top-10 -right-10 opacity-10 rotate-12">
             <Terminal className="w-40 h-40 sm:w-56 sm:h-56 lg:w-[300px] lg:h-[300px]" /></div>
           <div className="relative z-10">
              <h2 className="text-3xl lg:text-5xl font-[900] tracking-tighter leading-none mb-6">Work <br /><span className="text-murzak-cyan">With Us.</span></h2>
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                Nairobi Engineering Hub <br /> Active Engagement Node
              </p>
           </div>
           <div className="relative z-10 mt-6 md:mt-0 hidden sm:block">
             <div className="space-y-4">
                <div className="flex items-center gap-3 text-xs font-black uppercase tracking-widest text-murzak-cyan">
                   <CheckCircle2 size={16} /> Regional Data Hosting
                </div>
                <div className="flex items-center gap-3 text-xs font-black uppercase tracking-widest text-murzak-cyan">
                   <CheckCircle2 size={16} /> Technical Sovereignty
                </div>
             </div>
           </div>
        </div>

        {/* Right Side: Interactive Area */}
        <div className="flex-grow min-h-0 p-5 sm:p-8 lg:p-14 overflow-y-auto">
          {isSuccess ? (
            <div className="text-center py-10 animate-fade-in">
              <div className="w-20 h-20 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-8">
                <CheckCircle2 size={40} />
              </div>
              <h3 className="text-3xl font-black text-murzak-navy dark:text-white tracking-tighter mb-4 uppercase">Request Received.</h3>
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-8 max-w-xs mx-auto uppercase tracking-widest leading-relaxed">
                Handshake complete. Reference ID: <span className="text-murzak-cyan font-black">{refId}</span>. Our lead architect will reach out to schedule a technical sync.
              </p>
              <button onClick={onClose} className="bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy px-10 py-4 rounded-xl font-black text-[10px] uppercase tracking-widest">Done</button>
            </div>
          ) : mode === 'select' ? (
            <div className="space-y-8 animate-fade-in">
              <div className="flex justify-between items-center mb-10">
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.3em]">Select Your Interest</h3>
                <button onClick={onClose}
                  className="flex justify-between items-center mb-6 sm:mb-10">
                    <X className="w-5 h-5 sm:w-6 sm:h-6" /></button>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <button 
                  onClick={() => setMode('demo')}
                  className="group p-5 sm:p-7 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-[1.75rem] sm:rounded-[2.5rem] text-left hover:border-murzak-cyan transition-all hover:scale-[1.01] sm:hover:scale-[1.02] shadow-sm hover:shadow-xl"
                >
                  <div className="w-14 h-14 bg-murzak-cyan/10 text-murzak-cyan rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Package size={28} />
                  </div>
                  <h4 className="text-2xl font-black text-murzak-navy dark:text-white tracking-tighter mb-2 uppercase">Request a Demo</h4>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed">See our Logistics, Mobility, or Cloud systems in action via screen-share.</p>
                </button>
                
                <button 
                  onClick={() => setMode('quote')}
                  className="group p-5 sm:p-7 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-[1.75rem] sm:rounded-[2.5rem] text-left hover:border-murzak-cyan transition-all hover:scale-[1.01] sm:hover:scale-[1.02] shadow-sm hover:shadow-xl"
                >
                  <div className="w-14 h-14 bg-murzak-cyan/10 text-murzak-cyan rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Briefcase size={28} />
                  </div>
                  <h4 className="text-2xl font-black text-murzak-navy dark:text-white tracking-tighter mb-2 uppercase">Get a Quote</h4>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed">Request pricing and a technical roadmap for your custom project or software build.</p>
                </button>
                
              </div>
              <p className="text-center text-[9px] font-black uppercase tracking-widest text-slate-400 mt-8">Nairobi standard response time: Under 4 hours</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in">
              <div className="flex items-center justify-between mb-8">
                <button type="button" onClick={() => setMode('select')} className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 hover:text-murzak-cyan transition-colors">
                  <ChevronLeft size={16} /> Back to Selection
                </button>
                <h3 className="text-xs font-black text-murzak-cyan uppercase tracking-widest">
                  {mode === 'demo' ? 'Demo Details' : 'Project Scope'}
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                 <div className="space-y-1">
                    <label className={labelClasses}>Full Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input type="text" placeholder="e.g. Samuel Okoth" className={inputClasses('name')} value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                    </div>
                    {errors.name && <p className="text-[8px] font-bold text-red-500 uppercase mt-1 ml-1">{errors.name}</p>}
                 </div>
                 <div className="space-y-1">
                    <label className={labelClasses}>Work Email</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input type="email" placeholder="sam@company.co.ke" className={inputClasses('email')} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                    </div>
                    {errors.email && <p className="text-[8px] font-bold text-red-500 uppercase mt-1 ml-1">{errors.email}</p>}
                 </div>
              </div>

              <div className="space-y-1">
                 <label className={labelClasses}>Company Name</label>
                 <div className="relative">
                    <Building className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input type="text" placeholder="Enterprise or Startup Name" className={inputClasses('company')} value={formData.company} onChange={e => setFormData({...formData, company: e.target.value})} />
                 </div>
              </div>

              {mode === 'demo' ? (
                <div className="space-y-1">
                   <label className={labelClasses}>What should we demonstrate?</label>
                   <div className="grid grid-cols-2 gap-4">
                      {['Logistics Engine', 'Mobility Engine', 'Cloud Hosting', 'ERP Architecture'].map(item => (
                        <button key={item} type="button" onClick={() => setFormData({...formData, interest: item})} 
                        className={`p-3 sm:p-4 rounded-xl border text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-center transition-all ${
                          formData.interest === item
                          ? 'bg-murzak-cyan text-murzak-navy border-murzak-cyan shadow-lg'
                          : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:border-murzak-cyan'
                        }`}>
                          {item}
                        </button>
                      ))}
                   </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className={labelClasses}>Project Requirements</label>
                    <textarea rows={3} placeholder="Tell us about the software or system you need built..." className={`${inputClasses('scope')} resize-none`} value={formData.scope} onChange={e => setFormData({...formData, scope: e.target.value})} />
                    {errors.scope && <p className="text-[8px] font-bold text-red-500 uppercase mt-1 ml-1">{errors.scope}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className={labelClasses}>Entity Scale</label>
                    <div className="flex gap-4">
                       {['Startup', 'SME', 'Enterprise'].map(b => (
                         <button key={b} type="button" onClick={() => setFormData({...formData, budget: b})} 
                         className={`p-3 sm:p-4 rounded-xl border text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-center transition-all
                          ${formData.budget === b
                           ? 'bg-murzak-cyan text-murzak-navy border-murzak-cyan shadow-lg'
                           : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:border-murzak-cyan'
                         }`}>
                           {b}
                         </button>
                       ))}
                    </div>
                  </div>
                </>
              )}

              {errors.submit && (
                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-red-500">
                  <AlertCircle size={16} />
                  {errors.submit}
                </div>
              )}
              <button type="submit" disabled={isSubmitting} className="w-full bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy font-black py-4 sm:py-5 rounded-xl sm:rounded-2xl hover:scale-[1.01] sm:hover:scale-[1.02] transition-all text-[12px] sm:text-sm uppercase tracking-widest shadow-xl flex items-center justify-center group disabled:opacity-70 mt-4">
                {isSubmitting ? <RefreshCw className="animate-spin mr-3" /> : <>Send Request <Send size={18} className="ml-3 group-hover:translate-x-2 transition-transform" /></>}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default SalesModal;
