
import { useEffect } from 'react';
import { Command } from '@clash/web-ui/lib/clientActions';

interface CommandExecutorProps {
    command: Command;
    onExecute?: (command: Command) => void;
}

// This component is invisible but triggers the command execution on mount
export function CommandExecutor({ command, onExecute }: CommandExecutorProps) {
    useEffect(() => {
        if (onExecute) {
            onExecute(command);
        } else {
            // Fallback: Dispatch a custom event if no handler provided
            // This allows the parent ChatbotCopilot to listen for it even if deep in the tree
            const event = new CustomEvent('copilot:command', { detail: command });
            window.dispatchEvent(event);
        }
    }, [command, onExecute]);

    return null;
}
