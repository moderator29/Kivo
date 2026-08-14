import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <div className="flex items-center gap-2">
        <span className="kivo-gradient-prime h-8 w-8 rounded-lg" aria-hidden />
        <span className="text-xl font-semibold tracking-tight text-foreground">KIVO</span>
      </div>
      <SignUp
        appearance={{
          elements: {
            card: "kivo-glass shadow-none",
            headerTitle: "text-foreground",
            headerSubtitle: "text-foreground-muted",
          },
        }}
      />
    </div>
  );
}
