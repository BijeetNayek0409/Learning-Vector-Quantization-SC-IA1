/* ============================================================================
   animation.js — Step engine + animation
   ----------------------------------------------------------------------------
   Turns the LVQ algorithm into something you can walk through one screen at a
   time. Processing ONE training sample is broken into 6 visible phases:

       0 input -> 1 distances -> 2 winner -> 3 compare -> 4 move -> 5 done

   Every phase produces a SNAPSHOT that contains the complete state at that
   moment (including a copy of all prototype positions). Stepping forward from
   the frontier computes a new snapshot; stepping backward or replaying simply
   re-loads a stored one. Because state is always restored from a snapshot, an
   update can never be applied twice.
   ========================================================================== */

window.LVQ = window.LVQ || {};

LVQ.Animation = (function () {
  'use strict';

  var A = LVQ.Algorithm;

  var PHASES = [
    { key: 'input', title: 'Input vector selected', flow: 'input' },
    { key: 'distances', title: 'Distances calculated', flow: 'distance' },
    { key: 'winner', title: 'Winning prototype found', flow: 'winner' },
    { key: 'compare', title: 'Class labels compared', flow: 'compare' },
    { key: 'move', title: 'Prototype updated', flow: 'move' },
    { key: 'complete', title: 'Update complete', flow: 'update' }
  ];
  var PHASE_COUNT = PHASES.length;

  // Snapshots are capped so that "Train All" on large settings cannot grow
  // memory without bound. Older snapshots are dropped; recent ones (the part
  // a presenter would actually step back through) are always kept.
  var MAX_HISTORY = 2400;
  var TRIM_BATCH = 600;

  function clonePrototypes(prototypes) {
    return prototypes.map(function (p) {
      return { id: p.id, label: p.label, classId: p.classId, x: p.x, y: p.y };
    });
  }

  function totalSteps(state) {
    return state.numEpochs * state.trainingPoints.length * PHASE_COUNT;
  }

  function getSnapshot(state, index) {
    if (index < 0) return null;
    var i = index - state.historyOffset;
    if (i < 0 || i >= state.history.length) return null;
    return state.history[i];
  }

  function canStepBack(state) {
    if (state.globalStepIndex < 0) return false;
    if (state.globalStepIndex === 0) return true; // back to the "before training" state
    return getSnapshot(state, state.globalStepIndex - 1) !== null;
  }

  function canStepForward(state) {
    return state.globalStepIndex + 1 < totalSteps(state);
  }

  /* -- Building one new step at the frontier ------------------------------ */

  function computeFrontierStep(state) {
    var index = state.historyOffset + state.history.length; // next unseen step
    var sampleIndex = Math.floor(index / PHASE_COUNT);
    var phase = index % PHASE_COUNT;
    var pointsPerEpoch = state.trainingPoints.length;
    var epoch = Math.floor(sampleIndex / pointsPerEpoch);
    var sampleInEpoch = sampleIndex % pointsPerEpoch;

    var prev = getSnapshot(state, index - 1);
    var basePrototypes = prev ? prev.prototypes : state.initialPrototypes;
    var input = state.trainingPoints[state.sequence[epoch][sampleInEpoch]];
    var learningRate = A.learningRateAtEpoch(
      state.learningRate, epoch, state.numEpochs, state.decayEnabled
    );

    // Values computed in earlier phases of the SAME sample carry forward.
    var carry = (phase > 0 && prev) ? prev : null;
    var snap = {
      index: index,
      epoch: epoch,
      sampleInEpoch: sampleInEpoch,
      phase: phase,
      input: input,
      learningRate: learningRate,
      prototypes: clonePrototypes(basePrototypes),
      distances: carry ? carry.distances : null,
      winnerIndex: carry ? carry.winnerIndex : -1,
      sameClass: carry ? carry.sameClass : null,
      posBefore: carry ? carry.posBefore : null,
      posAfter: carry ? carry.posAfter : null,
      movement: carry ? carry.movement : 0,
      movementSum: (prev && prev.epoch === epoch) ? prev.movementSum : 0,
      movementCount: (prev && prev.epoch === epoch) ? prev.movementCount : 0,
      epochCompleted: false
    };

    switch (phase) {
      case 1: // distances to every prototype
        snap.distances = A.computeDistances(input, snap.prototypes);
        break;

      case 2: // Best Matching Unit
        snap.winnerIndex = A.findWinnerIndex(snap.distances);
        break;

      case 3: // does the winner carry the same label as the input?
        snap.sameClass = snap.prototypes[snap.winnerIndex].classId === input.classId;
        break;

      case 4: { // the actual LVQ update — the only phase that changes state
        var winner = snap.prototypes[snap.winnerIndex];
        var before = { x: winner.x, y: winner.y };
        var after = A.updatePrototypePosition(before, input, learningRate, snap.sameClass);
        winner.x = after.x;
        winner.y = after.y;
        snap.posBefore = before;
        snap.posAfter = after;
        snap.movement = A.euclideanDistance(before, after);
        snap.movementSum += snap.movement;
        snap.movementCount += 1;
        break;
      }

      case 5: // end of this sample; if the epoch ended, record its statistics
        if (sampleInEpoch === pointsPerEpoch - 1) {
          snap.epochCompleted = true;
          state.epochStats[epoch] = {
            epoch: epoch + 1,
            trainAccuracy: A.accuracy(state.trainingPoints, snap.prototypes),
            testAccuracy: A.accuracy(state.testPoints, snap.prototypes),
            avgMovement: snap.movementCount ? snap.movementSum / snap.movementCount : 0
          };
        }
        break;
    }

    state.history.push(snap);
    if (state.history.length > MAX_HISTORY) {
      state.history.splice(0, TRIM_BATCH);
      state.historyOffset += TRIM_BATCH;
    }
    return snap;
  }

  /* -- Moving the cursor -------------------------------------------------- */

  function applySnapshot(state, snapshot) {
    state.currentSnapshot = snapshot;
    state.prototypes = snapshot
      ? clonePrototypes(snapshot.prototypes)
      : clonePrototypes(state.initialPrototypes);
  }

  // Advance one phase. Returns the snapshot, or null at the end of training.
  function advance(state) {
    if (!canStepForward(state)) return null;
    var next = state.globalStepIndex + 1;
    var snapshot = getSnapshot(state, next);
    if (!snapshot) snapshot = computeFrontierStep(state);
    state.globalStepIndex = next;
    applySnapshot(state, snapshot);
    return snapshot;
  }

  function stepForward(state) {
    var snapshot = advance(state);
    if (snapshot && snapshot.phase === 4) startMoveTween(state, snapshot);
    return snapshot;
  }

  function stepBackward(state) {
    if (!canStepBack(state)) return null;
    state.tween = null;
    state.globalStepIndex -= 1;
    applySnapshot(state, getSnapshot(state, state.globalStepIndex));
    return state.currentSnapshot;
  }

  // Run many phases with no drawing in between, then let the caller redraw.
  function fastForwardTo(state, targetIndex) {
    state.tween = null;
    var limit = Math.min(targetIndex, totalSteps(state) - 1);
    var guard = 0;
    while (state.globalStepIndex < limit && guard++ < 2000000) {
      if (!advance(state)) break;
    }
    return state.currentSnapshot;
  }

  function trainOneEpoch(state) {
    if (!canStepForward(state)) return null;
    var pointsPerEpoch = state.trainingPoints.length;
    var nextSample = Math.floor((state.globalStepIndex + 1) / PHASE_COUNT);
    var epoch = Math.floor(nextSample / pointsPerEpoch);
    return fastForwardTo(state, (epoch + 1) * pointsPerEpoch * PHASE_COUNT - 1);
  }

  function trainAll(state) {
    return fastForwardTo(state, totalSteps(state) - 1);
  }

  // Jump straight to the fully trained state (used by the BEFORE/AFTER view).
  function isFinished(state) {
    return state.globalStepIndex >= totalSteps(state) - 1;
  }

  /* -- Prototype movement tween ------------------------------------------
     The data has already moved to its new position; the tween only controls
     where the marker is DRAWN, so the picture slides instead of jumping.   */
  function startMoveTween(state, snapshot) {
    if (!snapshot.posBefore || !snapshot.posAfter) return;
    state.tween = {
      prototypeIndex: snapshot.winnerIndex,
      from: snapshot.posBefore,
      to: snapshot.posAfter,
      start: performance.now(),
      duration: Math.min(520, Math.max(160, stepDelay(state) * 0.75))
    };
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // Where should prototype i be drawn right now?
  function renderPosition(state, index, prototype) {
    var tween = state.tween;
    if (!tween || tween.prototypeIndex !== index) return prototype;
    var t = (performance.now() - tween.start) / tween.duration;
    if (t >= 1) { state.tween = null; return prototype; }
    var e = easeInOut(Math.max(0, t));
    return {
      x: tween.from.x + (tween.to.x - tween.from.x) * e,
      y: tween.from.y + (tween.to.y - tween.from.y) * e
    };
  }

  /* -- Play / pause ------------------------------------------------------- */

  function stepDelay(state) {
    return Math.round(1200 / Math.max(1, state.animationSpeed));
  }

  function play(state, onTick, onFinish) {
    if (state.isPlaying) return;
    state.isPlaying = true;
    state.playTimer = setInterval(function () {
      var snapshot = stepForward(state);
      if (!snapshot) {
        pause(state);
        if (onFinish) onFinish();
        return;
      }
      if (onTick) onTick(snapshot);
    }, stepDelay(state));
  }

  function pause(state) {
    state.isPlaying = false;
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
  }

  /* -- Continuous redraw loop -------------------------------------------- */

  function startRenderLoop(drawFn) {
    function frame() {
      drawFn();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  return {
    PHASES: PHASES,
    PHASE_COUNT: PHASE_COUNT,
    clonePrototypes: clonePrototypes,
    totalSteps: totalSteps,
    canStepBack: canStepBack,
    canStepForward: canStepForward,
    stepForward: stepForward,
    stepBackward: stepBackward,
    trainOneEpoch: trainOneEpoch,
    trainAll: trainAll,
    isFinished: isFinished,
    renderPosition: renderPosition,
    play: play,
    pause: pause,
    stepDelay: stepDelay,
    startRenderLoop: startRenderLoop
  };
})();
