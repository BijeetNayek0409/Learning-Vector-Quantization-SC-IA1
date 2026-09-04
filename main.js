/* ============================================================================
   main.js — Application state and wiring
   ----------------------------------------------------------------------------
   Owns the single shared state object, exposes the actions the UI can trigger
   (rebuild / reset / step / play / train) and starts the redraw loop.
   ========================================================================== */

(function () {
  'use strict';

  var Dataset = LVQ.Dataset;
  var Algorithm = LVQ.Algorithm;
  var Animation = LVQ.Animation;
  var Viz = LVQ.Viz;
  var Metrics = LVQ.Metrics;

  var canvas = document.getElementById('main-canvas');

  var state = {
    // settings (mirrored from the controls)
    datasetType: 'separated',
    numClasses: 2,
    numTrainingPoints: 40,
    numPrototypes: 4,
    learningRate: 0.1,
    decayEnabled: true,
    numEpochs: 15,
    animationSpeed: 5,
    seed: 14,
    protoNonce: 0, // bumped by "Initialize Prototypes" so the button re-rolls

    // data and model
    trainingPoints: [],
    testPoints: [],
    prototypes: [],
    initialPrototypes: [],

    // training progress
    sequence: [],
    epochStats: [],
    history: [],
    historyOffset: 0,
    globalStepIndex: -1,
    currentSnapshot: null,
    isPlaying: false,
    playTimer: null,
    tween: null,

    // view
    showRegions: true,
    showTestPoints: true,
    viewMode: 'live',
    clickMode: 'classify',
    drawClass: 0,
    queryPoints: [],
    theme: 'light',
    presentationMode: false,

    accuracyChart: null,
    movementChart: null
  };

  /* -- Actions ------------------------------------------------------------ */

  function buildData() {
    var generated = Dataset.generate({
      datasetType: state.datasetType,
      numClasses: state.numClasses,
      numTrainingPoints: state.numTrainingPoints,
      seed: state.seed
    });
    state.trainingPoints = generated.trainingPoints;
    state.testPoints = generated.testPoints;
    state.queryPoints = [];
  }

  function buildPrototypes() {
    // A separate RNG stream so that changing the dataset size does not also
    // reshuffle where the prototypes start.
    var rng = Dataset.createRNG(state.seed + 1000 + state.protoNonce * 7919);
    state.initialPrototypes = Algorithm.initializePrototypes(
      state.trainingPoints, state.numClasses, state.numPrototypes, rng
    );
  }

  // Clears all training progress. Prototypes go back to their initial
  // positions and the sample order is rebuilt for the current settings.
  function resetRun() {
    Animation.pause(state);
    var rng = Dataset.createRNG(state.seed + 2000);
    state.sequence = Algorithm.buildEpochSequence(state.trainingPoints.length, state.numEpochs, rng);
    state.history = [];
    state.historyOffset = 0;
    state.globalStepIndex = -1;
    state.currentSnapshot = null;
    state.epochStats = [];
    state.tween = null;
    state.prototypes = Animation.clonePrototypes(state.initialPrototypes);
    refresh();
  }

  function rebuild(options) {
    if (options && options.data) {
      state.protoNonce = 0; // a new dataset starts from the reproducible layout
      buildData();
    }
    if (options && (options.data || options.prototypes)) buildPrototypes();
    Viz.invalidateRegions();
    resetRun();
  }

  function refresh() {
    Metrics.updateAll(state);
    LVQ.UI.syncButtons();
    LVQ.Charts.drawAll();
  }

  function step(direction) {
    Animation.pause(state);
    if (direction > 0) Animation.stepForward(state);
    else Animation.stepBackward(state);
    refresh();
  }

  function play() {
    Animation.play(state, refresh, function () {
      refresh();
      LVQ.UI.toast('Training complete — ' + state.numEpochs + ' epochs finished');
    });
    LVQ.UI.syncButtons();
  }

  function togglePlay() {
    if (state.isPlaying) {
      Animation.pause(state);
      LVQ.UI.syncButtons();
    } else if (Animation.canStepForward(state)) {
      play();
    }
  }

  function trainEpoch() {
    Animation.pause(state);
    var snapshot = Animation.trainOneEpoch(state);
    refresh();
    if (snapshot) LVQ.UI.toast('Epoch ' + (snapshot.epoch + 1) + ' complete');
  }

  function trainAll() {
    Animation.pause(state);
    Animation.trainAll(state);
    refresh();
    LVQ.UI.toast('Training complete — ' + state.numEpochs + ' epochs finished');
  }

  /* -- Start -------------------------------------------------------------- */

  state.accuracyChart = LVQ.Charts.createLineChart(document.getElementById('chart-accuracy'), {
    title: 'Accuracy per epoch', percent: true
  });
  state.movementChart = LVQ.Charts.createLineChart(document.getElementById('chart-movement'), {
    title: 'Avg prototype movement', percent: false
  });

  LVQ.UI.init(state, {
    rebuild: rebuild,
    resetRun: resetRun,
    refresh: refresh,
    step: step,
    play: play,
    togglePlay: togglePlay,
    trainEpoch: trainEpoch,
    trainAll: trainAll
  });

  buildData();
  buildPrototypes();
  resetRun();

  window.addEventListener('resize', function () { LVQ.Charts.drawAll(); });

  Animation.startRenderLoop(function () { Viz.render(canvas, state); });

  // Handy during a viva: `LVQ.state` exposes everything in the console.
  LVQ.state = state;
})();
