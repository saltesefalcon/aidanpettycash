// src/app/page.tsx
import { redirect } from "next/navigation";

export default function Home() {
  // Land on dashboard; if not signed in, the dashboard page will bounce to /login
  redirect("/dashboard");
}
