/* ============================================================================
   charts.js — Minimal line charts (no charting library)
   ----------------------------------------------------------------------------
   Two small charts track training over time: accuracy per epoch and average
   prototype movement per epoch. Written by hand with the Canvas API so the
   project has zero external dependencies and works offline.
   ========================================================================== */

window.LVQ = window.LVQ || {};

LVQ.Charts = (function () {
  'use strict';

  var palette = { plotBg: '#ffffff', grid: '#e5e7eb', text: '#1f2430', textDim: '#6b7280' };
  var charts = [];

  function setPalette(next) { palette = next; }

  function niceCeil(value) {
    if (value <= 0) return 1;
    var exponent = Math.pow(10, Math.floor(Math.log10(value)));
    var scaled = value / exponent;
    var step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return step * exponent;
  }

  function createLineChart(canvas, options) {
    var chart = {
      canvas: canvas,
      series: [],
      title: options.title || '',
      percent: !!options.percent,
      emptyText: options.emptyText || 'Run training to plot this chart'
    };

    chart.setSeries = function (series) { chart.series = series; };

    chart.draw = function () {
      var ctx = canvas.getContext('2d');
      var rect = canvas.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var w = Math.max(1, Math.round(rect.width * dpr));
      var h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      var pad = { left: 38, right: 10, top: 22, bottom: 22 };
      var plotW = rect.width - pad.left - pad.right;
      var plotH = rect.height - pad.top - pad.bottom;

      ctx.fillStyle = palette.plotBg;
      ctx.fillRect(pad.left, pad.top, plotW, plotH);

      var hasData = chart.series.some(function (s) { return s.points.length > 0; });

      // Y scale: accuracy is always 0..100%, movement scales to the data.
      var maxY = 1;
      if (chart.percent) {
        maxY = 1;
      } else {
        var peak = 0;
        chart.series.forEach(function (s) {
          s.points.forEach(function (p) { if (p.y > peak) peak = p.y; });
        });
        maxY = niceCeil(peak || 0.1);
      }

      var maxX = 1;
      chart.series.forEach(function (s) {
        s.points.forEach(function (p) { if (p.x > maxX) maxX = p.x; });
      });

      // Gridlines + y labels
      ctx.strokeStyle = palette.grid;
      ctx.fillStyle = palette.textDim;
      ctx.lineWidth = 1;
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (var i = 0; i <= 4; i++) {
        var y = pad.top + (plotH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
        var value = maxY * (1 - i / 4);
        ctx.fillText(chart.percent ? Math.round(value * 100) + '%' : value.toFixed(2), pad.left - 6, y);
      }

      ctx.fillStyle = palette.textDim;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Epoch', pad.left + plotW / 2, pad.top + plotH + 6);

      // Legend first (right aligned), then the title in whatever room is left,
      // so a long title can never overlap the legend labels.
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
      var legendX = pad.left + plotW;
      if (chart.series.length > 1) { // a single series is already named by the title
        ctx.textAlign = 'right';
        for (var s = chart.series.length - 1; s >= 0; s--) {
          var series = chart.series[s];
          ctx.fillStyle = series.color;
          ctx.fillText(series.label, legendX, 4);
          legendX -= ctx.measureText(series.label).width + 14;
        }
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = palette.text;
      if (ctx.measureText(chart.title).width <= legendX - pad.left - 8) {
        ctx.fillText(chart.title, pad.left, 4);
      }

      if (!hasData) {
        ctx.fillStyle = palette.textDim;
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(chart.emptyText, pad.left + plotW / 2, pad.top + plotH / 2);
        return;
      }

      chart.series.forEach(function (series) {
        if (!series.points.length) return;
        ctx.strokeStyle = series.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        series.points.forEach(function (point, index) {
          var px = pad.left + (maxX <= 1 ? plotW / 2 : (plotW * (point.x - 1)) / (maxX - 1));
          var py = pad.top + plotH * (1 - Math.min(1, point.y / maxY));
          if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.stroke();

        if (series.points.length <= 30) { // dots stay readable only when sparse
          ctx.fillStyle = series.color;
          series.points.forEach(function (point) {
            var px = pad.left + (maxX <= 1 ? plotW / 2 : (plotW * (point.x - 1)) / (maxX - 1));
            var py = pad.top + plotH * (1 - Math.min(1, point.y / maxY));
            ctx.beginPath();
            ctx.arc(px, py, 2.6, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      });
    };

    charts.push(chart);
    return chart;
  }

  function drawAll() { charts.forEach(function (c) { c.draw(); }); }

  return { createLineChart: createLineChart, drawAll: drawAll, setPalette: setPalette };
})();
