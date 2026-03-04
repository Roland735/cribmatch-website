import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import ProfileClient from "./ProfileClient";

export default async function UserProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href="/user"
          className="text-sm font-medium text-emerald-400 transition hover:text-emerald-300"
        >
          ← Back to dashboard
        </Link>
      </div>

      <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
        Profile
      </h1>
      <p className="mt-2 text-sm text-slate-300">
        Manage your account details and preferences.
      </p>

      <div className="mt-8">
        <ProfileClient />
      </div>
    </div>
  );
}
