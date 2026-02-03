import AdminClient from "./AdminClient";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session?.user?.role !== "admin") redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
        Admin dashboard
      </h1>
      <p className="mt-2 text-sm text-slate-300">Create and manage listings.</p>
      <AdminClient />
    </div>
  );
}
