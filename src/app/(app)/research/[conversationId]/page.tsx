import { ResearchConversationWorkbench } from "@/components/research-conversation-workbench";

export default async function ResearchConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ResearchConversationWorkbench conversationId={conversationId} embeddedInShell />;
}
