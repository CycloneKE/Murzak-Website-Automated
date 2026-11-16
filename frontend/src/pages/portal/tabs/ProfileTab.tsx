import React from "react";
import { Crown, Pencil, Plus, RotateCcw } from "lucide-react";
import ChangePasswordCard from "../../../components/portal/ChangePasswordCard";
import { Field, PageHeader, Panel, PButton, StatusPill, inputClass, statusTone } from "../../../components/portal/ui";
import { usePortal } from "../PortalContext";

/** A label / value row inside a Panel. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 sm:px-5 py-3 border-b border-p-border last:border-b-0">
    <dt className="sm:w-40 shrink-0 text-[13px] text-p-muted">{label}</dt>
    <dd className="min-w-0 grow text-sm text-p-text wrap-break-word">{children}</dd>
  </div>
);

const ProfileTab: React.FC = () => {
  const {
    goToUpgrade,
    profileCompanyDraft,
    profileEditing,
    profileMsg,
    profileNameDraft,
    profileSaving,
    repoDraft,
    repoMsg,
    repoSaving,
    saveProfile,
    saveRepo,
    selectedServices,
    setAddonsOpen,
    setProfileCompanyDraft,
    setProfileEditing,
    setProfileNameDraft,
    setRepoDraft,
    setRepoMsg,
    setShowOnboarding,
    user,
  } = usePortal();

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title="Settings" description="Your details, your plan and your password." />

      <Panel
        title="Your details"
        flush={!profileEditing}
        actions={
          !profileEditing && (
            <PButton
              size="sm"
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => {
                setProfileNameDraft(user.name || "");
                setProfileCompanyDraft(user.company || "");
                setProfileEditing(true);
              }}
            >
              Edit
            </PButton>
          )
        }
      >
        {profileEditing ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveProfile();
            }}
          >
            <Field label="Full name" htmlFor="profile-name">
              <input
                id="profile-name"
                type="text"
                value={profileNameDraft}
                onChange={(e) => setProfileNameDraft(e.target.value)}
                autoComplete="name"
                className={inputClass}
              />
            </Field>
            <Field label="Business name" htmlFor="profile-company">
              <input
                id="profile-company"
                type="text"
                value={profileCompanyDraft}
                onChange={(e) => setProfileCompanyDraft(e.target.value)}
                autoComplete="organization"
                className={inputClass}
              />
            </Field>
            {profileMsg && !profileMsg.ok && <p role="alert" className="text-[13px] text-p-danger">{profileMsg.text}</p>}
            <div className="flex gap-2">
              <PButton type="submit" variant="primary" loading={profileSaving} disabled={!profileNameDraft.trim()}>
                {profileSaving ? "Saving…" : "Save"}
              </PButton>
              <PButton disabled={profileSaving} onClick={() => setProfileEditing(false)}>
                Cancel
              </PButton>
            </div>
          </form>
        ) : (
          <dl>
            <Row label="Full name">{user.name}</Row>
            <Row label="Email address">{user.email}</Row>
            <Row label="Business name">{user.company}</Row>
          </dl>
        )}
      </Panel>

      <Panel
        title="Project repository"
        description={
          <>
            The Git repo we deploy your App Hosting services from. Add <span className="font-mono">#branch</span> to pin a branch.
          </>
        }
      >
        <form
          className="flex flex-col sm:flex-row sm:items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveRepo();
          }}
        >
          <div className="grow min-w-0">
            <Field label="Repository URL" htmlFor="profile-repo">
              <input
                id="profile-repo"
                type="url"
                value={repoDraft}
                onChange={(e) => {
                  setRepoDraft(e.target.value);
                  if (repoMsg) setRepoMsg(null);
                }}
                placeholder="https://github.com/you/your-app"
                className={inputClass}
              />
            </Field>
          </div>
          <PButton type="submit" variant="primary" loading={repoSaving} disabled={repoDraft.trim() === (user.sourceCode || "")}>
            {repoSaving ? "Saving…" : "Save"}
          </PButton>
        </form>
        {repoMsg && (
          <p role="status" className={`mt-3 text-[13px] ${repoMsg.ok ? "text-p-success" : "text-p-danger"}`}>
            {repoMsg.text}
          </p>
        )}
      </Panel>

      <Panel
        title="Your plan"
        flush
        actions={
          <>
            <PButton icon={<Plus className="w-4 h-4" />} onClick={() => setAddonsOpen(true)}>
              Add services
            </PButton>
            <PButton icon={<Crown className="w-4 h-4" />} onClick={goToUpgrade}>
              Change plan
            </PButton>
          </>
        }
      >
        <dl>
          <Row label="Plan">{user.plan || "None"}</Row>
          <Row label="Status">
            <StatusPill tone={statusTone(user.accountStatus)}>{user.accountStatus}</StatusPill>
          </Row>
          <Row label="Services">{selectedServices.length}</Row>
        </dl>
      </Panel>

      <ChangePasswordCard />

      <Panel
        title="Welcome tour"
        description="See the short introduction to the portal again."
        actions={
          <PButton icon={<RotateCcw className="w-4 h-4" />} onClick={() => setShowOnboarding(true)}>
            Replay tour
          </PButton>
        }
      />
    </div>
  );
};

export default ProfileTab;
