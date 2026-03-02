import asyncio
import unittest
from unittest.mock import MagicMock, patch, AsyncMock
import logging

# Set up logging to see output
logging.basicConfig(level=logging.DEBUG)

from master_clash.services.execution import SessionExecution, SessionExecutionManager

class TestSessionExecution(unittest.IsolatedAsyncioTestCase):
    async def test_session_execution_lifecycle(self):
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

            self.assertTrue(session.is_running)
            self.assertEqual(len(session.tasks), 3)

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
            self.assertGreater(len(events), 0)
            self.assertIn("event: text", events[0])

            # Check for timeline_edit in any event
            found_custom = False
            for e in events:
                if "event: timeline_edit" in str(e):
                    found_custom = True
                    break
            self.assertTrue(found_custom)

            self.assertEqual(events[-1], "__END__")

            # Verify logging called
            self.assertGreater(mock_log_event.call_count, 0)

            # Verify Loro connection
            MockLoro.return_value.connect.assert_called_once()
            MockLoro.return_value.disconnect.assert_called_once()

    async def test_session_interruption(self):
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
            # We need enough False returns to let it start, then True
            mock_check_interrupt.side_effect = [False, False, True, True, True]

            session = SessionExecutionManager.create_session(thread_id, project_id)
            await session.start(inputs={}, config={})

            # Wait for poller to catch interrupt
            # Poller sleeps 1.0s, so we wait longer
            await asyncio.sleep(2.0)

            # Session should have handled cancellation
            # mock_set_status should be called with "interrupted"
            mock_set_status.assert_any_call(thread_id, "interrupted")

            await session.stop()

if __name__ == "__main__":
    unittest.main()
