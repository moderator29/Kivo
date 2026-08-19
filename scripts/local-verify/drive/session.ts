/**
 * Signs a scenario user in through the real client, and prints the cookies the
 * application will read back.
 *
 * Deliberately uses @supabase/ssr's own cookie writer rather than hand-rolling
 * the cookie format: the point of driving the product is to exercise what it
 * actually does, and a hand-made session cookie would be testing my
 * understanding of the encoding rather than the application's.
 */
import { createServerClient } from "@supabase/ssr";

const email = process.argv[2] ?? "ada@kivo.local";
const jar = new Map<string, string>();

const supabase = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  },
);

async function main() {
  const { error: otpError } = await supabase.auth.signInWithOtp({ email });
  if (otpError) throw new Error(`signInWithOtp: ${otpError.message}`);

  const { data, error } = await supabase.auth.verifyOtp({ email, token: "123456", type: "email" });
  if (error) throw new Error(`verifyOtp: ${error.message}`);

  const cookieHeader = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  console.error(`signed in as ${data.user?.email} (${data.user?.id})`);
  console.log(cookieHeader);
}

main();
