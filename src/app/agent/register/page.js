import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import AgentRegistrationClient from "./AgentRegistrationClient";

export const runtime = "nodejs";

export default async function AgentRegistrationPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login?callbackUrl=/agent/register");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
        Agent registration
      </h1>
      <p className="mt-2 text-sm text-slate-300">
        Submit your agency credentials and commission details, or review your existing application state.
      </p>
      <div className="mt-8">
        <AgentRegistrationClient />
      </div>
    </div>
  );
}
