import React, { useMemo, useState } from "react";
import QRCode from "qrcode.react";

export default function ShareRouteQRCode({ shareUrl, hasRoute }) {
  const [open, setOpen] = useState(false);
  const url = useMemo(() => shareUrl || "", [shareUrl]);

  const disabled = !hasRoute || !url;

  return (
    <div className="mt-2">
      <button
        className="btn btn-outline-info btn-sm mt-3"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <i class="bi bi-qr-code-scan text-white fs-1"></i>
      </button>
      {open && url && (
        <div className="p-3 bg-dark mt-2 d-flex justify-content-center rounded-3">
          <QRCode value={url} size={152} bgColor="#0d1117" fgColor="#e8f6ff" />
        </div>
      )}
      {disabled ? (
        <div className="text-card mt-1 fst-italic slogan">Need a route</div>
      ) : (
        <div className="text-card mt-1 fst-italic slogan">Route ready</div>
      )}
    </div>
  );
}
