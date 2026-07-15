"""Load/save the admin-editable product-knowledge reference text.

This is a standing reference (not per-episode) that gets folded into every
script-generation prompt, so the model has accurate Hunter/FX Luminaire
product context instead of guessing - and guessing wrong, the way NotebookLM
did when it invented a "flow rate" for a controller.
"""

from pathlib import Path

KNOWLEDGE_PATH = Path(__file__).parent.parent / "product_knowledge.md"


def load_product_knowledge() -> str:
    if KNOWLEDGE_PATH.exists():
        return KNOWLEDGE_PATH.read_text(encoding="utf-8")
    return ""


def save_product_knowledge(text: str) -> None:
    KNOWLEDGE_PATH.write_text(text, encoding="utf-8")
