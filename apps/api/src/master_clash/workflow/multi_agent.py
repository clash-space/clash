"""Multi-agent LangGraph workflow for the creative canvas.

This module creates a supervisor agent with four specialized sub-agents,
following the deepagents architecture pattern.
"""

from langchain_google_genai import ChatGoogleGenerativeAI

from master_clash.workflow.backends import StateCanvasBackend
from master_clash.workflow.graph import create_supervisor_agent
from master_clash.workflow.middleware import (
    CanvasMiddleware,
    TimelineMiddleware,
)
from master_clash.workflow.subagents import create_specialist_agents


def create_default_llm() -> ChatGoogleGenerativeAI:
    """Create the default Gemini client used across agents."""
    #     client = Client(
    #       vertexai=True,
    #       api_key=os.environ.get("GOOGLE_CLOUD_API_KEY"),
    #   )
    # vertexai.init()
    # return ChatVertexAI(
    #     model_name="gemini-2.5-pro",
    #     include_thoughts=True,
    #     thinking_budget=1000,
    #     streaming=True
    # )
    return ChatGoogleGenerativeAI(
        model="gemini-3-pro-preview",
        include_thoughts=True,
        thinking_budget=1000,
        streaming=True,
        vertexai=True,
    )


def create_multi_agent_workflow(llm: ChatGoogleGenerativeAI | None = None):
    """Create the multi-agent workflow using deepagents-inspired architecture (sync version).

    This creates:
    1. A supervisor agent that delegates tasks
    2. Four specialist sub-agents (ScriptWriter, ConceptArtist, StoryboardDesigner, Editor)
    3. Middleware stack (TodoList, Canvas, SubAgent)
    4. Canvas backend for tool operations

    Note: This version uses get_checkpointer() which may not work with PostgreSQL.
    For PostgreSQL support, use create_multi_agent_workflow_async() instead.

    Args:
        llm: Optional language model (defaults to Gemini 2.5 Pro)

    Returns:
        Compiled supervisor agent graph
    """
    llm = llm or create_default_llm()

    # Create backend and middleware
    backend = StateCanvasBackend()
    canvas_middleware = CanvasMiddleware(backend=backend)
    timeline_middleware = TimelineMiddleware()

    # Create specialist sub-agents
    subagents = create_specialist_agents(
        model=llm,
        canvas_middleware=canvas_middleware,
        timeline_middleware=timeline_middleware,
    )

    # Create supervisor agent with delegation capability
    # Use persistent checkpointer for cross-request state persistence
    from master_clash.database import get_checkpointer

    checkpointer = get_checkpointer()

    supervisor = create_supervisor_agent(
        model=llm,
        subagents=subagents,
        backend=backend,
        checkpointer=checkpointer,
    )

    return supervisor


async def create_multi_agent_workflow_async(llm: ChatGoogleGenerativeAI | None = None):
    """Create the multi-agent workflow using deepagents-inspired architecture (async version).

    This creates:
    1. A supervisor agent that delegates tasks
    2. Four specialist sub-agents (ScriptWriter, ConceptArtist, StoryboardDesigner, Editor)
    3. Middleware stack (TodoList, Canvas, SubAgent)
    4. Canvas backend for tool operations

    This async version properly supports PostgreSQL checkpointers.

    Args:
        llm: Optional language model (defaults to Gemini 2.5 Pro)

    Returns:
        Compiled supervisor agent graph
    """
    llm = llm or create_default_llm()

    # Create backend and middleware
    backend = StateCanvasBackend()
    canvas_middleware = CanvasMiddleware(backend=backend)
    timeline_middleware = TimelineMiddleware()

    # Create specialist sub-agents
    subagents = create_specialist_agents(
        model=llm,
        canvas_middleware=canvas_middleware,
        timeline_middleware=timeline_middleware,
    )

    # Create supervisor agent with delegation capability
    # Use persistent checkpointer for cross-request state persistence
    from master_clash.database import get_async_checkpointer

    checkpointer = await get_async_checkpointer()

    supervisor = create_supervisor_agent(
        model=llm,
        subagents=subagents,
        backend=backend,
        checkpointer=checkpointer,
    )

    return supervisor


# Global cached graph instance
_cached_graph = None


async def get_or_create_graph():
    """Get or create the global workflow graph instance.

    This function lazily initializes the graph on first use and caches it
    for subsequent requests. Supports async checkpointer initialization.

    Returns:
        Compiled supervisor agent graph
    """
    global _cached_graph
    if _cached_graph is None:
        _cached_graph = await create_multi_agent_workflow_async()
    return _cached_graph


# For backwards compatibility - will be lazily initialized on first use
# Use get_or_create_graph() in async contexts instead
graph = None
