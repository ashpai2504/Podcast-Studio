"""Configuration loaded from .env / environment variables."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    openai_endpoint: str = ""
    openai_api_key: str = ""
    openai_deployment: str = "gpt-5-mini"
    openai_api_version: str = "2025-04-01-preview"
    speech_key: str = ""
    speech_region: str = "eastus"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            openai_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            openai_api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            openai_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5-mini"),
            openai_api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2025-04-01-preview"),
            speech_key=os.getenv("AZURE_SPEECH_KEY", ""),
            speech_region=os.getenv("AZURE_SPEECH_REGION", "eastus"),
        )

    @property
    def effective_speech_key(self) -> str:
        # Multi-service AI Services resources use one key for both services,
        # so fall back to the OpenAI key when no dedicated Speech key is set.
        return self.speech_key or self.openai_api_key

    def missing_openai(self) -> bool:
        return not (self.openai_endpoint and self.openai_api_key and self.openai_deployment)

    def missing_speech(self) -> bool:
        return not (self.effective_speech_key and self.speech_region)
