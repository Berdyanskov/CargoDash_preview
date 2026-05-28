"""CargoDash: a modular pipeline for LLM training data synthesis & augmentation."""
from .core import Module, Port, Pipeline
from .data_utils import Schema, Batch
from .modules import RawDataSource, DataOutput, Processor, Judge, JoinById
from .voting import Vote
from .models import (
    ChatClient, OpenAICompatChatClient, MockChatClient,
    LocalHFChatClient, LocalVLLMChatClient, LLMCall,
)

__all__ = [
    "Module", "Port", "Pipeline",
    "Schema", "Batch",
    "RawDataSource", "DataOutput", "Processor", "Judge", "JoinById",
    "Vote",
    "ChatClient", "OpenAICompatChatClient", "MockChatClient",
    "LocalHFChatClient", "LocalVLLMChatClient", "LLMCall",
]

__version__ = "1.0.6"
