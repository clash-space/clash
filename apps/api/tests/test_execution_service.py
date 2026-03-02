import asyncio
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from master_clash.services.execution import SessionExecution, SessionExecutionManager

@pytest.mark.asyncio
async def test_session_execution_lifecycle():
    thread_id = "test_thread"
    project_id = "test_project"

    # Mock dependencies
    with patch("master_clash.services.execution.LoroSyncClient") as MockLoro, \
         patch("master_clash.services.execution.get_or_create_graph", new_callable=AsyncMock) as mock_get_graph, \
         patch("master_clash.services.execution.create_session", new_callable=AsyncMock) as mock_create_session, \
         patch("master_clash.services.execution.log_session_event", new_callable=AsyncMock) as mock_log_event, \
         patch("master_clash.services.execution.generate_and_update_title", new_callable=AsyncMock) as mock_gen_title, \
         patch("master_clash.services.execution.set_session_status", new_callable=AsyncMock) as mock_set_status, \
         patch("master_clash.services.execution.check_interrupt_flag_async", new_callable=AsyncMock) as mock_check_interrupt:

        # Setup mocks
        mock_graph = AsyncMock()
        mock_get_graph.return_value = mock_graph

        # Mock graph.astream to yield some dummy events
        async def mock_astream(*args, **kwargs):
            # 1. Message event
            yield ([], "messages", ([{"type": "text", "text": "Hello"}], {"langgraph_node": "agent"}))
            await asyncio.sleep(0.1)
            # 2. Custom event
            yield ([], "custom", {"action": "timeline_edit", "data": "foo"})

        mock_graph.astream = mock_astream
        mock_check_interrupt.return_value = False

        # Create session
        session = SessionExecutionManager.create_session(thread_id, project_id)

        # Start session
        await session.start(inputs={}, config={}, user_input="hi")

        assert session.is_running
        assert len(session.tasks) == 3

        # Test Subscribe
        events = []
        async def subscriber():
            async for event in session.subscribe():
                events.append(event)

        sub_task = asyncio.create_task(subscriber())

        # Let it run for a bit
        await asyncio.sleep(0.5)

        # Stop session
        await session.stop()

        await sub_task

        # Verification
        assert len(events) > 0
        assert "event: text" in events[0]
        assert "event: timeline_edit" in str(events)
        assert events[-1] == "__END__" # Or explicit handling in test

        # Verify logging called
        assert mock_log_event.call_count > 0

        # Verify Loro connection
        MockLoro.return_value.connect.assert_called_once()
        MockLoro.return_value.disconnect.assert_called_once()

@pytest.mark.asyncio
async def test_session_interruption():
    thread_id = "test_thread_interrupt"
    project_id = "test_project"

    with patch("master_clash.services.execution.LoroSyncClient"), \
         patch("master_clash.services.execution.get_or_create_graph", new_callable=AsyncMock) as mock_get_graph, \
         patch("master_clash.services.execution.create_session", new_callable=AsyncMock), \
         patch("master_clash.services.execution.log_session_event", new_callable=AsyncMock), \
         patch("master_clash.services.execution.set_session_status", new_callable=AsyncMock) as mock_set_status, \
         patch("master_clash.services.execution.check_interrupt_flag_async", new_callable=AsyncMock) as mock_check_interrupt:

        mock_graph = AsyncMock()
        mock_get_graph.return_value = mock_graph

        # Mock astream that runs forever until cancelled
        async def mock_astream(*args, **kwargs):
            try:
                while True:
                    yield ([], "messages", ([{"type": "text", "text": "Running..."}], {"langgraph_node": "agent"}))
                    await asyncio.sleep(0.1)
            except asyncio.CancelledError:
                raise

        mock_graph.astream = mock_astream

        # Mock interrupt flag becoming True after first check
        mock_check_interrupt.side_effect = [False, True, True, True, True]

        session = SessionExecutionManager.create_session(thread_id, project_id)
        await session.start(inputs={}, config={})

        # Wait for poller to catch interrupt
        await asyncio.sleep(1.5)

        # Session should have handled cancellation
        # mock_set_status should be called with "interrupted"
        mock_set_status.assert_any_call(thread_id, "interrupted")

        await session.stop()
