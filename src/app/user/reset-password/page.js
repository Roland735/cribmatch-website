import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import ResetPasswordClient from "./ResetPasswordClient";

export default async function UserResetPasswordPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href="/user/profile"
          className="text-sm font-medium text-emerald-400 transition hover:text-emerald-300"
        >
          ← Back to profile
        </Link>
      </div>

      <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
        Reset password
      </h1>
      <p className="mt-2 text-sm text-slate-300">
        Change your account password while you are signed in.
      </p>

      <div className="mt-8">
        <ResetPasswordClient />
      </div>
    </div>
  );
}
