import { SessionRefresher } from "@/components/session-refresher";
import { requireCustomerSession } from "@/lib/auth/session";

export default async function CustomerCabinetLayout({ children }: { children: React.ReactNode }) {
  const session = await requireCustomerSession();
  return <>
    <SessionRefresher scope="customer" accessTokenExpiresAtEpochMs={session.accessTokenExpiresAtEpochMs} />
    {children}
  </>;
}
