import { InviteAcceptCard } from "@/components/invite-accept-card";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InviteAcceptCard token={decodeURIComponent(token)} />;
}
