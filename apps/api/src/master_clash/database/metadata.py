"""In-memory metadata tracking (deprecated - use async ORM instead).

This module now provides in-memory metadata tracking without database dependency.
For persistent metadata, use SQLAlchemy ORM models directly.
"""

import time
from contextlib import contextmanager
from typing import Any

from master_clash.json_utils import dumps as json_dumps, loads as json_loads


class MetadataTracker:
    """In-memory metadata tracker (DEPRECATED - use SQLAlchemy ORM)."""

    def __init__(self, run_id: str):
        """Initialize metadata tracker."""
        self.run_id = run_id
        self._metadata = {"workflow": {}, "checkpoints": [], "assets": [], "api_calls": []}

    def start_workflow(self, workflow_name: str, metadata: dict[str, Any] | None = None) -> None:
        """Record workflow start."""
        self._metadata["workflow"] = {
            "run_id": self.run_id,
            "workflow_name": workflow_name,
            "status": "running",
            "start_time": time.time(),
            "metadata": metadata or {},
        }

    def update_workflow_status(self, status: str, **kwargs) -> None:
        """Update workflow status."""
        if "workflow" in self._metadata:
            self._metadata["workflow"]["status"] = status
            self._metadata["workflow"].update(kwargs)

    def record_checkpoint(
        self,
        checkpoint_ns: str,
        checkpoint_id: str,
        step_name: str,
        step_index: int,
        execution_time_ms: int,
        api_calls: int = 0,
        total_cost: float = 0.0,
        error_message: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Record checkpoint metadata."""
        self._metadata["checkpoints"].append({
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": checkpoint_id,
            "step_name": step_name,
            "step_index": step_index,
            "execution_time_ms": execution_time_ms,
            "api_calls": api_calls,
            "total_cost": total_cost,
            "error_message": error_message,
            "metadata": metadata or {},
        })

    def get_workflow_stats(self) -> dict[str, Any]:
        """Get workflow execution statistics."""
        workflow = self._metadata.get("workflow", {})
        checkpoints = self._metadata.get("checkpoints", [])

        api_calls = sum(cp.get("api_calls", 0) for cp in checkpoints)
        total_cost = sum(cp.get("total_cost", 0) for cp in checkpoints)

        return {
            "run_id": self.run_id,
            "workflow_name": workflow.get("workflow_name"),
            "status": workflow.get("status"),
            "start_time": workflow.get("start_time"),
            "total_cost": total_cost,
            "api_call_count": api_calls,
            "checkpoint_count": len(checkpoints),
            "metadata": workflow.get("metadata", {}),
        }

    def close(self) -> None:
        """Close tracker (no-op for in-memory)."""
        pass


@contextmanager
def track_step(
    tracker: MetadataTracker,
    checkpoint_ns: str,
    checkpoint_id: str,
    step_name: str,
    step_index: int,
):
    """Context manager for tracking step execution."""

    class StepTracker:
        def __init__(self):
            self.start_time = time.time()
            self.api_calls = 0
            self.total_cost = 0.0
            self.error: str | None = None
            self.metadata: dict[str, Any] = {}

        def add_api_call(self, cost: float = 0.0) -> None:
            self.api_calls += 1
            self.total_cost += cost

        def add_cost(self, cost: float) -> None:
            self.total_cost += cost

        def set_error(self, error: str) -> None:
            self.error = error

        def set_metadata(self, key: str, value: Any) -> None:
            self.metadata[key] = value

    step_tracker = StepTracker()

    try:
        yield step_tracker
    finally:
        execution_time_ms = int((time.time() - step_tracker.start_time) * 1000)
        tracker.record_checkpoint(
            checkpoint_ns=checkpoint_ns,
            checkpoint_id=checkpoint_id,
            step_name=step_name,
            step_index=step_index,
            execution_time_ms=execution_time_ms,
            api_calls=step_tracker.api_calls,
            total_cost=step_tracker.total_cost,
            error_message=step_tracker.error,
            metadata=step_tracker.metadata,
        )
