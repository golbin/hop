import React from 'react';
import * as diff from 'diff';
import { invoke } from '@tauri-apps/api/core';

interface DiffViewerProps {
  oldText: string;
  newText: string;
  onApply: () => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ oldText, newText, onApply }) => {
  const changes = diff.diffWords(oldText, newText);

  // Table Parsing Logic
  const parseTableData = (text: string): string[][] | null => {
    // 1. JSON format detection (as seen in user screenshot)
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        if (typeof data.text === 'string') {
          const rows = data.text.split('\n')
            .map(row => row.split(',').map(cell => cell.trim()))
            .filter(row => row.some(cell => cell !== ""));
          if (rows.length > 0 && rows[0].length > 1) return rows;
        }
      } catch (e) { /* ignore */ }
    }

    // 2. Markdown table detection
    const lines = text.split('\n').map(l => l.trim());
    const mdRows = lines.filter(l => l.startsWith('|') && l.endsWith('|'));
    if (mdRows.length >= 2) {
      const rows = mdRows
        .filter(r => !r.match(/^\|[\s\-:|]+\|$/)) // Exclude header separator
        .map(r => r.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim()));
      if (rows.length > 0) return rows;
    }

    return null;
  };

  const tableData = parseTableData(newText);

  const handleApply = async () => {
    onApply();
  };

  const handleSaveAs = async () => {
     console.log('Save As triggered');
  };

  return (
    <div className="as-diff-box">
      <div className="as-diff-header">
        <span>⚖️ 팀장 승인 검토 (미리보기)</span>
        <span style={{color: '#e67e22'}}>Pending Approval</span>
      </div>
      <div className="as-diff-content">
        {tableData ? (
          <div className="as-preview-table-container">
            <table className="as-preview-table">
              <thead>
                <tr>
                  {tableData[0].map((cell, i) => <th key={i}>{cell}</th>)}
                </tr>
              </thead>
              <tbody>
                {tableData.slice(1).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => <td key={j}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          changes.map((part, index) => (
            <span
              key={index}
              className={part.added ? 'as-diff-line-add' : part.removed ? 'as-diff-line-del' : ''}
            >
              {part.value}
            </span>
          ))
        )}
      </div>
      <div className="as-diff-actions">
        <button className="as-diff-btn as-diff-btn-primary" onClick={handleApply}>
          ✅ 승인 (문서 반영)
        </button>
      </div>
    </div>
  );
};
