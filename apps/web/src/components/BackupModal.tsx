import { useState } from "react";
import { Modal } from "./Modal";

interface BackupModalProps {
  content: string;
  filename: string;
  onClose(): void;
}

export function BackupModal({ content, filename, onClose }: BackupModalProps) {
  const [message, setMessage] = useState("");

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content);
      setMessage("Đã sao chép vào clipboard.");
    } catch {
      setMessage("Không thể tự sao chép. Hãy chọn nội dung và bấm Cmd/Ctrl+C.");
    }
  };

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setMessage(`Đã yêu cầu tải “${filename}”.`);
  };

  return (
    <Modal
      title="Sao lưu dữ liệu"
      onClose={onClose}
      wide
      footer={(
        <>
          <button className="btn" type="button" onClick={() => void copy()}>Sao chép</button>
          <button className="btn primary" type="button" onClick={download}>⬇ Tải bản sao lưu</button>
          <button className="btn" type="button" onClick={onClose}>Đóng</button>
        </>
      )}
    >
      <p className="hint">Tải bản sao lưu về máy và giữ ở nơi an toàn. Bạn có thể nhập lại bản này để thay thế toàn bộ sổ hiện tại.</p>
      <textarea className="backup-text" readOnly value={content} aria-label="Nội dung sao lưu" />
      <div className="success-message" role="status">{message}</div>
    </Modal>
  );
}
