import Image from "next/image";
import { SignIn } from "@clerk/nextjs";
import kivoLogo from "../../../../public/brand/kivo-logo.png";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <Image src={kivoLogo} alt="KIVO" width={112} height={112} className="h-28 w-28" priority />
      <SignIn
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
