"""Skills Middleware for injecting skill content into agent prompts.

This middleware reads SKILL.md files from specified directories and injects
their content into the system prompt, enabling progressive skill disclosure.
"""

import logging
import re
from collections.abc import Awaitable, Callable, Sequence
from pathlib import Path

from langchain.agents.middleware.types import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
)
from langchain_core.messages import SystemMessage

from deepagents.backends.filesystem import FilesystemBackend

logger = logging.getLogger(__name__)


# Regex pattern to match YAML frontmatter in SKILL.md files
FRONTMATTER_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _parse_skill_frontmatter(content: str) -> tuple[dict[str, str], str]:
    """Parse YAML frontmatter from skill content.

    Args:
        content: Raw SKILL.md content.

    Returns:
        Tuple of (metadata dict, body content without frontmatter).
    """
    match = FRONTMATTER_PATTERN.match(content)
    if not match:
        return {}, content

    frontmatter = match.group(1)
    body = content[match.end() :]

    # Simple YAML parsing for name/description
    # Frontmatter format: "key: value" per line
    metadata: dict[str, str] = {}
    for line in frontmatter.strip().split("\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip()

    return metadata, body


class SkillsMiddleware(AgentMiddleware):
    """Middleware that loads and injects skill content into agent prompts.

    Skills are markdown files (SKILL.md) that contain best practices, workflows,
    and guidelines for specific tasks. This middleware reads skills from
    specified source directories and injects them into the system prompt.

    Example:
        ```python
        from master_clash.workflow.skills_middleware import SkillsMiddleware
        from deepagents.backends.filesystem import FilesystemBackend

        backend = FilesystemBackend(root_dir="./skills", virtual_mode=True)
        middleware = SkillsMiddleware(
            backend=backend,
            sources=["/creative/", "/categories/"],
        )
        ```
    """

    def __init__(
        self,
        backend: FilesystemBackend,
        sources: Sequence[str] | None = None,
    ) -> None:
        """Initialize skills middleware.

        Args:
            backend: FilesystemBackend pointing to the skills directory.
            sources: List of source directories to load skills from.
                    Each path should be relative to the backend root.
                    Example: ["/creative/", "/categories/"]
        """
        self.backend = backend
        self.sources = list(sources) if sources else ["/"]
        self.tools: list = []  # No tools provided by this middleware
        self._skills_cache: dict[str, tuple[dict[str, str], str]] | None = None

    def _load_skills(self) -> dict[str, tuple[dict[str, str], str]]:
        """Load all skills from configured sources.

        Returns:
            Dict mapping skill name to (metadata, body) tuples.
        """
        if self._skills_cache is not None:
            return self._skills_cache

        skills: dict[str, tuple[dict[str, str], str]] = {}

        for source in self.sources:
            # Find all SKILL.md files in this source directory
            try:
                # Use glob to find SKILL.md files recursively
                skill_files = self.backend.glob_info("**/SKILL.md", path=source)

                for file_info in skill_files:
                    file_path = file_info.get("path", "")
                    if not file_path:
                        continue

                    # Read the skill content
                    content = self.backend.read(file_path, offset=0, limit=10000)

                    # Check for read errors
                    if content.startswith("Error:"):
                        logger.warning(f"Failed to read skill file {file_path}: {content}")
                        continue

                    # Parse frontmatter and body
                    metadata, body = _parse_skill_frontmatter(content)
                    skill_name = metadata.get("name", Path(file_path).parent.name)

                    skills[skill_name] = (metadata, body)
                    logger.info(f"Loaded skill: {skill_name} from {file_path}")

            except Exception as e:
                logger.warning(f"Error loading skills from {source}: {e}")

        self._skills_cache = skills
        logger.info(f"Loaded {len(skills)} skills: {list(skills.keys())}")
        return skills

    def _format_skills_prompt(self) -> str:
        """Format loaded skills into a system prompt section.

        Returns:
            Formatted skills content for injection into system prompt.
        """
        skills = self._load_skills()

        if not skills:
            return ""

        sections = ["## Available Skills\n"]
        sections.append("You have access to the following skills for specialized tasks:\n")

        for skill_name, (metadata, body) in skills.items():
            description = metadata.get("description", "No description")
            sections.append(f"### {skill_name}\n")
            sections.append(f"*{description}*\n")
            # Include the skill body (markdown content)
            sections.append(body)
            sections.append("\n---\n")

        return "\n".join(sections)

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        """Inject skills content into the system prompt.

        Args:
            request: The model request.
            handler: The next handler in the chain.

        Returns:
            Model response from handler.
        """
        skills_prompt = self._format_skills_prompt()

        if skills_prompt:
            if request.system_prompt:
                new_prompt = f"{request.system_prompt}\n\n{skills_prompt}"
            else:
                new_prompt = skills_prompt
            request = request.override(system_message=SystemMessage(content=new_prompt))

        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        """Async version of wrap_model_call.

        Args:
            request: The model request.
            handler: The next async handler in the chain.

        Returns:
            Model response from handler.
        """
        skills_prompt = self._format_skills_prompt()

        if skills_prompt:
            if request.system_prompt:
                new_prompt = f"{request.system_prompt}\n\n{skills_prompt}"
            else:
                new_prompt = skills_prompt
            request = request.override(system_message=SystemMessage(content=new_prompt))

        return await handler(request)
