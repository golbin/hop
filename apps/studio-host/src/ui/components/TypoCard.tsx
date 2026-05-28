import React from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface TypoInfo {
  original: string;
  fixed: string;
  reason: string;
}

interface TypoCardProps {
  typo: TypoInfo;
  onFixed: () => void;
}

export const TypoCard: React.FC<TypoCardProps> = ({ typo, onFixed }) => {
  const handleFix = async () => {
    try {
      // 문서에서 해당 오타를 찾아 수정본으로 교체 (단순 문자열 교체 예시)
      // 실제로는 edit_text_at_path 같은 정밀한 명령이 필요함
      await invoke('mutate_document', {
        docId: "active",
        operation: "replaceText",
        args: {
          findText: typo.original,
          replaceText: typo.fixed
        }
      });
      onFixed();
    } catch (e) {
      console.error('오타 수정 실패', e);
    }
  };

  return (
    <div className="as-typo-card" style={{
      padding: '10px', 
      background: 'rgba(231, 76, 60, 0.1)', 
      borderLeft: '4px solid #e74c3c',
      borderRadius: '4px',
      fontSize: '0.85rem'
    }}>
      <div style={{fontWeight: 'bold', marginBottom: '4px'}}>
        <span style={{textDecoration: 'line-through', color: '#e74c3c'}}>{typo.original}</span>
        <span style={{margin: '0 8px'}}>→</span>
        <span style={{color: '#27ae60'}}>{typo.fixed}</span>
      </div>
      <div style={{opacity: 0.8, fontSize: '0.8rem', marginBottom: '8px'}}>{typo.reason}</div>
      <button 
        onClick={handleFix}
        style={{
          padding: '4px 12px', 
          background: '#e74c3c', 
          color: 'white', 
          border: 'none', 
          borderRadius: '4px', 
          cursor: 'pointer',
          fontSize: '0.8rem'
        }}
      >
        적용하기
      </button>
    </div>
  );
};
