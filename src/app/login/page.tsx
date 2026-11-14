import { LoginForm } from "@/components/login-form";
import { Card } from "@/components/ui";
import { safeNext } from "@/lib/auth";

// Login superadmin (PLAN §9 no. 1). Akun Supabase Auth; hanya email di ADMIN_EMAILS yang diterima.
type Props = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-[.08em] text-[var(--red)]">REMAX HQ</div>
        <h1 className="mb-1 font-display text-2xl font-extrabold tracking-tight">Reporting Closing</h1>
        <p className="mb-5 text-[13px] text-[var(--muted)]">Masuk dengan akun superadmin.</p>
        <LoginForm next={safeNext(next)} />
      </Card>
    </main>
  );
}
