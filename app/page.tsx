import { redirect } from "next/navigation";

// The call floor moved to /dashboard. This stays until the public sign-in page takes over /.
export default function Home() {
  redirect("/dashboard");
}
