/* ============================================================================
   lvq.js — THE LVQ ALGORITHM (LVQ1)
   ----------------------------------------------------------------------------
   This file contains the complete algorithm and nothing else: no drawing,
   no DOM, no animation. Every function here is small and pure, so the maths
   can be read and checked on its own.

   LVQ1 training rule, for one labelled input x:
     1. d_i = || x - w_i ||          (Euclidean distance to every prototype)
     2. winner = argmin_i d_i        (Best Matching Unit)
     3. if class(w_winner) == class(x):  w = w + alpha * (x - w)   MOVE TOWARD
        else:                            w = w - alpha * (x - w)   MOVE AWAY
     Only the winning prototype is updated. The label decides the sign — this
     is exactly what separates supervised LVQ from unsupervised K-means.
   ========================================================================== */

window.LVQ = window.LVQ || {};

LVQ.Algorithm = (function () {
  'use strict';

  /* Step 1 — distance ----------------------------------------------------- */

  // d(x, w) = sqrt( (x1-w1)^2 + (x2-w2)^2 )
  function euclideanDistance(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Distance from the input to every prototype, in prototype order.
  function computeDistances(input, prototypes) {
    return prototypes.map(function (p) {
      return euclideanDistance(input, p);
    });
  }

  /* Step 2 — Best Matching Unit ------------------------------------------- */

  // Index of the smallest distance: the winning prototype.
  function findWinnerIndex(distances) {
    var winner = 0;
    for (var i = 1; i < distances.length; i++) {
      if (distances[i] < distances[winner]) winner = i;
    }
    return winner;
  }

  /* Step 3 — the LVQ update rule ------------------------------------------
     Returns the NEW prototype position (does not mutate the old one).
     sameClass = true  ->  w_new = w_old + alpha * (x - w_old)   (toward)
     sameClass = false ->  w_new = w_old - alpha * (x - w_old)   (away)     */
  function updatePrototypePosition(prototype, input, learningRate, sameClass) {
    var sign = sameClass ? 1 : -1;
    return {
      x: prototype.x + sign * learningRate * (input.x - prototype.x),
      y: prototype.y + sign * learningRate * (input.y - prototype.y)
    };
  }

  /* Classification — nearest prototype wins, and the point inherits that
     prototype's class label. Used for accuracy, decision regions and for
     the click-anywhere query tool.                                          */
  function classify(point, prototypes) {
    var distances = computeDistances(point, prototypes);
    var winnerIndex = findWinnerIndex(distances);
    return {
      winnerIndex: winnerIndex,
      predictedClass: prototypes[winnerIndex].classId,
      distance: distances[winnerIndex],
      distances: distances
    };
  }

  // Fraction of points whose predicted class matches their true label.
  function accuracy(points, prototypes) {
    if (!points.length || !prototypes.length) return 0;
    var correct = 0;
    for (var i = 0; i < points.length; i++) {
      if (classify(points[i], prototypes).predictedClass === points[i].classId) correct++;
    }
    return correct / points.length;
  }

  // Per-point correctness, for colouring the test points on the canvas.
  function evaluate(points, prototypes) {
    var correct = 0;
    var results = points.map(function (p) {
      var r = classify(p, prototypes);
      var ok = r.predictedClass === p.classId;
      if (ok) correct++;
      return { predictedClass: r.predictedClass, winnerIndex: r.winnerIndex, correct: ok };
    });
    return { results: results, correct: correct, incorrect: points.length - correct, total: points.length };
  }

  /* Prototype initialisation ---------------------------------------------
     Every prototype is given a fixed class label (that label never changes)
     and a random starting position scattered around the centre of the data
     cloud. Starting them in the middle rather than on their own class means
     they must actually travel to their class region during training, which
     is what makes the learning visible — and it produces both correct-winner
     and wrong-winner updates. Prototypes are shared as evenly as possible
     between the classes, with at least one per class.                      */
  var INIT_SPREAD = 2.0;

  function initializePrototypes(trainingPoints, numClasses, numPrototypes, rng) {
    var total = Math.max(numClasses, numPrototypes);
    var base = Math.floor(total / numClasses);
    var remainder = total - base * numClasses;

    var centre = { x: 5, y: 5 }; // fallback when no data has been drawn yet
    if (trainingPoints.length) {
      centre.x = trainingPoints.reduce(function (s, p) { return s + p.x; }, 0) / trainingPoints.length;
      centre.y = trainingPoints.reduce(function (s, p) { return s + p.y; }, 0) / trainingPoints.length;
    }

    var prototypes = [];
    var index = 0;
    for (var c = 0; c < numClasses; c++) {
      var count = base + (c < remainder ? 1 : 0);
      for (var k = 0; k < count; k++) {
        prototypes.push({
          id: index,
          label: 'P' + (index + 1),
          classId: c,
          x: centre.x + (rng() - 0.5) * INIT_SPREAD,
          y: centre.y + (rng() - 0.5) * INIT_SPREAD
        });
        index++;
      }
    }
    return prototypes;
  }

  /* Learning rate with optional linear decay -----------------------------
     alpha(epoch) = alpha0 * (1 - epoch / totalEpochs)
     The rate shrinks each epoch so that early passes make big corrections
     and later passes only fine-tune. With decay off, alpha stays constant. */
  function learningRateAtEpoch(baseRate, epoch, totalEpochs, decayEnabled) {
    if (!decayEnabled) return baseRate;
    return baseRate * (1 - epoch / totalEpochs);
  }

  /* Presentation order of the training samples.
     Each epoch visits every training point exactly once, in a shuffled
     order (seeded, so the whole run can be replayed step by step).         */
  function buildEpochSequence(numPoints, numEpochs, rng) {
    var epochs = [];
    for (var e = 0; e < numEpochs; e++) {
      var order = [];
      for (var i = 0; i < numPoints; i++) order.push(i);
      for (var j = order.length - 1; j > 0; j--) { // Fisher-Yates shuffle
        var k = Math.floor(rng() * (j + 1));
        var tmp = order[j]; order[j] = order[k]; order[k] = tmp;
      }
      epochs.push(order);
    }
    return epochs;
  }

  return {
    euclideanDistance: euclideanDistance,
    computeDistances: computeDistances,
    findWinnerIndex: findWinnerIndex,
    updatePrototypePosition: updatePrototypePosition,
    classify: classify,
    accuracy: accuracy,
    evaluate: evaluate,
    initializePrototypes: initializePrototypes,
    learningRateAtEpoch: learningRateAtEpoch,
    buildEpochSequence: buildEpochSequence
  };
})();
