/* ============================================================================
   ui.js — Controls, tabs, canvas interaction, keyboard shortcuts, theming
   ----------------------------------------------------------------------------
   This module only handles INPUT and page chrome. It never touches the LVQ
   maths directly: it changes settings on the shared state object and calls
   back into main.js to rebuild or redraw.
   ========================================================================== */

window.LVQ = window.LVQ || {};

LVQ.UI = (function () {
  'use strict';

  var THEMES = {
    light: {
      plotBg: '#ffffff', grid: '#e5e7eb', axis: '#9ca3af',
      text: '#1f2430', textDim: '#6b7280', marker: '#ffffff'
    },
    dark: {
      plotBg: '#1e2229', grid: '#333944', axis: '#5b6472',
      text: '#e8eaed', textDim: '#a8afba', marker: '#191c22'
    }
  };

  var state = null;
  var app = null;
  var toastTimer = null;

  function el(id) { return document.getElementById(id); }

  function toast(message) {
    var node = el('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('is-visible'); }, 2200);
  }

  /* -- Theme --------------------------------------------------------------- */

  function applyTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    LVQ.Viz.setPalette(THEMES[name]);
    LVQ.Charts.setPalette(THEMES[name]);
    var icon = el('theme-icon');
    if (icon) icon.textContent = name === 'dark' ? '🌙' : '☀️';
    state.theme = name;
  }

  /* -- Legend + class picker ---------------------------------------------- */

  function renderClassChips() {
    var legend = el('legend-classes');
    var picker = el('class-picker');
    var html = '';
    for (var c = 0; c < state.numClasses; c++) {
      html += '<span class="legend-item"><span class="lg-swatch" style="background:'
        + LVQ.Dataset.CLASS_COLORS[c] + '"></span>' + LVQ.Dataset.CLASS_NAMES[c] + '</span>';
    }
    if (legend) legend.innerHTML = html;

    if (picker) {
      var buttons = '';
      for (var k = 0; k < state.numClasses; k++) {
        buttons += '<button type="button" class="class-btn' + (k === state.drawClass ? ' is-active' : '')
          + '" data-class="' + k + '" style="--swatch:' + LVQ.Dataset.CLASS_COLORS[k] + '">'
          + LVQ.Dataset.CLASS_NAMES[k] + '</button>';
      }
      picker.innerHTML = buttons;
    }
  }

  /* -- Experiment hint ----------------------------------------------------- */

  function updateHint() {
    var node = el('experiment-hint');
    if (!node) return;
    var parts = [];

    if (state.learningRate >= 0.3) {
      parts.push('α is high — big jumps, so prototypes can overshoot near the boundary.');
    } else if (state.learningRate <= 0.05) {
      parts.push('α is low — small steady steps, but slower to settle.');
    } else {
      parts.push('α is moderate — a reasonable default.');
    }

    if (state.numEpochs <= 3) {
      parts.push('Few epochs: little chance to adapt.');
    } else if (state.numEpochs >= 50) {
      parts.push('With decay on, the late epochs mostly fine-tune.');
    }

    if (state.datasetType === 'rings' && state.numPrototypes < state.numClasses * 3) {
      parts.push('Rings need more prototypes per class — nearest-prototype regions have straight edges.');
    }

    node.textContent = parts.join(' ');
  }

  /* -- Control synchronisation -------------------------------------------- */

  function syncOutputs() {
    el('out-classes').textContent = state.numClasses;
    el('out-points').textContent = state.numTrainingPoints;
    el('out-prototypes').textContent = state.numPrototypes;
    el('out-lr').textContent = state.learningRate.toFixed(2);
    el('out-epochs').textContent = state.numEpochs;
    el('out-speed').textContent = state.animationSpeed;

    var protoInput = el('input-prototypes');
    protoInput.min = String(state.numClasses);
    if (state.numPrototypes < state.numClasses) {
      state.numPrototypes = state.numClasses;
      protoInput.value = String(state.numPrototypes);
      el('out-prototypes').textContent = state.numPrototypes;
    }

    var perClass = (state.numPrototypes / state.numClasses);
    el('prototype-hint').textContent = '≈ '
      + (Number.isInteger(perClass) ? perClass : perClass.toFixed(1)) + ' per class.';

    el('input-points').disabled = state.datasetType === 'custom';
    updateHint();
  }

  // Enable/disable transport buttons for the current position in training.
  function syncButtons() {
    var A = LVQ.Animation;
    el('btn-prev').disabled = !A.canStepBack(state);
    var atEnd = !A.canStepForward(state);
    el('btn-next').disabled = atEnd;
    el('btn-play').disabled = atEnd;
    el('btn-epoch').disabled = atEnd;
    el('btn-train-all').disabled = atEnd;
    el('btn-play').textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
    el('btn-play').classList.toggle('is-playing', state.isPlaying);
  }

  /* -- Canvas interaction -------------------------------------------------- */

  function handleCanvasClick(event) {
    var canvas = el('main-canvas');
    var rect = canvas.getBoundingClientRect();
    var px = event.clientX - rect.left;
    var py = event.clientY - rect.top;
    if (!LVQ.Viz.isInsidePlot(px, py)) return;
    var point = LVQ.Viz.canvasToData(px, py);
    if (!point) return;

    if (state.clickMode === 'add') {
      state.trainingPoints.push(LVQ.Dataset.makePoint(point.x, point.y, state.drawClass));
      state.trainingPoints.forEach(function (p, i) { p.id = 'x' + i; });
      app.resetRun();
      toast('Added a training point to ' + LVQ.Dataset.CLASS_NAMES[state.drawClass]);
    } else {
      if (!state.prototypes.length) return;
      state.queryPoints.push({ x: point.x, y: point.y });
      if (state.queryPoints.length > 4) state.queryPoints.shift();
      var prototypes = state.viewMode === 'before' ? state.initialPrototypes : state.prototypes;
      var result = LVQ.Algorithm.classify(point, prototypes);
      LVQ.Metrics.updateQueryResult(state);
      toast('Predicted ' + LVQ.Dataset.CLASS_NAMES[result.predictedClass]
        + ' — nearest prototype ' + prototypes[result.winnerIndex].label
        + ' at distance ' + result.distance.toFixed(2));
    }
    app.refresh();
  }

  /* -- Wiring -------------------------------------------------------------- */

  function bindControls() {
    el('select-dataset').addEventListener('change', function () {
      state.datasetType = this.value;
      if (state.datasetType === 'custom') {
        setClickMode('add');
        toast('Custom dataset — click on the plot to add points');
      }
      app.rebuild({ data: true, prototypes: true });
      syncOutputs();
    });

    el('input-classes').addEventListener('input', function () {
      state.numClasses = parseInt(this.value, 10);
      if (state.drawClass >= state.numClasses) state.drawClass = 0;
      syncOutputs();
      renderClassChips();
      app.rebuild({ data: true, prototypes: true });
    });

    el('input-points').addEventListener('input', function () {
      state.numTrainingPoints = parseInt(this.value, 10);
      syncOutputs();
      app.rebuild({ data: true, prototypes: true });
    });

    el('input-seed').addEventListener('change', function () {
      state.seed = Math.max(1, parseInt(this.value, 10) || 1);
      this.value = state.seed;
      app.rebuild({ data: true, prototypes: true });
    });

    el('btn-seed').addEventListener('click', function () {
      state.seed = Math.floor(Math.random() * 99999) + 1;
      el('input-seed').value = state.seed;
      app.rebuild({ data: true, prototypes: true });
      toast('New random seed: ' + state.seed);
    });

    el('input-prototypes').addEventListener('input', function () {
      state.numPrototypes = parseInt(this.value, 10);
      syncOutputs();
      app.rebuild({ prototypes: true });
    });

    el('btn-init').addEventListener('click', function () {
      state.protoNonce += 1; // re-roll instead of repeating the same layout
      app.rebuild({ prototypes: true });
      toast('Prototypes re-initialised at new random starting positions');
    });

    el('input-lr').addEventListener('input', function () {
      state.learningRate = parseFloat(this.value);
      syncOutputs();
      app.resetRun();
    });

    el('input-decay').addEventListener('change', function () {
      state.decayEnabled = this.checked;
      app.resetRun();
    });

    el('input-epochs').addEventListener('input', function () {
      state.numEpochs = parseInt(this.value, 10);
      syncOutputs();
      app.resetRun();
    });

    el('input-speed').addEventListener('input', function () {
      state.animationSpeed = parseInt(this.value, 10);
      syncOutputs();
      if (state.isPlaying) { // restart the timer so the new speed applies now
        LVQ.Animation.pause(state);
        app.play();
      }
    });

    el('input-regions').addEventListener('change', function () {
      state.showRegions = this.checked;
    });

    el('input-test-points').addEventListener('change', function () {
      state.showTestPoints = this.checked;
      app.refresh();
    });

    el('btn-clear-queries').addEventListener('click', function () {
      state.queryPoints = [];
      app.refresh();
    });

    el('view-toggle').addEventListener('click', function (event) {
      var button = event.target.closest('.seg');
      if (!button) return;
      state.viewMode = button.dataset.view;
      this.querySelectorAll('.seg').forEach(function (b) {
        b.classList.toggle('is-active', b === button);
      });
      app.refresh();
    });

    el('click-mode').addEventListener('click', function (event) {
      var button = event.target.closest('.seg');
      if (button) setClickMode(button.dataset.mode);
    });

    el('class-picker').addEventListener('click', function (event) {
      var button = event.target.closest('.class-btn');
      if (!button) return;
      state.drawClass = parseInt(button.dataset.class, 10);
      renderClassChips();
    });
  }

  function setClickMode(mode) {
    state.clickMode = mode;
    document.querySelectorAll('#click-mode .seg').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    });
    el('class-picker').hidden = mode !== 'add';
    el('main-canvas').classList.toggle('is-adding', mode === 'add');
  }

  function bindTransport() {
    el('btn-reset').addEventListener('click', function () {
      app.resetRun();
      toast('Prototypes returned to their initial positions');
    });
    el('btn-prev').addEventListener('click', function () { app.step(-1); });
    el('btn-next').addEventListener('click', function () { app.step(1); });
    el('btn-play').addEventListener('click', function () { app.togglePlay(); });
    el('btn-epoch').addEventListener('click', function () { app.trainEpoch(); });
    el('btn-train-all').addEventListener('click', function () { app.trainAll(); });
  }

  function bindTabs() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach(function (t) {
          t.classList.toggle('is-active', t === tab);
        });
        document.querySelectorAll('.tab-panel').forEach(function (panel) {
          panel.classList.toggle('is-active', panel.dataset.panel === name);
        });
      });
    });
  }

  function bindChrome() {
    el('btn-theme').addEventListener('click', function () {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    el('btn-presentation').addEventListener('click', function () {
      state.presentationMode = !state.presentationMode;
      document.body.classList.toggle('presentation-mode', state.presentationMode);
      this.classList.toggle('is-active', state.presentationMode);
      if (state.presentationMode) {
        document.querySelector('.tab[data-tab="simulation"]').click();
        toast('Presentation mode — side panels hidden, keyboard shortcuts active');
      }
    });

    el('main-canvas').addEventListener('click', handleCanvasClick);
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      var tag = (event.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          app.togglePlay();
          break;
        case 'ArrowRight':
          event.preventDefault();
          app.step(1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          app.step(-1);
          break;
        case 'r':
        case 'R':
          app.resetRun();
          toast('Reset');
          break;
      }
    });
  }

  function init(appState, actions) {
    state = appState;
    app = actions;

    applyTheme(state.theme);
    renderClassChips();
    syncOutputs();
    setClickMode(state.clickMode);
    bindControls();
    bindTransport();
    bindTabs();
    bindChrome();
    bindKeyboard();
  }

  return { init: init, toast: toast, syncButtons: syncButtons, syncOutputs: syncOutputs, renderClassChips: renderClassChips };
})();
