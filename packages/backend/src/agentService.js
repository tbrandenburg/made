const FIXED_RESPONSE = `A2A Protocol Mock Response:\n\nYour request has been received. For full protocol specification visit https://a2a-protocol.org/latest/.\n\nNext Steps:\n1. Review repository context\n2. Plan coordinated agent actions\n3. Execute and report status`;

function sendAgentMessage(_channel, message) {
  return {
    messageId: Date.now().toString(),
    sent: new Date().toISOString(),
    prompt: message,
    response: FIXED_RESPONSE
  };
}

module.exports = {
  sendAgentMessage
};
