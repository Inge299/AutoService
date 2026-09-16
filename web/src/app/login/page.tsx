import { redirect } from "next/navigation";

export default function LoginPage() {
  redirect("/customer/login?mode=sms");
}
