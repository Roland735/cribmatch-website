import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import SignOutButton from "../SignOutButton";

export default async function UserLayout({ children }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const role = session?.user?.role;
  if (role !== "user" && role !== "agent" && role !== "admin") {
    redirect("/login");
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
