import { ProfilePageSkeleton } from "@/components/profile/profile-page-skeleton";

// Without this the page inherits /profile's own skeleton — a cover band, a
// large avatar and a tab bar — which this page has none of.
export default function EditProfileLoading() {
  return <ProfilePageSkeleton variant="rows" label="Loading profile settings" />;
}
