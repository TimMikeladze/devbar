// Simple HMAC-based token for auth proxy (Mode C)
// Token format: base64url(JSON payload).base64url(HMAC-SHA256 signature)

export async function sign(
  payload: { name: string; email: string; avatar?: string; exp?: number },
  secret: string,
): Promise<string> {
  const data = {
    ...payload,
    exp: payload.exp ?? Date.now() + 5 * 60 * 1000,
  }; // 5 min default expiry
  const encoded = btoa(JSON.stringify(data));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded),
  );
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${encoded}.${sigStr}`;
}

export async function verify(
  token: string,
  secret: string,
): Promise<{ name: string; email: string; avatar?: string } | null> {
  const [encoded, sigStr] = token.split(".");
  if (!encoded || !sigStr) return null;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sig = Uint8Array.from(atob(sigStr), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sig,
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;

    const payload = JSON.parse(atob(encoded));
    if (payload.exp && payload.exp < Date.now()) return null; // expired

    return {
      name: payload.name,
      email: payload.email,
      avatar: payload.avatar,
    };
  } catch {
    return null;
  }
}
