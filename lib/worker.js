self.importScripts('https://cdn.jsdelivr.net/npm/lodash@4.17.4/lodash.min.js')
self.importScripts('geneticSolver.js')

self.addEventListener('message', function(e) {
  // Any message from the host page starts a new computation
  const {groups, ofSize, forRounds, withGroupLeaders, forbiddenPairs, discouragedGroups} = e.data
  const totalPlayers = groups * ofSize;
  // Compute results and send them back to the host page
  geneticSolver(groups, ofSize, forRounds, withGroupLeaders, forbiddenPairs, discouragedGroups, (results) => {
    if (results.done) {
      const { assignments, scores } = tableRotationSolver(results.rounds, totalPlayers);
      results.tableAssignments = assignments;
      results.tableRotationScores = scores;
    }
    self.postMessage(results)
  })
}, false)
