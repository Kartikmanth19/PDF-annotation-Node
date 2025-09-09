import React, { useState } from 'react';
import API from './api';
import PdfViewer from './components/PdfViewer';

export default function App() {
  const [file, setFile] = useState(null);
  const [process, setProcess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formId, setFormId] = useState('');

  async function handleUpload() {
    if (!file) return alert('Choose a PDF file first');
    const fd = new FormData();
    fd.append('file', file);
    setLoading(true);
    try {
      const res = await API.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const p = res.data;
      p.form_id = formId || null;
      setProcess(p);
    } catch (err) {
      console.error(err);
      alert('Upload failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <h1>PDF Annotation — Node.js + React (MVP)</h1>

      {!process ? (
        <div className="uploader">
          <div>
            <label>Form ID (optional): </label>
            <input value={formId} onChange={e => setFormId(e.target.value)} placeholder="20" />
          </div>
          <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files[0])} />
          <button onClick={handleUpload} disabled={loading}>{loading ? 'Uploading...' : 'Upload PDF'}</button>
          <p style={{opacity:0.8}}>Uploaded PDFs are served from backend /uploads folder.</p>
          <hr/>
          <p>Or open an existing process (debug):</p>
          <OpenExisting setProcess={setProcess} />
        </div>
      ) : (
        <PdfViewer process={process} />
      )}
    </div>
  );
}

function OpenExisting({ setProcess }) {
  const [list, setList] = useState(null);
  const load = async () => {
    const res = await API.get('/processes');
    setList(res.data);
  };
  return (
    <div>
      <button onClick={load}>Load processes</button>
      {list && (
        <ul>
          {list.map(p => (
            <li key={p.id}>
              {p.originalName} — <button onClick={() => setProcess(p)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
