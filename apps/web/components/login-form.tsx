"use client";

import { Button, Input, Label, TextField } from "@heroui/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) })
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .catch(() => ({ ok: false, body: { error: "Network error" } }));
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? "Sign in failed"); return; }
    // Only same-site paths: never redirect to another origin from the query string.
    const next = params.get("next");
    // Full page load: the client router may hold the pre-login redirect to /login in its cache.
    window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <TextField value={password} onChange={setPassword} type="password" autoFocus isRequired>
        <Label className="ow-eyebrow">Password</Label>
        <Input autoComplete="current-password" />
      </TextField>
      {error && <p className="text-danger text-sm">{error}</p>}
      <Button type="submit" size="lg" isPending={busy} isDisabled={!password}>Sign in</Button>
    </form>
  );
}
