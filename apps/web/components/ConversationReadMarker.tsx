"use client";

import { useEffect, useTransition } from "react";
import { markConversationReadById } from "@/app/actions/social";

export function ConversationReadMarker({ conversationId }: { conversationId: string }) {
  const [, startTransition] = useTransition();
  useEffect(() => {
    startTransition(() => { void markConversationReadById(conversationId); });
  }, [conversationId]);
  return null;
}
