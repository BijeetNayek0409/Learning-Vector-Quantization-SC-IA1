/* ============================================================================
   visualization.js — Canvas rendering of the feature space
   ----------------------------------------------------------------------------
   Draws: decision regions, grid + axes, training points, test points,
   prototypes, and the overlays for the current training step (distance lines,
   winner highlight, movement arrow).

   The data space (0..10 x 0..10) is always mapped onto a SQUARE plot area so
   that one unit on x is the same number of pixels as one unit on y. That
   matters: distances on screen must match the Euclidean distances the
   algorithm actually computes.
   ========================================================================== */

window.LVQ = window.LVQ || {};

LVQ.Viz = (function () {
  'use strict';

  var SPACE = LVQ.Dataset.SPACE;
  var COLORS = LVQ.Dataset.CLASS_COLORS;

  var PAD = { left: 46, right: 16, top: 16, bottom: 40 };

  // Status colours for the update direction, kept distinct from class colours.
  var MOVE_TOWARD_COLOR = '#16a34a';
  var MOVE_AWAY_COLOR = '#dc2626';
  var REGION_RES = 150; // decision-region grid resolution (cells per side)

  var palette = {
    plotBg: '#ffffff', grid: '#e5e7eb', axis: '#9ca3af',
    text: '#1f2430', textDim: '#6b7280', marker: '#ffffff'
  };

  var regionCanvas = document.createElement('canvas');
  var regionCache = { key: '', ready: false };
  var layout = null; // current plot geometry, refreshed every frame

  function setPalette(next) {
    palette = next;
    regionCache.key = ''; // colours changed, region image must be redrawn
  }

  /* -- Canvas sizing ------------------------------------------------------ */

  // Match the backing store to the CSS size * devicePixelRatio so lines and
  // text stay sharp on high-density displays.
  function resizeCanvas(canvas) {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      regionCache.key = '';
    }
    return { width: rect.width, height: rect.height, dpr: dpr };
  }

  function computeLayout(width, height) {
    var availW = width - PAD.left - PAD.right;
    var availH = height - PAD.top - PAD.bottom;
    var size = Math.max(40, Math.min(availW, availH));
    return {
      x: PAD.left + (availW - size) / 2,
      y: PAD.top + (availH - size) / 2,
      size: size,
      width: width,
      height: height
    };
  }

  /* -- Coordinate transforms --------------------------------------------- */

  function dataToCanvas(point) {
    var L = layout;
    return {
      x: L.x + ((point.x - SPACE.minX) / (SPACE.maxX - SPACE.minX)) * L.size,
      y: L.y + (1 - (point.y - SPACE.minY) / (SPACE.maxY - SPACE.minY)) * L.size
    };
  }

  function canvasToData(px, py) {
    var L = layout;
    if (!L) return null;
    return {
      x: SPACE.minX + ((px - L.x) / L.size) * (SPACE.maxX - SPACE.minX),
      y: SPACE.minY + (1 - (py - L.y) / L.size) * (SPACE.maxY - SPACE.minY)
    };
  }

  function isInsidePlot(px, py) {
    var L = layout;
    return L && px >= L.x && px <= L.x + L.size && py >= L.y && py <= L.y + L.size;
  }

  /* -- Small drawing helpers --------------------------------------------- */

  function hexToRgba(hex, alpha) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function drawDiamond(ctx, cx, cy, radius) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx + radius, cy);
    ctx.lineTo(cx, cy + radius);
    ctx.lineTo(cx - radius, cy);
    ctx.closePath();
  }

  function drawArrowHead(ctx, from, to, size, color) {
    var angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle - 0.42), to.y - size * Math.sin(angle - 0.42));
    ctx.lineTo(to.x - size * Math.cos(angle + 0.42), to.y - size * Math.sin(angle + 0.42));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Outlined label: plot-coloured fill with a coloured border and text.
  function drawBadge(ctx, text, x, y, color) {
    ctx.save();
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    var w = ctx.measureText(text).width + 14;
    var h = 19;
    var bx = x - w / 2;
    var by = y - h / 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 3);
    else ctx.rect(bx, by, w, h);
    ctx.fillStyle = palette.plotBg;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  /* -- Decision regions ---------------------------------------------------
     Colour every cell of a grid by the class of its nearest prototype.
     Rendered once into a small offscreen canvas and then stretched, which is
     far cheaper than shading the full-resolution canvas each frame.        */
  function buildRegionImage(prototypes) {
    var key = prototypes.map(function (p) {
      return p.classId + ':' + p.x.toFixed(3) + ',' + p.y.toFixed(3);
    }).join('|');
    if (key === regionCache.key) return;

    regionCanvas.width = REGION_RES;
    regionCanvas.height = REGION_RES;
    var rctx = regionCanvas.getContext('2d');
    var image = rctx.createImageData(REGION_RES, REGION_RES);
    var data = image.data;
    var rgb = COLORS.map(function (hex) {
      var n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });

    for (var row = 0; row < REGION_RES; row++) {
      var dy = SPACE.minY + (1 - (row + 0.5) / REGION_RES) * (SPACE.maxY - SPACE.minY);
      for (var col = 0; col < REGION_RES; col++) {
        var dx = SPACE.minX + ((col + 0.5) / REGION_RES) * (SPACE.maxX - SPACE.minX);
        var best = 0;
        var bestDist = Infinity;
        for (var i = 0; i < prototypes.length; i++) {
          var ex = dx - prototypes[i].x;
          var ey = dy - prototypes[i].y;
          var d = ex * ex + ey * ey; // squared distance is enough to compare
          if (d < bestDist) { bestDist = d; best = i; }
        }
        var c = rgb[prototypes[best].classId % rgb.length];
        var o = (row * REGION_RES + col) * 4;
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
      }
    }
    rctx.putImageData(image, 0, 0);
    regionCache.key = key;
    regionCache.ready = true;
  }

  function drawRegions(ctx, prototypes, opacity) {
    if (!prototypes.length) return;
    buildRegionImage(prototypes);
    if (!regionCache.ready) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(regionCanvas, layout.x, layout.y, layout.size, layout.size);
    ctx.restore();
  }

  /* -- Grid and axes ------------------------------------------------------ */

  function drawGrid(ctx) {
    var L = layout;
    ctx.save();
    ctx.fillStyle = palette.plotBg;
    ctx.fillRect(L.x, L.y, L.size, L.size);
    ctx.restore();
  }

  function drawGridLines(ctx) {
    var L = layout;
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = palette.textDim;

    for (var v = 0; v <= 10; v++) {
      var p = dataToCanvas({ x: v, y: v });
      ctx.globalAlpha = v % 5 === 0 ? 0.85 : 0.45;
      ctx.beginPath();
      ctx.moveTo(p.x, L.y);
      ctx.lineTo(p.x, L.y + L.size);
      ctx.moveTo(L.x, p.y);
      ctx.lineTo(L.x + L.size, p.y);
      ctx.stroke();

      if (v % 2 === 0) {
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(v), p.x, L.y + L.size + 8);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), L.x - 8, p.y);
      }
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(L.x, L.y, L.size, L.size);

    ctx.fillStyle = palette.textDim;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Feature x₁', L.x + L.size / 2, L.y + L.size + 22);
    ctx.save();
    ctx.translate(L.x - 32, L.y + L.size / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Feature x₂', 0, 0);
    ctx.restore();
    ctx.restore();
  }

  /* -- Data points -------------------------------------------------------- */

  function drawTrainingPoints(ctx, state, activeInput) {
    ctx.save();
    state.trainingPoints.forEach(function (point) {
      var p = dataToCanvas(point);
      var isActive = activeInput === point;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isActive ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[point.classId % COLORS.length];
      ctx.globalAlpha = isActive ? 1 : 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = hexToRgba(palette.marker, 0.55);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawTestPoints(ctx, state, prototypes, showResults) {
    if (!state.showTestPoints || !state.testPoints.length) return;
    var evaluation = showResults && prototypes.length
      ? LVQ.Algorithm.evaluate(state.testPoints, prototypes).results
      : null;
    ctx.save();
    state.testPoints.forEach(function (point, i) {
      var p = dataToCanvas(point);
      var color = COLORS[point.classId % COLORS.length];
      var s = 4.6;
      ctx.beginPath();
      ctx.rect(p.x - s, p.y - s, s * 2, s * 2);
      ctx.fillStyle = hexToRgba(color, 0.18);
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = color;
      ctx.stroke();

      // A misclassified test point is crossed out — readable whatever the
      // class colours happen to be.
      if (evaluation && !evaluation[i].correct) {
        ctx.strokeStyle = palette.text;
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s);
        ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s);
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  function drawPrototypes(ctx, state, prototypes, snapshot, live) {
    ctx.save();
    prototypes.forEach(function (proto, index) {
      var pos = live ? LVQ.Animation.renderPosition(state, index, proto) : proto;
      var p = dataToCanvas(pos);
      var color = COLORS[proto.classId % COLORS.length];
      var isWinner = live && snapshot && snapshot.phase >= 2 && snapshot.winnerIndex === index;

      if (isWinner) { // glow ring around the Best Matching Unit
        var pulse = 12 + Math.sin(performance.now() / 220) * 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulse + 5, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(color, 0.16);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulse + 5, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(color, 0.7);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      drawDiamond(ctx, p.x, p.y, isWinner ? 11 : 9);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = palette.text;
      ctx.stroke();

      ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = hexToRgba(palette.marker, 0.85);
      ctx.strokeText(proto.label, p.x, p.y - 13);
      ctx.fillStyle = palette.text;
      ctx.fillText(proto.label, p.x, p.y - 13);
    });
    ctx.restore();
  }

  /* -- Overlays for the current training step ----------------------------- */

  function drawStepOverlay(ctx, state, snapshot) {
    if (!snapshot) return;
    var input = snapshot.input;
    var inputPos = dataToCanvas(input);
    var phase = snapshot.phase;

    // Phase 1+: a faint line to every prototype, labelled with its distance.
    if (phase >= 1 && snapshot.distances) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      state.prototypes.forEach(function (proto, index) {
        if (phase >= 2 && index === snapshot.winnerIndex) return; // drawn solid below
        var p = dataToCanvas(LVQ.Animation.renderPosition(state, index, proto));
        ctx.beginPath();
        ctx.moveTo(inputPos.x, inputPos.y);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = hexToRgba(palette.text, phase >= 2 ? 0.16 : 0.4);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        if (phase === 1) {
          ctx.setLineDash([]);
          ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = palette.textDim;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(snapshot.distances[index].toFixed(2),
            (inputPos.x + p.x) / 2, (inputPos.y + p.y) / 2 - 7);
          ctx.setLineDash([4, 4]);
        }
      });
      ctx.restore();
    }

    // Phase 2+: the winning link, coloured once the labels are compared.
    if (phase >= 2 && snapshot.winnerIndex >= 0) {
      var winnerProto = state.prototypes[snapshot.winnerIndex];
      var wp = dataToCanvas(LVQ.Animation.renderPosition(state, snapshot.winnerIndex, winnerProto));
      var linkColor = phase >= 3
        ? (snapshot.sameClass ? MOVE_TOWARD_COLOR : MOVE_AWAY_COLOR)
        : palette.text;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(inputPos.x, inputPos.y);
      ctx.lineTo(wp.x, wp.y);
      ctx.strokeStyle = linkColor;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = linkColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var mx = (inputPos.x + wp.x) / 2;
      var my = (inputPos.y + wp.y) / 2 - 10;
      ctx.strokeStyle = hexToRgba(palette.marker, 0.8);
      ctx.lineWidth = 3;
      ctx.strokeText('d = ' + snapshot.distances[snapshot.winnerIndex].toFixed(2), mx, my);
      ctx.fillText('d = ' + snapshot.distances[snapshot.winnerIndex].toFixed(2), mx, my);
      ctx.restore();
    }

    // Phase 4/5: the movement arrow — drawn from the real before/after
    // positions, so it points toward the input on a match and away on a miss.
    if (phase >= 4 && snapshot.posBefore && snapshot.posAfter) {
      var from = dataToCanvas(snapshot.posBefore);
      var to = dataToCanvas(snapshot.posAfter);
      var moveColor = snapshot.sameClass ? MOVE_TOWARD_COLOR : MOVE_AWAY_COLOR;
      var dist = Math.hypot(to.x - from.x, to.y - from.y);
      ctx.save();
      ctx.strokeStyle = moveColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      if (dist > 3) drawArrowHead(ctx, from, to, 9, moveColor);
      ctx.beginPath();
      ctx.arc(from.x, from.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(moveColor, 0.6);
      ctx.fill();
      ctx.restore();

      drawBadge(ctx,
        snapshot.sameClass ? 'MOVE TOWARD' : 'MOVE AWAY',
        to.x, to.y + 26, moveColor);
    }

    // The current input marker sits on top of everything.
    ctx.save();
    var inputColor = COLORS[input.classId % COLORS.length];
    ctx.beginPath();
    ctx.arc(inputPos.x, inputPos.y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = inputColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(inputPos.x, inputPos.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = inputColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.text;
    ctx.stroke();
    ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    var label = 'x = (' + input.x.toFixed(1) + ', ' + input.y.toFixed(1) + ')';
    ctx.lineWidth = 3;
    ctx.strokeStyle = hexToRgba(palette.marker, 0.85);
    ctx.strokeText(label, inputPos.x + 14, inputPos.y - 10);
    ctx.fillStyle = palette.text;
    ctx.fillText(label, inputPos.x + 14, inputPos.y - 10);
    ctx.restore();
  }

  /* -- Click-to-classify query markers ------------------------------------ */

  function drawQueryPoints(ctx, state, prototypes) {
    if (!prototypes.length) return;
    ctx.save();
    state.queryPoints.forEach(function (query, i) {
      var isLatest = i === state.queryPoints.length - 1;
      var result = LVQ.Algorithm.classify(query, prototypes);
      var color = COLORS[result.predictedClass % COLORS.length];
      var p = dataToCanvas(query);
      var wp = dataToCanvas(prototypes[result.winnerIndex]);

      ctx.globalAlpha = isLatest ? 1 : 0.45;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(wp.x, wp.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(color, 0.25);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 5, p.y);
      ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5);
      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      if (isLatest) {
        drawBadge(ctx, '? → ' + LVQ.Dataset.CLASS_NAMES[result.predictedClass],
          p.x, p.y - 22, color);
      }
    });
    ctx.restore();
  }

  /* -- Main render -------------------------------------------------------- */

  function render(canvas, state) {
    var ctx = canvas.getContext('2d');
    var size = resizeCanvas(canvas);
    layout = computeLayout(size.width, size.height);

    ctx.save();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    // Which prototypes are on screen depends on the BEFORE / AFTER toggle.
    var live = state.viewMode === 'live';
    var prototypes = state.viewMode === 'before' ? state.initialPrototypes : state.prototypes;
    var snapshot = live ? state.currentSnapshot : null;

    drawGrid(ctx);
    if (state.showRegions && prototypes.length) drawRegions(ctx, prototypes, 0.18);
    drawGridLines(ctx);
    drawTestPoints(ctx, state, prototypes, state.showTestPoints);
    drawTrainingPoints(ctx, state, snapshot ? snapshot.input : null);
    drawQueryPoints(ctx, state, prototypes);
    drawStepOverlay(ctx, state, snapshot);
    drawPrototypes(ctx, state, prototypes, snapshot, live);

    if (state.viewMode !== 'live') {
      drawBadge(ctx,
        state.viewMode === 'before' ? 'BEFORE TRAINING' : 'AFTER TRAINING',
        layout.x + layout.size / 2, layout.y + 18,
        state.viewMode === 'before' ? palette.textDim : MOVE_TOWARD_COLOR);
    }

    ctx.restore();
  }

  return {
    render: render,
    setPalette: setPalette,
    canvasToData: canvasToData,
    isInsidePlot: isInsidePlot,
    invalidateRegions: function () { regionCache.key = ''; }
  };
})();
