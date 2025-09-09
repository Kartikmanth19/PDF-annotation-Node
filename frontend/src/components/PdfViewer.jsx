import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import API from '../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.js', import.meta.url).toString();

export default function PdfViewer({ process }) {
  const canvasRef = useRef();
  const overlayRef = useRef();
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [annotations, setAnnotations] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [tempRect, setTempRect] = useState(null);
  const startRef = useRef(null);
  const [viewportScale, setViewportScale] = useState(1);
  const [highlightId, setHighlightId] = useState(null);

  useEffect(() => {
    async function load() {
      const url = `http://localhost:4000${process.path}`;
      const loadingTask = pdfjsLib.getDocument(url);
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setPageNum(1);
      await loadAnnotations();
    }
    load();
    
  }, [process]);

  useEffect(() => {
    if (!pdfDoc) return;
    renderPage(pageNum);

  }, [pdfDoc, pageNum]);

  async function renderPage(num) {
    const page = await pdfDoc.getPage(num);
    const scale = 1.5; 
    const viewport = page.getViewport({ scale });
    setViewportScale(scale);
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const overlay = overlayRef.current;
    overlay.style.width = canvas.width + 'px';
    overlay.style.height = canvas.height + 'px';
    overlay.style.left = canvas.offsetLeft + 'px';
    overlay.style.top = canvas.offsetTop + 'px';
    const renderContext = { canvasContext: context, viewport };
    await page.render(renderContext).promise;
  }

  async function loadAnnotations() {
    try {
      const res = await API.get(`/annotations/${process.id}`);
      setAnnotations(res.data || []);
    } catch (e) {
      console.error('Failed loading annotations', e);
    }
  }

  
  function containerCoords(e) {
    const rect = overlayRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e) {
    const p = containerCoords(e);
    startRef.current = p;
    setDrawing(true);
    setTempRect({ left: p.x, top: p.y, width: 0, height: 0 });
  }

  function onMouseMove(e) {
    if (!drawing) return;
    const p = containerCoords(e);
    const s = startRef.current;
    const left = Math.min(s.x, p.x);
    const top = Math.min(s.y, p.y);
    const width = Math.abs(p.x - s.x);
    const height = Math.abs(p.y - s.y);
    setTempRect({ left, top, width, height });
  }

  function onMouseUp() {
    if (!drawing) return;
    setDrawing(false);
    if (!tempRect || (tempRect.width < 8 || tempRect.height < 8)) {
      setTempRect(null);
      return;
    }
    const canvas = canvasRef.current;
    const x1_px = tempRect.left;
    const y1_px = tempRect.top;
    const x2_px = tempRect.left + tempRect.width;
    const y2_px = tempRect.top + tempRect.height;
    const x1_norm = +(x1_px / canvas.width).toFixed(6);
    const y1_norm = +(y1_px / canvas.height).toFixed(6);
    const x2_norm = +(x2_px / canvas.width).toFixed(6);
    const y2_norm = +(y2_px / canvas.height).toFixed(6);

    
    const ann = {
      id: null,
      process: process.id,
      form_id: process.form_id || null,
      field_id: null,
      field_name: 'field_' + Date.now(),
      field_header: '',
      bbox_pixel: [x1_px, y1_px, x2_px, y2_px],
      bbox_norm: [x1_norm, y1_norm, x2_norm, y2_norm],
      page: pageNum,
      scale: viewportScale,
      field_type: 'CharField',
      metadata: { required: false }
    };

    setAnnotations(prev => [...prev, ann]);
    setTempRect(null);
  }

  async function saveAll() {
    if (!annotations.length) return alert('No annotations to save');
    
    const payload = annotations.map(a => ({
      process: a.process,
      form_id: a.form_id,
      field_id: a.field_id,
      field_name: a.field_name,
      field_header: a.field_header,
      bbox_pixel: a.bbox_pixel,
      bbox_norm: a.bbox_norm,
      page: a.page,
      scale: a.scale,
      field_type: a.field_type,
      metadata: a.metadata || {}
    }));
    try {
      const res = await API.post('/pdf-annotation-mappings/bulk', payload);
      if (res.data && res.data.saved) {
        const saved = res.data.saved;
        const updated = annotations.map(local => {
          const match = saved.find(s =>
            s.page === local.page &&
            Array.isArray(s.bbox_norm) &&
            s.bbox_norm[0] === local.bbox_norm[0] &&
            s.bbox_norm[1] === local.bbox_norm[1]
          );
          return match ? Object.assign({}, local, match) : local;
        });
        setAnnotations(updated);
        alert(`Saved ${res.data.saved_count} mappings. ${res.data.errors.length} errors.`);
      } else {
        alert('Saved (no returned saved items).');
        await loadAnnotations();
      }
    } catch (e) {
      console.error(e);
      alert('Save failed. Check server logs.');
    }
  }

  function go(n) {
    if (n < 1 || n > numPages) return;
    setPageNum(n);
    setHighlightId(null);
  }

  function updateAnnotation(idx, patch) {
    setAnnotations(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  }
  function onClickFieldItem(item) {
    if (item.page !== pageNum) {
      setPageNum(item.page);
      setTimeout(() => setHighlightId(item.id || item.field_name), 250);
    } else {
      setHighlightId(item.id || item.field_name);
    }
  }

  return (
    <div className="viewer-root">
      <div className="toolbar">
        <button onClick={() => go(pageNum - 1)}>Prev</button>
        <span>Page {pageNum} / {numPages}</span>
        <button onClick={() => go(pageNum + 1)}>Next</button>
        <button onClick={saveAll}>Save annotations</button>
        <button onClick={loadAnnotations}>Reload annotations</button>
        <button onClick={() => {
          if (!confirm('Clear annotations for this process?')) return;
          API.delete(`/annotations/clear/${process.id}`).then(()=> loadAnnotations());
        }}>Clear (dev)</button>
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        <div className="canvas-wrap" style={{ position: 'relative', display: 'inline-block' }}>
          <canvas ref={canvasRef} style={{ border: '1px solid #333' }} />
          <div
            ref={overlayRef}
            className="overlay"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            style={{ position: 'absolute', top: 0, left: 0 }}
          >
            {}
            {annotations
              .filter(a => Number(a.page) === Number(pageNum))
              .map((a, idx) => {
                const left = a.bbox_norm ? `${(a.bbox_norm[0] * 100).toFixed(4)}%` : `${a.bbox_pixel[0]}px`;
                const top = a.bbox_norm ? `${(a.bbox_norm[1] * 100).toFixed(4)}%` : `${a.bbox_pixel[1]}px`;
                const width = a.bbox_norm ? `${((a.bbox_norm[2] - a.bbox_norm[0]) * 100).toFixed(4)}%` : `${a.bbox_pixel[2]-a.bbox_pixel[0]}px`;
                const height = a.bbox_norm ? `${((a.bbox_norm[3] - a.bbox_norm[1]) * 100).toFixed(4)}%` : `${a.bbox_pixel[3]-a.bbox_pixel[1]}px`;
                const isHighlight = (highlightId && (a.id === highlightId || a.field_name === highlightId));
                return (
                  <div
                    key={a.id || idx}
                    className={`box saved-box ${isHighlight ? 'highlight' : ''}`}
                    title={a.field_name}
                    style={{
                      position: 'absolute',
                      left,
                      top,
                      width,
                      height,
                      borderWidth: isHighlight ? '3px' : '2px',
                      borderStyle: 'dashed',
                      boxShadow: isHighlight ? '0 0 8px rgba(0,120,255,0.4)' : 'none'
                    }}
                  />
                );
              })}

            {}
            {tempRect && <div className="box temp-box" style={{
              position: 'absolute',
              left: tempRect.left + 'px',
              top: tempRect.top + 'px',
              width: tempRect.width + 'px',
              height: tempRect.height + 'px'
            }} />}
          </div>
        </div>

        <div className="sidepanel" style={{ width: 340 }}>
          <h3>Annotations (this process)</h3>
          <p><strong>Process:</strong> {process.originalName} ({process.id})</p>
          <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
            {annotations.map((a, i) => (
              <div key={a.id || i} style={{ borderBottom: '1px solid #eee', padding: 8, background: (highlightId === a.id ? '#f0f8ff' : 'transparent') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong onClick={() => onClickFieldItem(a)} style={{ cursor: 'pointer' }}>{a.field_name}</strong>
                  <span>page {a.page}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <label>Field name</label>
                  <input value={a.field_name} onChange={e => updateAnnotation(i, { field_name: e.target.value })} />
                </div>
                <div>
                  <label>Header</label>
                  <input value={a.field_header} onChange={e => updateAnnotation(i, { field_header: e.target.value })} />
                </div>
                <div>
                  <label>Field type</label>
                  <input value={a.field_type} onChange={e => updateAnnotation(i, { field_type: e.target.value })} />
                </div>
                <div>
                  <label>Form ID</label>
                  <input value={a.form_id || ''} onChange={e => updateAnnotation(i, { form_id: e.target.value })} />
                </div>
                <div>
                  <label><input type="checkbox" checked={!!(a.metadata && a.metadata.required)} onChange={e => updateAnnotation(i, { metadata: { ...a.metadata, required: e.target.checked } })} /> Required</label>
                </div>
                <div style={{ marginTop: 6 }}>
                  <small>bbox_norm: {a.bbox_norm ? a.bbox_norm.join(',') : 'n/a'}</small><br/>
                  <small>scale: {a.scale}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
