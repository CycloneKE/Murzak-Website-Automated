
import React, { useState } from 'react';
import { 
  ChevronRight, ChevronLeft, RefreshCw, 
  Rocket, Server, ShieldCheck, AlertCircle, ChevronDown, ArrowRight
} from 'lucide-react';
import { Page } from '../types';
import { logLeadToCRM, generateReferenceId } from '../services/erpnext';
import { createTestPlan } from "../services/testPlan";

interface TestRequestProps {
  onNavigate: (page: Page) => void;
}

const TestRequest: React.FC<TestRequestProps> = ({ onNavigate }) => {
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [refId, setRefId] = useState('');
  const [formData, setFormData] = useState({
    fullName: '',
    workEmail: '',
    companyName: '',
    testingGoal: 'Website Performance',
    usageLevel: 'Moderate',
  });

  const validateStep1 = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!formData.companyName.trim()) newErrors.companyName = 'Company name is required';
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.workEmail.trim()) {
      newErrors.workEmail = 'Business email is required';
    } else if (!emailRegex.test(formData.workEmail)) {
      newErrors.workEmail = 'Please enter a valid email';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const nextStep = () => {
    if (validateStep1()) {
      setStep(s => s + 1);
    }
  };
  
  const prevStep = () => setStep(s => s - 1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const resp = await createTestPlan({
        fullName: formData.fullName,
        workEmail: formData.workEmail,
        companyName: formData.companyName,
        testingGoal: formData.testingGoal,
        usageLevel: formData.usageLevel,
        pageUrl: window.location.href,
      });

      // Store so portal/login can recognize this user came from trial
      localStorage.setItem("murzak_selected_plan", JSON.stringify({
        plan: "Test",
        test_invoice_id: resp.id,
        email: formData.workEmail,
        company: formData.companyName,
        testingGoal: formData.testingGoal,
        usageLevel: formData.usageLevel,
      }));

      setRefId(resp.id);     // use Frappe docname as ref
      setSubmitted(true);
    } catch (err: any) {
      console.error(err);
      setErrors((prev) => ({ ...prev, submit: err?.message || "Submission failed" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses = (name: string) => `w-full bg-slate-50 dark:bg-murzak-navy border ${errors[name] ? 'border-red-500' : 'border-slate-200 dark:border-white/10'} rounded-2xl px-6 py-4 text-base font-bold text-murzak-navy dark:text-white transition-all focus:outline-none focus:ring-2 focus:ring-murzak-cyan placeholder:text-slate-400`;
  const labelClasses = "block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.3em] mb-3 ml-1";

  if (submitted) {
    return (
      <div className="min-h-[90vh] flex items-center justify-center p-6 animate-fade-in">
        <div className="max-w-2xl w-full bg-white dark:bg-murzak-navy p-10 sm:p-12 lg:p-20 rounded-[3rem] sm:rounded-[4rem] shadow-3xl border border-slate-100 dark:border-white/5 relative overflow-hidden">
          <div className="relative z-10 text-center">
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-murzak-cyan/10 text-murzak-cyan rounded-full flex items-center justify-center mx-auto mb-8 sm:mb-10">
              <Rocket size={40} className="animate-bounce" />
            </div>
            
            <h2 className="text-3xl lg:text-4xl font-[900] text-murzak-navy dark:text-white mb-6 tracking-tighter leading-none">Evaluation Plan Ready.</h2>
            
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-10 max-w-sm mx-auto leading-relaxed">
              We've saved your goals for <span className="text-murzak-cyan font-black">{formData.testingGoal}</span>. Now, create your account and share your project link to see your system go live.
            </p>

            {errors.submit && (
              <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest flex items-center gap-1">
                <AlertCircle size={10} /> {errors.submit}
              </p>
            )}
            
            <button 
              onClick={() => onNavigate('login')} 
              className="w-full bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy px-12 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:scale-105 transition-all shadow-xl flex items-center justify-center gap-3"
            >
              Start Account & Upload Project <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent transition-colors py-12 lg:py-24 px-6 relative overflow-hidden">
      {/* Let the universal site backdrop show through; just a soft brand aura for depth. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 right-[-10%] w-[620px] h-[620px] rounded-full blur-[150px] bg-murzak-gradient opacity-20 animate-drift-slow" />
      </div>

      <div className="max-w-3xl mx-auto relative z-10">
        <div className="text-center mb-12 lg:mb-16 pt-12">
          <div className="inline-flex items-center gap-3 bg-murzak-cyan/10 text-murzak-cyan px-4 py-2 rounded-full border border-murzak-cyan/20 mb-6 backdrop-blur-md">
            <Server size={18} />
            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em]">Nairobi System Sandbox</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-8xl font-[900] text-murzak-navy dark:text-white tracking-tighter leading-[0.85] mb-6">
            Get your <br /><span className="text-murzak-cyan">36h trial.</span>
          </h1>
        </div>

        <div className="bg-white/90 dark:bg-murzak-navy/90 backdrop-blur-2xl rounded-[2.5rem] sm:rounded-[3.5rem] p-8 sm:p-10 lg:p-16 shadow-3xl border border-slate-100 dark:border-white/5">
          {step === 1 ? (
            <div className="space-y-6 sm:space-y-8 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                <div>
                  <label className={labelClasses}>Your Name</label>
                  <input type="text" placeholder="Samuel Okoth" className={inputClasses('fullName')} value={formData.fullName} onChange={e => { setFormData({...formData, fullName: e.target.value}); if(errors.fullName) setErrors({...errors, fullName: ''}); }} />
                  {errors.fullName && <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest mt-2 flex items-center gap-1"><AlertCircle size={10}/> {errors.fullName}</p>}
                </div>
                <div>
                  <label className={labelClasses}>Business Email</label>
                  <input type="email" placeholder="samuel@company.co.ke" className={inputClasses('workEmail')} value={formData.workEmail} onChange={e => { setFormData({...formData, workEmail: e.target.value}); if(errors.workEmail) setErrors({...errors, workEmail: ''}); }} />
                  {errors.workEmail && <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest mt-2 flex items-center gap-1"><AlertCircle size={10}/> {errors.workEmail}</p>}
                </div>
              </div>
              <div>
                <label className={labelClasses}>Company Name</label>
                <input type="text" placeholder="Regional Enterprise Ltd" className={inputClasses('companyName')} value={formData.companyName} onChange={e => { setFormData({...formData, companyName: e.target.value}); if(errors.companyName) setErrors({...errors, companyName: ''}); }} />
                {errors.companyName && <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest mt-2 flex items-center gap-1"><AlertCircle size={10}/> {errors.companyName}</p>}
              </div>
              <button type="button" onClick={nextStep} className="w-full bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy py-5 sm:py-6 rounded-2xl font-black text-lg flex items-center justify-center group hover:scale-[1.02] transition-all shadow-xl">
                Next Step <ChevronRight className="ml-3 group-hover:translate-x-2 transition-transform" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8 animate-fade-in">
              <div>
                <label className={labelClasses}>What are you testing?</label>
                <div className="relative">
                  <select 
                    className={`${inputClasses('testingGoal')} appearance-none pr-12 cursor-pointer bg-white dark:bg-murzak-navy`} 
                    value={formData.testingGoal} 
                    onChange={e => setFormData({...formData, testingGoal: e.target.value})}
                  >
                    <option className="bg-white dark:bg-murzak-navy text-murzak-navy dark:text-white" value="Website Performance">Website Performance</option>
                    <option className="bg-white dark:bg-murzak-navy text-murzak-navy dark:text-white" value="Payment System Link">Payment System Link</option>
                    <option className="bg-white dark:bg-murzak-navy text-murzak-navy dark:text-white" value="Mobile App Speed">Mobile App Speed</option>
                    <option className="bg-white dark:bg-murzak-navy text-murzak-navy dark:text-white" value="General Business Tool">General Business Tool</option>
                  </select>
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-murzak-cyan">
                    <ChevronDown size={20} />
                  </div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <button type="button" onClick={prevStep} className="hidden sm:flex px-8 bg-slate-100 dark:bg-white/10 text-murzak-navy dark:text-white rounded-2xl items-center justify-center font-black uppercase text-[10px] tracking-widest"><ChevronLeft size={20} /></button>
                <button type="submit" disabled={isSubmitting} className="flex-grow bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy py-5 sm:py-6 rounded-2xl font-black text-lg flex items-center justify-center group hover:scale-[1.02] transition-all disabled:opacity-50 shadow-xl">
                  {isSubmitting ? <RefreshCw className="animate-spin mr-3" /> : <>Save My Plan <ShieldCheck size={20} className="ml-3" /></>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default TestRequest;
