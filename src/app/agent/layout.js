import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import SignOutButton from "../SignOutButton";

export default async function AgentLayout({ children }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (
    session?.user?.role !== "agent" &&
    session?.user?.role !== "admin" &&
    session?.user?.role !== "user"
  ) {
    redirect("/user");
  }

  const phoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber : "";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:max-w-7xl lg:px-8">
        {children}
      </main>
    </div>
  );
}
