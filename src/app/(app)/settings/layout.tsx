import { SettingsHeader, SettingsTabs } from "./tabs";

export const metadata = { title: { template: "%s · Settings · PharmaStock", default: "Settings" } };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsHeader />
      <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
        <SettingsTabs />
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </>
  );
}
