import { mcpCliSetupMessage } from '@aiki/protocol';
/** Same submission path as the chat composer; open only after server admission. */
export async function askCoordinatorForMcpCli(
 client: { submit(projectId: string, content: string, options: { whenBusy: 'steer' }): Promise<unknown> },
 projectId: string, cli: string, openChat: () => Promise<unknown>,
): Promise<void> {
 if (!projectId) throw new Error('Choose a project on this backend.');
 await client.submit(projectId, mcpCliSetupMessage(cli), { whenBusy: 'steer' });
 await openChat();
}
