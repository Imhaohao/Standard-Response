import os
from datetime import datetime, timezone
from uuid import uuid4

import anthropic
import httpx
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)

from rollcall_agent.conversation import Conversation
from rollcall_agent.convex_client import ConvexClient

NAME = "rollcall-evacuation-ready"


def text_of(message: ChatMessage) -> str:
    return " ".join(part.text for part in message.content if isinstance(part, TextContent)).strip()


def chat_reply(text: str) -> ChatMessage:
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(text=text)])


def build_agent() -> Agent:
    agent = Agent(
        name=NAME,
        seed=os.environ["AGENT_SEED_PHRASE"],
        port=int(os.environ.get("AGENT_PORT", "8001")),
        mailbox=True,
        publish_agent_details=True,
    )
    http = httpx.AsyncClient()
    conversation = Conversation(
        claude=anthropic.Anthropic().messages,
        convex=ConvexClient(os.environ["CONVEX_SITE_URL"], os.environ["FETCH_AGENT_SECRET"], http),
        http=http,
    )
    chat = Protocol(spec=chat_protocol_spec)

    @chat.on_message(ChatMessage)
    async def on_message(ctx: Context, sender: str, message: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=message.msg_id))
        text = text_of(message)
        if text:
            await ctx.send(sender, chat_reply(await conversation.reply(sender, text)))

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, message: ChatAcknowledgement):
        ctx.logger.info(f"ack from {sender} for {message.acknowledged_msg_id}")

    agent.include(chat, publish_manifest=True)
    return agent


if __name__ == "__main__":
    build_agent().run()
