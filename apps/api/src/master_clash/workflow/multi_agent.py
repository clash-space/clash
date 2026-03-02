"""Multi-agent LangGraph workflow for the creative canvas.

This module creates a supervisor agent with specialist sub-agents,
following the deepagents architecture pattern.

After skills integration:
- Supervisor handles creative tasks directly via skills (scriptwriting, concept-art, storyboarding)
- Only Editor remains as a subagent (requires TimelineMiddleware for special tools)
"""

from pathlib import Path

from deepagents.backends.filesystem import FilesystemBackend
from langchain_google_genai import ChatGoogleGenerativeAI

from master_clash.workflow.backends import StateCanvasBackend
from master_clash.workflow.graph import create_supervisor_agent
from master_clash.workflow.middleware import (
    CanvasMiddleware,
    TimelineMiddleware,
)
from master_clash.workflow.skills_middleware import SkillsMiddleware
from master_clash.workflow.subagents import create_specialist_agents

# Path to skills directory
SKILLS_DIR = Path(__file__).parent.parent / "skills"


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
    1. A supervisor agent with skills (scriptwriting, concept-art, storyboarding, video categories)
    2. Editor sub-agent (requires TimelineMiddleware for special tools)
    3. Middleware stack (Skills, Canvas, SubAgent)
    4. Canvas backend for tool operations

    Note: This version uses get_checkpointer() which may not work with PostgreSQL.
    For PostgreSQL support, use create_multi_agent_workflow_async() instead.

    Args:
        llm: Optional language model (defaults to Gemini).

    Returns:
        Compiled supervisor agent graph.
    """
    llm = llm or create_default_llm()

    # Create backends and middleware
    backend = StateCanvasBackend()
    canvas_middleware = CanvasMiddleware(backend=backend)
    timeline_middleware = TimelineMiddleware()

    # Create skills backend and middleware for supervisor
    # Skills provide creative capabilities and video category best practices
    skills_backend = FilesystemBackend(root_dir=str(SKILLS_DIR), virtual_mode=True)
    skills_middleware = SkillsMiddleware(
        backend=skills_backend,
        sources=[
            "/creative/",    # scriptwriting, concept-art, storyboarding
            "/categories/",  # product-ecommerce, tutorial-explainer, story-narrative, social-media
        ],
    )

    # Create specialist sub-agents (only Editor remains)
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
        additional_middleware=[skills_middleware, canvas_middleware],
    )

    return supervisor


async def create_multi_agent_workflow_async(llm: ChatGoogleGenerativeAI | None = None):
    """Create the multi-agent workflow using deepagents-inspired architecture (async version).

    This creates:
    1. A supervisor agent with skills (scriptwriting, concept-art, storyboarding, video categories)
    2. Editor sub-agent (requires TimelineMiddleware for special tools)
    3. Middleware stack (Skills, Canvas, SubAgent)
    4. Canvas backend for tool operations

    This async version properly supports PostgreSQL checkpointers.

    Args:
        llm: Optional language model (defaults to Gemini).

    Returns:
        Compiled supervisor agent graph.
    """
    llm = llm or create_default_llm()

    # Create backends and middleware
    backend = StateCanvasBackend()
    canvas_middleware = CanvasMiddleware(backend=backend)
    timeline_middleware = TimelineMiddleware()

    # Create skills backend and middleware for supervisor
    # Skills provide creative capabilities and video category best practices
    skills_backend = FilesystemBackend(root_dir=str(SKILLS_DIR), virtual_mode=True)
    skills_middleware = SkillsMiddleware(
        backend=skills_backend,
        sources=[
            "/creative/",    # scriptwriting, concept-art, storyboarding
            "/categories/",  # product-ecommerce, tutorial-explainer, story-narrative, social-media
        ],
    )

    # Create specialist sub-agents (only Editor remains)
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
        additional_middleware=[skills_middleware, canvas_middleware],
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
