/**
 * Designer Print – designer.js
 * Canvas-based print layout designer with:
 *   - Text, rectangle, ellipse, line and image elements
 *   - Drag-to-move, resize handles
 *   - Properties panel (position, size, text/shape styling)
 *   - Undo / redo stack
 *   - Preset page sizes & orientations
 *   - Built-in templates (blank, invoice, label, certificate)
 *   - Browser print
 */

(function () {
  "use strict";

  /* ============================================================
     Constants
     ============================================================ */
  const PX_PER_MM = 96 / 25.4; // 96 dpi

  const PAGE_SIZES = {
    A4:     { w: 210, h: 297 },
    A3:     { w: 297, h: 420 },
    Letter: { w: 215.9, h: 279.4 },
    custom: null,
  };

  /* ============================================================
     State
     ============================================================ */
  let elements   = [];       // array of element objects
  let selected   = null;     // currently selected element id
  let nextId     = 1;
  let undoStack  = [];
  let redoStack  = [];
  let activeTool = null;     // 'text' | 'rect' | 'ellipse' | 'line' | 'image'

  let pageW = 210; // mm
  let pageH = 297; // mm

  /* drag state */
  let dragging   = false;
  let dragEl     = null;
  let dragOX     = 0;
  let dragOY     = 0;
  let dragMoved  = false;   // true once the pointer actually moves during a drag
  let resizing   = false;
  let resizeEl   = null;
  let resizeCorner = "";
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartEl = {};

  /* ============================================================
     DOM refs
     ============================================================ */
  const canvas       = document.getElementById("canvas");
  const overlay      = document.getElementById("selection-overlay");
  const noSel        = document.getElementById("no-selection");
  const elProps      = document.getElementById("element-props");
  const textPropsDiv = document.getElementById("text-props");
  const shapePropsDiv= document.getElementById("shape-props");

  /* ============================================================
     Utility
     ============================================================ */
  function mm2px(mm) { return mm * PX_PER_MM; }
  function px2mm(px) { return px / PX_PER_MM; }

  function cloneState() { return JSON.parse(JSON.stringify(elements)); }

  function saveUndo() {
    undoStack.push(cloneState());
    redoStack = [];
  }

  function applyState(state) {
    elements = JSON.parse(JSON.stringify(state));
    selected = null;
    renderAll();
    updateProps();
  }

  /* ============================================================
     Element factory
     ============================================================ */
  function makeEl(type, extra) {
    const id = "el-" + (nextId++);
    const base = {
      id, type,
      x: 20, y: 20, w: 80, h: 40,
    };
    return Object.assign(base, extra);
  }

  function makeText(extra) {
    return makeEl("text", Object.assign({
      text: "文本",
      fontSize: 14,
      color: "#000000",
      bold: false,
      italic: false,
      align: "left",
    }, extra));
  }

  function makeRect(extra) {
    return makeEl("rect", Object.assign({ fill: "#ffffff", stroke: "#000000", strokeW: 1 }, extra));
  }

  function makeEllipse(extra) {
    return makeEl("ellipse", Object.assign({ fill: "#ffffff", stroke: "#000000", strokeW: 1 }, extra));
  }

  function makeLine(extra) {
    return makeEl("line", Object.assign({ stroke: "#000000", strokeW: 2, w: 80, h: 2 }, extra));
  }

  function makeImage(src, extra) {
    return makeEl("image", Object.assign({ src, w: 80, h: 60 }, extra));
  }

  /* ============================================================
     Render
     ============================================================ */
  function renderAll() {
    // remove old DOM elements (keep selection-overlay)
    Array.from(canvas.querySelectorAll(".design-el")).forEach(n => n.remove());
    elements.forEach(renderEl);
    updateOverlay();
  }

  function renderEl(el) {
    let node = document.getElementById(el.id);
    if (!node) {
      node = document.createElement("div");
      node.id = el.id;
      node.className = "design-el";
      canvas.appendChild(node);
      addElListeners(node);
    }
    // position & size
    node.style.left   = mm2px(el.x) + "px";
    node.style.top    = mm2px(el.y) + "px";
    node.style.width  = mm2px(el.w) + "px";
    node.style.height = mm2px(el.h) + "px";
    node.classList.toggle("selected", el.id === selected);

    // inner content
    node.innerHTML = "";
    if (el.type === "text") {
      const d = document.createElement("div");
      d.className = "text-content";
      d.style.fontSize   = el.fontSize + "pt";
      d.style.color      = el.color;
      d.style.fontWeight = el.bold   ? "bold"   : "normal";
      d.style.fontStyle  = el.italic ? "italic" : "normal";
      d.style.textAlign  = el.align;
      d.style.whiteSpace = "pre-wrap";
      d.style.lineHeight = "1.4";
      d.textContent = el.text;
      node.appendChild(d);
    } else if (el.type === "rect") {
      const d = document.createElement("div");
      d.className = "shape-rect";
      d.style.background   = el.fill;
      d.style.border       = el.strokeW + "px solid " + el.stroke;
      node.appendChild(d);
    } else if (el.type === "ellipse") {
      const d = document.createElement("div");
      d.className = "shape-ellipse";
      d.style.background   = el.fill;
      d.style.border       = el.strokeW + "px solid " + el.stroke;
      node.appendChild(d);
    } else if (el.type === "line") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width",  "100%");
      svg.setAttribute("height", "100%");
      svg.style.overflow = "visible";
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "50%");
      line.setAttribute("x2", "100%");
      line.setAttribute("y2", "50%");
      line.setAttribute("stroke", el.stroke);
      line.setAttribute("stroke-width", el.strokeW);
      svg.appendChild(line);
      node.appendChild(svg);
    } else if (el.type === "image") {
      const img = document.createElement("img");
      img.src = el.src;
      img.style.width  = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      img.draggable = false;
      node.appendChild(img);
    }
  }

  /* ============================================================
     Selection overlay (resize handles)
     ============================================================ */
  function updateOverlay() {
    const el = elements.find(e => e.id === selected);
    if (!el) { overlay.style.display = "none"; return; }
    const x = mm2px(el.x);
    const y = mm2px(el.y);
    const w = mm2px(el.w);
    const h = mm2px(el.h);
    overlay.style.display = "block";
    overlay.style.left   = x + "px";
    overlay.style.top    = y + "px";
    overlay.style.width  = w + "px";
    overlay.style.height = h + "px";
  }

  /* ============================================================
     Properties panel
     ============================================================ */
  function updateProps() {
    const el = elements.find(e => e.id === selected);
    if (!el) {
      noSel.style.display   = "";
      elProps.style.display = "none";
      return;
    }
    noSel.style.display   = "none";
    elProps.style.display = "";

    document.getElementById("prop-x").value = Math.round(el.x);
    document.getElementById("prop-y").value = Math.round(el.y);
    document.getElementById("prop-w").value = Math.round(el.w);
    document.getElementById("prop-h").value = Math.round(el.h);

    const isText  = el.type === "text";
    const isShape = ["rect","ellipse","line"].includes(el.type);

    textPropsDiv.style.display  = isText  ? "" : "none";
    shapePropsDiv.style.display = isShape ? "" : "none";

    if (isText) {
      document.getElementById("prop-text").value    = el.text;
      document.getElementById("prop-fontsize").value= el.fontSize;
      document.getElementById("prop-color").value   = el.color;
      document.getElementById("prop-align").value   = el.align;
      document.getElementById("prop-bold").checked  = el.bold;
      document.getElementById("prop-italic").checked= el.italic;
    }
    if (isShape) {
      document.getElementById("prop-fill").value   = el.fill   || "#ffffff";
      document.getElementById("prop-stroke").value = el.stroke || "#000000";
      document.getElementById("prop-strokew").value= el.strokeW != null ? el.strokeW : 1;
    }
  }

  function bindProps() {
    function update(key, valFn) {
      const el = elements.find(e => e.id === selected);
      if (!el) return;
      saveUndo();
      el[key] = valFn();
      renderEl(el);
      updateOverlay();
    }
    const n = id => document.getElementById(id);

    n("prop-x").addEventListener("change",       () => update("x",         () => +n("prop-x").value));
    n("prop-y").addEventListener("change",       () => update("y",         () => +n("prop-y").value));
    n("prop-w").addEventListener("change",       () => update("w",         () => +n("prop-w").value));
    n("prop-h").addEventListener("change",       () => update("h",         () => +n("prop-h").value));
    n("prop-text").addEventListener("change",    () => update("text",      () => n("prop-text").value));
    n("prop-fontsize").addEventListener("change",() => update("fontSize",  () => +n("prop-fontsize").value));
    n("prop-color").addEventListener("input",    () => update("color",     () => n("prop-color").value));
    n("prop-align").addEventListener("change",   () => update("align",     () => n("prop-align").value));
    n("prop-bold").addEventListener("change",    () => update("bold",      () => n("prop-bold").checked));
    n("prop-italic").addEventListener("change",  () => update("italic",    () => n("prop-italic").checked));
    n("prop-fill").addEventListener("input",     () => update("fill",      () => n("prop-fill").value));
    n("prop-stroke").addEventListener("input",   () => update("stroke",    () => n("prop-stroke").value));
    n("prop-strokew").addEventListener("change", () => update("strokeW",   () => +n("prop-strokew").value));
  }

  /* ============================================================
     Element interaction (drag / click)
     ============================================================ */
  function addElListeners(node) {
    node.addEventListener("mousedown", onElMousedown);
  }

  function onElMousedown(e) {
    e.stopPropagation();
    const el = elements.find(el => el.id === e.currentTarget.id);
    if (!el) return;

    // Only change selection – do NOT saveUndo() here; we save on first actual move.
    selected = el.id;
    renderAll();
    updateProps();

    dragging  = true;
    dragMoved = false;
    dragEl    = el;
    const rect = canvas.getBoundingClientRect();
    dragOX = e.clientX - rect.left - mm2px(el.x);
    dragOY = e.clientY - rect.top  - mm2px(el.y);

    e.preventDefault();
  }

  document.addEventListener("mousemove", function (e) {
    if (dragging && dragEl) {
      if (!dragMoved) {
        saveUndo();
        dragMoved = true;
      }
      const rect = canvas.getBoundingClientRect();
      let nx = px2mm(e.clientX - rect.left - dragOX);
      let ny = px2mm(e.clientY - rect.top  - dragOY);
      nx = Math.max(0, Math.min(pageW - dragEl.w, nx));
      ny = Math.max(0, Math.min(pageH - dragEl.h, ny));
      dragEl.x = nx;
      dragEl.y = ny;
      const node = document.getElementById(dragEl.id);
      if (node) {
        node.style.left = mm2px(nx) + "px";
        node.style.top  = mm2px(ny) + "px";
      }
      updateOverlay();
      updateProps();
    }
    if (resizing && resizeEl) {
      const dx = px2mm(e.clientX - resizeStartX);
      const dy = px2mm(e.clientY - resizeStartY);
      let { x, y, w, h } = resizeStartEl;
      const minSize = 5;
      if (resizeCorner.includes("r")) w = Math.max(minSize, w + dx);
      if (resizeCorner.includes("b")) h = Math.max(minSize, h + dy);
      if (resizeCorner.includes("l")) { const nw = Math.max(minSize, w - dx); x = x + (w - nw); w = nw; }
      if (resizeCorner.includes("t")) { const nh = Math.max(minSize, h - dy); y = y + (h - nh); h = nh; }
      resizeEl.x = x; resizeEl.y = y; resizeEl.w = w; resizeEl.h = h;
      const node = document.getElementById(resizeEl.id);
      if (node) {
        node.style.left   = mm2px(x) + "px";
        node.style.top    = mm2px(y) + "px";
        node.style.width  = mm2px(w) + "px";
        node.style.height = mm2px(h) + "px";
      }
      updateOverlay();
      updateProps();
    }
  });

  document.addEventListener("mouseup", function () {
    dragging = false; dragEl = null;
    resizing = false; resizeEl = null;
  });

  // Click on canvas background: deselect
  canvas.addEventListener("mousedown", function (e) {
    if (e.target !== canvas) return;

    if (activeTool) {
      addElementAt(e);
      return;
    }

    selected = null;
    renderAll();
    updateProps();
  });

  /* ============================================================
     Add element via tool click on canvas
     ============================================================ */
  function addElementAt(e) {
    const rect = canvas.getBoundingClientRect();
    const x = px2mm(e.clientX - rect.left);
    const y = px2mm(e.clientY - rect.top);

    saveUndo();
    let el;
    if (activeTool === "text")    el = makeText({ x, y });
    else if (activeTool === "rect")    el = makeRect({ x, y });
    else if (activeTool === "ellipse") el = makeEllipse({ x, y });
    else if (activeTool === "line")    el = makeLine({ x, y });

    if (el) {
      elements.push(el);
      selected = el.id;
      activeTool = null;
      canvas.style.cursor = "";
      renderAll();
      updateProps();
    }
  }

  /* ============================================================
     Resize handle listeners
     ============================================================ */
  overlay.querySelectorAll(".handle").forEach(function (h) {
    h.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      const el = elements.find(el => el.id === selected);
      if (!el) return;
      resizing      = true;
      resizeEl      = el;
      resizeCorner  = h.classList[1]; // tl | tr | bl | br
      resizeStartX  = e.clientX;
      resizeStartY  = e.clientY;
      resizeStartEl = { x: el.x, y: el.y, w: el.w, h: el.h };
      saveUndo();
      e.preventDefault();
    });
  });

  /* ============================================================
     Toolbar tool buttons
     ============================================================ */
  document.querySelectorAll("[data-tool]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const tool = btn.dataset.tool;
      if (tool === "image") {
        document.getElementById("img-upload").click();
        return;
      }
      activeTool = tool;
      canvas.style.cursor = "crosshair";
    });
  });

  document.getElementById("img-upload").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      saveUndo();
      const el = makeImage(ev.target.result, { x: 20, y: 20 });
      elements.push(el);
      selected = el.id;
      renderAll();
      updateProps();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });

  /* ============================================================
     Keyboard shortcuts (delete, undo/redo, arrow keys)
     ============================================================ */
  document.addEventListener("keydown", function (e) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      deleteSelected();
    } else if (e.ctrlKey && e.key === "z") {
      undo();
    } else if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
      redo();
    } else if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key) && selected) {
      moveSelected(e.key, e.shiftKey ? 5 : 1);
      e.preventDefault();
    }
  });

  function deleteSelected() {
    if (!selected) return;
    saveUndo();
    elements = elements.filter(e => e.id !== selected);
    selected = null;
    renderAll();
    updateProps();
  }

  function moveSelected(key, step) {
    const el = elements.find(e => e.id === selected);
    if (!el) return;
    saveUndo();
    if (key === "ArrowLeft")  el.x = Math.max(0, el.x - step);
    if (key === "ArrowRight") el.x = Math.min(pageW - el.w, el.x + step);
    if (key === "ArrowUp")    el.y = Math.max(0, el.y - step);
    if (key === "ArrowDown")  el.y = Math.min(pageH - el.h, el.y + step);
    renderEl(el);
    updateOverlay();
    updateProps();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(cloneState());
    applyState(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(cloneState());
    applyState(redoStack.pop());
  }

  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);

  document.getElementById("btn-clear").addEventListener("click", function () {
    if (!elements.length) return;
    saveUndo();
    elements = [];
    selected = null;
    renderAll();
    updateProps();
  });

  document.getElementById("btn-delete").addEventListener("click", deleteSelected);

  /* ============================================================
     Page size / orientation
     ============================================================ */
  function applyPageSize() {
    const pxW = mm2px(pageW);
    const pxH = mm2px(pageH);
    canvas.style.width  = pxW + "px";
    canvas.style.height = pxH + "px";
    updateOverlay();
  }

  function getSizeFromInputs() {
    const sel   = document.getElementById("page-size").value;
    const orient= document.getElementById("page-orient").value;
    let sz = PAGE_SIZES[sel];
    if (!sz) {
      sz = {
        w: +document.getElementById("custom-w").value || 210,
        h: +document.getElementById("custom-h").value || 297,
      };
    }
    if (orient === "landscape") return { w: sz.h, h: sz.w };
    return { w: sz.w, h: sz.h };
  }

  document.getElementById("page-size").addEventListener("change", function () {
    const isCustom = this.value === "custom";
    document.getElementById("custom-size").style.display = isCustom ? "" : "none";
    if (!isCustom) {
      const sz = getSizeFromInputs();
      pageW = sz.w; pageH = sz.h;
      applyPageSize();
    }
  });
  document.getElementById("page-orient").addEventListener("change", function () {
    const sz = getSizeFromInputs();
    pageW = sz.w; pageH = sz.h;
    applyPageSize();
  });
  ["custom-w","custom-h"].forEach(id => {
    document.getElementById(id).addEventListener("change", function () {
      const sz = getSizeFromInputs();
      pageW = sz.w; pageH = sz.h;
      applyPageSize();
    });
  });

  /* ============================================================
     Built-in templates
     ============================================================ */
  const TEMPLATES = {
    blank: function () { return []; },
    invoice: function () {
      return [
        makeText({ x: 5, y: 8,  w: 200, h: 14, text: "发票",   fontSize: 24, bold: true, align: "center" }),
        makeText({ x: 5, y: 28, w: 100, h: 8,  text: "开票日期：2024-01-01" }),
        makeText({ x: 5, y: 40, w: 100, h: 8,  text: "发票号码：NO.000001" }),
        makeRect({ x: 5, y: 55, w: 200, h: 10, fill: "#1677ff", stroke: "#1677ff", strokeW: 0 }),
        makeText({ x: 5, y: 55, w: 60,  h: 10, text: "项目",   fontSize: 11, color: "#fff", bold: true }),
        makeText({ x: 75, y: 55, w: 50, h: 10, text: "数量",   fontSize: 11, color: "#fff", bold: true }),
        makeText({ x: 130, y: 55, w: 40, h: 10, text: "单价",  fontSize: 11, color: "#fff", bold: true }),
        makeText({ x: 170, y: 55, w: 40, h: 10, text: "金额",  fontSize: 11, color: "#fff", bold: true }),
        makeText({ x: 5, y: 68, w: 60,  h: 8, text: "服务费" }),
        makeText({ x: 75, y: 68, w: 50, h: 8, text: "1" }),
        makeText({ x: 130, y: 68, w: 40, h: 8, text: "¥500.00" }),
        makeText({ x: 170, y: 68, w: 40, h: 8, text: "¥500.00" }),
        makeLine({ x: 5, y: 80, w: 200, h: 2, stroke: "#d9d9d9" }),
        makeText({ x: 130, y: 84, w: 80, h: 8, text: "合计：¥500.00", bold: true, align: "right" }),
      ];
    },
    label: function () {
      return [
        makeRect({ x: 2, y: 2, w: 96, h: 50, fill: "#fff", stroke: "#000", strokeW: 1 }),
        makeText({ x: 5, y: 8,  w: 90, h: 10, text: "产品名称", fontSize: 14, bold: true }),
        makeText({ x: 5, y: 22, w: 90, h: 8,  text: "规格型号：XXX" }),
        makeText({ x: 5, y: 32, w: 90, h: 8,  text: "生产日期：2024-01-01" }),
        makeText({ x: 5, y: 42, w: 90, h: 8,  text: "批次号：LOT-001" }),
      ];
    },
    certificate: function () {
      return [
        makeRect({ x: 5, y: 5, w: 200, h: 287, fill: "#fffef5", stroke: "#c8a84b", strokeW: 3 }),
        makeRect({ x: 10, y: 10, w: 190, h: 277, fill: "transparent", stroke: "#c8a84b", strokeW: 1 }),
        makeText({ x: 10, y: 30, w: 190, h: 20, text: "荣誉证书", fontSize: 32, bold: true, align: "center", color: "#8b6914" }),
        makeText({ x: 20, y: 70, w: 170, h: 12, text: "兹证明 ________________ 同学", fontSize: 16, align: "center" }),
        makeText({ x: 20, y: 90, w: 170, h: 12, text: "在本次活动中表现优秀，特颁发此证书。", fontSize: 16, align: "center" }),
        makeText({ x: 20, y: 240, w: 80, h: 10, text: "颁发机构：___________" }),
        makeText({ x: 110, y: 240, w: 80, h: 10, text: "日期：___________" }),
      ];
    },
  };

  document.querySelectorAll("[data-tpl]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const tpl = btn.dataset.tpl;
      if (!TEMPLATES[tpl]) return;
      saveUndo();
      elements = TEMPLATES[tpl]();
      selected = null;
      renderAll();
      updateProps();
    });
  });

  /* ============================================================
     Print
     ============================================================ */
  document.getElementById("btn-print").addEventListener("click", function () {
    // Temporarily hide selection outline then print
    const prevSelected = selected;
    selected = null;
    renderAll();
    window.print();
    selected = prevSelected;
    renderAll();
    updateProps();
  });

  /* ============================================================
     Init
     ============================================================ */
  bindProps();
  applyPageSize();
  renderAll();
  updateProps();
})();
