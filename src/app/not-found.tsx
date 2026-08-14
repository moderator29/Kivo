import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="kivo-gradient-intelligence flex h-16 w-16 items-center justify-center rounded-2xl">
        <Compass className="h-8 w-8 text-kivo-white" strokeWidth={1.75} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Offside. This page doesn&apos;t exist.</h1>
        <p className="max-w-md text-sm text-foreground-muted">
          The page you&apos;re looking for isn&apos;t here. Let&apos;s get you back to the game.
        </p>
      </div>
      <Link
        href="/home"
        className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
      >
        Back to Home
      </Link>
    </div>
  );
}
