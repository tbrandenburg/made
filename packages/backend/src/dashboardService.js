const { listRepositories } = require('./repositoryService');

function getDashboardSummary() {
  const repositories = listRepositories();
  return {
    projectCount: repositories.length,
    agentConnection: true,
    repositories
  };
}

module.exports = {
  getDashboardSummary
};
