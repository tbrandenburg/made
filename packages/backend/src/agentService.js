export async function sendAgentMessage({ context = 'global', prompt }) {
  const cannedResponse = {
    message: 'Agent handshake successful. Awaiting instructions for MADE operations.',
    timestamp: new Date().toISOString(),
    context
  };
  return {
    prompt,
    response: cannedResponse
  };
}
