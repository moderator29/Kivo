import Image from "next/image";
import { SignUp } from "@clerk/nextjs";
import { FadeIn } from "@/components/ui/fade-in";
import kivoLogo from "../../../../public/brand/kivo-logo.png";

export default function SignUpPage() {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-4 py-12">
      <div className="kivo-aurora" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" />
        <span className="kivo-aurora-blob kivo-aurora-blob--magenta" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8">
        <FadeIn>
          <Image src={kivoLogo} alt="KIVO" width={112} height={112} className="h-28 w-28" priority />
        </FadeIn>

        {clerkConfigured ? (
          <FadeIn delay={0.12}>
            <SignUp
              appearance={{
                elements: {
                  card: "kivo-glass-brand shadow-none",
                  headerTitle: "text-foreground",
                  headerSubtitle: "text-foreground-muted",
                },
              }}
            />
          </FadeIn>
        ) : (
          <FadeIn
            delay={0.12}
            className="kivo-glass-brand max-w-sm rounded-2xl p-6 text-center text-sm text-foreground-muted"
          >
            Sign-up isn&apos;t configured in this environment yet. See ENVIRONMENT.md for the required Clerk keys.
          </FadeIn>
        )}
      </div>
    </div>
  );
}
