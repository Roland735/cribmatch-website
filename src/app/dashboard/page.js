import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function DashboardRouterPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const role = session?.user?.role;
  if (role === "admin") redirect("/admin");
  if (role === "agent") redirect("/agent");
  redirect("/user");
}

