import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface RagStatus {
  folder: string | null;
  projects: string[];
}

export const ContextChips: React.FC = () => {
  const [status, setStatus] = useState<RagStatus>({ folder: null, projects: [] });

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await invoke<RagStatus>('get_rag_status');
        setStatus(res);
      } catch (e) {
        console.error('Failed to fetch RAG status', e);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!status.folder && status.projects.length === 0) {
    return <div className="as-context-bar"><span style={{fontSize: '0.8rem', opacity: 0.6}}>교열 대기 중...</span></div>;
  }

  return (
    <div className="as-context-bar">
      {status.folder && (
        <div className="as-chip">
          <span>📁</span>
          <span>지식 폴더 연결됨</span>
        </div>
      )}
      {status.projects.map((proj) => (
        <div key={proj} className="as-chip" style={{background: '#2ecc71'}}>
          <span>📌</span>
          <span>{proj}</span>
        </div>
      ))}
    </div>
  );
};
