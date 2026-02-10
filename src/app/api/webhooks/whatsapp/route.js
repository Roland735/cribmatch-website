import { NextResponse } from "next/server";

export const runtime = "nodejs";

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

const FLOW_ID = "1534021024566343";

async function sendFlow(toPhone) {
  const token = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId =
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneNumberId) {
    console.log("Missing WhatsApp credentials");
    return { error: "missing-credentials" };
  }

  const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(toPhone),
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: "Find rentals — filters" },
      body: { text: "Please press continue to SEARCH." },
      footer: { text: "Search" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: FLOW_ID,
          flow_cta: "Search",
          flow_action: "navigate",
          flow_action_payload: {
            screen: "SEARCH",
            data: {
              cities: [
                { id: "harare", title: "Harare" },
                { id: "chitungwiza", title: "Chitungwiza" },
                { id: "bulawayo", title: "Bulawayo" },
                { id: "mutare", title: "Mutare" }
              ],
              suburbs: [
                { id: "any", title: "Any" },
                { id: "borrowdale", title: "Borrowdale" },
                { id: "mount_pleasant", title: "Mount Pleasant" },
                { id: "avondale", title: "Avondale" }
              ],
              propertyCategories: [
                { id: "residential", title: "Residential" },
                { id: "commercial", title: "Commercial" }
              ],
              propertyTypes: [
                { id: "house", title: "House" },
                { id: "flat", title: "Flat" },
                { id: "studio", title: "Studio" }
              ],
              bedrooms: [
                { id: "any", title: "Any" },
                { id: "1", title: "1" },
                { id: "2", title: "2" },
                { id: "3", title: "3" }
              ],
              selected_city: "harare",
              selected_suburb: "any",
              selected_category: "residential",
              selected_type: "house",
              selected_bedrooms: "any",
              min_price: "0",
              max_price: "0",
              q: ""
            }
          }
        }
      }
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

/* -------------------------
   GET — webhook verify
------------------------- */
export async function GET(req) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("OK", { status: 200 });
}

/* -------------------------
   POST — receive messages
------------------------- */
export async function POST(request) {
  const payload = await request.json();

  console.log("Incoming webhook:", JSON.stringify(payload));

  const msg =
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!msg) {
    return NextResponse.json({ ok: true, note: "no-message" });
  }

  const from = msg.from;
  const text = msg.text?.body || "";

  console.log("FROM:", from);
  console.log("TEXT:", text);

  if (/^(hi|hello|hey|start)$/i.test(text.trim())) {
    const resp = await sendFlow(from);
    console.log("Flow send response:", resp);
  }

  return NextResponse.json({ ok: true });
}
