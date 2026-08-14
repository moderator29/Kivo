import { currentUser } from "@clerk/nextjs/server";
import { CircleUserRound } from "lucide-react";

export default async function ProfilePage() {
  const user = await currentUser();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="kivo-glass flex items-center gap-4 rounded-2xl p-5">
        <div className="kivo-gradient-prime flex h-16 w-16 shrink-0 items-center justify-center rounded-full">
          <CircleUserRound className="h-8 w-8 text-kivo-white" strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : (user?.username ?? "Your profile")}
          </h1>
          <p className="text-sm text-foreground-muted">{user?.primaryEmailAddress?.emailAddress}</p>
        </div>
      </div>

      <div className="kivo-glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Football identity</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          Favourite clubs, players, prediction history, fantasy rank and badges will live here as those systems come
          online.
        </p>
      </div>
    </div>
  );
}
