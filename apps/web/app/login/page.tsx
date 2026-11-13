import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="max-w-sm mx-auto pt-24">
      <div className="ow-eyebrow mb-3">OW Studio</div>
      <h1 className="ow-display text-4xl mb-10">Sign in</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
