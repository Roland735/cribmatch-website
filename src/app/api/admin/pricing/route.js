import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPricingSettings, updatePricingSettings } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session?.user?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pricing = await getPricingSettings({ ensurePersisted: true });
  return Response.json({ pricing });
}

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session?.user?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const contactUnlockPriceUsd = Number(body?.contactUnlockPriceUsd);
  const landlordListingPriceUsd = Number(body?.landlordListingPriceUsd);

  if (!Number.isFinite(contactUnlockPriceUsd) || contactUnlockPriceUsd < 0) {
    return Response.json({ error: "Unlock price must be a non-negative number" }, { status: 400 });
  }
  if (!Number.isFinite(landlordListingPriceUsd) || landlordListingPriceUsd < 0) {
    return Response.json({ error: "Landlord listing price must be a non-negative number" }, { status: 400 });
  }

  const pricing = await updatePricingSettings({
    contactUnlockPriceUsd,
    landlordListingPriceUsd,
  });

  return Response.json({ ok: true, pricing });
}
