import React from "react";
import { Activity, Crown, Plus, Server, Settings, Shield, UserCircle, User as UserIcon } from "lucide-react";
import ChangePasswordCard from "../../../components/portal/ChangePasswordCard";
import { usePortal } from "../PortalContext";

const ProfileTab: React.FC = () => {
  const {
    goToUpgrade,
    repoDraft,
    repoMsg,
    repoSaving,
    saveRepo,
    selectedServices,
    setAddonsError,
    setAddonsOpen,
    setRepoDraft,
    setRepoMsg,
    setShowOnboarding,
    user,
  } = usePortal();

  return (
    <div className="space-y-12 animate-fade-in max-w-5xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 mb-4 px-1 sm:px-2">
        <div>
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tighter uppercase leading-none">Account Profile</h2>
          <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mt-4">
            Manage your personal information, security and active plans
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        {/* Personal Information */}
        <div className="glass-card bg-white/80 dark:bg-white/5 backdrop-blur-md sm:backdrop-blur-xl border border-slate-100 dark:border-murzak-border/50 p-8 sm:p-10 rounded-[3rem] shadow-lg sm:shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-125 transition-transform duration-700 pointer-events-none">
            <UserIcon className="w-24 h-24 text-murzak-accent" />
          </div>
          
          <h3 className="text-[12px] font-black text-slate-800 dark:text-slate-100 uppercase tracking-widest mb-8 flex items-center gap-3 relative z-10">
            <UserCircle className="w-5 h-5 text-murzak-accent" /> Personal Information
          </h3>
          
          <div className="space-y-8 relative z-10">
            <div className="group/item">
              <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-murzak-accent/50 group-hover/item:bg-murzak-accent transition-colors"></span> Full Name
              </p>
              <p className="text-xl sm:text-2xl font-black text-murzak-ink dark:text-slate-100 break-words pl-3 border-l-2 border-transparent group-hover/item:border-murzak-accent/30 transition-all">
                {user.name}
              </p>
            </div>
            
            <div className="group/item">
              <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-murzak-accent/50 group-hover/item:bg-murzak-accent transition-colors"></span> Email Address
              </p>
              <p className="text-lg sm:text-xl font-black text-murzak-ink dark:text-slate-100 break-words pl-3 border-l-2 border-transparent group-hover/item:border-murzak-accent/30 transition-all">
                {user.email}
              </p>
            </div>
            
            <div className="group/item">
              <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-murzak-accent/50 group-hover/item:bg-murzak-accent transition-colors"></span> Business Name
              </p>
              <p className="text-xl sm:text-2xl font-black text-murzak-ink dark:text-slate-100 break-words pl-3 border-l-2 border-transparent group-hover/item:border-murzak-accent/30 transition-all">
                {user.company}
              </p>
            </div>

            <div className="group/item">
              <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-murzak-accent/50 group-hover/item:bg-murzak-accent transition-colors"></span> Project Repository
              </p>
              <p className="text-micro text-slate-600 dark:text-slate-400 mb-3 pl-3">
                The Git repo we deploy your App Hosting services from. Add <span className="font-mono">#branch</span> to pin a branch.
              </p>
              <div className="flex gap-2 pl-3">
                <input
                  type="url"
                  value={repoDraft}
                  onChange={(e) => { setRepoDraft(e.target.value); if (repoMsg) setRepoMsg(null); }}
                  placeholder="https://github.com/you/your-app"
                  className="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-black/5 px-4 py-2.5 text-sm font-semibold text-murzak-ink dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-murzak-accent/60"
                />
                <button
                  type="button"
                  onClick={saveRepo}
                  disabled={repoSaving || repoDraft.trim() === (user.sourceCode || "")}
                  className="shrink-0 px-4 py-2.5 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase disabled:opacity-40 hover:scale-[1.02] transition-all"
                >
                  {repoSaving ? "Saving…" : "Save"}
                </button>
              </div>
              {repoMsg && (
                <p className={`text-micro font-bold mt-2 pl-3 ${repoMsg.ok ? "text-emerald-500" : "text-red-500"}`}>
                  {repoMsg.text}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Service Plan */}
        <div className="glass-card glass-dark p-8 sm:p-10 rounded-[3rem] shadow-xl flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-transparent to-murzak-accent/5 z-0 pointer-events-none"></div>
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-murzak-accent/10 blur-3xl rounded-full opacity-50 group-hover:opacity-80 transition-opacity duration-700 pointer-events-none z-0"></div>

          {/* This card is `.glass-dark` — a fixed dark backdrop that does not
              switch with the site theme (see index.css). Text here must
              therefore always use the light palette; a `dark:` variant means
              "near-black on near-black in light mode", which is what made
              the plan name and this panel unreadable in light mode. */}
          <div className="relative z-10">
            <h3 className="text-[12px] font-black text-slate-100 uppercase tracking-widest mb-8 flex items-center gap-3">
              <Shield className="w-5 h-5 text-murzak-accent" /> Service Plan
            </h3>

            <div className="flex flex-col gap-2 mb-8">
              <p className="text-4xl sm:text-5xl font-[900] tracking-tighter uppercase text-slate-100">
                {user.plan || "None"}
              </p>
              <div className="inline-flex self-start items-center gap-2 px-3 py-1 bg-black/5 rounded-full border border-white/20 backdrop-blur-md">
                <div className={`w-1.5 h-1.5 rounded-full ${user.accountStatus === 'Active' ? 'bg-green-400 shadow-[0_0_8px_#4ade80]' : 'bg-orange-400 shadow-[0_0_8px_#fb923c]'}`}></div>
                <span className="text-micro font-black uppercase text-slate-400">
                  Status: {user.accountStatus}
                </span>
              </div>
            </div>

            <div className="rounded-3xl border border-murzak-border bg-black/5 p-6 backdrop-blur-sm group-hover:bg-black/5 transition-colors">
              <div className="flex justify-between items-center mb-4">
                <p className="text-micro font-black uppercase text-murzak-accent">
                  Provisioned Services
                </p>
                <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center">
                  <Server className="w-4 h-4 text-slate-100" />
                </div>
              </div>

              <div className="flex items-end gap-2">
                <span className="text-3xl font-black">{selectedServices.length}</span>
                <span className="text-micro font-bold text-slate-400 uppercase pb-1">
                  Active
                </span>
              </div>

            </div>
          </div>

          <div className="space-y-3 mt-8 relative z-10">
            <button
              onClick={() => {
                setAddonsError("");
                setAddonsOpen(true);
              }}
              className="w-full bg-murzak-accent text-murzak-ink rounded-xl font-black text-micro uppercase py-3 sm:py-4 hover:scale-[1.02] transition-all shadow-[0_0_20px_rgba(0,189,252,0.2)] flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Services
            </button>

            <button
              onClick={goToUpgrade}
              className="w-full bg-black/5 border border-white/15 text-slate-100 rounded-xl font-black text-micro uppercase py-3 sm:py-4 hover:bg-black/5 transition-all backdrop-blur-md flex items-center justify-center gap-2"
            >
              <Crown className="w-4 h-4 text-murzak-accent" /> Upgrade Plan
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel p-8 sm:p-10 rounded-[3rem] border border-murzak-border">
        <h3 className="text-[12px] font-black text-slate-800 dark:text-slate-100 uppercase tracking-widest mb-8 flex items-center gap-3">
          <Settings className="w-5 h-5 text-murzak-accent" /> Account Preferences
        </h3>
        
        <div className="space-y-6">
          <ChangePasswordCard />
          
          <div className="pt-8 mt-8 border-t border-slate-200 dark:border-murzak-border flex flex-col sm:flex-row justify-between items-center gap-6">
            <div>
              <h4 className="text-sm font-black text-murzak-ink dark:text-slate-100">Welcome Tour</h4>
              <p className="text-micro font-bold text-slate-600 dark:text-slate-400 uppercase mt-1">Re-run the onboarding experience</p>
            </div>
            <button
              onClick={() => setShowOnboarding(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-slate-200 dark:border-murzak-border bg-white/60 dark:bg-black/5 text-murzak-ink dark:text-slate-100 font-black text-micro uppercase hover:border-murzak-accent hover:bg-murzak-accent/5 transition-all"
            >
              <Activity className="w-4 h-4 text-murzak-accent" /> Replay Tour
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileTab;
