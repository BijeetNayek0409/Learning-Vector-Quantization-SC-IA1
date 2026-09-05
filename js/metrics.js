/* ============================================================================
   metrics.js — Dashboard, step explanation, distance bars, live highlighting
   ----------------------------------------------------------------------------
   Everything that reports the CURRENT state as text or bars lives here:
   the metric cards, the step-by-step calculation panel, the distance panel,
   the formula highlight and the flow-diagram highlight.
   ========================================================================== */

window.LVQ = window.LVQ || {};

LVQ.Metrics = (function () {
  'use strict';

  var A = LVQ.Algorithm;
  var CLASS_NAMES = LVQ.Dataset.CLASS_NAMES;
  var CLASS_COLORS = LVQ.Dataset.CLASS_COLORS;

  function el(id) { return document.getElementById(id); }
  function setText(id, value) { var node = el(id); if (node) node.textContent = value; }
  function percent(value) { return (value * 100).toFixed(1) + '%'; }
  function vec(point) { return '(' + point.x.toFixed(2) + ', ' + point.y.toFixed(2) + ')'; }

  function classChip(classId) {
    return '<span class="chip" style="--chip:' + CLASS_COLORS[classId % CLASS_COLORS.length] + '">'
      + CLASS_NAMES[classId] + '</span>';
  }

  /* -- Metric cards -------------------------------------------------------- */

  function updateCards(state) {
    var snapshot = state.currentSnapshot;
    var prototypes = state.prototypes;
    var started = !!snapshot;

    var trainAcc = A.accuracy(state.trainingPoints, prototypes);
    var testEval = A.evaluate(state.testPoints, prototypes);

    setText('stat-epoch', started ? (snapshot.epoch + 1) + ' / ' + state.numEpochs : '0 / ' + state.numEpochs);
    setText('stat-step', started
      ? (snapshot.sampleInEpoch + 1) + ' / ' + state.trainingPoints.length
      : '0 / ' + state.trainingPoints.length);
    setText('stat-phase', started ? LVQ.Animation.PHASES[snapshot.phase].title : 'Not started');
    setText('stat-lr', (started
      ? snapshot.learningRate
      : A.learningRateAtEpoch(state.learningRate, 0, state.numEpochs, state.decayEnabled)).toFixed(4));
    setText('stat-prototypes', String(prototypes.length));
    setText('stat-train-acc', percent(trainAcc));
    setText('stat-test-acc', testEval.total ? percent(testEval.correct / testEval.total) : '—');
    setText('stat-correct', String(testEval.correct));
    setText('stat-incorrect', String(testEval.incorrect));
    setText('stat-movement', started && snapshot.movementCount
      ? (snapshot.movementSum / snapshot.movementCount).toFixed(4)
      : '0.0000');
    setText('stat-winner', started && snapshot.winnerIndex >= 0
      ? prototypes[snapshot.winnerIndex].label + ' · ' + CLASS_NAMES[prototypes[snapshot.winnerIndex].classId]
      : '—');

    // Before / after comparison
    var beforeAcc = A.accuracy(state.trainingPoints, state.initialPrototypes);
    setText('compare-before', percent(beforeAcc));
    setText('compare-after', percent(trainAcc));
    var delta = trainAcc - beforeAcc;
    var deltaNode = el('compare-delta');
    if (deltaNode) {
      var up = delta > 0.0001, down = delta < -0.0001;
      deltaNode.textContent = (up || down)
        ? '(' + (up ? '+' : '') + (delta * 100).toFixed(1) + ')'
        : '';
      deltaNode.className = 'compare-delta ' + (up ? 'is-up' : down ? 'is-down' : '');
    }

    var progress = el('progress-fill');
    if (progress) {
      var total = LVQ.Animation.totalSteps(state);
      var done = total ? (state.globalStepIndex + 1) / total : 0;
      progress.style.width = (Math.max(0, Math.min(1, done)) * 100).toFixed(2) + '%';
    }
  }

  /* -- Step-by-step calculation panel -------------------------------------- */

  function stepPanelHTML(state, snapshot) {
    var input = snapshot.input;
    var protos = state.prototypes;
    var phase = snapshot.phase;
    var rows = [];

    rows.push('<div class="calc-row"><span>Input vector</span><code>x = ' + vec(input) + '</code></div>');
    rows.push('<div class="calc-row"><span>True label</span>' + classChip(input.classId) + '</div>');

    if (phase >= 1) {
      var lines = snapshot.distances.map(function (d, i) {
        var mark = (phase >= 2 && i === snapshot.winnerIndex) ? '  ← WINNER' : '';
        return protos[i].label + ': d = ' + d.toFixed(3) + mark;
      }).join('\n');
      rows.push('<div class="calc-block"><span>Euclidean distances</span><pre>' + lines + '</pre></div>');
    }

    if (phase >= 2) {
      var winner = protos[snapshot.winnerIndex];
      rows.push('<div class="calc-row"><span>Winner (BMU)</span><code>' + winner.label + '</code></div>');
      rows.push('<div class="calc-row"><span>Winner class</span>' + classChip(winner.classId) + '</div>');
      rows.push('<div class="calc-row"><span>Distance</span><code>d = '
        + snapshot.distances[snapshot.winnerIndex].toFixed(3) + '</code></div>');
    }

    if (phase >= 3) {
      rows.push('<div class="verdict ' + (snapshot.sameClass ? 'is-correct' : 'is-wrong') + '">'
        + (snapshot.sameClass
          ? '✓ CORRECT CLASS WINNER<small>Winner label = input label → move the prototype TOWARD the input</small>'
          : '✗ WRONG CLASS WINNER<small>Winner label ≠ input label → push the prototype AWAY from the input</small>')
        + '</div>');
    }

    if (phase >= 4 && snapshot.posBefore) {
      var sign = snapshot.sameClass ? '+' : '−';
      rows.push('<div class="calc-block"><span>Update rule applied</span><pre>'
        + 'w_new = w_old ' + sign + ' α (x − w_old)\n'
        + 'α      = ' + snapshot.learningRate.toFixed(4) + '\n'
        + 'w_old  = ' + vec(snapshot.posBefore) + '\n'
        + 'w_new  = ' + vec(snapshot.posAfter) + '\n'
        + 'moved  = ' + snapshot.movement.toFixed(4) + ' units'
        + '</pre></div>');
    }

    if (phase >= 5) {
      rows.push('<div class="calc-row"><span>Samples this epoch</span><code>'
        + (snapshot.sampleInEpoch + 1) + ' / ' + state.trainingPoints.length + '</code></div>');
      if (snapshot.epochCompleted) {
        var stats = state.epochStats[snapshot.epoch];
        var isLastEpoch = snapshot.epoch + 1 >= state.numEpochs;
        rows.push('<div class="calc-note">Epoch ' + (snapshot.epoch + 1) + ' finished · training accuracy '
          + percent(stats ? stats.trainAccuracy : 0)
          + (isLastEpoch
            ? ' · training complete'
            : (state.decayEnabled ? ' · learning rate decays for the next epoch' : ''))
          + '</div>');
      }
    }

    return rows.join('');
  }

  function updateStepPanel(state) {
    var snapshot = state.currentSnapshot;
    var title = el('step-title');
    var badge = el('step-badge');
    var body = el('step-body');
    if (!title || !body) return;

    if (!snapshot) {
      title.textContent = 'Not started';
      if (badge) badge.hidden = true;
      body.innerHTML = '<p class="empty-note">Press Next Step to begin.</p>';
      return;
    }

    var phase = snapshot.phase;
    title.textContent = 'Step ' + (phase + 1) + ' · ' + LVQ.Animation.PHASES[phase].title;
    if (badge) {
      badge.hidden = false;
      if (phase >= 3 && snapshot.sameClass !== null) {
        badge.textContent = snapshot.sameClass ? 'MOVE TOWARD' : 'MOVE AWAY';
        badge.className = 'step-badge ' + (snapshot.sameClass ? 'is-correct' : 'is-wrong');
      } else {
        badge.textContent = 'Epoch ' + (snapshot.epoch + 1);
        badge.className = 'step-badge';
      }
    }
    body.innerHTML = stepPanelHTML(state, snapshot);
  }

  /* -- Distance panel ------------------------------------------------------ */

  function updateDistancePanel(state) {
    var list = el('distance-list');
    if (!list) return;
    var snapshot = state.currentSnapshot;

    if (!snapshot || !snapshot.distances) {
      list.innerHTML = '<p class="empty-note">No sample selected yet.</p>';
      return;
    }

    var max = Math.max.apply(null, snapshot.distances) || 1;
    var html = snapshot.distances.map(function (d, i) {
      var proto = state.prototypes[i];
      var isWinner = snapshot.phase >= 2 && i === snapshot.winnerIndex;
      var color = CLASS_COLORS[proto.classId % CLASS_COLORS.length];
      return '<div class="dist-row' + (isWinner ? ' is-winner' : '') + '">'
        + '<span class="dist-label"><i style="background:' + color + '"></i>' + proto.label + '</span>'
        + '<span class="dist-track"><span class="dist-fill" style="width:'
        + ((d / max) * 100).toFixed(1) + '%;background:' + color + '"></span></span>'
        + '<span class="dist-value">' + d.toFixed(3) + '</span>'
        + (isWinner ? '<span class="dist-win">WINNER</span>' : '')
        + '</div>';
    }).join('');

    list.innerHTML = '<div class="dist-head">Input x = ' + vec(snapshot.input) + '</div>' + html;
  }

  /* -- Formula + flow diagram highlighting --------------------------------- */

  function updateHighlights(state) {
    var snapshot = state.currentSnapshot;
    var phase = snapshot ? snapshot.phase : -1;

    var activeFormula = null;
    if (phase === 1 || phase === 2) activeFormula = 'distance';
    else if (phase >= 3 && snapshot.sameClass !== null) activeFormula = snapshot.sameClass ? 'toward' : 'away';

    document.querySelectorAll('[data-formula]').forEach(function (node) {
      node.classList.toggle('is-active', node.dataset.formula === activeFormula);
    });

    var active = [];
    if (phase === 0) active = ['input'];
    else if (phase === 1) active = ['distance'];
    else if (phase === 2) active = ['winner'];
    else if (phase === 3) active = ['compare', snapshot.sameClass ? 'toward' : 'away'];
    else if (phase === 4) active = [snapshot.sameClass ? 'toward' : 'away', 'update'];
    else if (phase === 5) active = ['update', snapshot.epochCompleted ? 'next-epoch' : 'next-input'];
    if (snapshot && LVQ.Animation.isFinished(state)) active = ['final'];

    document.querySelectorAll('[data-flow]').forEach(function (node) {
      node.classList.toggle('is-active', active.indexOf(node.dataset.flow) !== -1);
    });
  }

  /* -- Charts -------------------------------------------------------------- */

  function updateCharts(state) {
    var snapshot = state.currentSnapshot;
    var visible = snapshot ? snapshot.epoch + (snapshot.epochCompleted ? 1 : 0) : 0;
    var stats = state.epochStats.slice(0, visible).filter(Boolean);

    if (state.accuracyChart) {
      state.accuracyChart.setSeries([
        { label: 'Train', color: '#3b82f6', points: stats.map(function (s) { return { x: s.epoch, y: s.trainAccuracy }; }) },
        { label: 'Test', color: '#f59e0b', points: stats.map(function (s) { return { x: s.epoch, y: s.testAccuracy }; }) }
      ]);
    }
    if (state.movementChart) {
      state.movementChart.setSeries([
        { label: 'Avg movement', color: '#16a34a', points: stats.map(function (s) { return { x: s.epoch, y: s.avgMovement }; }) }
      ]);
    }
  }

  /* -- Click-to-classify result -------------------------------------------- */

  function updateQueryResult(state) {
    var node = el('query-result');
    if (!node) return;
    var query = state.queryPoints[state.queryPoints.length - 1];
    if (!query || !state.prototypes.length) {
      node.innerHTML = '<p class="empty-note">Click the plot in Classify mode to test a point.</p>';
      return;
    }
    var prototypes = state.viewMode === 'before' ? state.initialPrototypes : state.prototypes;
    var result = A.classify(query, prototypes);
    var winner = prototypes[result.winnerIndex];
    node.innerHTML =
      '<div class="calc-row"><span>Query point</span><code>' + vec(query) + '</code></div>'
      + '<div class="calc-row"><span>Nearest prototype</span><code>' + winner.label + '</code></div>'
      + '<div class="calc-row"><span>Distance</span><code>' + result.distance.toFixed(3) + '</code></div>'
      + '<div class="calc-row"><span>Predicted class</span>' + classChip(result.predictedClass) + '</div>';
  }

  function updateAll(state) {
    updateCards(state);
    updateStepPanel(state);
    updateDistancePanel(state);
    updateHighlights(state);
    updateCharts(state);
    updateQueryResult(state);
  }

  return { updateAll: updateAll, updateQueryResult: updateQueryResult };
})();
