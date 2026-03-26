"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAgentStore } from "@/lib/agent-store";
import { Message, sendMessage } from "@/lib/api";
import { useMessages } from "@/lib/use-messages";
import { agentColor } from "@/lib/agent-colors";
import { ApprovalCard } from "@/components/chat/approval-card";
import { useApprovals } from "@/lib/use-approvals";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const { selectedAgent } = useAgentStore();
  const { messages, loading, addOptimistic, clearMessages } = useMessages(
    selectedAgent?.folder ?? null,
  );
  const { approvals, respond: respondApproval } = useApprovals();

  const agentName = selectedAgent?.name ?? "No Agent";
  const agentInitial = agentName.charAt(0).toUpperCase();
  const agentFolder = selectedAgent?.folder ?? "";
  const color = agentColor(agentFolder);
  const isOnline = selectedAgent?.online ?? false;
  const [sentAt, setSentAt] = useState<string | null>(null);
  const waitingForReply = sentAt !== null;

  // Clear lock when a bot message arrives AFTER we sent ours
  useEffect(() => {
    if (!sentAt) return;
    const hasReply = messages.some(
      (m) => m.is_bot_message && m.timestamp >= sentAt,
    );
    if (hasReply) setSentAt(null);
  }, [messages, sentAt]);

  // Reset when agent changes
  useEffect(() => {
    setSentAt(null);
  }, [selectedAgent?.jid]);

  // Auto-scroll to bottom on new messages, approvals, or typing indicator (unless user scrolled up)
  useEffect(() => {
    if (!userScrolled) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, waitingForReply, approvals]);

  // Detect user scroll
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setUserScrolled(!atBottom);
  }, []);

  // Reset scroll tracking when agent changes
  useEffect(() => {
    setUserScrolled(false);
  }, [selectedAgent?.jid]);

  const sendingRef = useRef(false);
  const handleSend = useCallback(async () => {
    if (!input.trim() || !selectedAgent || sending || sendingRef.current) return;
    sendingRef.current = true;

    const text = input.trim();
    setInput("");
    setSending(true);

    // Optimistic UI
    const optimisticMsg: Message = {
      id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      chat_jid: selectedAgent.jid,
      sender: "dashboard",
      sender_name: "You (Dashboard)",
      content: text,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: false,
    };
    addOptimistic(optimisticMsg);
    setUserScrolled(false);

    try {
      await sendMessage(selectedAgent.folder, text);
      setSentAt(new Date().toISOString());
    } catch {
      // Send failed — restore input so user can retry
      setInput(text);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [input, selectedAgent, sending, addOptimistic]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-surface-1">
      {/* Chat header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-surface-border">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${color.bg} ${color.text}`}>
            {agentInitial}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-mono text-sm font-semibold text-text-primary uppercase truncate">
              {agentName}
            </h3>
            <Badge variant={isOnline ? "running" : "idle"}>
              {isOnline ? "Running" : "Idle"}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedAgent && messages.length > 0 && (
            <button
              onClick={() => setClearConfirm(true)}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-medium uppercase tracking-wider text-text-muted hover:text-signal-error transition-colors cursor-pointer"
              aria-label="Clear chat history"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Clear
            </button>
          )}
          <ConfirmDialog
            open={clearConfirm}
            title="Clear Chat"
            message={`Delete all messages with ${agentName}? This cannot be undone.`}
            confirmLabel="Clear"
            variant="danger"
            onConfirm={async () => {
              setClearConfirm(false);
              if (selectedAgent) {
                try {
                  const res = await fetch(`/api/messages?group=${selectedAgent.folder}`, { method: "DELETE" });
                  if (res.ok) clearMessages();
                } catch {
                  // Network error — messages not cleared
                }
              }
            }}
            onCancel={() => setClearConfirm(false)}
          />
          <select className="hidden md:block bg-surface-2 text-text-secondary text-xs font-mono px-3 py-1.5 rounded-lg border border-surface-border appearance-none cursor-pointer">
            <option>Claude Sonnet 4</option>
            <option>Claude Opus 4</option>
          </select>
        </div>

      </div>

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {!selectedAgent ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-text-muted">
              Select an agent to start chatting
            </p>
          </div>
        ) : loading ? (
          <div className="space-y-4 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`flex gap-3 ${i % 2 === 0 ? "" : "justify-end"}`}>
                {i % 2 === 0 && <div className="w-8 h-8 rounded-full bg-surface-2 shrink-0" />}
                <div className={`space-y-1.5 ${i % 2 === 0 ? "max-w-[60%]" : "max-w-[50%]"}`}>
                  <div className="h-3 bg-surface-2 rounded w-20" />
                  <div className={`rounded-2xl bg-surface-2 ${i % 2 === 0 ? "h-16" : "h-10"} w-full min-w-[120px]`} />
                </div>
                {i % 2 !== 0 && <div className="w-8 h-8 rounded-full bg-surface-2 shrink-0" />}
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-semibold ${color.bg} ${color.text}`}>
              {agentInitial}
            </div>
            <p className="text-sm text-text-muted">
              Start a conversation with {agentName}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                agentName={agentName}
                agentInitial={agentInitial}
                agentColor={color}
              />
            ))}
            {/* Pending approval cards for this agent */}
            {approvals
              .filter((a) => a.groupFolder === selectedAgent?.folder)
              .map((a) => (
                <div key={a.id} className="flex gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-1 ${color.bg} ${color.text}`}>
                    {agentInitial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-mono text-text-muted">{agentName}</span>
                    </div>
                    <ApprovalCard
                      request={{
                        id: a.id,
                        tool: a.toolName,
                        args: typeof a.toolInput === "object" && a.toolInput !== null
                          ? JSON.stringify(a.toolInput, null, 2)
                          : String(a.toolInput ?? ""),
                        timestamp: a.timestamp,
                      }}
                      agentName={agentName}
                      onApprove={(id) => respondApproval(id, "allow", false)}
                      onAlwaysAllow={(id) => respondApproval(id, "allow", true)}
                      onDeny={(id) => respondApproval(id, "deny", false)}
                    />
                  </div>
                </div>
              ))}
            {waitingForReply && (
              <div className="flex gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-1 ${color.bg} ${color.text}`}>
                  {agentInitial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-text-muted">{agentName}</span>
                  </div>
                  <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-chat-agent border border-surface-border inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {userScrolled && messages.length > 0 && (
        <div className="flex justify-center -mt-10 mb-2 relative z-10">
          <button
            onClick={() => {
              setUserScrolled(false);
              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            className="px-3 py-1 bg-surface-2 border border-surface-border rounded-full text-xs font-mono text-text-secondary hover:bg-surface-3 transition-colors cursor-pointer shadow-sm"
          >
            Jump to latest
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="px-4 pb-4 pt-2 border-t border-surface-border">
        <div className="flex items-end gap-2 bg-surface-2 rounded-xl px-4 py-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={waitingForReply ? "waiting for response…" : "type a message"}
            rows={1}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none font-mono resize-none max-h-32"
            disabled={!selectedAgent || waitingForReply}
            style={{
              height: "auto",
              minHeight: "24px",
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
            }}
          />
          <button
            onClick={handleSend}
            className="px-4 py-1.5 bg-primary text-text-inverse rounded-lg text-xs font-mono font-semibold uppercase hover:bg-primary-hover active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            disabled={!selectedAgent || !input.trim() || sending || waitingForReply}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  agentName,
  agentInitial,
  agentColor: color,
}: {
  message: Message;
  agentName: string;
  agentInitial: string;
  agentColor: { bg: string; text: string };
}) {
  const isUser = !message.is_bot_message;
  const initial = isUser ? "Y" : agentInitial;
  const bgClass = isUser ? "bg-chat-user shadow-sm" : "bg-chat-agent border border-surface-border shadow-sm";
  const avatarBg = isUser
    ? "bg-surface-3 text-text-muted"
    : `${color.bg} ${color.text}`;

  // Detect source label
  let sourceLabel: string | null = null;
  if (message.sender === "dashboard") {
    sourceLabel = "Dashboard";
  } else if (message.chat_jid?.startsWith("tg:")) {
    sourceLabel = "Telegram";
  } else if (
    message.chat_jid &&
    !message.chat_jid.startsWith("dashboard-")
  ) {
    sourceLabel = "WhatsApp";
  }

  return (
    <div className="flex gap-3">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-1 ${avatarBg}`}
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-mono text-text-muted">
            {isUser ? "You" : agentName}
          </span>
          {sourceLabel && (
            <span className="text-[10px] font-mono text-text-muted/60">
              via {sourceLabel}
            </span>
          )}
          <span className="text-[10px] text-text-muted/40">
            {formatTime(message.timestamp)}
          </span>
        </div>
        <div
          className={`rounded-2xl rounded-tl-md px-4 py-2.5 max-w-[85%] inline-block ${bgClass}`}
        >
          <div className="text-sm text-text-primary prose prose-sm max-w-none prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:text-sm prose-headings:font-semibold prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:bg-surface-3 prose-pre:rounded-lg prose-pre:overflow-x-auto prose-pre:my-2 prose-code:text-xs prose-code:font-mono break-words overflow-hidden">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
