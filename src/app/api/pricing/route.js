import { getPricingSettings } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const pricing = await getPricingSettings({ ensurePersisted: true });
  return Response.json({ pricing });
}
