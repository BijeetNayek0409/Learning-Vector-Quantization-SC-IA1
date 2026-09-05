/* ============================================================================
   dataset.js — Dataset generation
   Creates labelled 2D points for the LVQ simulator.
   All randomness goes through a seeded generator so a given seed always
   reproduces exactly the same dataset (important for a repeatable demo).
   ========================================================================== */

window.LVQ = window.LVQ || {};

LVQ.Dataset = (function () {
  'use strict';

  // The logical feature space. All data lives inside this box; the canvas
  // simply maps this box onto pixels.
  var SPACE = { minX: 0, maxX: 10, minY: 0, maxY: 10 };

  var CLASS_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b'];
  var CLASS_NAMES = ['Class A', 'Class B', 'Class C', 'Class D'];
  var MAX_CLASSES = CLASS_COLORS.length;

  /* -- Seeded pseudo-random number generator (mulberry32) ------------------
     A tiny deterministic PRNG. Math.random() cannot be seeded, so we use this
     to make every run reproducible from the "Random Seed" control. */
  function createRNG(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Standard normal sample (Box-Muller transform) driven by our seeded RNG.
  function gaussian(rng) {
    var u = 1 - rng();
    var v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clampToSpace(value, min, max) {
    var margin = 0.35;
    return Math.min(max - margin, Math.max(min + margin, value));
  }

  function makePoint(x, y, classId) {
    return {
      x: clampToSpace(x, SPACE.minX, SPACE.maxX),
      y: clampToSpace(y, SPACE.minY, SPACE.maxY),
      classId: classId
    };
  }

  /* -- Cluster helpers ---------------------------------------------------- */

  // Class centres evenly spaced on a circle around the middle of the space.
  function classCentre(classId, numClasses, radius) {
    var angle = (classId / numClasses) * Math.PI * 2 - Math.PI / 2;
    return {
      x: 5 + radius * Math.cos(angle),
      y: 5 + radius * Math.sin(angle)
    };
  }

  function gaussianCluster(rng, classId, numClasses, count, radius, spread) {
    var centre = classCentre(classId, numClasses, radius);
    var points = [];
    for (var i = 0; i < count; i++) {
      points.push(makePoint(
        centre.x + gaussian(rng) * spread,
        centre.y + gaussian(rng) * spread,
        classId
      ));
    }
    return points;
  }

  // Class 0 is a blob in the middle, every other class is a ring around it.
  // Produces a non-linearly separable problem.
  function ringCluster(rng, classId, count) {
    var points = [];
    for (var i = 0; i < count; i++) {
      if (classId === 0) {
        points.push(makePoint(5 + gaussian(rng) * 0.55, 5 + gaussian(rng) * 0.55, 0));
      } else {
        var angle = rng() * Math.PI * 2;
        var radius = 1.65 + (classId - 1) * 1.5 + gaussian(rng) * 0.26;
        points.push(makePoint(
          5 + radius * Math.cos(angle),
          5 + radius * Math.sin(angle),
          classId
        ));
      }
    }
    return points;
  }

  /* -- Public generators --------------------------------------------------
     Every generator takes (rng, classId, count) and returns that class's
     points, so the dataset dropdown just picks one of these. */
  var GENERATORS = {
    separated: function (rng, classId, numClasses, count) {
      return gaussianCluster(rng, classId, numClasses, count, 3.0, 0.62);
    },
    overlapping: function (rng, classId, numClasses, count) {
      // Keep neighbouring centres a fixed distance apart whatever the class
      // count, so the classes stay partly overlapping instead of merging.
      var radius = 3.1 / (2 * Math.sin(Math.PI / numClasses));
      return gaussianCluster(rng, classId, numClasses, count, radius, 0.95);
    },
    rings: function (rng, classId, numClasses, count) {
      return ringCluster(rng, classId, count);
    },
    custom: function () {
      return []; // The user draws these points by clicking on the canvas.
    }
  };

  // Split a requested total as evenly as possible across the classes.
  function splitCount(total, numClasses) {
    var base = Math.floor(total / numClasses);
    var remainder = total - base * numClasses;
    var counts = [];
    for (var c = 0; c < numClasses; c++) {
      counts.push(base + (c < remainder ? 1 : 0));
    }
    return counts;
  }

  /* Build the training set and a held-out test set from the same
     distribution, so "test accuracy" really measures generalisation. */
  function generate(config) {
    var rng = createRNG(config.seed);
    var generator = GENERATORS[config.datasetType] || GENERATORS.separated;
    var numClasses = config.numClasses;
    var trainCounts = splitCount(config.numTrainingPoints, numClasses);
    var testTotal = Math.max(numClasses * 3, Math.round(config.numTrainingPoints * 0.35));
    var testCounts = splitCount(testTotal, numClasses);

    var training = [];
    var test = [];

    for (var c = 0; c < numClasses; c++) {
      var needed = trainCounts[c] + testCounts[c];
      var pool = generator(rng, c, numClasses, needed);
      for (var i = 0; i < pool.length; i++) {
        if (i < trainCounts[c]) {
          training.push(pool[i]);
        } else {
          test.push(pool[i]);
        }
      }
    }

    // Give every point a stable id, useful for debugging and for labels.
    training.forEach(function (p, i) { p.id = 'x' + i; });
    test.forEach(function (p, i) { p.id = 't' + i; });

    return { trainingPoints: training, testPoints: test };
  }

  return {
    SPACE: SPACE,
    CLASS_COLORS: CLASS_COLORS,
    CLASS_NAMES: CLASS_NAMES,
    MAX_CLASSES: MAX_CLASSES,
    createRNG: createRNG,
    generate: generate,
    makePoint: makePoint
  };
})();
