import { NextResponse } from "next/server";

const SITE_PASSWORD = process.env.SITE_PASSWORD || "poradnypruser";

export async function POST(request: Request) {
  const { password } = await request.json();

  if (password !== SITE_PASSWORD) {
    return NextResponse.json({ error: "wrong" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("site_auth", "authenticated", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
