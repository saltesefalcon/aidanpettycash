import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await ctx.params;
  return NextResponse.json({ ok: true, route: "store/_health", storeId });
}
