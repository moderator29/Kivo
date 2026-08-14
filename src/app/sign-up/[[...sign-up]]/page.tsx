import Image from "next/image";
import { SignUp } from "@clerk/nextjs";
import kivoLogo from "../../../../public/brand/kivo-logo.png";

export default function SignUpPage() {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <Image src={kivoLogo} alt="KIVO" width={112} height={112} className="h-28 w-28" priority />
      {clerkConfigured ? (
        <SignUp
          appearance={{
            elements: {
              card: "kivo-glass shadow-none",
              headerTitle: "text-foreground",
              headerSubtitle: "text-foreground-muted",
            },
          }}
        />
      ) : (
        <div className="kivo-glass max-w-sm rounded-2xl p-6 text-center text-sm text-foreground-muted">
          Sign-up isn&apos;t configured in this environment yet — see ENVIRONMENT.md for the required Clerk keys.
        </div>
      )}
    </div>
  );
}
