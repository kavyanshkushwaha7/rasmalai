import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { NewPasswordForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return <AuthShell eyebrow="ALMOST BACK IN THE GAME" title="Choose a new password." description="Make it something you’ll remember next time.">
    <NewPasswordForm />
  </AuthShell>;
}
