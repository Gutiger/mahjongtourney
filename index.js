// Good Enough Golfers
// Brad Buchanan, 2017
// MIT License (see ./LICENSE)
//
// Good-Enough Golfers is a near-solver for a class of scheduling
// problems including the [Social Golfer Problem][1] and
// [Kirkman's Schoolgirl Problem][2]. The goal is to schedule g x p
// players into g groups of size p for w weeks such that no two
// players meet more than once.
//
// [1]: http://mathworld.wolfram.com/SocialGolferProblem.html
// [2]: http://mathworld.wolfram.com/KirkmansSchoolgirlProblem.html
//
// Real solutions to these problems can be extremely slow, but
// approximations are fast and often good enough for real-world
// purposes.  Good-Enough Golfers uses a genetic algorithm to
// generate near-solutions to this class of problems, and has the
// ability to consider additional weighted constriants, making it
// useful for real-world situations such as assigning students to
// discussion groups.
//
// Besides index.html itself, this file is the entry point for the
// application and is a good place to start to understand the flow
// of control. However, it does not contain the actual solver. See
// lib/geneticSolver.js if you want to jump to the actual algorithm.
//
// We begin by declaring and initializing some page-global variables.
//
// These are references to the inputs column and the outputs column,
// and an object to organize references to individual controls, so
// that working with the DOM is more readable later.
let controlsDiv, resultsDiv
let controls = {}
// Also references for the help text
let helpDivs, showHelpLink, hideHelpLink

// These variables hold the state of the input controls, which are
// also the parameters we will pass into the solver.
let groups = 0
let ofSize = 0
let forRounds = 0
let withGroupLeaders = false
let playerNames = []
let windNames = ["East", "South", "West", "North"]
let textFieldRefs = {}
let forbiddenPairs = Immutable.Set()
let discouragedGroups = Immutable.Set()

// Each time we kick off the solver we will mark the time, so that
// we can eaily report the time required to compute the solution.
let startTime

// This variable holds the last result returned by the solver,
let lastResults

// Next we launch a web worker which is responsible for the slow job
// of actually computing a solution.
//
// Web workers are a simple way to do work in a background thread.
// This gets the solver work out of the UI thread (this one) and
// keeps the interface feeling responsive while a solution is being
// computed.
//
// See https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
const myWorker = new Worker('lib/worker.js');

let finalScores = {}
let chomboRefs = {}

// WebSocket synchronization flags
let isSyncingFromServer = false;
let hasReceivedInitialState = false;

// Helper to send state updates
function syncStateToServer(type, payload) {
  if (!isSyncingFromServer && hasReceivedInitialState && typeof wsClient !== 'undefined') {
    wsClient.send(type, payload);
  }
}

const scoreBoard = document.getElementById('scoreBoard');

function updateScoreboard() {
  const scoreBoard = document.getElementById('scoreBoard');
  scoreBoard.innerHTML = '';
  const sortedScores = Object.entries(finalScores).sort((a, b) => b[1] - a[1]);
  const ul = document.createElement('ul');
  sortedScores.forEach(([person, score], index) => {
    const li = document.createElement('li');
    li.classList.add('player-item');
    var personNumberNested = person.replace('person-', '');
    const place = getOrdinalSuffix(index + 1);
    
    // Create text node for the placement and score
    const textNode = document.createTextNode(`${place}:   ${playerName(personNumberNested)}:   ${score.toFixed(2)} `);
    li.appendChild(textNode);
    
    // Create chombo input field
    const chomboInput = document.createElement('input');
    chomboInput.type = 'number';
    chomboInput.min = '0';
    chomboInput.value = chomboRefs[person] || 0;
    chomboInput.style.width = '50px';
    chomboInput.style.marginLeft = '10px';
    chomboInput.placeholder = 'Chombo';
    
    chomboInput.addEventListener('input', () => {
      const chomboCount = parseInt(chomboInput.value) || 0;
      chomboRefs[person] = chomboCount;
      finalScores = {};
      calculateValues();
      updateScoreboard();

      // WebSocket sync
      syncStateToServer('UPDATE_CHOMBO', { person, count: chomboCount });
    });
    
    li.appendChild(chomboInput);
    ul.appendChild(li);
  });
  scoreBoard.appendChild(ul);
}

function updateScoresImmediately() {
  finalScores = {};
  calculateValues();
  updateScoreboard();

  // WebSocket sync - send current Uma/Oka config
  const okaField = document.getElementById('okaField');
  const uma1Field = document.getElementById('uma1');
  const uma2Field = document.getElementById('uma2');
  const uma3Field = document.getElementById('uma3');
  const uma4Field = document.getElementById('uma4');
  const startingPointsField = document.getElementById('starting_points');
  const chomboField = document.getElementById('chomboField');

  syncStateToServer('UPDATE_CONFIG', {
    oka: okaField ? parseFloat(okaField.value) : null,
    uma1: uma1Field ? parseFloat(uma1Field.value) : null,
    uma2: uma2Field ? parseFloat(uma2Field.value) : null,
    uma3: uma3Field ? parseFloat(uma3Field.value) : null,
    uma4: uma4Field ? parseFloat(uma4Field.value) : null,
    startingPoints: startingPointsField ? parseFloat(startingPointsField.value) : null,
    chomboValue: chomboField ? parseFloat(chomboField.value) : null
  });
}

// The init() function is called after the DOM is loaded. It prepares
// the application by setting up event handlers and an initial state
// and calling for an initial solution.
function init() {
  myWorker.addEventListener('message', onResults, false);

  controlsDiv = document.getElementById('controls')
  resultsDiv = document.getElementById('results')
  helpDivs = document.querySelectorAll('.help-text')

  //const calculateButton = document.getElementById('calculateButton');
  //calculateButton.addEventListener('click', calculateValues);

  showHelpLink = document.getElementById("show-help-link")
  hideHelpLink = document.getElementById("hide-help-link")

  controls.recomputeButton = controlsDiv.querySelector('#recomputeButton')
  controls.groupsBox = controlsDiv.querySelector('#groupsBox')
  controls.groupsSlider = controlsDiv.querySelector('#groupsSlider')
  controls.ofSizeBox = controlsDiv.querySelector('#ofSizeBox')
  controls.ofSizeSlider = controlsDiv.querySelector('#ofSizeSlider')
  controls.forRoundsBox = controlsDiv.querySelector('#forRoundsBox')
  controls.forRoundsSlider = controlsDiv.querySelector('#forRoundsSlider')
  controls.withGroupLeadersBox = controlsDiv.querySelector('#withGroupLeadersBox')
  controls.playerNames = controlsDiv.querySelector('#playerNames')
  controls.forbiddenPairs = controlsDiv.querySelector('#forbiddenPairs')
  controls.discouragedGroups = controlsDiv.querySelector('#discouragedGroups')

  // User input controls
  controls.recomputeButton.onclick = recomputeResultsWrapper
  controls.groupsSlider.oninput = onSliderMoved
  controls.ofSizeSlider.oninput = onSliderMoved
  controls.forRoundsSlider.oninput = onSliderMoved
  controls.withGroupLeadersBox.onchange = onWithGroupLeadersChanged
  controls.groupsBox.oninput = onSliderLabelEdited
  controls.ofSizeBox.oninput = onSliderLabelEdited
  controls.forRoundsBox.oninput = onSliderLabelEdited
  controls.playerNames.onkeyup = onPlayerNamesKeyUp
  controls.playerNames.onchange = onPlayerNamesChanged
  controls.forbiddenPairs.onchange = onForbiddenPairsChanged
  controls.discouragedGroups.onchange = onDiscouragedGroupsChanged

  // Add immediate update listeners for Oka, Uma, and Chombo fields
  const okaField = document.getElementById('okaField')
  const uma1Field = document.getElementById('uma1')
  const uma2Field = document.getElementById('uma2')
  const uma3Field = document.getElementById('uma3')
  const uma4Field = document.getElementById('uma4')
  const startingPointsField = document.getElementById('starting_points')
  const chomboField = document.getElementById('chomboField')


  if (okaField) okaField.addEventListener('input', updateScoresImmediately)
  if (uma1Field) uma1Field.addEventListener('input', updateScoresImmediately)
  if (uma2Field) uma2Field.addEventListener('input', updateScoresImmediately)
  if (uma3Field) uma3Field.addEventListener('input', updateScoresImmediately)
  if (uma4Field) uma4Field.addEventListener('input', updateScoresImmediately)
  if (startingPointsField) startingPointsField.addEventListener('input', updateScoresImmediately)
  if (chomboField) chomboField.addEventListener('input', updateScoresImmediately)

  playerNames = readPlayerNames()
  readConstraints(playerNames)
  onSliderLabelEdited()
  withGroupLeaders = !!controls.withGroupLeadersBox.checked

  // Don't automatically recompute on init - wait for server state first
  // Server state sync will render results if they exist

  // Setup WebSocket synchronization
  setupWebSocketSync();
}

function onResults(e) {
  lastResults = e.data
  renderResults()
  if (lastResults.done) {
    enableControls()

    // WebSocket sync - broadcast tournament results to all clients
    syncStateToServer('UPDATE_RESULTS', { results: lastResults });
  }
}

function recomputeResultsWrapper() {
	const scoreBoard = document.getElementById('scoreBoard');
	if(scoreBoard.innerHTML.trim() !== "") {
	const userConfirmed = confirm("Are you sure you want to restart the tournament? This will erase all scores and data.");

	

    if (userConfirmed) {
        // Proceed with recomputing if user clicked OK
        recomputeResults();  // Assuming you already have a function named recompute
    } else {
        // Prevent default button behavior if the user cancels
        event.preventDefault();
    }
	}
	else
	{
		recomputeResults();
	}

}

function recomputeResults() {
  startTime = Date.now();
  lastResults = null;

  const scoreBoard = document.getElementById('scoreBoard');
  scoreBoard.innerHTML = null

  textFieldRefs = {}
  renderResults()
  disableControls()
  myWorker.postMessage({groups, ofSize, forRounds, withGroupLeaders, forbiddenPairs: forbiddenPairs.toJS(), discouragedGroups: discouragedGroups.toJS()})

  // WebSocket sync - notify all clients tournament is being recomputed
  syncStateToServer('RECOMPUTE_TOURNAMENT', {
    config: { groups, ofSize, forRounds, withGroupLeaders, playerNames, forbiddenPairs: forbiddenPairs.toJS(), discouragedGroups: discouragedGroups.toJS() }
  });
}


// Setup WebSocket synchronization
function setupWebSocketSync() {
  // Handler for full state sync
  wsClient.on('FULL_STATE', (message) => {
    isSyncingFromServer = true;
    const state = message.state;

    // Server state always wins - only apply if server has actual state
    // If server just started (isEmpty), do nothing - keep current client state
    if (state.isEmpty) {
      console.log('Server has no state yet - keeping current client state');
      hasReceivedInitialState = true;
      isSyncingFromServer = false;
      return;
    }

    // Apply server state
    console.log('Applying server state');
    groups = state.groups;
    ofSize = state.ofSize;
    forRounds = state.forRounds;
    withGroupLeaders = state.withGroupLeaders;
    playerNames = state.playerNames;
    forbiddenPairs = Immutable.Set(state.forbiddenPairs);
    discouragedGroups = Immutable.Set(state.discouragedGroups);
    lastResults = state.lastResults;
    textFieldRefs = state.textFieldRefs;
    chomboRefs = state.chomboRefs;

    // Update UI to reflect state
    controls.groupsBox.value = groups;
    controls.ofSizeBox.value = ofSize;
    controls.forRoundsBox.value = forRounds;
    controls.withGroupLeadersBox.checked = withGroupLeaders;
    controls.playerNames.value = playerNames.join('\n');

    // Update Uma/Oka fields if they exist
    const okaField = document.getElementById('okaField');
    const uma1Field = document.getElementById('uma1');
    const uma2Field = document.getElementById('uma2');
    const uma3Field = document.getElementById('uma3');
    const uma4Field = document.getElementById('uma4');
    const startingPointsField = document.getElementById('starting_points');
    const chomboField = document.getElementById('chomboField');

    if (okaField && state.oka !== null) okaField.value = state.oka;
    if (uma1Field && state.uma1 !== null) uma1Field.value = state.uma1;
    if (uma2Field && state.uma2 !== null) uma2Field.value = state.uma2;
    if (uma3Field && state.uma3 !== null) uma3Field.value = state.uma3;
    if (uma4Field && state.uma4 !== null) uma4Field.value = state.uma4;
    if (startingPointsField && state.startingPoints !== null) startingPointsField.value = state.startingPoints;
    if (chomboField && state.chomboValue !== null) chomboField.value = state.chomboValue;

    // Re-render if we have results
    if (lastResults) {
      renderResults();
      finalScores = {};
      calculateValues();
      updateScoreboard();
    }

    hasReceivedInitialState = true;
    isSyncingFromServer = false;
  });

  // Handler for text field updates
  wsClient.on('TEXT_FIELD_UPDATED', (message) => {
    isSyncingFromServer = true;
    const { fieldId, value } = message.payload;
    textFieldRefs[fieldId] = value;

    // Update the input field in the DOM
    const inputElement = document.getElementById(fieldId);
    if (inputElement) {
      inputElement.value = value;
    }

    // Recalculate scores
    finalScores = {};
    calculateValues();
    updateScoreboard();
    isSyncingFromServer = false;
  });

  // Handler for chombo updates
  wsClient.on('CHOMBO_UPDATED', (message) => {
    isSyncingFromServer = true;
    const { person, count } = message.payload;
    chomboRefs[person] = count;

    // Update chombo input in scoreboard if it exists
    const chomboInput = document.querySelector(`input[data-person="${person}"]`);
    if (chomboInput) {
      chomboInput.value = count;
    }

    // Recalculate scores
    finalScores = {};
    calculateValues();
    updateScoreboard();
    isSyncingFromServer = false;
  });

  // Handler for config updates
  wsClient.on('CONFIG_UPDATED', (message) => {
    isSyncingFromServer = true;
    const payload = message.payload;

    // Update tournament config if provided
    if (payload.groups !== undefined) groups = payload.groups;
    if (payload.ofSize !== undefined) ofSize = payload.ofSize;
    if (payload.forRounds !== undefined) forRounds = payload.forRounds;
    if (payload.withGroupLeaders !== undefined) withGroupLeaders = payload.withGroupLeaders;

    // Update UI controls
    controls.groupsBox.value = groups;
    controls.ofSizeBox.value = ofSize;
    controls.forRoundsBox.value = forRounds;
    controls.withGroupLeadersBox.checked = withGroupLeaders;

    // Update Uma/Oka fields if they're in the payload
    const okaField = document.getElementById('okaField');
    const uma1Field = document.getElementById('uma1');
    const uma2Field = document.getElementById('uma2');
    const uma3Field = document.getElementById('uma3');
    const uma4Field = document.getElementById('uma4');
    const startingPointsField = document.getElementById('starting_points');
    const chomboField = document.getElementById('chomboField');

    if (okaField && payload.oka !== undefined) okaField.value = payload.oka;
    if (uma1Field && payload.uma1 !== undefined) uma1Field.value = payload.uma1;
    if (uma2Field && payload.uma2 !== undefined) uma2Field.value = payload.uma2;
    if (uma3Field && payload.uma3 !== undefined) uma3Field.value = payload.uma3;
    if (uma4Field && payload.uma4 !== undefined) uma4Field.value = payload.uma4;
    if (startingPointsField && payload.startingPoints !== undefined) startingPointsField.value = payload.startingPoints;
    if (chomboField && payload.chomboValue !== undefined) chomboField.value = payload.chomboValue;

    // Recalculate scores if Uma/Oka changed
    if (payload.oka !== undefined || payload.uma1 !== undefined || payload.uma2 !== undefined ||
        payload.uma3 !== undefined || payload.uma4 !== undefined || payload.startingPoints !== undefined ||
        payload.chomboValue !== undefined) {
      finalScores = {};
      calculateValues();
      updateScoreboard();
    }

    isSyncingFromServer = false;
  });

  // Handler for player names updates
  wsClient.on('PLAYER_NAMES_UPDATED', (message) => {
    isSyncingFromServer = true;
    playerNames = message.payload.playerNames;
    controls.playerNames.value = playerNames.join('\n');
    readConstraints(playerNames);
    isSyncingFromServer = false;
  });

  // Handler for tournament recompute
  wsClient.on('TOURNAMENT_RECOMPUTED', (message) => {
    isSyncingFromServer = true;
    lastResults = null;
    textFieldRefs = {};
    chomboRefs = {};
    finalScores = {};

    const scoreBoard = document.getElementById('scoreBoard');
    scoreBoard.innerHTML = '';

    // Update config if provided
    if (message.payload.config) {
      if (message.payload.config.groups !== undefined) groups = message.payload.config.groups;
      if (message.payload.config.ofSize !== undefined) ofSize = message.payload.config.ofSize;
      if (message.payload.config.forRounds !== undefined) forRounds = message.payload.config.forRounds;
      if (message.payload.config.withGroupLeaders !== undefined) withGroupLeaders = message.payload.config.withGroupLeaders;
      if (message.payload.config.playerNames !== undefined) {
        playerNames = message.payload.config.playerNames;
        controls.playerNames.value = playerNames.join('\n');
      }
      if (message.payload.config.forbiddenPairs !== undefined) {
        forbiddenPairs = Immutable.Set(message.payload.config.forbiddenPairs);
      }
      if (message.payload.config.discouragedGroups !== undefined) {
        discouragedGroups = Immutable.Set(message.payload.config.discouragedGroups);
      }

      controls.groupsBox.value = groups;
      controls.ofSizeBox.value = ofSize;
      controls.forRoundsBox.value = forRounds;
      controls.withGroupLeadersBox.checked = withGroupLeaders;
    }

    renderResults();
    isSyncingFromServer = false;
  });

  // Handler for results updates
  wsClient.on('RESULTS_UPDATED', (message) => {
    isSyncingFromServer = true;
    lastResults = message.payload.results;
    renderResults();
    isSyncingFromServer = false;
  });

  // Connect WebSocket
  wsClient.connect();
}

function onSliderMoved() {
  groups = parseInt(controls.groupsSlider.value, 10)
  ofSize = parseInt(controls.ofSizeSlider.value, 10)
  forRounds = parseInt(controls.forRoundsSlider.value, 10)

  // Update labels
  controls.groupsBox.value = groups
  controls.ofSizeBox.value = ofSize
  controls.forRoundsBox.value = forRounds

  // WebSocket sync
  syncStateToServer('UPDATE_CONFIG', { groups, ofSize, forRounds });
}

function onSliderLabelEdited() {
  groups = Math.min(999, Math.abs(parseInt(controls.groupsBox.value, 10)));
  ofSize = Math.min(999, Math.abs(parseInt(controls.ofSizeBox.value, 10)));
  forRounds = Math.min(999, Math.abs(parseInt(controls.forRoundsBox.value, 10)));

  controls.groupsSlider.max = Math.max(groups, controls.groupsSlider.max);
  controls.ofSizeSlider.max = Math.max(ofSize, controls.ofSizeSlider.max);
  controls.forRoundsSlider.max = Math.max(forRounds, controls.forRoundsSlider.max);

  controls.groupsSlider.value = groups
  controls.ofSizeSlider.value = Math.min(controls.ofSizeSlider.max, ofSize);
  controls.forRoundsSlider.value = Math.min(controls.forRoundsSlider.max, forRounds);

  // WebSocket sync
  syncStateToServer('UPDATE_CONFIG', { groups, ofSize, forRounds });
}

function onWithGroupLeadersChanged() {
  withGroupLeaders = controls.withGroupLeadersBox.checked

  // WebSocket sync
  syncStateToServer('UPDATE_CONFIG', { withGroupLeaders });
}

function disableControls() {
  controls.recomputeButton.disabled = true
  controls.groupsSlider.disabled = true
  controls.ofSizeSlider.disabled = true
  controls.forRoundsSlider.disabled = true
  controls.withGroupLeadersBox.disabled = true;
  controls.playerNames.disabled = true
  controls.forbiddenPairs.disabled = true
  controls.discouragedGroups.disabled = true
  
  // Show spinner
  controls.recomputeButton.innerHTML = '&nbsp;<span class="spinner"></span>'
}

function enableControls() {
  controls.recomputeButton.disabled = false
  controls.groupsSlider.disabled = false
  controls.ofSizeSlider.disabled = false
  controls.forRoundsSlider.disabled = false
  controls.withGroupLeadersBox.disabled = false
  controls.playerNames.disabled = false
  controls.forbiddenPairs.disabled = false
  controls.discouragedGroups.disabled = false
  
  // Hide spinner
  controls.recomputeButton.innerHTML = 'Start Tournament!'
}

function readPlayerNames() {
  return controls.playerNames.value
    .split('\n')
    .map(name => name.trim())
}

function onPlayerNamesKeyUp() {
  playerNames = readPlayerNames()
  updateDisplayedNames()
}

function updateDisplayedNames() {
  // Update player names in tournament rounds
  const memberElements = document.querySelectorAll('.player-item')
  memberElements.forEach(member => {
    // Find the input field to get the person number and wind direction
    const inputField = member.querySelector('input')
    if (inputField && inputField.id) {
      const personMatch = inputField.id.match(/person-(\d+)/)
      if (personMatch) {
        const personNumber = parseInt(personMatch[1])
        
        // Get the current text to extract wind direction
        const currentText = member.textContent || member.innerText
        const windMatch = currentText.match(/^\(([^)]+)\)/)
        
        if (windMatch) {
          const wind = windMatch[1]
          
          // Store the current input field properties
          const inputValue = inputField.value
          const inputId = inputField.id
          
          // Clear the member and rebuild with new name
          member.innerHTML = ''
          
          // Create a text node for the label
          const labelText = document.createTextNode(`(${wind}) ${playerName(personNumber)}: `)
          member.appendChild(labelText)
          
          // Recreate the input field with the same properties
          const newInput = document.createElement('input')
          newInput.type = 'text'
          newInput.id = inputId
          newInput.value = inputValue
          
          // Copy the event listener logic from the original
          newInput.addEventListener('input', () => {
            finalScores = {}
            const currentValue = parseFloat(newInput.value) || 0
            textFieldRefs[inputId] = currentValue
            calculateValues()

            const scoreBoard = document.getElementById('scoreBoard')
            scoreBoard.innerHTML = ''
            const sortedScores = Object.entries(finalScores).sort((a, b) => b[1] - a[1])
            const ul = document.createElement('ul')
            sortedScores.forEach(([person, score], index) => {
              const li = document.createElement('li')
              li.classList.add('player-item');
              var personNumberNested = person.replace('person-', '')
              const place = getOrdinalSuffix(index + 1)

              // Create text node for the placement and score
              const textNode = document.createTextNode(`${place}:   ${playerName(personNumberNested)}:   ${score.toFixed(2)} `);
              li.appendChild(textNode);

              // Create chombo input field
              const chomboInput = document.createElement('input');
              chomboInput.type = 'number';
              chomboInput.min = '0';
              chomboInput.value = chomboRefs[person] || 0;
              chomboInput.style.width = '50px';
              chomboInput.style.marginLeft = '10px';
              chomboInput.placeholder = 'Chombo';

              chomboInput.addEventListener('input', () => {
                const chomboCount = parseInt(chomboInput.value) || 0;
                chomboRefs[person] = chomboCount;
                finalScores = {};
                calculateValues();
                updateScoreboard();

                // WebSocket sync
                syncStateToServer('UPDATE_CHOMBO', { person, count: chomboCount });
              });

              li.appendChild(chomboInput);
              ul.appendChild(li)
            })
            scoreBoard.appendChild(ul)

            // WebSocket sync
            syncStateToServer('UPDATE_TEXT_FIELD', { fieldId: inputId, value: currentValue });
          })
          
          member.appendChild(newInput)
        }
      }
    }
  })
  
  // Update player names in scoreboard if it exists
  if (Object.keys(finalScores).length > 0) {
    const scoreBoard = document.getElementById('scoreBoard')
    scoreBoard.innerHTML = ''
    const sortedScores = Object.entries(finalScores).sort((a, b) => b[1] - a[1])
    const ul = document.createElement('ul')
    sortedScores.forEach(([person, score], index) => {
      const li = document.createElement('li')
      li.classList.add('player-item');
      var personNumberNested = person.replace('person-', '')
      const place = getOrdinalSuffix(index + 1)
      
      // Create text node for the placement and score
      const textNode = document.createTextNode(`${place}:   ${playerName(personNumberNested)}:   ${score.toFixed(2)} `);
      li.appendChild(textNode);
      
      // Create chombo input field
      const chomboInput = document.createElement('input');
      chomboInput.type = 'number';
      chomboInput.min = '0';
      chomboInput.value = chomboRefs[person] || 0;
      chomboInput.style.width = '50px';
      chomboInput.style.marginLeft = '10px';
      chomboInput.placeholder = 'Chombo';
      
      chomboInput.addEventListener('input', () => {
        const chomboCount = parseInt(chomboInput.value) || 0;
        chomboRefs[person] = chomboCount;
        finalScores = {};
        calculateValues();
        updateScoreboard();
      });
      
      li.appendChild(chomboInput);
      ul.appendChild(li)
    })
    scoreBoard.appendChild(ul)
  }
}

function onPlayerNamesChanged() {
  playerNames = readPlayerNames()
  readConstraints(playerNames);
  //renderResults()

  // WebSocket sync
  syncStateToServer('UPDATE_PLAYER_NAMES', { playerNames });
}

function onForbiddenPairsChanged() {
  forbiddenPairs = readGroupConstraintFromControl(controls.forbiddenPairs, playerNames)
}

function onDiscouragedGroupsChanged() {
  discouragedGroups = readGroupConstraintFromControl(controls.discouragedGroups, playerNames)
}

function showHelp() {
  resultsDiv.style.opacity = "0.4"
  showHelpLink.style.display = "none"
  hideHelpLink.style.display = "inline"
  for (const div of helpDivs) {
    div.style.display = 'block'
  }
}

function hideHelp() {
  resultsDiv.style.opacity = "1"
  showHelpLink.style.display = "inline"
  hideHelpLink.style.display = "none"
  for (const div of helpDivs) {
    div.style.display = 'none'
  }
}

// This function reads the forbidden groups and discouraged groups
// from the DOM and writes the global state variables accordingly,
// using playerIndices instead of names.
function readConstraints(playerNames) {
  forbiddenPairs = readGroupConstraintFromControl(controls.forbiddenPairs, playerNames)
  discouragedGroups = readGroupConstraintFromControl(controls.discouragedGroups, playerNames)
}

/**
 * Given a textarea containing multiple comma-separated lists of player names,
 * where the lists are separated by newlines, returns a set of sets of player
 * ids suitable for passing as a contstraint to the solver.
 * Names not found in the provided playerNames list are ignored.
 * @param {HTMLTextAreaElement} control
 * @param {Array<string>} playerNames 
 * @returns {Immutable.Set<Immutable.Set<number>>}
 */
function readGroupConstraintFromControl(control, playerNames) {
  return control.value
    .split('\n')
    .map(playerNameList =>
      playerNameList
        .split(',')
        .map(name => name.trim()))
    // Drop lines that aren't groups
    .filter(group => group.length >= 2)
    // Convert player names to indices
    .reduce((memo, group) => {
      let groupSet = Immutable.Set()
      for (const playerName of group) {
        for (const index of indicesOf(playerName, playerNames)) {
          groupSet = groupSet.add(index)
        }
      }
      // Ignore single-member groups, since they don't make useful constraints.
      return groupSet.size >= 2 ? memo.add(groupSet) : memo;
    }, Immutable.Set())
}

function indicesOf(needle, haystack) {
  const indices = []
  let nextIndex = -1
  do {
    nextIndex = haystack.indexOf(needle, nextIndex + 1)
    if (nextIndex > -1) indices.push(nextIndex)
  } while (nextIndex > -1)
  return indices
}

function playerName(i) {
  return playerNames[i] ? playerNames[i] : `Player ${i+1}`
}

function downloadCsv() {
  // Pivot results into a table that's easier to work with
  const roundNames = lastResults.rounds.map((_, i) => `Round ${i + 1}`)
  const playerCount = lastResults.rounds[0].length * lastResults.rounds[0][0].length
  
  // Stub out a row for each player
  const players = []
  for (let i = 0; i < playerCount; i++) {
    players.push([playerName(i)])
  }
  
  // Fill in assigned groups
  lastResults.rounds.forEach((round) => {
    round.forEach((group, j) => {
      group.forEach(playerIndex => {
        players[playerIndex].push(`Group ${j + 1}`)
      })
    })
  })
  
  // Build table
  const rows = [
    ['', ...roundNames],
    ...players
  ]
  // For debugging: console.table(rows);
  
  let csvContent = "data:text/csv;charset=utf-8," 
    + rows.map(e => e.join(",")).join("\n");
  
  const encodedUri = encodeURI(csvContent)
  const link = document.createElement("a")
  link.setAttribute("href", encodedUri)
  link.setAttribute("download", "golfer_solution.csv")
  document.body.appendChild(link)
  link.click()
}

function renderResults() {
  resultsDiv.innerHTML = ''
  if (lastResults) {
    lastResults.rounds.forEach((round, roundIndex) => {
      const roundDiv = document.createElement('div')
      roundDiv.classList.add('round')
  
      const header = document.createElement('h1')
      header.textContent = `Round ${roundIndex+1}`
      const conflictScore = document.createElement('div')
      conflictScore.classList.add('conflictScore')
      conflictScore.textContent = `Conflict score: ${lastResults.roundScores[roundIndex]}`
      header.appendChild(conflictScore)
  
      const groups = document.createElement('div')
      groups.classList.add('groups')
  
      round.forEach((group, groupIndex) => {
        const groupDiv = document.createElement('div')
        groupDiv.classList.add('group')
        const groupName = document.createElement('h2')
        groupName.textContent = `Table ${groupIndex + 1}`
        groupDiv.appendChild(groupName)
  
        const members = document.createElement('ul')
	let counter = 0;
        group.forEach(personNumber => {
          const member = document.createElement('li')
	  member.classList.add('player-item');
	  const textField = document.createElement('input')
          member.textContent = `(${windNames[counter]}) ${playerName(personNumber)}: `
	  textField.type = 'text';
	//const randomValue = Math.floor(Math.random() * 50000);
    	//textField.value = randomValue;

	  const fieldId = `round-${roundIndex}-table-${groupIndex}-person-${personNumber}`
	  textField.id = fieldId

	    // Restore saved value if available
	    if (textFieldRefs[fieldId] !== undefined) {
		textField.value = textFieldRefs[fieldId]; // Set saved value
	    }

	      textField.addEventListener('input', () => {
		      finalScores = {}
		      const currentValue = parseFloat(textField.value) || 0; // Convert to number or default to 0
		      textFieldRefs[fieldId] = currentValue; // Set initial value
		      calculateValues();

		    const scoreBoard = document.getElementById('scoreBoard'); // Get the scoreboard element
		    scoreBoard.innerHTML = ''; // Clear any previous content

		    // Convert finalScores object to an array and sort it by score (descending order)
		    const sortedScores = Object.entries(finalScores).sort((a, b) => b[1] - a[1]);

		    // Create an unordered list to display the sorted scores
		    const ul = document.createElement('ul');

		    // Iterate over the sortedScores array and create list items
		    sortedScores.forEach(([person, score], index) => {
			const li = document.createElement('li');
			li.classList.add('player-item');
			var personNumberNested = person.replace('person-', '');
			const place = getOrdinalSuffix(index + 1);

			// Create text node for the placement and score
			const textNode = document.createTextNode(`${place}:   ${playerName(personNumberNested)}:   ${score.toFixed(2)} `);
			li.appendChild(textNode);

			// Create chombo input field
			const chomboInput = document.createElement('input');
			chomboInput.type = 'number';
			chomboInput.min = '0';
			chomboInput.value = chomboRefs[person] || 0;
			chomboInput.style.width = '50px';
			chomboInput.style.marginLeft = '10px';
			chomboInput.placeholder = 'Chombo';

			chomboInput.addEventListener('input', () => {
			  const chomboCount = parseInt(chomboInput.value) || 0;
			  chomboRefs[person] = chomboCount;
			  finalScores = {};
			  calculateValues();
			  updateScoreboard();

			  // WebSocket sync
			  syncStateToServer('UPDATE_CHOMBO', { person, count: chomboCount });
			});

			li.appendChild(chomboInput);
			ul.appendChild(li);
		    });

		    // Append the sorted list to the scoreBoard
		    scoreBoard.appendChild(ul);

		      // WebSocket sync
		      syncStateToServer('UPDATE_TEXT_FIELD', { fieldId, value: currentValue });

	    });

	  member.appendChild(textField)
          members.appendChild(member)
	  counter++;
        })
        groupDiv.appendChild(members)
        groups.appendChild(groupDiv)
      })
  
      roundDiv.appendChild(header)
      roundDiv.appendChild(groups)
      resultsDiv.appendChild(roundDiv)
    })
    
    if (lastResults.done) {
      // Summary div - total time and CSV download
      const summaryDiv = document.createElement('div')
      summaryDiv.classList.add('resultsSummary');
      summaryDiv.style.borderTop = 'solid #aaaaaa thin'
      summaryDiv.style.padding = '7px 0'

      
      const elapsedTime = document.createElement('span')
      elapsedTime.style.fontStyle = 'italic'
      elapsedTime.style.fontSize = 'smaller'
      if (startTime) {
        const elapsedSecs = Math.round((Date.now() - startTime) / 100) / 10
        elapsedTime.textContent = `Computed in ${elapsedSecs} seconds.`
      } else {
        elapsedTime.textContent = `Loaded from server.`
      }
      
      summaryDiv.appendChild(elapsedTime)
      resultsDiv.appendChild(summaryDiv)

    } else {
      resultsDiv.appendChild(document.createTextNode('Thinking...'));
    }
  }
}

document.addEventListener('DOMContentLoaded', init)

const NEGATIVE_DEFAULT = -1000000;

// Function to get the values and perform a calculation
function calculateValues() {
    //console.log(textFieldRefs);

  let nestedRefs = transformToNested(textFieldRefs);
  processNestedScores(nestedRefs);
  
  // Apply chombo penalties after all rounds are processed
  const chomboValue = parseInt(document.getElementById("chomboField").value) || 0;
  for (const person in finalScores) {
      const chomboCount = chomboRefs[person] || 0;
      if (chomboCount > 0) {
          finalScores[person] += chomboValue * chomboCount;
      }
  }
  //console.log(finalScores);
}

// Function to process the nested dictionary of rounds, tables, and people
function processNestedScores(nestedDict) {
    for (let round in nestedDict) {
        if (nestedDict.hasOwnProperty(round)) {
            const tables = nestedDict[round];
            
            for (let table in tables) {
                if (tables.hasOwnProperty(table)) {
                    const peopleAtTable = tables[table];

                    // Pass the table (peopleAtTable) to another function for further processing
                    processTableScores(peopleAtTable);
                }
            }
        }
    }
}

// Function to process each table's scores and find the placement order
function processTableScores(peopleAtTable) {
    // Extract the non-zero scores (people who participated in this table)
    const oka = parseInt(document.getElementById("okaField").value);
    const uma1 = parseInt(document.getElementById("uma1").value);
    const uma2 = parseInt(document.getElementById("uma2").value);
    const uma3 = parseInt(document.getElementById("uma3").value);
    const uma4 = parseInt(document.getElementById("uma4").value);
    const starting_points = parseInt(document.getElementById("starting_points").value);

    const participants = Object.entries(peopleAtTable)
        .filter(([person, score]) => score !== NEGATIVE_DEFAULT) // Filter out non-competing people
        .sort((a, b) => b[1] - a[1]); // Sort by score in descending order

	//console.log("table is");
	//console.log(participants);
	var num_people_at_table = Object.keys(participants).length;

        let umaArr = [uma1, uma2, uma3, uma4]
        let okaArr = [oka*num_people_at_table, 0, 0, 0]

	imbueOkaAndUma(participants, num_people_at_table, starting_points, okaArr, umaArr);
}


function imbueOkaAndUma(participants, num_people_at_table, starting_points, oka_array, uma_array) {


    let adjustedOka = [...oka_array];
    let adjustedUma = [...uma_array];

    // Iterate through the participants to check for ties
    for (let i = 0; i < participants.length; i++) {
	let person = participants[i][0];
        let score = participants[i][1];
        let tiedIndices = [i]; // Start with the current index

        // Check for subsequent participants with the same score
        while (i + 1 < participants.length && participants[i + 1][1] === score) {
            tiedIndices.push(i + 1); // Add the index of the tied participant
            i++; // Move to the next participant
        }

        // If there are ties, average the corresponding values in oka_array and uma_array
        if (tiedIndices.length > 1) {
            const totalOka = tiedIndices.reduce((sum, index) => sum + adjustedOka[index], 0);
            const totalUma = tiedIndices.reduce((sum, index) => sum + adjustedUma[index], 0);
            const averageOka = totalOka / tiedIndices.length;
            const averageUma = totalUma / tiedIndices.length;

            // Update the tied indices with the averaged values
            for (const index of tiedIndices) {
                adjustedOka[index] = averageOka;
                adjustedUma[index] = averageUma;
	    }
	}
    }
    for (let rank = 0; rank < participants.length; rank++) {
        let person = participants[rank][0];
        let score = participants[rank][1];

	    const target = starting_points + oka_array[0];
	    //console.log("num people, starting points, score, oka, uma");
	    //console.log(num_people_at_table, starting_points, score, adjustedOka[rank], adjustedUma[rank]);
	    finalScores[person] = (finalScores[person] || 0) + ((score + adjustedOka[rank] - target) / 1000) + adjustedUma[rank];
    }
}

function transformToNested(textFieldRefs) {
    const nestedRefs = {}; // The new nested structure
    let maxRound = 0, maxTable = 0, maxPerson = 0;


    // First, extract the highest indices
    for (const key in textFieldRefs) {
        // Use a regex to extract numbers after 'round-', 'table-', and 'person-'
        const match = key.match(/round-(\d+)-table-(\d+)-person-(\d+)/);
        if (match) {
            const roundIndex = parseInt(match[1]);  // Extracted round number
            const tableIndex = parseInt(match[2]);  // Extracted table number
            const personIndex = parseInt(match[3]); // Extracted person number

            // Update the maximum values
            maxRound = Math.max(maxRound, roundIndex);
            maxTable = Math.max(maxTable, tableIndex);
            maxPerson = Math.max(maxPerson, personIndex);
        }
    }

    // Create the nested structure based on the max indices
    for (let r = 0; r <= maxRound; r++) {
        nestedRefs[`round-${r}`] = {};
        for (let t = 0; t <= maxTable; t++) {
            nestedRefs[`round-${r}`][`table-${t}`] = {};
            for (let p = 0; p <= maxPerson; p++) {
                // Initialize to 0 (or any other default value) if necessary
		//console.log(r, t, p)
                nestedRefs[`round-${r}`][`table-${t}`][`person-${p}`] = NEGATIVE_DEFAULT; // set to a negative default value too great to reach
            }
        }
    }


    // Move the data from flat to nested structure
    for (const key in textFieldRefs) {
        const value = textFieldRefs[key];
        const match = key.match(/round-(\d+)-table-(\d+)-person-(\d+)/);
        if (match) {
            const roundIndex = match[1];
            const tableIndex = match[2];
            const personIndex = match[3];

            // Check if the structure exists before assigning value
            if (nestedRefs[`round-${roundIndex}`] && nestedRefs[`round-${roundIndex}`][`table-${tableIndex}`]) {
                nestedRefs[`round-${roundIndex}`][`table-${tableIndex}`][`person-${personIndex}`] = value;
            } else {
                console.error(`Structure not found for round-${roundIndex}, table-${tableIndex}, person-${personIndex}`);
            }
        }
    
    }
    //console.log(nestedRefs);
    return nestedRefs; // Return the new nested structure
}

function getOrdinalSuffix(n) {
    const suffixes = ["th", "st", "nd", "rd"];
    const value = n % 100;
    return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}
