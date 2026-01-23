import logging

from langchain_core.tools import tool

from master_clash.config import get_settings
from master_clash.utils import image_message_part_template, text_message_part_template

logger = logging.getLogger(__name__)

# Get settings instance
settings = get_settings()

# Global image registry: maps image names to base64 data
_IMAGE_REGISTRY: dict[str, str] = {}

# Counter for auto-generated image names
_GENERATED_IMAGE_COUNTER: dict[str, int] = {}


def register_image(name: str, base64_data: str) -> None:
    """
    Register an image with a name for later reference.
    Args:
        name: Unique identifier for the image (e.g., "cat_original", "reference_photo")
        base64_data: Base64-encoded image data
    """
    _IMAGE_REGISTRY[name] = base64_data


def get_image(name: str) -> str:
    """
    Retrieve base64 data for a registered image.
    Args:
        name: Image identifier
    Returns:
        Base64-encoded image data
    Raises:
        KeyError: If image name not found in registry
    """
    if name not in _IMAGE_REGISTRY:
        raise KeyError(
            f"Image '{name}' not found in registry. Available images: {list(_IMAGE_REGISTRY.keys())}"
        )
    return _IMAGE_REGISTRY[name]


def clear_image_registry() -> None:
    """Clear all registered images and counters."""
    _IMAGE_REGISTRY.clear()
    _GENERATED_IMAGE_COUNTER.clear()


def list_registered_images() -> list[str]:
    """Get list of all registered image names."""
    return list(_IMAGE_REGISTRY.keys())


def get_image_registry_prompt() -> str:
    """
    Generate a prompt snippet describing available images.
    Returns:
        Formatted string listing available images for inclusion in system prompts
    """
    if not _IMAGE_REGISTRY:
        return "No images are currently registered."

    image_list = ", ".join(f"'{name}'" for name in _IMAGE_REGISTRY)
    return (
        f"Available reference images: {image_list}. Use these names when calling nano_banana tools."
    )


def _generate_image_name(base_name: str) -> str:
    """
    Generate a unique image name based on the base name.
    Args:
        base_name: Base name for the generated image (e.g., "cat_original")
    Returns:
        Unique name like "cat_original_1", "cat_original_2", etc.
    """
    if base_name not in _GENERATED_IMAGE_COUNTER:
        _GENERATED_IMAGE_COUNTER[base_name] = 0

    _GENERATED_IMAGE_COUNTER[base_name] += 1
    return f"{base_name}_{_GENERATED_IMAGE_COUNTER[base_name]}"


def _save_image_to_file(base64_data: str, filename: str, output_dir: str | None = None) -> str:
    """
    Save base64-encoded image to file.
    Args:
        base64_data: Base64-encoded image data
        filename: Name of the file (without extension)
        output_dir: Directory to save the image (uses settings.output_dir if not provided)
    Returns:
        Full path to saved file
    """
    import base64
    from pathlib import Path

    # Use configured output directory if not provided
    output_dir = settings.output_dir if output_dir is None else Path(output_dir)

    # Create output directory if it doesn't exist
    output_dir.mkdir(parents=True, exist_ok=True)

    # Save as PNG
    filepath = output_dir / f"{filename}.png"

    with open(filepath, "wb") as f:
        f.write(base64.b64decode(base64_data))

    return filepath


def _base_nano_banana_gen(
    text: str,
    system_prompt: str | None = "Must generate an image",
    images: list[str] | None = None,
    aspect_ratio: str | None = "16:9",
    image_size: str | None = "2K",
    model_name: str | None = "gemini-2.5-flash-image",
):
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
    from langchain_google_genai import ChatGoogleGenerativeAI, Modality

    # Gemini supported aspect ratios (synced with shared-types GEMINI_ASPECT_RATIOS)
    # Reference: https://ai.google.dev/gemini-api/docs/image-generation
    supported_aspect_ratios = {
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
    }
    normalized_ratio = aspect_ratio if aspect_ratio in supported_aspect_ratios else "16:9"

    # Gemini supported image sizes (synced with shared-types GEMINI_IMAGE_SIZES)
    # Reference: https://googleapis.github.io/python-genai/genai.html#genai.types.ImageConfig
    supported_image_sizes = {"1K", "2K", "4K"}
    normalized_size = image_size if image_size in supported_image_sizes else "2K"

    logger.info(f"[NanoBanana] Using aspect_ratio={normalized_ratio}, image_size={normalized_size}")

    # Build ImageConfig with all supported parameters
    # - aspect_ratio: Output aspect ratio (required)
    # - image_size: Resolution - "1K" (default), "2K", or "4K" (must be uppercase K)
    # - number_of_images: Number of images per request (1-4)
    # Reference: https://googleapis.github.io/python-genai/genai.html#genai.types.ImageConfig
    image_config = {
        "aspect_ratio": normalized_ratio,
        "image_size": normalized_size,
        # "number_of_images": 1,  # Default is 1, can be 1-4
    }

    # llm = ChatGoogleGenerativeAI(
    #     model=model_name,
    #     response_modalities=[Modality.TEXT, Modality.IMAGE],
    #     base_url=settings.google_ai_studio_base_url,
    #     transport="rest",
    # )
    llm = ChatGoogleGenerativeAI(
        model=model_name,
        response_modalities=[Modality.TEXT, Modality.IMAGE],
        base_url=settings.google_ai_studio_base_url,
        vertexai=True,
        image_config=image_config,
    )

    # 构建消息内容
    content = [{"type": "text", "text": text}]
    if images:
        for img in images:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{img}"},
                }
            )

    # 构建消息列表
    messages = []
    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    messages.append(HumanMessage(content=content))

    try:
        # 调用模型
        response = llm.invoke(messages)
        # logger.info(f"Nano Banana Response: {response}")
    except Exception as e:
        logger.error(f"Error in nano_banana_gen: {str(e)}", exc_info=True)
        raise e

    # 提取图片 base64
    def _get_image_base64(response: AIMessage) -> str:
        # Handle string content (rare but possible)
        if isinstance(response.content, str):
            raise ValueError(f"Model returned text instead of image: {response.content}")

        # Look for image block
        image_block = next(
            (
                block
                for block in response.content
                if isinstance(block, dict) and block.get("image_url")
            ),
            None,
        )
        if image_block:
            return image_block["image_url"].get("url").split(",")[-1]

        # Look for text block to give better error
        text_block = next(
            (block for block in response.content if isinstance(block, dict) and block.get("text")),
            None,
        )
        if text_block:
            raise ValueError(f"Model returned text instead of image: {text_block.get('text')}")

        raise ValueError("No image generated in response")

    return _get_image_base64(response)


def nano_banana_gen(
    text: str,
    system_prompt: str | None = "",
    base64_images: list[str] | None = None,
    aspect_ratio: str | None = "16:9",
    image_size: str | None = "2K",
) -> str:
    """
    Advanced Nano Banana image generation with Gemini 2.5 Flash Image.
    Use it to edit or generate images with higher quality and more features.
    Args:
        text: Text prompt for image generation
        system_prompt: System-level instructions
        base64_images: List of base64-encoded images as visual anchors
        aspect_ratio: Desired aspect ratio for output image
        image_size: Resolution - "1K", "2K", or "4K"
    Returns:
        Generated image base64 data
    """
    if base64_images is None:
        base64_images = []
    return _base_nano_banana_gen(
        text,
        system_prompt=system_prompt,
        images=base64_images,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
        model_name="gemini-2.5-flash-image",
    )


def nano_banana_pro_gen(
    text: str,
    system_prompt: str | None = "",
    base64_images: list[str] | None = None,
    aspect_ratio: str | None = "16:9",
    image_size: str | None = "2K",
) -> str:
    """
    Advanced Nano Banana image generation with Gemini 3 Pro Image Preview.
    Use it to edit or generate images with higher quality and more features.
    Args:
        text: Text prompt for image generation
        system_prompt: System-level instructions
        base64_images: List of base64-encoded images as visual anchors
        aspect_ratio: Desired aspect ratio for output image
        image_size: Resolution - "1K", "2K", or "4K"
    Returns:
        Generated image base64 data
    """
    if base64_images is None:
        base64_images = []
    return _base_nano_banana_gen(
        text,
        system_prompt=system_prompt,
        images=base64_images,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
        model_name="gemini-3-pro-image-preview",
    )


@tool
def nano_banana_tool(
    text: str,
    system_prompt: str | None = "",
    image_names: list[str] | None = None,
    aspect_ratio: str | None = "4:3",
) -> dict:
    """
    Tool wrapper for Nano Banana image generation.
    Args:
        text: Text prompt for image generation
        system_prompt: System-level instructions
        image_names: List of registered image names to use as visual anchors (e.g., ["cat_original", "reference_style"])
        aspect_ratio: Desired aspect ratio for output image, ["1:1" "2:3" "3:2" "3:4" "4:3" "4:5"  "5:4" "9:16" "16:9" "21:9"]
    Returns:
        Dictionary with generated image base64 data and registered name
    """
    # Convert image names to base64 data
    if image_names is None:
        image_names = []
    base64_images = [get_image(name) for name in image_names] if image_names else []

    # Generate image
    image_data = nano_banana_gen(
        text,
        system_prompt=system_prompt,
        base64_images=base64_images,
        aspect_ratio=aspect_ratio,
    )
    # Generate new name based on first input image or "generated"
    base_name = image_names[0] if image_names else "generated"
    new_image_name = _generate_image_name(base_name)
    # Register generated image
    register_image(new_image_name, image_data)
    # Save to file
    _save_image_to_file(image_data, new_image_name)
    return [
        image_message_part_template(image_data),
        text_message_part_template(f"Registered image name: {new_image_name}"),
    ]


@tool
def nano_banana_pro_tool(
    text: str,
    system_prompt: str | None = "",
    image_names: list[str] | None = None,
    aspect_ratio: str | None = "4:3",
) -> dict:
    """
    Tool wrapper for Nano Banana Pro image generation.
    Args:
        text: Text prompt for image generation
        system_prompt: System-level instructions
        image_names: List of registered image names to use as visual anchors (e.g., ["cat_original", "reference_style"])
        aspect_ratio: Desired aspect ratio for output image, ["1:1" "2:3" "3:2" "3:4" "4:3" "4:5"  "5:4" "9:16" "16:9" "21:9"]
    Returns:
        Dictionary with generated image base64 data and registered name
    """
    # Convert image names to base64 data
    if image_names is None:
        image_names = []
    base64_images = [get_image(name) for name in image_names] if image_names else []

    # Generate image
    image_data = nano_banana_pro_gen(
        text,
        system_prompt=system_prompt,
        base64_images=base64_images,
        aspect_ratio=aspect_ratio,
    )

    # Generate new name based on first input image or "generated"
    base_name = image_names[0] if image_names else "generated"
    new_image_name = _generate_image_name(base_name)

    # Register generated image
    register_image(new_image_name, image_data)

    # Save to file
    _save_image_to_file(image_data, new_image_name)

    return [
        image_message_part_template(image_data),
        text_message_part_template(f"Registered image name: {new_image_name}"),
    ]


@tool
def get_images(
    image_names: list[str] = None,
) -> dict:
    """
    Tool wrapper for Nano Banana Pro image generation.
    Args:
        text: Text prompt for image generation
        system_prompt: System-level instructions
        image_names: List of registered image names to use as visual anchors (e.g., ["cat_original", "reference_style"])
        aspect_ratio: Desired aspect ratio for output image, ["1:1" "2:3" "3:2" "3:4" "4:3" "4:5"  "5:4" "9:16" "16:9" "21:9"]
    Returns:
        Dictionary with generated image base64 data and registered name
    """
    # Convert image names to base64 data
    if image_names is None:
        image_names = []
    base64_images = [get_image(name) for name in image_names] if image_names else []
    return [
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{img}"},
        }
        for img in base64_images
    ]


def test_agent_with_nano_banana():
    """
    Example usage of nano_banana with image registry.
    This demonstrates the proper workflow:
    1. Register images with descriptive names
    2. Include image names in system prompt
    3. Agent uses image names (not base64) when calling tools
    """
    from langchain.agents import create_agent
    from langchain_google_genai import ChatGoogleGenerativeAI

    from master_clash.utils import image_to_base64

    # Step 1: Register images with descriptive names
    register_image("cat_original", image_to_base64("./backend/assets/cuddly_cat_hat.png"))

    # Step 2: Build system prompt with available images
    system_prompt = """You are an AI assistant with image generation capabilities.
When generating images, use the nano_banana_pro_tool and reference images by their names in the image_names parameter."""

    model = ChatGoogleGenerativeAI(
        model="gemini-2.5-pro",
        temperature=0.7,
        base_url=settings.google_ai_studio_base_url,
        transport="rest",
    )

    agent = create_agent(
        model=model,
        system_prompt=system_prompt,
        tools=[nano_banana_pro_tool, get_images],
    )

    # Step 3: User provides image in message, agent will use registered image names in tool call
    result = agent.invoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "what is the image named cat_original look like?",
                        },
                    ],
                }
            ]
        }
    )
    print("Agent Result:", result)

    # Clean up
    clear_image_registry()
