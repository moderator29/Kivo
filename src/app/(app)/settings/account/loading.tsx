import { SettingsPageSkeleton } from "@/components/settings/settings-page-skeleton";

// Without this the section inherits /settings' own skeleton — the hub's tall
// card of navigation rows — which is not the shape of this page.
export default function AccountSettingsLoading() {
  return <SettingsPageSkeleton cards={3} label="Loading account settings" />;
}
