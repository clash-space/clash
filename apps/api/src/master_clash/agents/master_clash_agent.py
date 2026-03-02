import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from master_clash.config import get_settings
from master_clash.prompts import MASTERCLASH_SYSTEM_PROMPT

logger = logging.getLogger(__name__)
settings = get_settings()

class MasterClashAgent:
    def __init__(self):
        # Use a capable model for reasoning
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            temperature=0.7,
            base_url=settings.google_ai_studio_base_url,
            transport="rest",
        )

    async def plan(self, user_input: str) -> dict:
        """
        Analyze user input and return a plan (JSON).
        """
        messages = [
            SystemMessage(content=DIRECTOR_SYSTEM_PROMPT),
            HumanMessage(content=user_input)
        ]

        try:
            logger.info("MasterClash Agent planning...")
            response = await self.llm.ainvoke(messages)
            content = response.content

            # Clean up potential markdown code blocks
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                 content = content.split("```")[1].split("```")[0]

            plan = json.loads(content.strip())
            logger.info(f"MasterClash Agent plan: {plan}")
            return plan
        except Exception as e:
            logger.error(f"MasterClash Agent planning failed: {e}")
            # Return empty plan on error
            return {"thought": f"I encountered an error while planning: {str(e)}", "plan": []}
